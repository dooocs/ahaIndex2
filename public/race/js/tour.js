// 开场航拍：全景 → 沿平滑长方形巡游一圈 → 回到全景。仅控制片头，不推进比赛。
import * as LY from './layout.js';

export const LANDMARKS = [
  { name: '断桥', detail: '白堤东端', at: [224, -402], lift: 12 },
  { name: '雷峰塔', detail: '雷峰夕照', at: LY.LEIFENG, lift: 58 },
  { name: '苏堤', detail: '一堤烟柳 · 六座拱桥', at: LY.SUDI[2], lift: 12 },
  { name: '三潭印月', detail: '小瀛洲南侧', at: LY.SANTAN[1], lift: 12 },
  { name: '龙翔桥', detail: '起点 / 终点', at: LY.START_AT, lift: 14 },
];

const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const blend = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
export const TOUR = { overview: 1, descend: 3, lap: 62, ascend: 7 };
export const TOUR_DURATION = Object.values(TOUR).reduce((a, b) => a + b, 0);

export function createTour(track, groundAt, start) {
  // 仅露出完整赛道及其近旁景物，外围城区和树林在片头雾中隐去。
  const pad = track.halfW + 24;
  const bounds = [Math.min(...track.px) - pad, Math.min(...track.pz) - pad,
    Math.max(...track.px) + pad, Math.max(...track.pz) + pad];
  const cx = (bounds[0] + bounds[2]) / 2, cz = (bounds[1] + bounds[3]) / 2;
  // 无人机走四条长直线与四段圆角，不追随赛道的发卡弯和城市绕行。
  const left = bounds[0] + 100, right = bounds[2] - 100;
  const top = bounds[1] + 100, bottom = bounds[3] - 100;
  const radius = Math.min(100, (right - left) / 4, (bottom - top) / 4);
  const legs = [];
  const line = (x0, z0, x1, z1) => legs.push({ length: Math.hypot(x1 - x0, z1 - z0), at: t => [mix(x0, x1, t), mix(z0, z1, t)] });
  const arc = (x, z, angle) => legs.push({ length: Math.PI * radius / 2, at: t => [x + Math.cos(angle - t * Math.PI / 2) * radius, z + Math.sin(angle - t * Math.PI / 2) * radius] });
  arc(right - radius, top + radius, 0);
  line(right - radius, top, left + radius, top);
  arc(left + radius, top + radius, -Math.PI / 2);
  line(left, top + radius, left, bottom - radius);
  arc(left + radius, bottom - radius, Math.PI);
  line(left + radius, bottom, right - radius, bottom);
  arc(right - radius, bottom - radius, Math.PI / 2);
  line(right, bottom - radius, right, top + radius);
  const perimeter = legs.reduce((sum, leg) => sum + leg.length, 0);
  const startZ = Math.max(top + radius, Math.min(bottom - radius, track.sample(start, {}).z));
  const startOffset = perimeter - (startZ - top - radius);
  function rectangleAt(distance) {
    let d = ((distance + startOffset) % perimeter + perimeter) % perimeter;
    for (const leg of legs) {
      if (d <= leg.length) return leg.at(d / leg.length);
      d -= leg.length;
    }
    return [right, top + radius];
  }
  let fittedAspect, overview;
  function fitOverview(aspect) {
    if (fittedAspect === aspect) return overview;
    const tilt = 0.38, tan = Math.tan(58 * Math.PI / 360), tiltLength = Math.hypot(1, tilt);
    let height = 0;
    // 用实际赛道范围拟合机位，不再用固定的高空高度展示整个世界。
    for (const x of [bounds[0], bounds[2]]) for (const z of [bounds[1], bounds[3]]) for (const y of [0, 65]) {
      const dz = z - cz;
      const depth = Math.max(Math.abs(tilt * y - dz) / (0.94 * tan),
        Math.abs(x - cx) * tiltLength / (0.9 * tan * Math.max(0.3, aspect)));
      height = Math.max(height, (depth + tilt * dz + y) / (1 + tilt * tilt));
    }
    fittedAspect = aspect;
    overview = { position: [cx, height, cz + height * tilt], look: [cx, 0, cz] };
    return overview;
  }
  function aerial(progress) {
    const [x, z] = rectangleAt(progress * perimeter), [ax, az] = rectangleAt(progress * perimeter + 95);
    return {
      position: [x, Math.max(groundAt(x, z), 0) + 205, z],
      look: [mix(ax, cx, 0.12), 0, mix(az, cz, 0.12)],
    };
  }
  return {
    bounds,
    sample(time, aspect = 1) {
      const t = ((time % TOUR_DURATION) + TOUR_DURATION) % TOUR_DURATION;
      const overview = fitOverview(aspect);
      const first = aerial(0);
      if (t < TOUR.overview) return { ...overview, phase: 'overview', progress: 0, reveal: 1 };
      const flightStart = TOUR.overview + TOUR.descend;
      if (t < flightStart) {
        const f = smooth((t - TOUR.overview) / TOUR.descend);
        return { position: blend(overview.position, first.position, f), look: blend(overview.look, first.look, f), phase: 'descend', progress: 0, reveal: 1 - f };
      }
      if (t < flightStart + TOUR.lap) {
        const progress = smooth((t - flightStart) / TOUR.lap);
        return { ...aerial(progress), phase: 'lap', progress, reveal: 0 };
      }
      const f = smooth((t - flightStart - TOUR.lap) / TOUR.ascend);
      return { position: blend(first.position, overview.position, f), look: blend(first.look, overview.look, f), phase: 'ascend', progress: 1, reveal: f };
    },
  };
}

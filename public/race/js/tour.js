// 开场航拍：全景 → 沿真实赛道巡游一圈 → 回到全景。仅控制片头，不推进比赛。
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
export const TOUR = { overview: 5, descend: 7, lap: 62, ascend: 7, rest: 3 };
export const TOUR_DURATION = Object.values(TOUR).reduce((a, b) => a + b, 0);

export function createTour(track, groundAt, start) {
  function aerial(d) {
    const s = track.sample(d, {}), ahead = track.sample(d + 95, {});
    // 向湖心稍收，避免紧弯时机位在赛道两侧突然切换；高度越过群树和山脊。
    const r = Math.hypot(s.x, s.z) || 1;
    const x = s.x - s.x / r * 85, z = s.z - s.z / r * 85;
    return {
      position: [x, Math.max(groundAt(x, z), s.y) + 205, z],
      look: [ahead.x * 0.88, ahead.y, ahead.z * 0.88],
    };
  }
  return {
    sample(time, aspect = 1) {
      const t = ((time % TOUR_DURATION) + TOUR_DURATION) % TOUR_DURATION;
      // 北在上，略带倾角；窄屏拉高，给整圈赛道留出边距。
      const height = Math.max(1150, 780 / Math.max(0.3, aspect));
      const overview = { position: [80, height, 30 + height * 0.38], look: [80, 0, 30] };
      const first = aerial(start);
      if (t < TOUR.overview) return { ...overview, phase: 'overview', progress: 0 };
      const flightStart = TOUR.overview + TOUR.descend;
      if (t < flightStart) {
        const f = smooth((t - TOUR.overview) / TOUR.descend);
        return { position: blend(overview.position, first.position, f), look: blend(overview.look, first.look, f), phase: 'descend', progress: 0 };
      }
      if (t < flightStart + TOUR.lap) {
        const progress = smooth((t - flightStart) / TOUR.lap);
        return { ...aerial(start + progress * track.length), phase: 'lap', progress };
      }
      const f = smooth((t - flightStart - TOUR.lap) / TOUR.ascend);
      return { position: blend(first.position, overview.position, f), look: blend(first.look, overview.look, f), phase: 'overview', progress: 1 };
    },
  };
}

// 从游戏前端的赛道数据（public/race/js/layout.js + track.js）导出服务器判定要用的西湖赛道：
// 检查点、发车位、赛道长度。赛道改动后重新跑一次，提交生成的 JSON 即可。
//
//   cd game-server && npm run export:track
//
// 输出：
//   src/tracks/xihu.json            服务器读取
//   test/fixtures/xihu-centerline.json  单测用的中心线（每 3 米一个点，带右向量）

import { writeFileSync } from 'node:fs';
import { Track } from '../../public/race/js/track.js';
import * as LY from '../../public/race/js/layout.js';

const CHECKPOINT_SPACING = 210; // 米；环湖一圈约 20 个
const DEFAULT_RADIUS = 16; // 门的半长：路宽 22 米，半宽 11 米，留 5 米余量
const MIN_RADIUS = 12;
const NEIGHBOR_GAP = 100; // 沿路距离超过这个值的路段才算「别的路段」（用于发卡弯相邻路段检查）

const track = new Track(LY.CENTERLINE, LY.ROAD_WIDTH);
const L = track.length;
const D_START = track.dAt(...LY.START_AT); // 与 main.js 相同
const round = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

/** 检查点中心到「沿路不相邻的其他路段」中心线的最近距离。 */
function clearance(d, x, z) {
  let best = Infinity;
  for (let i = 0; i < track.N; i++) {
    const di = i * track.ds;
    let gap = Math.abs(di - d) % L;
    gap = Math.min(gap, L - gap);
    if (gap < NEIGHBOR_GAP) continue;
    best = Math.min(best, Math.hypot(track.px[i] - x, track.pz[i] - z));
  }
  return best;
}

const n = Math.round(L / CHECKPOINT_SPACING);
const checkpoints = [];
for (let k = 1; k <= n; k++) {
  const d = track.wrapD(D_START + (k * L) / n); // k = n 时正好回到起终点线
  const s = track.sample(d, {});
  const c = clearance(d, s.x, s.z);
  // 半径不能大到让隔壁路段（如三台山发卡弯的另一条腿）上的车也碰到它
  const r = Math.max(MIN_RADIUS, Math.min(DEFAULT_RADIUS, c - LY.ROAD_WIDTH / 2 - 3));
  // tx, tz：赛道前进方向（单位向量），服务器据此把检查点当成一道「门」，只认正向穿过
  checkpoints.push({
    x: round(s.x), z: round(s.z), tx: round4(s.tx), tz: round4(s.tz), r: round(r),
    d: round((k * L) / n), clearance: round(c),
  });
}

// 发车位与 main.js 的 gridSlot(k) 一致：起点线后 10 米起每 8 米一排，左右交错 4.8 米
const grid = [0, 1, 2, 3].map((k) => {
  const s = track.sample(D_START - 10 - k * 8, {});
  const lat = k % 2 ? 4.8 : -4.8;
  return { x: round(s.x + s.rx * lat), z: round(s.z + s.rz * lat), rot: round(s.hd) };
});

const out = {
  id: 'xihu',
  generatedBy: 'game-server/scripts/export-xihu-track.mjs',
  source: 'public/race/js/layout.js CENTERLINE + track.js Track',
  length: round(L),
  roadWidth: LY.ROAD_WIDTH,
  checkpoints,
  grid,
};
writeFileSync(new URL('../src/tracks/xihu.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');

// 单测夹具：从起点线开始沿行驶方向每 3 米一个点，[x, z, 右向量 x, 右向量 z]
const pts = [];
for (let d = 0; d < L; d += 3) {
  const s = track.sample(D_START + d, {});
  pts.push([round(s.x), round(s.z), round(s.rx), round(s.rz)]);
}
writeFileSync(new URL('../test/fixtures/xihu-centerline.json', import.meta.url), JSON.stringify(pts) + '\n');

const tight = checkpoints.filter((c) => c.r < DEFAULT_RADIUS);
console.log(`赛道长 ${L.toFixed(1)} 米，${checkpoints.length} 个检查点，间距约 ${(L / n).toFixed(0)} 米`);
console.log(`离其他路段最近的检查点：${Math.min(...checkpoints.map((c) => c.clearance)).toFixed(1)} 米`);
if (tight.length) console.log(`因隔壁路段太近而缩小半径的检查点：${tight.map((c) => `#${checkpoints.indexOf(c) + 1}(r=${c.r})`).join('，')}`);
console.log(`夹具：${pts.length} 个中心线点`);

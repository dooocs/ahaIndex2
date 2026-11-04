// 赛道定义。服务器只关心判定需要的数据：检查点、发车位、圈数、速度上限。
//
// 坐标与朝向与游戏前端（public/race/js/track.js）一致：
// 水平面 x（东）/ z（南），高度 y；朝向 rot 即游戏里的 h，前进方向 = (sin rot, cos rot)。
// checkpoints 按行驶顺序排列，最后一个就是终点线；跑完 laps 圈即完赛。
// 每个检查点是一道垂直于赛道的「门」：中心 (x, z)、赛道方向 (tx, tz)、半长 r，只认正向穿过。
//
// 只有配了检查点的赛道，成绩才由服务器验证并写库。

import { readFileSync } from 'node:fs';

const round = (v) => Math.round(v * 100) / 100;

/** 测试用椭圆赛道（/test 页面使用），用来验证整条联机链路。 */
function buildTestOval() {
  const rx = 300;
  const rz = 180;
  const startAngle = Math.PI / 2; // 起点在 (0, 180)，沿角度增大方向行驶（起点处朝 -x）
  const n = 8;
  const checkpoints = [];
  for (let k = 1; k <= n; k++) {
    const a = startAngle + (k * 2 * Math.PI) / n;
    // 门的方向 = 沿角度增大方向的切线
    const tx = -rx * Math.sin(a);
    const tz = rz * Math.cos(a);
    const len = Math.hypot(tx, tz);
    checkpoints.push({ x: round(rx * Math.cos(a)), z: round(rz * Math.sin(a)), tx: tx / len, tz: tz / len, r: 50 });
  }
  // 朝 -x：sin(rot) = -1 → rot = -π/2。发车位排在起点线后方（+x 一侧），两两并排
  const rot = round(-Math.PI / 2);
  const grid = [
    { x: 30, z: 165, rot },
    { x: 30, z: 195, rot },
    { x: 65, z: 165, rot },
    { x: 65, z: 195, rot },
  ];
  return {
    id: 'test-oval',
    name: '联机测试椭圆赛道',
    laps: 2,
    maxSpeed: 80, // 米/秒，含少量余量
    minRaceMs: 20000,
    checkpoints,
    grid,
    shape: { type: 'ellipse', rx, rz, width: 70 },
    recordResults: false,
  };
}

/**
 * 西湖赛道：检查点和发车位由 scripts/export-xihu-track.mjs 从游戏赛道数据导出。
 * 游戏赛道改了以后要重新导出，否则服务器的检查点会和画面对不上。
 */
function buildXihu() {
  const data = JSON.parse(readFileSync(new URL('./tracks/xihu.json', import.meta.url), 'utf8'));
  return {
    id: 'xihu',
    name: '西湖飞车',
    laps: 2, // 与单机模式一致，成绩可以和单机榜对比
    // 游戏最高 260 km/h（72 m/s，氮气/小喷/加速带/起步加速），留 1.2 倍余量给碰撞推挤和网络抖动
    maxSpeed: 85,
    // 与单机榜 race_scores 的校验一致：两圈不可能少于 120 秒
    minRaceMs: 120000,
    length: data.length,
    checkpoints: data.checkpoints.map(({ x, z, tx, tz, r }) => ({ x, z, tx, tz, r })),
    grid: data.grid,
    recordResults: true,
  };
}

export const TRACKS = {
  'test-oval': buildTestOval(),
  xihu: buildXihu(),
};

export const DEFAULT_TRACK = 'xihu';

export function getTrack(id) {
  return Object.hasOwn(TRACKS, id) ? TRACKS[id] : null;
}

/** 服务器能否独立判定这条赛道的完赛（决定成绩是否可信、是否写库）。 */
export function isVerifiedTrack(track) {
  return Array.isArray(track.checkpoints) && track.checkpoints.length > 0 && Number.isFinite(track.maxSpeed);
}

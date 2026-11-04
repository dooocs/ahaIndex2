// 比赛判定的纯函数部分（不依赖网络和房间），单独拿出来方便单测。

/** 点 p 到线段 a-b 的水平距离，用来判断这一帧的移动轨迹有没有扫过检查点。 */
export function segmentDistance(ax, az, bx, bz, px, pz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx - px, az + t * dz - pz);
}

/**
 * 这一步移动有没有「正向」穿过检查点的门。
 * 门是过检查点中心、垂直于赛道方向 (tx, tz) 的线段，半长 r。
 * 只认从门后（沿赛道方向的投影 < 0）开到门上或门前（≥ 0），并且穿越点离中心不超过 r；
 * 倒着开、从旁边路段擦过都不算。没给方向的检查点退化为圆形判定（离中心 r 以内）。
 */
export function crossesGate(cp, ax, az, bx, bz) {
  if (!Number.isFinite(cp.tx) || !Number.isFinite(cp.tz)) {
    return segmentDistance(ax, az, bx, bz, cp.x, cp.z) <= cp.r;
  }
  const sa = (ax - cp.x) * cp.tx + (az - cp.z) * cp.tz;
  const sb = (bx - cp.x) * cp.tx + (bz - cp.z) * cp.tz;
  if (!(sa < 0 && sb >= 0)) return false;
  const u = -sa / (sb - sa);
  const qx = ax + u * (bx - ax) - cp.x;
  const qz = az + u * (bz - az) - cp.z;
  // 门方向 = 赛道方向转 90°
  const lateral = qx * cp.tz - qz * cp.tx;
  return Math.abs(lateral) <= cp.r;
}

/**
 * 车从 (ax, az) 移动到 (bx, bz)，按顺序推进检查点和圈数。
 * progress = { lap, cp }：lap 已完成圈数，cp 下一个要过的检查点下标。会被就地修改。
 * 返回这一步完成的圈数（0 或 1），以及是否完赛。
 */
export function advanceCheckpoints(track, progress, ax, az, bx, bz) {
  const cps = track.checkpoints;
  let lapsDone = 0;
  let finished = false;
  // 一帧最多连过 2 个检查点（检查点很密时可能发生），防止刷圈
  for (let i = 0; i < 2 && !finished; i++) {
    if (!crossesGate(cps[progress.cp], ax, az, bx, bz)) break;
    progress.cp += 1;
    if (progress.cp >= cps.length) {
      progress.cp = 0;
      progress.lap += 1;
      lapsDone += 1;
      if (progress.lap >= track.laps) finished = true;
    }
  }
  return { lapsDone, finished };
}

/**
 * 速度额度检查：额度按时间以 maxSpeed 累积、最多攒 1 秒，每次移动扣掉移动距离。
 * 网络抖动导致几条消息扎堆到达时，攒下的额度能吸收，不会误判。
 * 返回 { ok, allowance }。
 */
export function checkSpeed(allowance, maxSpeed, elapsedSec, dist) {
  const budget = Math.min(allowance + maxSpeed * Math.max(0, elapsedSec), maxSpeed);
  if (dist > budget + 1) return { ok: false, allowance: 0 };
  return { ok: true, allowance: budget - dist };
}

/** 实时名次：已完赛的按完赛顺序在前，其余按 圈数 → 检查点 → 离下一个检查点的距离 排。 */
export function rankRunning(track, racers) {
  const cps = track.checkpoints;
  const remaining = (r) => {
    if (!cps.length) return 0;
    const cp = cps[r.cp];
    return Math.hypot(r.x - cp.x, r.z - cp.z);
  };
  return [...racers].sort((a, b) => (b.lap - a.lap) || (b.cp - a.cp) || (remaining(a) - remaining(b)));
}

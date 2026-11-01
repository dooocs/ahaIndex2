// 走线：在路宽内找一条曲率尽量小的线（外—内—外），AI、自动驾驶和调参都按它算过弯速度。
// 做法：反复让每个点的“弯曲程度”向前后邻居看齐（四阶差分平滑，压的是曲率而不是长度），横向不出路面，从大尺度到小尺度各做几百遍。
export function racingLine(track, margin) {
  const N = track.N, lat = new Float32Array(N), W = track.halfW - margin;
  const P = i => { i = (i % N + N) % N; return [track.px[i] + track.rx[i] * lat[i], track.pz[i] + track.rz[i] * lat[i]]; };
  for (const [s, iters] of [[40, 160], [20, 160], [10, 160], [5, 120]]) {
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < N; i++) {
        const a = P(i - 2 * s), b = P(i - s), c = P(i + s), d = P(i + 2 * s);
        const mx = (-a[0] + 4 * b[0] + 4 * c[0] - d[0]) / 6, mz = (-a[1] + 4 * b[1] + 4 * c[1] - d[1]) / 6;
        const t = (mx - track.px[i]) * track.rx[i] + (mz - track.pz[i]) * track.rz[i];
        lat[i] = Math.max(-W, Math.min(W, lat[i] + 0.5 * (t - lat[i])));
      }
    }
  }
  // 线上的曲率（带符号，左转为正，和 track.curv 一致）：三点外接圆，再平滑
  const k = new Float32Array(N), S = 4;
  for (let i = 0; i < N; i++) {
    const a = P(i - S), b = P(i), c = P(i + S);
    const abx = b[0] - a[0], abz = b[1] - a[1], bcx = c[0] - b[0], bcz = c[1] - b[1], acx = c[0] - a[0], acz = c[1] - a[1];
    const cross = abx * bcz - abz * bcx, den = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(acx, acz);
    k[i] = den > 1e-6 ? -2 * cross / den : 0;
  }
  const ks = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -4; j <= 4; j++) s += k[((i + j) % N + N) % N]; ks[i] = s / 9; }
  // 符号对齐到 track.curv（三点法在 x-z 平面上的手性取决于坐标系，按整圈相关性定符号）
  let dot = 0; for (let i = 0; i < N; i++) dot += ks[i] * track.curv[i];
  if (dot < 0) for (let i = 0; i < N; i++) ks[i] = -ks[i];
  return { lat, k: ks };
}

// 按走线曲率算一圈的限速：过弯 v ≤ √(aLat/κ)，再往回推刹车距离（减速 brake），封顶 vmax
export function speedProfile(track, k, { aLat, brake, vmax }) {
  const N = track.N, ds = track.ds, v = new Float32Array(N);
  for (let i = 0; i < N; i++) v[i] = Math.min(vmax, Math.sqrt(aLat / Math.max(Math.abs(k[i]), 1e-6)));
  for (let pass = 0; pass < 2; pass++) for (let i = 2 * N - 1; i >= 0; i--) {
    const a = i % N, b = (i + 1) % N;
    v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * brake * ds));
  }
  return v;
}

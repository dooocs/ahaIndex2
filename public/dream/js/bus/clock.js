// A shared clock for the buses: the offset between this browser's clock and the server's, from the HTTP
// Date header of a few small requests. Date only has whole seconds, so each answer says "the server's clock
// read something in [lo, hi) at some moment between sending (t0) and receiving (t1)"; every such answer
// bounds the offset to [lo - t1, hi - t0], and intersecting a handful spread over a second or two pins it to
// roughly the round trip. Pure apart from `syncClock`, which only calls the fetchDate it is given.

/**
 * @param {{ t0: number, t1: number, lo: number, hi: number }[]} samples  local send/receive times and the server reading's bounds (ms)
 * @returns {number} server − local, in ms (0 with no samples)
 */
export function offsetFromSamples(samples) {
  const ok = samples.filter(s => s && Number.isFinite(s.lo) && Number.isFinite(s.hi) && s.t1 >= s.t0);
  if (!ok.length) return 0;
  let lo = -Infinity, hi = Infinity;
  for (const s of ok) { lo = Math.max(lo, s.lo - s.t1); hi = Math.min(hi, s.hi - s.t0); }
  if (lo <= hi) return (lo + hi) / 2;
  // inconsistent answers (a cached Date, a slow hop): fall back to the median of the samples' middles
  const mids = ok.map(s => (s.lo + s.hi) / 2 - (s.t0 + s.t1) / 2).sort((a, b) => a - b);
  return mids[mids.length >> 1];
}

/**
 * Ask the server for its time `count` times, `gap` ms apart, and return the offset (server − local, ms).
 * fetchDate() resolves to { date, age } (date: ms from the Date header, age: s from the Age header) or null.
 */
export async function syncClock({ fetchDate, count = 9, gap = 140, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const t0 = now();
    let r = null;
    try { r = await fetchDate(); } catch { r = null; }
    const t1 = now();
    if (r && Number.isFinite(r.date)) {
      const age = Math.max(0, r.age || 0) * 1000;
      // Date is whole seconds; an Age adds up to another second of doubt
      samples.push({ t0, t1, lo: r.date + age, hi: r.date + age + 1000 + (age ? 1000 : 0) });
    }
    if (i < count - 1) await sleep(gap);
  }
  return { offset: offsetFromSamples(samples), samples: samples.length };
}

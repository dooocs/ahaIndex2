// Bus timetables: where every bus on a line is at a given moment, worked out from the time alone. Every
// visitor runs the same arithmetic on the same (server-synced) clock, so everyone sees the same buses in the
// same places without a server simulating them. Pure: no three.js, no DOM.
//
// A line is a closed loop of length `length` with stops at arc lengths `stops` (ascending). A bus waits
// `dwell` seconds at each stop, then drives to the next: speed rises from 0 along half a cosine over `ramp`
// seconds, cruises, and falls the same way, so it pulls away and comes to rest gently. A leg too short to
// reach cruise speed peaks lower but still takes 2 × ramp. `buses` buses share the loop, evenly spaced in time.

export const DWELL = 20;      // s at each stop
export const RAMP = 3.5;      // s from rest to full speed, and from full speed to rest

/**
 * @param {object} o
 * @param {number} o.length   loop length (units)
 * @param {number[]} o.stops  arc lengths of the stops, ascending, each in [0, length)
 * @param {number} o.speed    cruise speed (units/s)
 * @param {number} o.buses    buses on the loop
 * @param {number} [o.dwell]
 * @param {number} [o.ramp]
 */
export function makeTimetable({ length, stops, speed, buses, dwell = DWELL, ramp = RAMP }) {
  if (!(length > 0) || !stops.length || !(speed > 0) || !(buses >= 1)) throw new Error('makeTimetable: bad line');
  for (let i = 1; i < stops.length; i++) if (!(stops[i] > stops[i - 1])) throw new Error('makeTimetable: stops must ascend');
  const legs = [];
  let t = 0;
  stops.forEach((s0, i) => {
    const d = (i + 1 < stops.length ? stops[i + 1] : stops[0] + length) - s0;
    const vp = Math.min(speed, d / ramp);             // peak speed (a short leg never reaches cruise)
    const cruise = Math.max(0, (d - vp * ramp) / vp); // seconds at peak
    legs.push({ stop: i, s0, d, vp, cruise, move: 2 * ramp + cruise, t0: t });
    t += dwell + 2 * ramp + cruise;
  });
  const period = t;
  const mod = (a, m) => ((a % m) + m) % m;

  /** distance covered u seconds after leaving the stop at the start of `leg`, and the speed then */
  function along(leg, u) {
    const { vp, cruise, d } = leg, a = vp * ramp / 2;
    if (u <= 0) return { x: 0, v: 0 };
    if (u < ramp) return { x: vp * (u / 2 - ramp / (2 * Math.PI) * Math.sin(Math.PI * u / ramp)), v: vp * (1 - Math.cos(Math.PI * u / ramp)) / 2 };
    if (u < ramp + cruise) return { x: a + vp * (u - ramp), v: vp };
    const w = u - ramp - cruise;
    if (w >= ramp) return { x: d, v: 0 };
    return { x: a + vp * cruise + vp * (w / 2 + ramp / (2 * Math.PI) * Math.sin(Math.PI * w / ramp)), v: vp * (1 + Math.cos(Math.PI * w / ramp)) / 2 };
  }
  const legAt = phase => { let lo = 0, hi = legs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (legs[m].t0 <= phase) lo = m; else hi = m - 1; } return legs[lo]; };

  return {
    length, stops, speed, buses, dwell, ramp, period, legs,
    /** this bus's place in its cycle at time t (s) */
    phaseOf: (bus, t) => mod(t + bus * period / buses, period),
    /**
     * Bus `bus` at time `t` (seconds, server clock):
     * { s, v, stop (index while waiting, else null), dwellLeft, next (the stop it is heading for or waiting at), eta (s until it arrives there; 0 while waiting) }
     */
    at(bus, t) {
      const phase = mod(t + bus * period / buses, period), leg = legAt(phase), u = phase - leg.t0;
      if (u < dwell) return { s: leg.s0, v: 0, stop: leg.stop, dwellLeft: dwell - u, next: leg.stop, eta: 0 };
      const { x, v } = along(leg, u - dwell);
      return { s: mod(leg.s0 + x, length), v, stop: null, dwellLeft: 0, next: (leg.stop + 1) % stops.length, eta: leg.move - (u - dwell) };
    },
    /** Seconds until the next bus reaches stop `i` at time t (0 while one is waiting there), and which bus. */
    nextAt(i, t) {
      let best = { wait: Infinity, bus: -1, dwellLeft: 0 };
      for (let b = 0; b < buses; b++) {
        const phase = mod(t + b * period / buses, period), arrive = legs[i].t0;
        const since = mod(phase - arrive, period);
        if (since < dwell) return { wait: 0, bus: b, dwellLeft: dwell - since };
        const wait = mod(arrive - phase, period);
        if (wait < best.wait) best = { wait, bus: b, dwellLeft: 0 };
      }
      return best;
    },
  };
}

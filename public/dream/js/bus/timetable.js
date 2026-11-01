// Bus timetables: where every bus on a line is at a given moment, worked out from the time alone. Every
// visitor runs the same arithmetic on the same (server-synced) clock, so everyone sees the same buses in the
// same places without a server simulating them. Pure: no three.js, no DOM.
//
// A line is a closed loop of length `length` with stops at arc lengths `stops` (ascending). A bus waits
// `dwell` seconds at each stop, then drives to the next: speed rises from 0 along half a cosine over `ramp`
// seconds, cruises, and falls the same way, so it pulls away and comes to rest gently. A leg too short to
// reach cruise speed peaks lower but still takes 2 × ramp. `buses` buses share the loop, evenly spaced in time.
//
// Early departures. A rider alone on a waiting bus may send it off at once. That is an event { bus, i, a }:
// bus `bus` leaves stop i at time a (GO_LEAD seconds after the click, for the doors). Until then the timetable
// rules. The bus then runs the leg to stop i + 1 as usual, only earlier, and waits there until its scheduled
// departure from that stop (longer than the usual dwell), so it is back on the timetable by the time it leaves
// stop i + 1. Only the latest event of a bus matters, and only for that window: everyone who has heard of it
// computes the same bus. A bus may be at most `maxAhead` seconds early, so it never catches the bus in front:
// that one is a headway ahead and leaves each stop `dwell` seconds after reaching it.

export const DWELL = 20;      // s at each stop
export const RAMP = 3.5;      // s from rest to full speed, and from full speed to rest
export const GO_LEAD = 1.5;   // s from "立即发车" to moving: the doors close

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
  const off = bus => bus * period / buses;
  const maxAhead = Math.max(0, period / buses - dwell - 3);
  /** the first scheduled departure from stop i after schedule time tau (unwrapped) */
  const depAfter = (i, tau) => { const base = legs[i].t0 + dwell; return (Math.floor((tau - base) / period) + 1) * period + base; };
  /** the window of an early departure, in the bus's schedule time: [start, end) */
  const windowOf = e => { const ta = e.a + off(e.bus), dep = depAfter(e.i, ta); return { ta, dep, start: ta - GO_LEAD, end: dep + legs[e.i].move + dwell }; };
  /** where `bus` is at t if an early departure is shaping it then; else null */
  function early(bus, t, events) {
    const tau = t + off(bus);
    let best = null;
    for (const e of events) {
      if (e.bus !== bus || !legs[e.i]) continue;
      const w = windowOf(e);
      if (tau < w.start || tau >= w.end || (best && best.e.a > e.a)) continue;
      best = { e, ...w };
    }
    if (!best) return null;
    const { e, ta, end } = best, leg = legs[e.i], next = (e.i + 1) % legs.length, arrive = ta + leg.move;
    if (tau < ta) return { s: leg.s0, v: 0, stop: e.i, dwellLeft: ta - tau, since: dwell, next: e.i, eta: 0, leaving: true };
    if (tau < arrive) { const { x, v } = along(leg, tau - ta); return { s: mod(leg.s0 + x, length), v, stop: null, dwellLeft: 0, since: 0, next, eta: arrive - tau, early: true }; }
    return { s: legs[next].s0, v: 0, stop: next, dwellLeft: end - tau, since: tau - arrive, next, eta: 0, early: true };
  }
  const legAt = phase => { let lo = 0, hi = legs.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (legs[m].t0 <= phase) lo = m; else hi = m - 1; } return legs[lo]; };

  const api = {
    length, stops, speed, buses, dwell, ramp, period, legs, maxAhead,
    /** this bus's place in its cycle at time t (s) */
    phaseOf: (bus, t) => mod(t + bus * period / buses, period),
    /**
     * Bus `bus` at time `t` (seconds, server clock):
     * { s, v, stop (index while waiting, else null), dwellLeft, since (s since it arrived), next (the stop it is heading
     * for or waiting at), eta (s until it arrives there; 0 while waiting), leaving / early (shaped by an early departure) }
     * `events`: the line's accepted early departures (see accept).
     */
    at(bus, t, events = null) {
      if (events && events.length) { const e = early(bus, t, events); if (e) return e; }
      const phase = mod(t + bus * period / buses, period), leg = legAt(phase), u = phase - leg.t0;
      if (u < dwell) return { s: leg.s0, v: 0, stop: leg.stop, dwellLeft: dwell - u, since: u, next: leg.stop, eta: 0 };
      const { x, v } = along(leg, u - dwell);
      return { s: mod(leg.s0 + x, length), v, stop: null, dwellLeft: 0, since: 0, next: (leg.stop + 1) % stops.length, eta: leg.move - (u - dwell) };
    },
    /** Seconds until the next bus reaches stop `i` at time t (0 while one is waiting there), and which bus. */
    nextAt(i, t, events = null) {
      let best = { wait: Infinity, bus: -1, dwellLeft: 0 };
      for (let b = 0; b < buses; b++) {
        const phase = mod(t + b * period / buses, period), arrive = legs[i].t0;
        const e = events && events.length ? early(b, t, events) : null;
        let wait;
        if (e) {
          // an early bus: waiting here, on its way here early, or else back on the timetable from its next stop on
          if (e.stop === i) return { wait: 0, bus: b, dwellLeft: e.dwellLeft };
          wait = e.stop === null && e.next === i ? e.eta : mod(arrive - phase, period) || period;
        } else {
          const since = mod(phase - arrive, period);
          if (since < dwell) return { wait: 0, bus: b, dwellLeft: dwell - since };
          wait = mod(arrive - phase, period);
        }
        if (wait < best.wait) best = { wait, bus: b, dwellLeft: 0 };
      }
      return best;
    },
    /**
     * The early departures that could have happened, oldest first: each from the stop its bus was then waiting
     * at (and not already leaving), and leaving no more than maxAhead early. Everyone filters the same way.
     */
    accept(events) {
      const ok = [];
      for (const e of [...events].sort((p, q) => p.a - q.a)) {
        if (!legs[e.i] || !(e.bus >= 0 && e.bus < buses) || ok.some(o => o.bus === e.bus && o.a === e.a)) continue;
        const st = api.at(e.bus, e.a - GO_LEAD - 1e-6, ok);
        const w = windowOf(e), ahead = w.dep - w.ta;
        if (st.stop === e.i && !st.leaving && ahead > 0 && ahead <= maxAhead + 0.25) ok.push(e);
      }
      return ok;
    },
    /** when an early departure stops mattering (absolute seconds): after that the timetable alone places the bus */
    endOf(e) { return windowOf(e).end - off(e.bus); },
    /**
     * May bus `bus` leave now (t) rather than at its scheduled time? { ok, i, a } (a: when it would move), or
     * { ok: false, why: 'moving' | 'leaving' | 'early', wait } (wait: seconds until it may, for 'early').
     */
    canGo(bus, t, events = null) {
      const st = api.at(bus, t, events);
      if (st.stop === null) return { ok: false, why: 'moving' };
      if (st.leaving) return { ok: false, why: 'leaving' };
      const a = t + GO_LEAD, ahead = depAfter(st.stop, t + off(bus)) - (a + off(bus));
      if (ahead <= 0.3) return { ok: false, why: 'leaving' };
      if (ahead > maxAhead) return { ok: false, why: 'early', wait: ahead - maxAhead };
      return { ok: true, i: st.stop, a };
    },
  };
  return api;
}

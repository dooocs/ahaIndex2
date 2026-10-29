// Who else is walking round the planets right now.
//
// Transport-agnostic: `connect(key)` returns a channel with the subset of Supabase Realtime's
// RealtimeChannel this needs (on / subscribe / track / untrack / send / presenceState / unsubscribe),
// so the same code runs over Supabase Realtime in production, over BroadcastChannel between tabs in
// development (./local.js), and over an in-memory hub in tests. No three.js, no DOM.
//
// Online means "has a live connection that has told the channel who it is" (Presence): a closed tab
// leaves at once, a lost connection when the server's heartbeat times out. On top of that each visitor
// reports an activity: 'active' (looking and doing something) or 'idle' (tab in the background or no
// input for a while); see activityOf below. People are keyed by a per-browser visitor id, so several
// tabs of one person count once.

export const IDLE_AFTER = 2 * 60e3;          // no input for this long → idle
export const AWAY_AFTER = 5 * 60e3;          // tab hidden for this long → leave the channel
export const POSE_EVERY = 200;               // ms between pose messages while moving (5 a second)

/** 'active' | 'idle' | 'away' from what the page knows about the person in front of it. */
export function activityOf({ visible, hiddenSince = 0, lastInput, now }) {
  if (!visible && now - hiddenSince >= AWAY_AFTER) return 'away';
  if (!visible || now - lastInput >= IDLE_AFTER) return 'idle';
  return 'active';
}

const round = v => v && [+v[0].toFixed(5), +v[1].toFixed(5), +v[2].toFixed(5)];

/**
 * @param {object} o
 * @param {(key: string) => object} o.connect   makes a channel keyed by this visitor
 * @param {{ id: string, g: 'm'|'f', look?: object, prov: string }} o.me   look: the avatar's hairstyle and colours, passed through as is
 * @param {() => number} [o.now]
 */
export function createPresence({ connect, me, now = () => Date.now() }) {
  let channel = null, joined = false, planet = null, act = 'active';
  let pose = null, moving = false, lastSent = 0, posed = false;   // posed: presence carries a pose
  const profile = { ...me };
  const peers = new Map();       // id → { id, g, prov, planet, act, p, f, t }
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f());

  const meta = () => ({ id: profile.id, g: profile.g, look: profile.look, prov: profile.prov, planet, act, p: round(pose?.p), f: round(pose?.f), t: now() });
  const retrack = () => { if (joined) { posed = !!pose; channel.track(meta()); } };

  function onSync() {
    const state = channel.presenceState();
    const seen = new Set();
    for (const [key, metas] of Object.entries(state)) {
      if (key === profile.id || !metas.length) continue;
      // one person, several tabs: prefer an active tab, then the most recent
      const m = [...metas].sort((a, b) => (a.act === 'active') - (b.act === 'active') || a.t - b.t).pop();
      seen.add(key);
      const old = peers.get(key);
      const next = { id: key, g: m.g, look: m.look, prov: m.prov, planet: m.planet, act: m.act, p: m.p, f: m.f, t: m.t };
      if (old && old.t > m.t && old.planet === m.planet) { next.p = old.p; next.f = old.f; next.t = old.t; }   // a newer live pose wins
      peers.set(key, next);
    }
    for (const key of [...peers.keys()]) if (!seen.has(key)) peers.delete(key);
    emit();
  }
  function onPose({ payload: q }) {
    const peer = q && peers.get(q.id);           // only people the channel says are here (no ghosts after a leave)
    if (!peer || q.t <= peer.t) return;
    Object.assign(peer, { planet: q.planet, p: q.p, f: q.f, t: q.t });
    emit();
  }

  return {
    /** Join (idempotent). Call after the first real interaction, so crawlers never count. */
    start() {
      if (channel) return;
      channel = connect(profile.id);
      channel.on('presence', { event: 'sync' }, onSync);
      channel.on('broadcast', { event: 'pose' }, onPose);
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { joined = true; retrack(); emit(); }
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { joined = false; emit(); }
      });
    },
    /** Leave now (tab closing, or away too long). */
    stop() {
      if (!channel) return;
      const c = channel;
      channel = null; joined = false; peers.clear();
      try { c.untrack(); } catch { /* closing anyway */ }
      c.unsubscribe();
      emit();
    },
    get started() { return !!channel; },
    get joined() { return joined; },
    setPlanet(key) { if (key !== planet) { planet = key; retrack(); } },
    setProfile(p) { Object.assign(profile, p); retrack(); },
    setActivity(a) { if (a !== act) { act = a; retrack(); emit(); } },
    /** Report where I am. While moving, at most every POSE_EVERY ms; when I stop, my resting pose goes into presence. */
    move(p, f, isMoving) {
      pose = { p, f };
      if (!joined) { moving = isMoving; return; }
      if (!posed) retrack();                       // joined before my first pose: say where I stand
      const t = now();
      if (isMoving && t - lastSent >= POSE_EVERY) {
        lastSent = t;
        channel.send({ type: 'broadcast', event: 'pose', payload: { id: profile.id, planet, p: round(p), f: round(f), t } });
      }
      if (moving && !isMoving) retrack();
      moving = isMoving;
    },
    /** Everyone else, on any planet. */
    peers: () => [...peers.values()],
    /** Head counts including me once I have joined. */
    counts() {
      let online = joined ? 1 : 0, active = joined && act === 'active' ? 1 : 0;
      for (const p of peers.values()) { online++; if (p.act === 'active') active++; }
      return { online, active };
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

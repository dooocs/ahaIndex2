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
export const MSG_MAX = 60;                   // characters per message
export const SAY_EVERY = 1200;               // ms between messages from one person
export const OUTBOX_TTL = 60e3;              // messages also ride in my presence for this long (see say)
export const SLOW_POSE_EVERY = 1000;         // pose updates through presence when broadcasts don't get through

/** A message as it may be shown: control characters out, whitespace squeezed, capped. */
export const cleanText = text => Array.from(String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, MSG_MAX).join('').trim();

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
  const listeners = new Set(), inbox = new Set();
  const emit = () => listeners.forEach(f => f());
  let lastSay = -Infinity;
  const seenMsg = new Set();
  // Messages travel two ways: a broadcast (instant) and my presence state (the last few, for a minute),
  // so they arrive even where broadcasts are dropped; receivers dedupe by message id. Broadcasts are sent
  // with server acks; after two that fail, poses also go through presence (slower, about once a second).
  let out = [], bcastOk = true, bcastFails = 0;
  const fresh = () => { const t = now(); out = out.filter(m => t - m.t < OUTBOX_TTL).slice(-5); return out; };
  function bcast(event, payload) {
    const failed = () => { if (++bcastFails >= 2 && bcastOk) { bcastOk = false; emit(); } };
    let r;
    try { r = channel.send({ type: 'broadcast', event, payload }); } catch { failed(); return; }
    Promise.resolve(r).then(res => { if (res === 'ok') bcastFails = 0; else failed(); }, failed);
  }

  const meta = () => ({ id: profile.id, g: profile.g, look: profile.look, prov: profile.prov, planet, act, p: round(pose?.p), f: round(pose?.f), t: now(), out: fresh() });
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
      if (Array.isArray(m.out)) for (const x of m.out) if (x && x.to === profile.id) deliver(key, x);
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

  // only messages to me, from someone the channel says is here, once each (whichever way they came)
  function deliver(from, m) {
    if (!m || m.to !== profile.id || !peers.has(from) || !m.mid || seenMsg.has(m.mid)) return;
    seenMsg.add(m.mid);
    const text = cleanText(m.text);
    if (text) inbox.forEach(f => f({ from, text, t: m.t }));
  }
  const onMsg = ({ payload: m }) => m && deliver(m.from, m);

  return {
    /** Join (idempotent). Call after the first real interaction, so crawlers never count. */
    start() {
      if (channel) return;
      channel = connect(profile.id);
      channel.on('presence', { event: 'sync' }, onSync);
      channel.on('broadcast', { event: 'pose' }, onPose);
      channel.on('broadcast', { event: 'msg' }, onMsg);
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
    /** false once broadcasts have failed: poses and messages then go through presence */
    get broadcastOk() { return bcastOk; },
    setPlanet(key) { if (key !== planet) { planet = key; retrack(); } },
    setProfile(p) { Object.assign(profile, p); retrack(); },
    setActivity(a) { if (a !== act) { act = a; retrack(); emit(); } },
    /** Report where I am. While moving, at most every POSE_EVERY ms; when I stop, my resting pose goes into presence. */
    move(p, f, isMoving) {
      pose = { p, f };
      if (!joined) { moving = isMoving; return; }
      if (!posed) retrack();                       // joined before my first pose: say where I stand
      const t = now();
      if (isMoving && t - lastSent >= (bcastOk ? POSE_EVERY : SLOW_POSE_EVERY)) {
        lastSent = t;
        if (bcastOk) bcast('pose', { id: profile.id, planet, p: round(p), f: round(f), t });
        else retrack();
      }
      if (moving && !isMoving) retrack();
      moving = isMoving;
    },
    /**
     * Say something to one person. Returns the text as sent, or null (not joined, too soon, empty, or
     * they're not here). Delivery is a broadcast on the shared channel that only the addressee shows,
     * so it is a nudge, not a private message.
     */
    say(to, text) {
      const t = now(), clean = cleanText(text);
      if (!joined || !clean || !peers.has(to) || t - lastSay < SAY_EVERY) return null;
      lastSay = t;
      const m = { from: profile.id, to, text: clean, t, mid: `${profile.id}:${t}` };
      out.push(m);
      retrack();                                    // the reliable way
      bcast('msg', m);                              // the fast way
      return clean;
    },
    /** cb({ from, text, t }) for each message to me */
    onMessage(f) { inbox.add(f); return () => inbox.delete(f); },
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

// A stand-in for Supabase Realtime between tabs of one browser, over BroadcastChannel.
// Same channel subset as presence.js expects; used with ?presence=local for development and the
// browser tests. Like the real server it drops anyone it hasn't heard from for `timeout` ms.

// broadcast: false drops every broadcast and reports an error, like a server that won't relay them.
export function createLocalConnect({ name = 'dream-presence', heartbeat = 2000, timeout = 6000, broadcast = true } = {}) {
  return function connect(key) {
    const bc = new BroadcastChannel(name);
    const others = new Map();        // key → { meta, seen }
    const handlers = { sync: [], broadcast: new Map() };
    let mine = null, beat = null, sweep = null, open = true;

    const sync = () => handlers.sync.forEach(f => f());
    const post = m => { if (open) bc.postMessage(m); };
    bc.onmessage = ({ data: m }) => {
      if (!m || m.key === key) return;
      if (m.k === 'track') { others.set(m.key, { meta: m.meta, seen: Date.now() }); sync(); }
      else if (m.k === 'leave') { if (others.delete(m.key)) sync(); }
      else if (m.k === 'hello') { if (mine) post({ k: 'track', key, meta: mine }); }
      else if (m.k === 'bc') (handlers.broadcast.get(m.event) || []).forEach(f => f({ payload: m.payload }));
    };

    return {
      on(type, filter, cb) {
        if (type === 'presence' && filter.event === 'sync') handlers.sync.push(cb);
        if (type === 'broadcast') { const l = handlers.broadcast.get(filter.event) || []; l.push(cb); handlers.broadcast.set(filter.event, l); }
        return this;
      },
      subscribe(cb) {
        sweep = setInterval(() => {
          const t = Date.now(); let gone = false;
          for (const [k, o] of others) if (t - o.seen > timeout) { others.delete(k); gone = true; }
          if (gone) sync();
        }, 500);
        post({ k: 'hello', key });
        queueMicrotask(() => cb('SUBSCRIBED'));
        return this;
      },
      track(meta) {
        mine = meta;
        post({ k: 'track', key, meta });
        if (!beat) beat = setInterval(() => post({ k: 'track', key, meta: mine }), heartbeat);
        sync();
        return Promise.resolve('ok');
      },
      untrack() { mine = null; clearInterval(beat); beat = null; post({ k: 'leave', key }); sync(); return Promise.resolve('ok'); },
      send({ event, payload }) { if (!broadcast) return Promise.resolve('error'); post({ k: 'bc', key, event, payload }); return Promise.resolve('ok'); },
      presenceState() {
        const s = {};
        for (const [k, o] of others) s[k] = [o.meta];
        if (mine) s[key] = [mine];
        return s;
      },
      unsubscribe() { open = false; clearInterval(beat); clearInterval(sweep); bc.close(); return Promise.resolve('ok'); },
      /** test hook: vanish without saying goodbye, like a laptop lid closing */
      drop() { open = false; clearInterval(beat); clearInterval(sweep); bc.close(); },
    };
  };
}

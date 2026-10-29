// Presence over Supabase Realtime (the site's community project, on Alibaba Cloud's hosted Supabase).
// Only the Realtime client is loaded (vendor/realtime-js-*.min.js, bundled from @supabase/realtime-js
// with esbuild; see docs/dream.md), not the whole supabase-js.
import { RealtimeClient } from '../../vendor/realtime-js-2.103.0.min.js';

/** @returns {(key: string) => object} a connect function for presence.js */
export function createSupabaseConnect({ url, key, topic = 'dream-world' }) {
  const client = new RealtimeClient(`${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/realtime/v1`, {
    params: { apikey: key, eventsPerSecond: 10 },
    heartbeatIntervalMs: 15000,
    // JSON frames (protocol 1.0.0). The client's default 2.0.0 sends broadcasts as binary frames, which an
    // older Realtime server (such as a hosted one that lags upstream) drops while presence still works.
    vsn: '1.0.0',
  });
  return presenceKey => {
    const channel = client.channel(topic, { config: { presence: { key: presenceKey }, broadcast: { self: false, ack: true } } });
    const api = {
      on(type, filter, cb) { channel.on(type, filter, cb); return api; },
      subscribe(cb) { channel.subscribe(cb); return api; },
      track: meta => channel.track(meta),
      untrack: () => channel.untrack(),
      send: msg => channel.send(msg),
      presenceState: () => channel.presenceState(),
      // removing the last channel closes the socket, so the server drops our presence at once
      unsubscribe: () => client.removeChannel(channel),
    };
    return api;
  };
}

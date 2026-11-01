// 西湖飞车联机模块（浏览器端，无框架依赖）。
//
// 用法：
//   // 浏览器里先加载 https://game.amazingindex.com/sdk/colyseus.js（全局 Colyseus），或用 npm 装 @colyseus/sdk
//   import { createRaceNet } from 'https://game.amazingindex.com/client/xihu-race-net.js';
//   const net = createRaceNet({ Client: Colyseus.Client, endpoint: 'https://game.amazingindex.com',
//                               name: '阿甘', playerKey: localStorage.getItem('race.player') });
//   net.on('phase', (phase) => ...);
//   await net.findMatch();
//   // 每帧：
//   net.sendState({ x, y, z, rot, speed });           // 内部自动限频到 20 次/秒
//   for (const r of net.racers()) if (!r.isMe) draw(r.sessionId, net.getRemotePose(r.sessionId));
//
// 坐标约定与游戏（public/race/js/track.js）一致：水平面 x（东）/ z（南），高度 y，
// rot 就是游戏里的 h，前进方向 = (sin rot, cos rot)。
// playerKey 用单机榜同一个本地密钥（localStorage 的 race.player），联机成绩和单机成绩是同一个 player_id；
// 不传就是游客，能玩但成绩不写库。

const SEND_INTERVAL_MS = 50; // 20Hz 上报
const INTERP_DELAY_MS = 120; // 其他玩家的画面延后 120ms，用两帧之间插值换平滑
const MAX_SAMPLES = 30;

export function createRaceNet({
  Client,
  endpoint,
  track = 'xihu',
  name = '',
  playerKey = '',
  roomName = 'xihu_race',
}) {
  if (!Client) throw new Error('需要传入 @colyseus/sdk 的 Client');
  const client = new Client(endpoint);
  const listeners = new Map();
  const samples = new Map(); // sessionId -> [{ t, x, y, z, rot, speed }]
  const known = new Set();
  let room = null;
  let phase = 'idle';
  let trackInfo = null;
  let slot = 0;
  let clockOffset = 0; // 服务器时间 - 本地时间
  let bestRtt = Infinity;
  let rtt = 0;
  let lastSendAt = 0;
  let timeTimer = null;

  const emit = (event, ...args) => {
    for (const fn of listeners.get(event) || []) {
      try { fn(...args); } catch (err) { console.error(`[xihu-race] ${event} 回调出错`, err); }
    }
  };

  const serverNow = () => Date.now() + clockOffset;

  function syncClock() {
    if (room) room.send('time', { c: Date.now() });
  }

  function onTime({ c, s }) {
    const now = Date.now();
    const sample = now - c;
    rtt = sample;
    // 取往返最短的那次估算时钟偏差，最准
    if (sample <= bestRtt) {
      bestRtt = sample;
      clockOffset = s - (c + sample / 2);
    }
  }

  function readRacer(sessionId, r) {
    return {
      sessionId,
      isMe: room && sessionId === room.sessionId,
      name: r.name,
      slot: r.slot,
      lap: r.lap,
      cp: r.cp,
      place: r.place,
      finished: r.finished,
      finishMs: r.finished ? r.finishMs : null,
      connected: r.connected,
      left: r.left,
      guest: r.guest,
    };
  }

  function onStateChange(state) {
    if (!room) return;
    if (state.phase !== phase) {
      phase = state.phase;
      emit('phase', phase, state);
    }
    const t = serverNow();
    const seen = new Set();
    state.racers.forEach((r, sid) => {
      seen.add(sid);
      if (!known.has(sid)) {
        known.add(sid);
        emit('racerJoin', readRacer(sid, r));
      }
      if (sid === room.sessionId) return;
      let list = samples.get(sid);
      if (!list) samples.set(sid, (list = []));
      const last = list[list.length - 1];
      if (!last || last.x !== r.x || last.z !== r.z || last.rot !== r.rot || last.y !== r.y) {
        list.push({ t, x: r.x, y: r.y, z: r.z, rot: r.rot, speed: r.speed });
        if (list.length > MAX_SAMPLES) list.shift();
      }
    });
    for (const sid of [...known]) {
      if (!seen.has(sid)) {
        known.delete(sid);
        samples.delete(sid);
        emit('racerLeave', sid);
      }
    }
    emit('state', state);
  }

  function attach(r) {
    room = r;
    samples.clear();
    known.clear();
    phase = 'idle';
    bestRtt = Infinity;
    trackInfo = null;
    room.reconnection.minUptime = 1000; // SDK 默认 5 秒内掉线不重连，开局前后掉线也要能回来
    room.onMessage('welcome', (w) => {
      trackInfo = w.track;
      slot = w.slot;
      if (bestRtt === Infinity) clockOffset = w.serverNow - Date.now();
      emit('welcome', w);
    });
    room.onMessage('time', onTime);
    room.onMessage('finish', (m) => emit('finish', { ...m, isMe: m.sessionId === room.sessionId }));
    room.onMessage('results', (m) => emit('results', m));
    room.onStateChange(onStateChange);
    room.onDrop((code) => emit('drop', code));
    room.onReconnect(() => { bestRtt = Infinity; syncClock(); emit('reconnect'); });
    room.onLeave((code, reason) => {
      clearInterval(timeTimer);
      timeTimer = null;
      phase = 'idle';
      emit('left', { code, reason });
      room = null;
    });
    room.onError((code, message) => emit('error', { code, message }));

    // 开局先连测 5 次把时钟对准，之后每 5 秒校一次
    for (let i = 0; i < 5; i++) setTimeout(syncClock, 100 + i * 150);
    timeTimer = setInterval(syncClock, 5000);
  }

  /** 在离开插值缓冲后，按时间在两帧之间线性插值；角度走最短路径。 */
  function interpolate(list, renderT) {
    if (!list || !list.length) return null;
    if (renderT <= list[0].t) return list[0];
    const last = list[list.length - 1];
    if (renderT >= last.t) {
      // 数据断档时最多外推 200ms，避免车冲出去太远
      const dt = Math.min(renderT - last.t, 200) / 1000;
      return {
        ...last,
        x: last.x + Math.sin(last.rot) * last.speed * dt,
        z: last.z + Math.cos(last.rot) * last.speed * dt,
      };
    }
    for (let i = list.length - 1; i > 0; i--) {
      const a = list[i - 1];
      const b = list[i];
      if (renderT >= a.t && renderT <= b.t) {
        const k = (renderT - a.t) / Math.max(1, b.t - a.t);
        let dr = b.rot - a.rot;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        return {
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
          rot: a.rot + dr * k,
          speed: a.speed + (b.speed - a.speed) * k,
        };
      }
    }
    return last;
  }

  return {
    /** 匹配前查询全服状态：{ online, max, full, waiting, racing } */
    async status() {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/status`);
      return res.json();
    },

    /** 开始匹配：自动进入一个等待中的房间，没有就新建。人满时会抛出带中文提示的错误。 */
    async findMatch() {
      if (room) return room;
      const r = await client.joinOrCreate(roomName, { track, name, playerKey });
      attach(r);
      return r;
    },

    /** 每帧都可以调用，内部限频 20 次/秒。按 R 复位（车被挪回中心线）那一帧传 respawn: true。 */
    sendState({ x, y = 0, z, rot, speed, respawn = false }) {
      if (!room || phase !== 'racing') return;
      const now = performance.now();
      if (!respawn && now - lastSendAt < SEND_INTERVAL_MS) return;
      lastSendAt = now;
      const msg = { x, y, z, r: rot, v: speed };
      if (respawn) msg.t = 1;
      room.send('s', msg);
    },

    /** 只在赛道未配置检查点（信任客户端模式）时使用；配置后服务器自己判定完赛。 */
    finish() {
      if (room && phase === 'racing' && trackInfo && !trackInfo.verified) room.send('finish');
    },

    /** 其他玩家此刻应该画在哪里。 */
    getRemotePose(sessionId) {
      return interpolate(samples.get(sessionId), serverNow() - INTERP_DELAY_MS);
    },

    racers() {
      if (!room?.state?.racers) return [];
      const list = [];
      room.state.racers.forEach((r, sid) => list.push(readRacer(sid, r)));
      return list.sort((a, b) => (a.place || 99) - (b.place || 99));
    },

    me() {
      const r = room?.state?.racers?.get(room.sessionId);
      return r ? readRacer(room.sessionId, r) : null;
    },

    get phase() { return phase; },
    get track() { return trackInfo; },
    get slot() { return slot; },
    get sessionId() { return room?.sessionId || null; },
    get ping() { return rtt; },
    serverNow,

    /** 距离发车还有多少毫秒（倒计时阶段）。 */
    countdownLeft() {
      const s = room?.state;
      return s && s.phase === 'countdown' ? Math.max(0, s.startAt - serverNow()) : 0;
    },

    /** 凑够 2 人后，还要等多久看有没有更多人加入。 */
    waitLeft() {
      const s = room?.state;
      return s && s.phase === 'waiting' && s.waitEndsAt ? Math.max(0, s.waitEndsAt - serverNow()) : 0;
    },

    /** 本局已用时（以服务器发车时刻为准）。 */
    raceElapsed() {
      const s = room?.state;
      return s && (s.phase === 'racing' || s.phase === 'finished') ? Math.max(0, serverNow() - s.startAt) : 0;
    },

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },

    async leave() {
      if (room) await room.leave(true);
    },
  };
}

// 全服在线统计：用于 20 人上限判断，以及 /status 接口给前端显示「当前 x/20 人」。
// 单进程部署，用内存计数即可。

const joined = new Set();
const reserved = new Map(); // sessionId -> 超时清理定时器
const rooms = new Map(); // roomId -> { track, phase, players }

const RESERVATION_TTL_MS = 20000;

export const stats = {
  /** 已加入 + 正在加入（通过鉴权但还没真正连上）的人数。 */
  onlineCount() {
    return joined.size + reserved.size;
  },

  /** onAuth 通过时先占位，防止同一时刻多人涌入超过上限。 */
  reserve(sessionId) {
    if (joined.has(sessionId) || reserved.has(sessionId)) return;
    const timer = setTimeout(() => reserved.delete(sessionId), RESERVATION_TTL_MS);
    timer.unref?.();
    reserved.set(sessionId, timer);
  },

  join(sessionId) {
    const timer = reserved.get(sessionId);
    if (timer) clearTimeout(timer);
    reserved.delete(sessionId);
    joined.add(sessionId);
  },

  leave(sessionId) {
    const timer = reserved.get(sessionId);
    if (timer) clearTimeout(timer);
    reserved.delete(sessionId);
    joined.delete(sessionId);
  },

  setRoom(roomId, info) {
    rooms.set(roomId, info);
  },

  removeRoom(roomId) {
    rooms.delete(roomId);
  },

  snapshot(maxPlayers) {
    const list = [...rooms.values()];
    return {
      online: this.onlineCount(),
      max: maxPlayers,
      full: this.onlineCount() >= maxPlayers,
      rooms: list.length,
      waiting: list.filter((r) => r.phase === 'waiting').reduce((n, r) => n + r.players, 0),
      racing: list.filter((r) => r.phase === 'countdown' || r.phase === 'racing').reduce((n, r) => n + r.players, 0),
    };
  },
};

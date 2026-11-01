// 西湖飞车比赛房间。
//
// 生命周期：waiting（匹配中）→ countdown（锁房倒计时）→ racing（比赛）→ finished（结算）→ 关房
//
// 分工：
// - 客户端在本地跑自己车的物理，每秒上报 20 次位置（消息 "s"）。
// - 服务器只做判定：速度是否超限、检查点是否按顺序通过、每圈用时、谁先冲线。
// - 位置通过 Colyseus 状态同步（每 50ms 一个增量补丁）广播给同房间其他人，客户端插值显示。
//
// 玩家身份沿用单机榜的做法（public/race/js/board.js）：浏览器本地的随机密钥 race.player，
// 服务器只保存它的 sha256（player_id），和单机榜 race_scores 的 player_id 一一对应。

import { randomUUID, createHash } from 'node:crypto';
import { Room, ServerError } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import { config } from './config.js';
import { getTrack, isVerifiedTrack, DEFAULT_TRACK } from './tracks.js';
import { advanceCheckpoints, checkSpeed, rankRunning } from './judge.js';
import { insertResults } from './supabase.js';
import { stats } from './stats.js';

export const Racer = schema({
  name: t.string(),
  slot: t.uint8(), // 发车位 0-3，也用作车身颜色编号
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  rot: t.float32(), // 与游戏的 h 相同：前进方向 (sin rot, cos rot)
  speed: t.float32(),
  lap: t.uint8(), // 已完成圈数
  cp: t.uint16(), // 下一个要通过的检查点下标
  place: t.uint8(), // 实时名次，1 开始；0 表示无名次
  finished: t.boolean(),
  finishMs: t.uint32(),
  connected: t.boolean(),
  left: t.boolean(), // 比赛中途退出（保留在结算里，记为未完赛）
  guest: t.boolean(), // 没带身份密钥，成绩不写库
}, 'Racer');

export const RaceState = schema({
  track: t.string(),
  phase: t.string(), // waiting | countdown | racing | finished
  laps: t.uint8(),
  minPlayers: t.uint8(),
  maxPlayers: t.uint8(),
  waitEndsAt: t.float64(), // 凑够最少人数后，等待更多玩家的截止时间（服务器时间戳，0 表示未开始等待）
  startAt: t.float64(), // 发车时刻
  endsAt: t.float64(), // 第一名冲线后的收车时刻
  racers: t.map(Racer),
}, 'RaceState');

const MAX_COORD = 1e6;
const RESPAWN_RADIUS = 40; // 按 R 复位只会把车挪回附近的中心线
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MAX_COORD;

function sanitizeName(raw) {
  const cleaned = typeof raw === 'string'
    ? [...raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim()].slice(0, 12).join('')
    : '';
  return cleaned || `游客${Math.floor(1000 + Math.random() * 9000)}`;
}

/** 与 board.js / race_scores 触发器相同：player_id = sha256(player_key) 的 16 进制。 */
function playerIdOf(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) return null;
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export class RaceRoom extends Room {
  maxClients = config.maxPlayersPerRace;
  patchRate = 50;
  maxMessagesPerSecond = 60;

  onCreate(options = {}) {
    const trackId = getTrack(options.track) ? options.track : DEFAULT_TRACK;
    this.track = getTrack(trackId);
    this.verified = isVerifiedTrack(this.track);
    this.raceId = randomUUID();
    // sessionId -> { playerId, flagged, violations, allowance, lastAt, px, pz, lapMs, lapStartAt }
    this.meta = new Map();
    this.finishOrder = [];

    const state = new RaceState();
    state.track = trackId;
    state.phase = 'waiting';
    state.laps = this.track.laps;
    state.minPlayers = config.minPlayersPerRace;
    state.maxPlayers = config.maxPlayersPerRace;
    state.waitEndsAt = 0;
    state.startAt = 0;
    state.endsAt = 0;
    this.setState(state);

    this.onMessage('s', (client, msg) => this.handleMove(client, msg));
    this.onMessage('time', (client, msg) => {
      // c 是客户端发出时的本地时间戳，原样带回，客户端据此算往返延迟和时钟偏差
      const c = typeof msg?.c === 'number' && Number.isFinite(msg.c) ? msg.c : 0;
      client.send('time', { c, s: Date.now() });
    });
    // 信任客户端模式下的完赛上报；已配检查点的赛道忽略这条消息
    this.onMessage('finish', (client) => {
      if (this.verified || this.state.phase !== 'racing') return;
      const racer = this.state.racers.get(client.sessionId);
      if (racer && !racer.finished && !racer.left) this.finishRacer(client.sessionId, racer, Date.now());
    });

    this.clock.setInterval(() => this.tick(), 100);
    this.publishStats();
    console.log(`[room ${this.roomId}] 创建，赛道 ${trackId}${this.verified ? '' : '（未配检查点，不记成绩）'}`);
  }

  onAuth(client, options = {}, context) {
    const origin = context?.headers?.get?.('origin');
    if (origin && !config.allowedOrigins.includes(origin)) {
      throw new ServerError(403, '不允许的来源');
    }
    if (stats.onlineCount() >= config.maxPlayersGlobal) {
      throw new ServerError(503, `当前已有 ${config.maxPlayersGlobal} 人在玩，请稍后再来`);
    }
    stats.reserve(client.sessionId);
    return { playerId: playerIdOf(options.playerKey), name: sanitizeName(options.name) };
  }

  onJoin(client) {
    stats.join(client.sessionId);
    const auth = client.auth || {};
    const racer = new Racer();
    racer.name = auth.name || sanitizeName('');
    racer.slot = this.freeSlot();
    racer.lap = 0;
    racer.cp = 0;
    racer.place = 0;
    racer.speed = 0;
    racer.finished = false;
    racer.finishMs = 0;
    racer.connected = true;
    racer.left = false;
    racer.guest = !auth.playerId;
    this.placeOnGrid(racer);
    this.state.racers.set(client.sessionId, racer);
    this.meta.set(client.sessionId, {
      playerId: auth.playerId || null,
      flagged: false,
      violations: 0,
      allowance: 0,
      lastAt: 0,
      px: racer.x,
      pz: racer.z,
      lapMs: [],
      lapStartAt: 0,
    });
    this.sendWelcome(client);
    this.updateWaiting();
    this.publishStats();
  }

  onDrop(client) {
    const racer = this.state.racers.get(client.sessionId);
    if (racer) racer.connected = false;
    if (this.state.phase !== 'finished') {
      this.allowReconnection(client, config.reconnectSeconds);
    }
  }

  onReconnect(client) {
    const racer = this.state.racers.get(client.sessionId);
    if (racer) racer.connected = true;
    const meta = this.meta.get(client.sessionId);
    if (meta && racer) {
      // 断线期间客户端可能已经开出去一段：按断线时长补足速度额度，下一帧照常判定
      meta.lastAt = Date.now();
      meta.allowance = (this.track.maxSpeed || 0) * config.reconnectSeconds;
    }
    this.sendWelcome(client);
  }

  onLeave(client) {
    const sid = client.sessionId;
    stats.leave(sid);
    const racer = this.state.racers.get(sid);
    if (!racer) return;
    if (this.state.phase === 'waiting') {
      this.state.racers.delete(sid);
      this.meta.delete(sid);
      this.updateWaiting();
    } else {
      racer.connected = false;
      racer.left = true;
      racer.speed = 0;
    }
    this.publishStats();
  }

  onDispose() {
    for (const sid of this.state.racers.keys()) stats.leave(sid);
    stats.removeRoom(this.roomId);
    console.log(`[room ${this.roomId}] 关闭`);
  }

  // ───────── 阶段推进 ─────────

  tick() {
    const now = Date.now();
    const s = this.state;
    if (s.phase === 'waiting') {
      if (s.waitEndsAt && now >= s.waitEndsAt && this.activeCount() >= config.minPlayersPerRace) {
        this.beginCountdown();
      }
    } else if (s.phase === 'countdown') {
      if (now >= s.startAt) {
        s.phase = 'racing';
        for (const meta of this.meta.values()) {
          meta.lastAt = now;
          meta.allowance = (this.track.maxSpeed || 0) * 0.5;
          meta.lapStartAt = s.startAt;
        }
        this.publishStats();
      }
    } else if (s.phase === 'racing') {
      this.updatePlaces();
      const stillRacing = [...s.racers.values()].some((r) => !r.finished && !r.left);
      if (!stillRacing || (s.endsAt && now >= s.endsAt) || now - s.startAt >= config.maxRaceMs) {
        this.endRace();
      }
    }
  }

  updateWaiting() {
    const s = this.state;
    if (s.phase !== 'waiting') return;
    const n = this.activeCount();
    if (n >= config.maxPlayersPerRace) {
      this.beginCountdown();
    } else if (n >= config.minPlayersPerRace) {
      if (!s.waitEndsAt) s.waitEndsAt = Date.now() + config.waitForMoreMs;
    } else {
      s.waitEndsAt = 0;
    }
  }

  async beginCountdown() {
    const s = this.state;
    if (s.phase !== 'waiting') return;
    s.phase = 'countdown';
    s.waitEndsAt = 0;
    s.startAt = Date.now() + config.countdownMs;
    for (const [sid, racer] of s.racers) {
      this.placeOnGrid(racer);
      const meta = this.meta.get(sid);
      if (meta) { meta.px = racer.x; meta.pz = racer.z; }
    }
    this.publishStats();
    await this.lock(); // 开跑后不再接受新人，新来的玩家会被匹配到别的房间
    console.log(`[room ${this.roomId}] ${this.activeCount()} 人，倒计时开始`);
  }

  async endRace() {
    const s = this.state;
    if (s.phase === 'finished') return;
    s.phase = 'finished';
    s.endsAt = Date.now();
    this.updatePlaces();

    const results = [...s.racers.entries()]
      .map(([sid, r]) => ({
        sessionId: sid,
        name: r.name,
        place: r.finished ? r.place : 0,
        finishMs: r.finished ? r.finishMs : null,
        lapMs: this.meta.get(sid)?.lapMs ?? [],
        guest: r.guest,
      }))
      .sort((a, b) => (a.finishMs ?? Infinity) - (b.finishMs ?? Infinity));
    this.broadcast('results', { raceId: this.raceId, track: s.track, results });
    this.publishStats();

    const rows = [];
    if (this.verified && this.track.recordResults) {
      for (const [sid, r] of s.racers) {
        const meta = this.meta.get(sid);
        if (!r.finished || !meta?.playerId || meta.flagged || meta.lapMs.length !== this.track.laps) continue;
        rows.push({
          race_id: this.raceId,
          track: s.track,
          player_id: meta.playerId,
          nickname: r.name,
          place: r.place,
          players: s.racers.size,
          laps: meta.lapMs.length,
          lap_ms: meta.lapMs,
          total_ms: r.finishMs,
          best_lap_ms: Math.min(...meta.lapMs),
        });
      }
    }
    console.log(`[room ${this.roomId}] 比赛结束：${results.map((x) => `${x.name} ${x.finishMs ?? 'DNF'}`).join('，')}`);
    this.clock.setTimeout(() => this.disconnect(), config.resultsLingerMs);
    if (rows.length) await insertResults(rows);
  }

  // ───────── 位置上报与判定 ─────────

  handleMove(client, msg) {
    const s = this.state;
    if (s.phase !== 'racing' || !msg) return;
    const sid = client.sessionId;
    const racer = s.racers.get(sid);
    const meta = this.meta.get(sid);
    if (!racer || !meta || racer.finished || racer.left) return;
    const { x, y, z, r, v } = msg;
    if (!isNum(x) || !isNum(z)) return;

    if (this.verified) {
      const now = Date.now();
      const elapsed = (now - meta.lastAt) / 1000;
      meta.lastAt = now;
      const dist = Math.hypot(x - meta.px, z - meta.pz);
      let credit = true;

      if (msg.t === 1) {
        // 复位（游戏里按 R）：车被挪回附近的中心线。挪动距离不扣速度额度，但不能借此跳过路段
        if (dist > RESPAWN_RADIUS) { this.flagViolation(sid, meta); credit = false; }
      } else {
        const res = checkSpeed(meta.allowance, this.track.maxSpeed, elapsed, dist);
        meta.allowance = res.allowance;
        // 超速或瞬移：这一段移动不计检查点（跳过的检查点必须开回去才能补上），
        // 但仍以新位置作为后续判定的起点，避免正常玩家因一次误判永久卡住
        if (!res.ok) { this.flagViolation(sid, meta); credit = false; }
      }

      if (credit) {
        const progress = { lap: racer.lap, cp: racer.cp };
        const { lapsDone, finished } = advanceCheckpoints(this.track, progress, meta.px, meta.pz, x, z);
        racer.lap = progress.lap;
        racer.cp = progress.cp;
        if (lapsDone) {
          meta.lapMs.push(Math.round(now - meta.lapStartAt));
          meta.lapStartAt = now;
        }
        if (finished) this.finishRacer(sid, racer, now);
      }
      meta.px = x;
      meta.pz = z;
    }

    racer.x = x;
    racer.z = z;
    if (isNum(y)) racer.y = y;
    if (isNum(r)) racer.rot = r;
    if (isNum(v)) racer.speed = v;
  }

  flagViolation(sid, meta) {
    meta.violations += 1;
    // 正常玩家几乎不会触发（网络抖动已被速度额度吸收），3 次即视为异常
    if (meta.violations === 3) {
      meta.flagged = true;
      console.warn(`[room ${this.roomId}] ${sid} 多次超速或瞬移，本局成绩不记录`);
    }
  }

  finishRacer(sid, racer, now) {
    racer.finished = true;
    racer.finishMs = Math.max(0, Math.round(now - this.state.startAt));
    racer.speed = 0;
    this.finishOrder.push(sid);
    racer.place = this.finishOrder.length;
    const meta = this.meta.get(sid);
    if (meta && racer.finishMs < this.track.minRaceMs) {
      meta.flagged = true;
      console.warn(`[room ${this.roomId}] ${sid} 用时 ${racer.finishMs}ms 低于下限，本局成绩不记录`);
    }
    if (!this.state.endsAt) this.state.endsAt = now + config.finishGraceMs;
    this.broadcast('finish', {
      sessionId: sid,
      name: racer.name,
      place: racer.place,
      finishMs: racer.finishMs,
      lapMs: meta?.lapMs ?? [],
    });
  }

  updatePlaces() {
    const running = [];
    for (const r of this.state.racers.values()) {
      if (r.left && !r.finished) { r.place = 0; continue; }
      if (!r.finished) running.push(r);
    }
    let place = this.finishOrder.length;
    for (const r of rankRunning(this.track, running)) r.place = ++place;
  }

  // ───────── 工具方法 ─────────

  activeCount() {
    let n = 0;
    for (const r of this.state.racers.values()) if (!r.left) n++;
    return n;
  }

  freeSlot() {
    const used = new Set([...this.state.racers.values()].map((r) => r.slot));
    for (let i = 0; i < config.maxPlayersPerRace; i++) if (!used.has(i)) return i;
    return 0;
  }

  placeOnGrid(racer) {
    const g = this.track.grid[racer.slot];
    racer.x = g ? g.x : 0;
    racer.y = 0;
    racer.z = g ? g.z : 0;
    racer.rot = g ? g.rot : 0;
  }

  sendWelcome(client) {
    const tr = this.track;
    const racer = this.state.racers.get(client.sessionId);
    client.send('welcome', {
      sessionId: client.sessionId,
      slot: racer ? racer.slot : 0,
      raceId: this.raceId,
      serverNow: Date.now(),
      track: {
        id: tr.id,
        laps: tr.laps,
        verified: this.verified,
        checkpoints: tr.checkpoints,
        grid: tr.grid,
        shape: tr.shape || null,
      },
    });
  }

  publishStats() {
    stats.setRoom(this.roomId, {
      track: this.state.track,
      phase: this.state.phase,
      players: this.activeCount(),
    });
  }
}

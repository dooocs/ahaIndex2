// 杭州飞车 · 西湖赛道：把赛道、地形、景物、车辆、AI、HUD、声音接到一起。
import * as THREE from 'three';
import { G, createPost } from './toon.js';
import * as LY from './layout.js';
import { Track } from './track.js';
import { buildTerrain, WATER } from './terrain.js';
import { classify, buildTrackMeshes } from './trackMesh.js';
import { buildScenery, buildBoats, updateLOD } from './scenery.js';
import { buildCarModel, PlayerCar, IDLE } from './car.js';
import { AICar, AI_DRIVERS } from './ai.js';
import { Smoke, Skids } from './effects.js';
import { Sound } from './audio.js';
import { damp, makeRand, slice } from './noise.js';

THREE.ColorManagement.enabled = false;
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug'), AUTO = Q.has('auto'), PIN = Q.get('quality') === 'high';
const LAPS = Math.max(1, Math.min(5, +(Q.get('laps') || 2)));
const $ = id => document.getElementById(id);
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = t => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };

// ---------- 渲染器 ----------
const canvas = $('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); }
catch (e) { $('loadmsg').textContent = '这台设备的浏览器没有开启 WebGL，无法运行杭州飞车。'; throw e; }
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2600);
const SUN = new THREE.Vector3(-0.75, 1.1, 0.12).normalize();
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 400 });
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.06; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const post = createPost(camera);

// ---------- 尺寸与自适应分辨率 ----------
let pr = Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2), lowTier = 0;
let insetTop = Math.max(0, Math.min(400, +(Q.get('inset')) || 0));
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  post.setSize(Math.round(w * pr), Math.round(h * pr), pr);
  document.documentElement.style.setProperty('--inset-top', `${insetTop}px`);
}
addEventListener('resize', resize);
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'race:inset') return;
  insetTop = Math.max(0, Math.min(400, Math.round(+e.data.top || 0))); resize();
});
resize();

// ---------- 输入 ----------
const keys = new Set(), pressed = new Set();
const MAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'drift', ShiftRight: 'drift', ControlLeft: 'nitro', ControlRight: 'nitro', Space: 'nitro', KeyR: 'reset', Escape: 'pause', KeyP: 'pause', KeyM: 'mute', KeyC: 'cam' };
addEventListener('keydown', e => {
  const k = MAP[e.code]; if (!k) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space' || k === 'nitro') e.preventDefault();
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
});
addEventListener('keyup', e => { const k = MAP[e.code]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());
// 触屏：左边 ◀ ▶，右边 漂移 / 氮气 / 刹车，油门自动
const touch = { on: false };
if (matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
  touch.on = true;
  document.querySelectorAll('[data-key]').forEach(b => {
    const k = b.dataset.key;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); if (!keys.has(k)) pressed.add(k); keys.add(k); b.classList.add('on'); });
    const up = () => { keys.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
}
function readInput() {
  const inp = {
    up: keys.has('up') || (touch.on && !keys.has('down')), down: keys.has('down'), left: keys.has('left'), right: keys.has('right'),
    drift: keys.has('drift'), upPressed: pressed.has('up'), nitroPressed: pressed.has('nitro'),
  };
  // 触屏上松开漂移键即自动小喷（手指不够按）
  if (touch.on && player && player.window > 0 && !keys.has('drift')) inp.upPressed = true;
  return inp;
}

// ---------- 世界 ----------
const track = new Track(LY.CENTERLINE, LY.ROAD_WIDTH);
track.startAt = LY.START_AT;
track.padAt = [[425, -180], [50, -352], [-403, -178], [-300, 474]];
const D_START = track.dAt(...LY.START_AT);
let terrain, updateBoats, player, ais = [], cars = [], smoke, skids;
const sound = new Sound();

// 赛道沿途的景点字幕（西湖十景）
const SPOTS = [
  [LY.START_AT, '龙翔桥 · 平海路'], [[442, -92], '湖滨 · 音乐喷泉'], [[400, -290], '钱塘门'], [[298, -424], '北山街 · 宝石流霞'], [[224, -402], '断桥残雪'],
  [[102, -361], '锦带桥', 1], [[-12, -338], '平湖秋月'], [[-108, -325], '孤山'], [[-198, -374], '西泠桥'],
  [[-262, -440], '曲院风荷'], [[-396, -396], '杨公堤'], [[-456, -15], '三台山'], [[-505, 132], '于谦祠', 1],
  [[-364, 458], '花港观鱼'], [[-242, 482], '苏堤春晓'], [[-58, 472], '太子湾', 1], [[124, 476], '南屏晚钟'],
  [[270, 446], '雷峰夕照'], [[352, 392], '长桥', 1], [[408, 262], '柳浪闻莺'], [[420, 200], '钱王祠', 1],
  [[490, 156], '解放路', 1], [[716, 90], '延安路', 1],
].map(([p, name, small]) => ({ d: track.dAt(...p), name, small: !!small }));

async function build() {
  const prog = (a, b) => f => { $('bar').style.width = `${(a + (b - a) * f) * 100}%`; };
  prog(0, 0)(0);
  terrain = await buildTerrain(track, scene, slice);
  prog(0, 0.35)(1);
  classify(track);
  buildTrackMeshes(track, scene);
  // 杨公堤里六桥的名字：按经过顺序（由北往南）
  const yang = (track.bridgeRuns || []).filter(([a]) => track.px[a % track.N] < -380).sort((p, q) => p[0] - q[0]);
  yang.forEach(([a, b], k) => SPOTS.push({ d: ((a + b) / 2) * track.ds - 12, name: LY.YANG_BRIDGES[k] || '', small: true }));
  SPOTS.sort((p, q) => p.d - q.d);
  await slice();
  await buildScenery(track, terrain, scene, prog(0.35, 0.92));
  updateBoats = buildBoats(scene);
  smoke = new Smoke(scene); skids = new Skids(scene);

  // 车：玩家 + 5 个 AI
  const rand = makeRand(3);
  player = new PlayerCar(track, buildCarModel(0xe8643c, 0xf3efe6, 0xfff2c8));
  player.name = '你';
  scene.add(player.model);
  ais = AI_DRIVERS.map(cfg => { const a = new AICar(track, buildCarModel(cfg.body, cfg.trim, cfg.helmet), cfg, rand); scene.add(a.model); return a; });
  ais.forEach(a => { a.others = ais; });
  cars = [...ais, player];
  resetRace();
  prog(0, 1)(1);
  renderer.compile(scene, camera);
}

// ---------- 比赛状态 ----------
let state = 'loading', raceT = 0, countT = 0, lapStart = 0, bestLap = Infinity, lastLap = Infinity, finishOrder = [], paused = false, camMode = 0;
let spotIdx = -1;
function gridSlot(k) { return { d: D_START - 10 - k * 8, lat: k % 2 ? 4.8 : -4.8 }; }
function resetRace() {
  ais.forEach((a, k) => { const g = gridSlot(k); a.reset(g.d, g.lat); a.prog = g.d - D_START; a.finished = false; a.time = 0; });
  const g = gridSlot(5);
  player.reset(g.d, g.lat);
  player.prog = g.d - D_START; player.lastD = player.d; player.finished = false; player.time = 0;
  raceT = 0; lapStart = 0; bestLap = Infinity; lastLap = Infinity; finishOrder = []; spotIdx = -1; player.lapSeen = 0;
  cam.yaw = player.h; cam.pos.set(0, 0, 0);
  smoke && smoke.p.forEach(p => { p.life = 0; });
}
function progressOf(c) { return c === player ? player.prog : c.dist - D_START; }
function lapOf(c) { return clamp(Math.floor(progressOf(c) / track.length) + 1, 1, LAPS); }
function ranking() { return [...cars].sort((a, b) => (a.finished && b.finished ? a.time - b.time : b.finished - a.finished || progressOf(b) - progressOf(a))); }

$('start').addEventListener('click', () => startRace());
$('again').addEventListener('click', () => { $('result').hidden = true; resetRace(); startRace(); });
$('mute').addEventListener('click', () => { sound.setOn(!sound.on); $('mute').classList.toggle('off', !sound.on); });
function startRace() {
  sound.start();
  $('title').hidden = true; $('hud').hidden = false;
  if (state === 'title' || state === 'finish') resetRace();
  state = 'count'; countT = Q.has('skipcount') ? 0.61 : 3.6; lastCount = 4;
  canvas.focus();
}
let lastCount = 4;

// ---------- HUD ----------
const toastEl = $('toast'), spotEl = $('spot');
let toastT = 0, spotT = 0;
function toast(text, kind = '') { toastEl.textContent = text; toastEl.className = `toast show ${kind}`; toastT = 1.2; }
function showSpot(name, small) { spotEl.textContent = name; spotEl.className = `spot show${small ? ' small' : ''}`; spotT = small ? 1.6 : 2.6; }
const mini = $('mini'), mctx = mini.getContext('2d');
const MB = { x0: -600, x1: 730, z0: -480, z1: 520 };
function mm(x, z) { const s = Math.min(mini.width / (MB.x1 - MB.x0), mini.height / (MB.z1 - MB.z0)); return [(x - MB.x0) * s + (mini.width - (MB.x1 - MB.x0) * s) / 2, (z - MB.z0) * s + (mini.height - (MB.z1 - MB.z0) * s) / 2]; }
function drawMini() {
  const c = mctx; c.clearRect(0, 0, mini.width, mini.height);
  c.fillStyle = 'rgba(107,188,191,0.55)';
  for (const poly of [LY.LAKE]) { c.beginPath(); poly.forEach(([x, z], i) => { const [a, b] = mm(x, z); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.fill(); }
  c.strokeStyle = '#2a3238'; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i <= track.N; i += 6) { const [a, b] = mm(track.px[i % track.N], track.pz[i % track.N]); i ? c.lineTo(a, b) : c.moveTo(a, b); }
  c.stroke();
  c.strokeStyle = '#f6f3ea'; c.lineWidth = 2.2; c.stroke();
  for (const car of cars) {
    const [a, b] = mm(car.x, car.z);
    c.fillStyle = car === player ? '#e8643c' : '#' + car.cfg.body.toString(16).padStart(6, '0');
    c.strokeStyle = '#2a3238'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(a, b, car === player ? 6 : 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
const nitroSlots = [...document.querySelectorAll('#nitro .slot')];
function updateHud() {
  const rk = ranking(), pos = rk.indexOf(player) + 1;
  $('pos').innerHTML = `${pos}<small>/${cars.length}</small>`;
  $('lap').textContent = `${lapOf(player)}/${LAPS}`;
  $('time').textContent = fmt(raceT);
  $('best').textContent = fmt(bestLap);
  $('kmh').textContent = Math.round(player.kmh);
  // 氮气槽：前 nitroN 个满，下一个按集气进度灌水
  const n = player.nitroN;
  nitroSlots.forEach((el, k) => {
    const full = k < n;
    if (full && !el.classList.contains('full')) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    el.classList.toggle('full', full);
    el.classList.toggle('burning', k === n && player.nitroT > 0);
    el.firstElementChild.style.height = full ? '100%' : k === n ? `${(player.gauge * 100).toFixed(1)}%` : '0%';
  });
  $('nitro').classList.toggle('burn', player.nitroT > 0);
  $('nitro').classList.toggle('max', n >= 3);
  $('nlabel').textContent = player.nitroT > 0 ? '氮气中！' : n >= 3 ? '氮气已满 · Ctrl/空格' : n > 0 ? `氮气 ×${n} · Ctrl/空格` : '漂移集气';
  $('wrong').hidden = !(player.wrongT > 1.2);
  $('board').innerHTML = rk.map((c, i) => `<li class="${c === player ? 'me' : ''}"><b>${i + 1}</b>${c.name}</li>`).join('');
}

// ---------- 自动驾驶（?auto，测试和录屏用） ----------
const autoS = {};
function autopilot() {
  const p = player, look = 14 + p.s * 0.45;
  const k = track.curvAhead(p.d, 0, 40 + p.s * 1.2);
  const tgt = track.sample(p.d + look, autoS);
  const want = Math.atan2(tgt.x - p.x, tgt.z - p.z);
  const err = wrapA(want - p.h);
  const vSafe = Math.sqrt(30 / Math.max(Math.abs(k.k), 1e-4));
  const sharp = Math.abs(track.curv[p.hint]) > 1 / 60;
  return { up: p.s < vSafe + 4, down: p.s > vSafe + 10, left: err > 0.03, right: err < -0.03, drift: sharp && p.s > 20 && Math.abs(err) > 0.08,
    upPressed: p.window > 0 && p.window < 0.38, nitroPressed: Math.abs(k.k) < 1 / 400 && p.nitroN > 0 };
}

// ---------- 相机 ----------
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62, shake: 0, fly: 0 };
function updateCamera(dt) {
  if (state === 'title' || state === 'loading') {
    // 片头：沿着赛道上空慢慢飞，看西湖
    cam.fly += dt * 22;
    const s = track.sample(D_START + cam.fly, {}), a = track.sample(D_START + cam.fly + 110, {});
    // 机位放在赛道低的那一侧（通常是湖面上），高度至少离地 45 米，避开山上的树
    const side = terrain && terrain.groundAt(s.x + s.rx * 70, s.z + s.rz * 70) < terrain.groundAt(s.x - s.rx * 70, s.z - s.rz * 70) ? 1 : -1;
    if (terrain) cam.side = cam.side === undefined ? side : damp(cam.side, side, 1.2, dt);
    else cam.side = 1;
    const cx = s.x + s.rx * 70 * cam.side, cz = s.z + s.rz * 70 * cam.side;
    const gy = terrain ? Math.max(terrain.groundAt(cx, cz), s.y) : s.y;
    cam.flyY = damp(cam.flyY ?? gy + 45, gy + 45, 1.2, dt);
    camera.position.set(cx, cam.flyY, cz);
    camera.lookAt(a.x, a.y + 2, a.z);
    camera.fov = 58; camera.updateProjectionMatrix();
    return;
  }
  const p = player;
  // 偏向运动方向，漂移时能看到车身甩出去
  const yawT = camMode === 1 ? p.h : p.m + wrapA(p.h - p.m) * 0.35;
  cam.yaw += wrapA(yawT - cam.yaw) * (1 - Math.exp(-(p.drift ? 4 : 6) * dt));
  const dist = camMode === 1 ? 6.5 : 9.5 + clamp(p.s / 70, 0, 1) * 1.5, hgt = camMode === 1 ? 2.6 : 3.7;
  const tx = p.x - Math.sin(cam.yaw) * dist, tz = p.z - Math.cos(cam.yaw) * dist;
  const ty = Math.max(p.y + hgt, p.y + hgt);
  if (cam.pos.lengthSq() === 0) cam.pos.set(tx, ty, tz);
  cam.pos.x = damp(cam.pos.x, tx, 14, dt); cam.pos.z = damp(cam.pos.z, tz, 14, dt); cam.pos.y = damp(cam.pos.y, ty, 7, dt);
  cam.shake = Math.max(0, cam.shake - dt * 3);
  const sh = cam.shake * 0.35;
  camera.position.set(cam.pos.x + (Math.random() - 0.5) * sh, cam.pos.y + (Math.random() - 0.5) * sh, cam.pos.z + (Math.random() - 0.5) * sh);
  cam.look.set(p.x + Math.sin(cam.yaw) * 6, p.y + 1.4, p.z + Math.cos(cam.yaw) * 6);
  camera.lookAt(cam.look);
  const fovT = 60 + clamp(p.s / 52, 0, 1.2) * 9 + (p.nitroT > 0 ? 8 : 0);
  cam.fov = damp(cam.fov, fovT, 4, dt);
  camera.fov = cam.fov; camera.updateProjectionMatrix();
}

// ---------- 主循环 ----------
let last = performance.now(), elapsed = 0, frames = 0, fpsT = 0, fps = 60, slow = 0;
const stats = $('stats');
const wheelL = new THREE.Vector3(), wheelR = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (paused || state === 'loading') dt = state === 'loading' ? dt : 0;
  elapsed += dt;
  if (state !== 'loading') step(dt);
  pressed.clear();
  render(dt);
}
function step(dt) {
  if (pressed.has('pause') && (state === 'race' || state === 'count')) { paused = !paused; $('paused').hidden = !paused; }
  if (paused) return;
  if (pressed.has('mute')) $('mute').click();
  if (pressed.has('cam')) camMode = (camMode + 1) % 2;

  const racing = state === 'race';
  if (state === 'count') {
    countT -= dt;
    const n = Math.ceil(countT - 0.6);
    if (n !== lastCount && n >= 0) { lastCount = n; $('count').textContent = n > 0 ? n : 'GO!'; $('count').className = 'count show'; sound.blip(n > 0 ? 520 : 1040, n > 0 ? 0.15 : 0.4); }
    if (countT <= 0.6) {
      state = 'race'; lapStart = 0;
      // 起步加速：倒计时结束那一刻按住油门
      if (keys.has('up') || touch.on || AUTO) { player.startT = 1.2; toast('起步加速！', 'good'); }
    }
  }
  if (countT < 0 && state === 'race') $('count').className = 'count';
  countT -= state === 'race' ? dt : 0;

  const inp = AUTO && state !== 'title' ? autopilot() : readInput();
  if (pressed.has('reset') && racing) {
    const s = track.sample(player.d, {});
    player.x = s.x; player.z = s.z; player.h = player.m = s.hd; player.s = Math.min(player.s, 10); player.drift = false; player.air = false;
  }
  const active = racing && !player.finished;
  player.update(dt, active ? inp : IDLE, active);
  // 累计进度（过起点线算圈）
  let dd = player.d - player.lastD; if (dd > track.length / 2) dd -= track.length; if (dd < -track.length / 2) dd += track.length;
  player.prog += dd; player.lastD = player.d;
  const pProg = player.prog;
  for (const a of ais) a.update(dt, racing || state === 'finish', pProg, a.dist - D_START);

  // 车与车：简单的圆形推开
  for (const a of ais) {
    const dx = a.x - player.x, dz = a.z - player.z, d = Math.hypot(dx, dz);
    if (d < 3.1 && d > 0.01) {
      const push = (3.1 - d) * 0.5, nx = dx / d, nz = dz / d;
      player.x -= nx * push; player.z -= nz * push;
      a.lat += (nx * track.rx[player.hint] + nz * track.rz[player.hint]) * push;
      const rel = (player.s - a.s) * 0.3; player.s -= rel; a.s += rel;
      if (Math.abs(rel) > 1.2) { sound.thud(Math.abs(rel) * 3); cam.shake = Math.min(1, cam.shake + 0.4); }
    }
  }

  if (racing || state === 'finish') raceT += dt;
  // 圈数与完赛
  const finishCheck = (c, prog) => {
    if (!c.finished && prog >= LAPS * track.length) { c.finished = true; c.time = raceT; finishOrder.push(c); }
  };
  if (racing || state === 'finish') {
    const lapNow = Math.floor(player.prog / track.length);
    if (player.lapSeen === undefined) player.lapSeen = 0;
    if (lapNow > player.lapSeen && lapNow >= 1) {
      player.lapSeen = lapNow;
      lastLap = raceT - lapStart; lapStart = raceT; bestLap = Math.min(bestLap, lastLap);
      if (lapNow < LAPS) toast(lapNow === LAPS - 1 ? `最后一圈！ ${fmt(lastLap)}` : `第 ${lapNow + 1} 圈 ${fmt(lastLap)}`, 'lap');
    }
    for (const a of ais) finishCheck(a, a.dist - D_START);
    if (!player.finished) { finishCheck(player, player.prog); if (player.finished) { state = 'finish'; finishT = 0; toast('完赛！', 'lap'); } }
  }
  if (state === 'finish') {
    finishT += dt;
    if (finishT > 2.2 && $('result').hidden) showResult();
  }

  // 事件 → 提示、声音、特效
  for (const e of player.events) {
    if (e.type === 'small') { toast(e.perfect ? '完美小喷！' : '小喷！', 'good'); sound.whoosh(0.25, 0.6); }
    else if (e.type === 'double') { toast('双喷！', 'great'); sound.whoosh(0.45, 1.2); }
    else if (e.type === 'nitro') { toast('氮气！', 'nitro'); sound.whoosh(0.4, 1.1); }
    else if (e.type === 'landBoost') { toast('落地喷！', 'good'); sound.whoosh(0.25, 0.6); }
    else if (e.type === 'gauge') { sound.blip(880, 0.12, 'triangle', 0.12); sound.blip(1320, 0.1, 'triangle', 0.08); }
    else if (e.type === 'pad') sound.whoosh(0.3, 0.7);
    else if (e.type === 'crash') { sound.thud(e.power); cam.shake = Math.min(1, 0.3 + e.power * 0.04); }
    else if (e.type === 'land' && e.air > 0.3) cam.shake = Math.min(1, cam.shake + 0.25);
  }
  player.events.length = 0;

  // 景点字幕
  if (racing) {
    const d = track.wrapD(player.d);
    for (let k = 0; k < SPOTS.length; k++) {
      const sp = SPOTS[k]; let dd2 = d - sp.d; if (dd2 < 0) dd2 += track.length;
      if (dd2 < 10 && k !== spotIdx) { spotIdx = k; showSpot(sp.name, sp.small); }
    }
  }

  // 漂移烟、刹车印
  const allCars = [player, ...ais];
  for (const c of allCars) {
    const drifting = c.drift && !c.air && c.s > 10;
    const h = c.h, fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    wheelL.set(c.x - fx * 1.35 - rx * 1.0, c.y, c.z - fz * 1.35 - rz * 1.0);
    wheelR.set(c.x - fx * 1.35 + rx * 1.0, c.y, c.z - fz * 1.35 + rz * 1.0);
    const near = Math.hypot(c.x - camera.position.x, c.z - camera.position.z) < 180;
    if (drifting && near && Math.random() < dt * 40) {
      for (const w of [wheelL, wheelR]) smoke.emit(w.x, w.y + 0.3, w.z, (Math.random() - 0.5) * 2 - fx * c.s * 0.05, 0.6 + Math.random(), (Math.random() - 0.5) * 2 - fz * c.s * 0.05, 0.55 + Math.random() * 0.35, 0.7 + Math.random() * 0.4);
    }
    // 喷气时尾部甩出火团（氮气偏蓝白、小喷偏橙）
    const boostOn = c === player ? (c.nitroT > 0 || c.smallT > 0 || c.padT > 0) : (c.nitroT > 0 || c.smallT > 0);
    if (boostOn && near && Math.random() < dt * 45) {
      const blue = c.nitroT > 0, side = Math.random() < 0.5 ? -0.45 : 0.45;
      smoke.emit(c.x - fx * (3.6 + Math.random() * 1.5) + rx * side, c.y + 0.55, c.z - fz * (3.6 + Math.random() * 1.5) + rz * side, -fx * 6, 0.6, -fz * 6,
        blue ? 0.55 : 0.42, 0.32, blue ? [0.75, 0.92, 1.25] : [1.3, 0.78, 0.35]);
    }
    skids.mark(c.name + 'L', wheelL.x, c.y, wheelL.z, rx, rz, drifting);
    skids.mark(c.name + 'R', wheelR.x, c.y, wheelR.z, rx, rz, drifting);
  }
  smoke.update(dt);
  player.sync(dt);
  sound.update(player.s, inp.up && active, player.drift, player.boosting, state === 'race' || state === 'count');

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.className = 'toast'; }
  if (spotT > 0) { spotT -= dt; if (spotT <= 0) spotEl.className = 'spot'; }
  if (state === 'race' || state === 'count' || state === 'finish') { updateHud(); drawMini(); }
}
let finishT = 0;
function showResult() {
  const rk = ranking();
  $('result').hidden = false;
  const me = rk.indexOf(player) + 1;
  $('rtitle').textContent = me === 1 ? '冠军！西湖一圈你最快' : me <= 3 ? `第 ${me} 名，上了领奖台` : `第 ${me} 名，再来一局？`;
  $('rlist').innerHTML = rk.map((c, i) => `<li class="${c === player ? 'me' : ''}"><b>${i + 1}</b><span>${c.name}</span><em>${c.finished ? fmt(c.time) : '未完赛'}</em></li>`).join('');
  $('rbest').textContent = `最快单圈 ${fmt(bestLap)}`;
}

function render(dt) {
  updateCamera(dt);
  if (updateBoats) updateBoats(elapsed);
  updateLOD(camera.position);
  G.uTime.value = elapsed;
  post.post.uniforms.uTime.value = elapsed;
  const sp = player && (player.nitroT > 0 ? 1 : player.padT > 0 || player.smallT > 0 ? 0.5 : 0);
  post.post.uniforms.uSpeed.value = damp(post.post.uniforms.uSpeed.value, state === 'race' ? sp || 0 : 0, 6, dt);
  // 阴影跟着车（片头跟着相机看的地方）
  const focus = player && state !== 'title' && state !== 'loading' ? player.model.position : camera.position;
  sun.target.position.set(focus.x, focus.y, focus.z);
  sun.position.copy(SUN).multiplyScalar(150).add(sun.target.position);
  sun.target.updateMatrixWorld();
  renderer.info.reset();
  post.render(renderer, scene, camera, { lines: lowTier < 2 });

  frames++;
  const nowT = performance.now();
  if (!fpsT) fpsT = nowT;
  if (nowT - fpsT >= 1000) {
    fps = Math.round(frames * 1000 / (nowT - fpsT)); frames = 0; fpsT = nowT;
    slow = fps < 45 && state !== 'loading' && !PIN ? slow + 1 : 0;
    if (slow >= 2 && pr > 1) { pr = Math.max(1, pr - 0.25); slow = 0; resize(); }
    else if (slow >= 3 && pr <= 1 && lowTier < 2) { slow = 0; lowTier++; if (lowTier === 1) { renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); } }
    if (DEBUG) { const i = renderer.info.render; stats.hidden = false; stats.innerHTML = `${fps} fps · 像素比 ${pr.toFixed(2)} · 档位 ${lowTier}<br>${i.calls} draw calls · ${(i.triangles / 1000).toFixed(0)}k 三角形`; }
  }
}

// ---------- 启动 ----------
const bootT = performance.now();
frame();
build().then(() => {
  $('loading').hidden = true; $('title').hidden = false;
  state = 'title';
  if (Q.has('go') || AUTO) startRace();
  window.__race = {
    track, player, ais, camera, renderer, get state() { return state; }, get fps() { return fps; }, get info() { return { ...renderer.info.render }; },
    buildMs: Math.round(performance.now() - bootT),
    finishNow() { player.prog = LAPS * track.length - 30; player.lapSeen = LAPS - 1; ais.forEach((a, k) => { a.dist = D_START + LAPS * track.length + 20 - k * 70; }); },
    // 测试用：把玩家（和 AI 车队）挪到起点后 d 米处
    teleport(d, lat = 0) {
      player.reset(D_START + d, lat); player.prog = d; player.lastD = player.d; player.lapSeen = 0;
      ais.forEach((a, k) => { a.reset(D_START + d + 18 + k * 9, (k % 2 ? 5 : -5)); a.s = 40; });
      player.s = 40; cam.pos.set(0, 0, 0); cam.yaw = player.h;
    },
  };
}).catch(err => { console.error(err); $('loadmsg').textContent = `加载失败：${err.message}`; });

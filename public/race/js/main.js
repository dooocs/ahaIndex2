// 西湖飞车 · 西湖赛道：把赛道、地形、景物、车辆、AI、HUD、声音接到一起。
import * as THREE from 'three';
import { G, createPost } from './toon.js';
import * as LY from './layout.js';
import { Track } from './track.js';
import { racingLine } from './line.js';
import { makePilot } from './pilot.js';
import { buildTerrain, WATER } from './terrain.js';
import { classify, buildTrackMeshes, cornerSigns } from './trackMesh.js';
import { buildScenery, buildBoats, updateLOD } from './scenery.js';
import { buildCarModel, PlayerCar, IDLE } from './car.js';
import { AICar, AI_DRIVERS } from './ai.js';
import { Smoke, Skids } from './effects.js';
import { Sound } from './audio.js';
import { damp, makeRand, slice } from './noise.js';
import * as LB from './board.js';
import { TUNE, isAdvanced, applyTuning } from './tuning.js';
import { readQuality, qualityProfile, bindQualityButton } from './quality.js';
import { createTour, LANDMARKS } from './tour.js';

THREE.ColorManagement.enabled = false;
const Q = new URLSearchParams(location.search);
const ADVANCED = isAdvanced(Q);
applyTuning(Q);
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
catch (e) { $('loadmsg').textContent = '这台设备的浏览器没有开启 WebGL，无法运行西湖飞车。'; throw e; }
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
sun.shadow.camera.layers.enable(1);   // 柳条在第 1 层（不描线），影子照样要投
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.06; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const post = createPost(camera);

// ---------- 尺寸与自适应分辨率 ----------
let qualityMode = readQuality(Q), lowTier = 0, pr = profile().pixelRatio;
function profile() {
  return qualityProfile(qualityMode, { dpr: window.devicePixelRatio || 1, coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth, height: innerHeight });
}
function setShadows(enabled) {
  if (renderer.shadowMap.enabled === enabled) return;
  renderer.shadowMap.enabled = enabled;
  scene.traverse(o => {
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    materials.forEach(m => { m.needsUpdate = true; });
  });
}
function applyQuality(mode) {
  qualityMode = mode;
  const p = profile();
  pr = p.pixelRatio; lowTier = mode === 'low' ? 2 : 0;
  setShadows(p.shadows);
  post.setQuality(p);
  if (smoke) smoke.setLimit(p.smokeLimit);
  // 手动切换后重新采样，避免将着色器编译耗时当作持续掉帧。
  slow = 0; frames = 0; fpsT = 0;
  resize();
}
let insetTop = Math.max(0, Math.min(400, +(Q.get('inset')) || 0));
function resize() {
  const w = innerWidth, h = innerHeight;
  if (qualityMode === 'low') pr = profile().pixelRatio;
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
const typing = e => e.target && e.target.closest && e.target.closest('input, textarea, #tuning-panel, #tuning-toggle');
addEventListener('keydown', e => {
  if (typing(e)) return;
  if (e.code === 'Escape' && !$('lb').hidden) { closeBoard(); return; }
  const k = MAP[e.code]; if (!k) return;
  // 声音开关直接在用户手势里执行，暂停时也可用；不等渲染帧再恢复 AudioContext。
  if (k === 'mute') { e.preventDefault(); if (!e.repeat) $('mute').click(); return; }
  if (e.code.startsWith('Arrow') || e.code === 'Space' || k === 'nitro') e.preventDefault();
  if (!keys.has(k)) pressed.add(k);
  keys.add(k);
});
addEventListener('keyup', e => { const k = MAP[e.code]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());
addEventListener('focusin', e => { if (e.target.closest?.('#tuning-panel, #tuning-toggle')) { keys.clear(); pressed.clear(); } });
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
  if (ADVANCED && document.activeElement?.closest('#tuning-panel, #tuning-toggle')) return { ...IDLE };
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
track.line = racingLine(track, 2.6);   // 走线：AI 和自动驾驶按它开、按它的曲率算过弯速度
track.startAt = LY.START_AT;
track.padAt = [[425, -180], [50, -352], [-403, -178], [-300, 474]];
const D_START = track.dAt(...LY.START_AT);
let terrain, updateBoats, player, ais = [], cars = [], smoke, skids;
let tour;
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
  tour = createTour(track, terrain.groundAt, D_START);
  mountLandmarks();
  prog(0, 0.35)(1);
  classify(track);
  buildTrackMeshes(track, scene);
  cornerSigns(track, scene);
  // 杨公堤里六桥的名字：按经过顺序（由北往南）
  const yang = (track.bridgeRuns || []).filter(([a]) => track.px[a % track.N] < -380).sort((p, q) => p[0] - q[0]);
  yang.forEach(([a, b], k) => SPOTS.push({ d: ((a + b) / 2) * track.ds - 12, name: LY.YANG_BRIDGES[k] || '', small: true }));
  SPOTS.sort((p, q) => p.d - q.d);
  await slice();
  await buildScenery(track, terrain, scene, prog(0.35, 0.92));
  updateBoats = buildBoats(scene);
  smoke = new Smoke(scene); smoke.setLimit(profile().smokeLimit); skids = new Skids(scene);

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
  raceT = 0; lapStart = 0; bestLap = Infinity; lastLap = Infinity; finishOrder = []; spotIdx = -1; player.lapSeen = 0; player.laps = [];
  cam.yaw = player.h; cam.pos.set(0, 0, 0);
  smoke && smoke.p.forEach(p => { p.life = 0; });
}
function progressOf(c) { return c === player ? player.prog : c.dist - D_START; }
function lapOf(c) { return clamp(Math.floor(progressOf(c) / track.length) + 1, 1, LAPS); }
function ranking() { return [...cars].sort((a, b) => (a.finished && b.finished ? a.time - b.time : b.finished - a.finished || progressOf(b) - progressOf(a))); }

$('start').addEventListener('click', () => startRace());
$('again').addEventListener('click', () => { $('result').hidden = true; resetRace(); startRace(); });
// 每次进入页面先静音；只有主动点击喇叭（或按 M）才开声音，不恢复旧的自动播放偏好。
const syncMute = () => { const on = !!sound.ctx && sound.on; $('mute').classList.toggle('off', !on); $('mute').classList.toggle('short', state !== 'title'); $('mute').title = on ? '关掉声音（M）' : '打开声音和音乐（M）'; };
$('mute').addEventListener('click', () => {
  const turnOn = !(sound.ctx && sound.on);
  sound.setOn(turnOn);
  if (turnOn) sound.start();
  $('mute').classList.remove('hint');
  syncMute(); $('mute').blur();   // 别让空格（喷氮气）再“按”到这个按钮
});
syncMute();
// 后退/前进缓存会保留整个游戏实例；离开时也静音，返回页面不会自行续播。
addEventListener('pagehide', () => { sound.setOn(false); syncMute(); });
function startRace() {
  sound.start(); $('mute').classList.remove('hint');
  $('title').hidden = true; $('hud').hidden = false;
  $('tour').hidden = true;
  if (state === 'title' || state === 'finish') resetRace();
  state = 'count'; countT = Q.has('skipcount') ? 0.61 : 3.6; lastCount = 4;
  syncMute();
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
// ---------- 车速表：指针表，0–280 km/h，180 以上红区 ----------
const dial = $('gauge'), dctx = dial.getContext('2d');
const DIAL_MAX = 280, A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;   // 从左下 135° 顺时针扫到右下 45°
let dialV = 0, dialSize = 0;
const ang = v => A0 + SWEEP * Math.min(1, Math.max(0, v / DIAL_MAX));
function drawDial(kmh, dt, boosting) {
  const css = dial.clientWidth || 168, pr = Math.min(2, devicePixelRatio || 1), px = Math.round(css * pr);
  if (px !== dialSize) { dial.width = dial.height = px; dialSize = px; }
  dialV += (kmh - dialV) * (1 - Math.exp(-16 * dt));    // 指针有一点阻尼，漂移掉速时看得见在往回摆
  const c = dctx, R = px / 2, cx = R, cy = R;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, px, px);
  const s = px / 200;
  c.setTransform(s, 0, 0, s, 0, 0);
  // 表盘
  c.beginPath(); c.arc(100, 100, 96, 0, Math.PI * 2); c.fillStyle = 'rgba(251,252,247,0.94)'; c.fill();
  c.lineWidth = 4; c.strokeStyle = '#2a3238'; c.stroke();
  // 红区：180–280
  c.beginPath(); c.arc(100, 100, 80, ang(180), ang(DIAL_MAX)); c.lineWidth = 14;
  c.strokeStyle = boosting ? '#e5533d' : 'rgba(229,83,61,0.75)'; c.stroke();
  // 当前速度的弧（蓝色，进红区后变红）
  c.beginPath(); c.arc(100, 100, 80, ang(0), ang(Math.min(dialV, 180))); c.lineWidth = 6; c.strokeStyle = 'rgba(63,134,160,0.55)'; c.stroke();
  // 刻度：每 10 一小格，每 20 一中格，每 40 标数字
  for (let v = 0; v <= DIAL_MAX; v += 10) {
    const a = ang(v), major = v % 40 === 0, mid = v % 20 === 0, r1 = 88, r0 = major ? 70 : mid ? 75 : 79;
    c.beginPath(); c.moveTo(100 + Math.cos(a) * r0, 100 + Math.sin(a) * r0); c.lineTo(100 + Math.cos(a) * r1, 100 + Math.sin(a) * r1);
    c.lineWidth = major ? 3.2 : mid ? 2.2 : 1.4; c.strokeStyle = v > 180 ? '#b8322a' : '#2a3238'; c.stroke();
    if (major) {
      c.font = '600 15px "Barlow Condensed", "Arial Narrow", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = v > 180 ? '#b8322a' : '#2a3238'; c.fillText(String(v), 100 + Math.cos(a) * 58, 100 + Math.sin(a) * 58);
    }
  }
  // 读数
  const red = dialV > 181;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = '600 32px "Barlow Condensed", "Arial Narrow", sans-serif'; c.fillStyle = red ? '#d23c2c' : '#2a3238'; c.fillText(String(Math.round(kmh)), 100, 156);
  c.font = '600 12px "Barlow Condensed", "Arial Narrow", sans-serif'; c.fillStyle = '#5a666c'; c.fillText('km/h', 100, 171);
  // 指针
  const a = ang(dialV);
  c.save(); c.translate(100, 100); c.rotate(a);
  c.beginPath(); c.moveTo(-14, -4.5); c.lineTo(76, -1.6); c.lineTo(80, 0); c.lineTo(76, 1.6); c.lineTo(-14, 4.5); c.closePath();
  c.fillStyle = red ? '#e5533d' : '#e8643c'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#2a3238'; c.stroke();
  c.restore();
  c.beginPath(); c.arc(100, 100, 9, 0, Math.PI * 2); c.fillStyle = '#2a3238'; c.fill();
  c.beginPath(); c.arc(100, 100, 3.5, 0, Math.PI * 2); c.fillStyle = '#fbfcf7'; c.fill();
}
function updateHud() {
  const rk = ranking(), pos = rk.indexOf(player) + 1;
  $('pos').innerHTML = `${pos}<small>/${cars.length}</small>`;
  $('lap').textContent = `${lapOf(player)}/${LAPS}`;
  $('time').textContent = fmt(raceT);
  $('best').textContent = fmt(bestLap);
  // 氮气瓶：前 nitroN 瓶满，下一瓶按集气进度从下往上灌
  const n = player.nitroN;
  nitroSlots.forEach((el, k) => {
    const full = k < n, f = full ? 1 : k === n ? player.gauge : 0;
    if (full && !el.classList.contains('full')) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    el.classList.toggle('full', full);
    el.querySelector('.liq').setAttribute('y', (61 - 48 * f).toFixed(1));
  });
  $('nburn').style.width = player.nitroT > 0 ? `${Math.min(100, player.nitroT / TUNE.nitroTime * 100).toFixed(1)}%` : '0';
  $('nitro').classList.toggle('burn', player.nitroT > 0);
  $('nitro').classList.toggle('max', n >= 3);
  $('nlabel').textContent = player.nitroT > 0 ? '氮气中！' : n >= 3 ? '氮气已满 · 按空格' : n > 0 ? `氮气 ×${n} · 按空格` : '漂移集气';
  $('wrong').hidden = !(player.wrongT > 1.2);
  $('board').innerHTML = rk.map((c, i) => `<li class="${c === player ? 'me' : ''}"><b>${i + 1}</b>${c.name}</li>`).join('');
}

// ---------- 自动驾驶（?auto，测试和录屏用）：和调参模拟同一个车手，纯抓地、按限速剖面刹车 ----------
let pilot = null;
function autopilot() {
  pilot ||= makePilot(track, { drift: false, f: 0.85, g: 0.6 });
  return pilot.step(player);
}

// ---------- 相机 ----------
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62, shake: 0 };
let tourTime = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const tourPos = new THREE.Vector3(), tourLook = new THREE.Vector3(), tourAim = new THREE.Vector3();
let tourInitialized = false;
const markers = [];
function mountLandmarks() {
  for (const spot of LANDMARKS) {
    const el = document.createElement('div');
    el.className = 'landmark'; el.hidden = true;
    const name = document.createElement('b'), detail = document.createElement('span');
    name.textContent = spot.name; detail.textContent = spot.detail;
    el.append(name, detail); $('landmarks').append(el);
    markers.push({ el, world: new THREE.Vector3(spot.at[0], terrain.groundAt(...spot.at) + spot.lift, spot.at[1]), projected: new THREE.Vector3() });
  }
}
function updateLandmarks() {
  const visible = state === 'title' && !CAM_PIN;
  $('tour').hidden = !visible;
  if (!visible) return;
  camera.updateMatrixWorld();
  const blocked = [$('title').firstElementChild, $('quality'), $('mute')].map(el => el.getBoundingClientRect());
  const placed = [], w = innerWidth, h = innerHeight, half = w < 640 ? 53 : 66;
  for (const m of markers) {
    const p = m.projected.copy(m.world).project(camera);
    const x = (p.x + 1) * w / 2, y = (1 - p.y) * h / 2;
    const box = { left: x - half, right: x + half, top: y - 70, bottom: y + 8 };
    const overlap = r => box.left < r.right + 8 && box.right > r.left - 8 && box.top < r.bottom + 8 && box.bottom > r.top - 8;
    const show = p.z > -1 && p.z < 1 && box.left > 8 && box.right < w - 8 && box.top > insetTop + 64 && box.bottom < h - 8 && !blocked.some(overlap) && !placed.some(overlap);
    m.el.hidden = !show;
    if (show) { m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; placed.push(box); }
  }
}
// ?cam=x,y,z,lx,ly,lz：固定机位（截图、检查建模用）
const CAM_PIN = Q.get('cam') ? Q.get('cam').split(',').map(Number) : null;
function updateCamera(dt) {
  if (CAM_PIN) { camera.position.set(CAM_PIN[0], CAM_PIN[1], CAM_PIN[2]); camera.lookAt(CAM_PIN[3], CAM_PIN[4], CAM_PIN[5]); camera.fov = 55; camera.updateProjectionMatrix(); return; }
  if (state === 'title' || state === 'loading') {
    if (!tour) return;
    if (state === 'title' && !document.hidden && !reducedMotion.matches) tourTime += dt;
    const shot = tour.sample(reducedMotion.matches ? 0 : tourTime, camera.aspect);
    tourPos.fromArray(shot.position); tourLook.fromArray(shot.look);
    // 高空视角下保持地图平整、远处清晰；比赛恢复原来的弧面和雾气。
    G.uBend.value = 0; camera.far = 6000;
    post.post.uniforms.uTourReveal.value = shot.reveal;
    post.post.uniforms.uTourBounds.value = tour.bounds;
    if (!tourInitialized || reducedMotion.matches) {
      camera.position.copy(tourPos); tourAim.copy(tourLook); tourInitialized = true;
    } else {
      const f = 1 - Math.exp(-3 * dt);
      camera.position.lerp(tourPos, f); tourAim.lerp(tourLook, f);
    }
    camera.lookAt(tourAim);
    camera.fov = 58; camera.updateProjectionMatrix();
    $('tour-phase').textContent = shot.phase === 'overview' ? '西湖全景' : '环湖巡游';
    return;
  }
  G.uBend.value = 1 / 3400; camera.far = 2600;
  post.post.uniforms.uTourReveal.value = 0;
  const p = player;
  // 偏向运动方向，漂移时能看到车身甩出去
  const yawT = camMode === 1 ? p.h : p.m + wrapA(p.h - p.m) * TUNE.camDriftLook;
  cam.yaw += wrapA(yawT - cam.yaw) * (1 - Math.exp(-(p.drift ? TUNE.camDriftYaw : TUNE.camYaw) * dt));
  const dist = camMode === 1 ? TUNE.camNearDistance : TUNE.camDistance + clamp(p.s / 70, 0, 1) * TUNE.camSpeedDistance, hgt = camMode === 1 ? TUNE.camNearHeight : TUNE.camHeight;
  const tx = p.x - Math.sin(cam.yaw) * dist, tz = p.z - Math.cos(cam.yaw) * dist;
  const ty = Math.max(p.y + hgt, p.y + hgt);
  if (cam.pos.lengthSq() === 0) cam.pos.set(tx, ty, tz);
  cam.pos.x = damp(cam.pos.x, tx, TUNE.camFollow, dt); cam.pos.z = damp(cam.pos.z, tz, TUNE.camFollow, dt); cam.pos.y = damp(cam.pos.y, ty, TUNE.camFollowY, dt);
  cam.shake = Math.max(0, cam.shake - dt * 3);
  const sh = cam.shake * TUNE.camShake;
  camera.position.set(cam.pos.x + (Math.random() - 0.5) * sh, cam.pos.y + (Math.random() - 0.5) * sh, cam.pos.z + (Math.random() - 0.5) * sh);
  cam.look.set(p.x + Math.sin(cam.yaw) * TUNE.camLookAhead, p.y + 1.4, p.z + Math.cos(cam.yaw) * TUNE.camLookAhead);
  camera.lookAt(cam.look);
  const fovT = TUNE.camFov + clamp(p.s / 52, 0, 1.2) * TUNE.camSpeedFov + (p.nitroT > 0 ? TUNE.camNitroFov : 0);
  cam.fov = damp(cam.fov, fovT, TUNE.camFovResponse, dt);
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
  if (pressed.has('cam')) camMode = (camMode + 1) % 2;

  const racing = state === 'race';
  if (state === 'count') {
    countT -= dt;
    const n = Math.ceil(countT - 0.6);
    if (n !== lastCount && n >= 0) { lastCount = n; $('count').textContent = n > 0 ? n : 'GO!'; $('count').className = 'count show'; sound.blip(n > 0 ? 520 : 1040, n > 0 ? 0.15 : 0.4); }
    if (countT <= 0.6) {
      state = 'race'; lapStart = 0;
      // 起步加速：倒计时结束那一刻按住油门
      if (keys.has('up') || touch.on || AUTO) { player.startT = TUNE.startTime; toast('起步加速！', 'good'); }
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
      const rel = (player.s - a.s) * TUNE.carCollision; player.s -= rel; a.s += rel;
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
      lastLap = raceT - lapStart; lapStart = raceT; bestLap = Math.min(bestLap, lastLap); (player.laps ||= []).push(lastLap);
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
    if (drifting && near && Math.random() < dt * (qualityMode === 'low' ? 14 : 40)) {
      for (const w of [wheelL, wheelR]) smoke.emit(w.x, w.y + 0.3, w.z, (Math.random() - 0.5) * 2 - fx * c.s * 0.05, 0.6 + Math.random(), (Math.random() - 0.5) * 2 - fz * c.s * 0.05, 0.55 + Math.random() * 0.35, 0.7 + Math.random() * 0.4);
    }
    // 喷气时尾部甩出火团（氮气偏蓝白、小喷偏橙）
    const boostOn = c === player ? (c.nitroT > 0 || c.smallT > 0 || c.padT > 0) : (c.nitroT > 0 || c.smallT > 0);
    if (boostOn && near && Math.random() < dt * (qualityMode === 'low' ? 16 : 45)) {
      const blue = c.nitroT > 0, side = Math.random() < 0.5 ? -0.45 : 0.45;
      smoke.emit(c.x - fx * (3.6 + Math.random() * 1.5) + rx * side, c.y + 0.55, c.z - fz * (3.6 + Math.random() * 1.5) + rz * side, -fx * 6, 0.6, -fz * 6,
        blue ? 0.55 : 0.42, 0.32, blue ? [0.75, 0.92, 1.25] : [1.3, 0.78, 0.35]);
    }
    skids.mark(c.name + 'L', wheelL.x, c.y, wheelL.z, rx, rz, drifting);
    skids.mark(c.name + 'R', wheelR.x, c.y, wheelR.z, rx, rz, drifting);
  }
  smoke.update(dt);
  player.sync(dt);
  sound.update(player.s, inp.up && active, player.drift, player.boosting, state === 'race' || state === 'count', player.under);

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.className = 'toast'; }
  if (spotT > 0) { spotT -= dt; if (spotT <= 0) spotEl.className = 'spot'; }
  if (state === 'race' || state === 'count' || state === 'finish') { updateHud(); drawMini(); drawDial(player.kmh, dt, player.boosting); }
}
let finishT = 0, tainted = false;
// 只有正常跑完两圈的成绩才上榜：自动驾驶、改圈数、测试钩子跳过的都不算
const canUpload = () => !ADVANCED && !AUTO && LAPS === 2 && !tainted && (player.laps || []).length === 2;
function showResult() {
  const rk = ranking();
  $('result').hidden = false;
  const me = rk.indexOf(player) + 1;
  $('rtitle').textContent = me === 1 ? '冠军！西湖一圈你最快' : me <= 3 ? `第 ${me} 名，上了领奖台` : `第 ${me} 名，再来一局？`;
  $('rlist').innerHTML = rk.map((c, i) => `<li class="${c === player ? 'me' : ''}"><b>${i + 1}</b><span>${c.name}</span><em>${c.finished ? fmt(c.time) : '未完赛'}</em></li>`).join('');
  $('rbest').textContent = `最快单圈 ${fmt(bestLap)}`;
  afterRace();
}

// ---------- 成绩：本机最佳、上传、总榜 ----------
const status = (html, kind = '') => { const el = $('ustatus'); el.hidden = !html; el.className = `ustatus ${kind}`; el.innerHTML = html; };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const recordTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function recordTime(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return '<span class="lb-record-time">—</span>';
  const p = Object.fromEntries(recordTimeFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const full = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  return `<time class="lb-record-time" datetime="${date.toISOString()}" title="${full}（北京时间）" aria-label="记录时间：${full}（北京时间）">${full.slice(5)}</time>`;
}
let lastRun = null;
const loginHint = '登录后才能提交个人成绩。<a href="/login?next=%2Frace" target="_top">登录 / 注册</a>';
function syncLoginHint() {
  $('lb-login').hidden = LB.signedIn();
  if (!$('result').hidden && lastRun && !lastRun.uploaded) {
    if (!LB.signedIn()) { $('up').hidden = true; status(`本机已记下这次成绩。${loginHint}`); }
    else { $('up').hidden = false; status('填写昵称，提交个人成绩'); }
  }
}
addEventListener('race:authchange', syncLoginHint);
syncLoginHint();
function afterRace() {
  $('up').hidden = true; status('');
  if (!canUpload()) { if (ADVANCED) status('高级模式试跑：不计个人纪录，也不上传总榜。可继续调参后重新试跑。'); else if (AUTO) status('自动驾驶的成绩不上榜'); return; }
  const laps = player.laps.slice(0, 2), total = laps[0] + laps[1];
  const { newTotal } = LB.saveLocalBest(total, Math.min(...laps));
  lastRun = { laps, total, uploaded: false };
  if (newTotal) $('rbest').innerHTML = `最快单圈 ${fmt(bestLap)} · <b style="color:var(--accent)">个人新纪录！</b>`;
  updatePB();
  LB.online().then(on => {
    if (!on) { status('本机已记下这次成绩。排行榜要在向上研究所站内（amazingindex.com/race）打开才能上传。'); return; }
    if (!LB.signedIn()) { status(`本机已记下这次成绩。${loginHint}`); return; }
    const nick = LB.nickname();
    $('nick').value = nick;
    if (nick) upload(nick); else { $('up').hidden = false; status(''); }
  });
}
async function upload(nick) {
  if (!lastRun || lastRun.uploaded) return;
  if (!LB.signedIn()) { $('up').hidden = true; status(`本机已记下这次成绩。${loginHint}`); return; }
  $('upbtn').disabled = true;
  status('正在上传成绩……');
  try {
    const me = await LB.submit({ nick, laps: lastRun.laps });
    lastRun.uploaded = true; $('up').hidden = true;
    LB.setNickname(nick);
    status(me ? `已上榜：<b>${esc(me.nickname)}</b> 的最佳是 <b>${fmt(me.total_ms / 1000)}</b>，总榜第 <b>${me.rank}</b> 名` : '成绩已上传', 'good');
    updatePB();
  } catch (err) {
    status(LB.why(err), 'bad');
    if (!LB.nickname()) $('up').hidden = false;
  } finally { $('upbtn').disabled = false; }
}
$('up').addEventListener('submit', e => {
  e.preventDefault();
  const nick = $('nick').value.trim().slice(0, 12);
  if (!nick) { $('nick').focus(); return; }
  upload(nick);
});
async function updatePB() {
  if (ADVANCED) { $('pb').textContent = '高级模式 · 参数仅当前页面有效，试跑不计个人纪录和总榜'; return; }
  const lb = LB.localBest();
  let text = lb && isFinite(lb.total) ? `个人最佳：<b>${fmt(lb.total)}</b> · 最快单圈 ${fmt(lb.lap)}` : '个人最佳：还没有成绩，跑完两圈就有了';
  $('pb').innerHTML = text;
  try {
    if (!(await LB.online())) return;
    const me = await LB.myBest();
    if (me) $('pb').innerHTML = `个人最佳：<b>${fmt(me.total_ms / 1000)}</b> · 最快单圈 ${fmt(me.best_lap_ms / 1000)} · 总榜第 <b>${me.rank}</b> 名`;
  } catch { /* 网络不好时只显示本机最佳 */ }
}
async function openBoard() {
  $('lb').hidden = false;
  syncLoginHint();
  const list = $('lb-list');
  list.innerHTML = '<li class="empty">加载中……</li>'; $('lb-me').textContent = '';
  if (!(await LB.online())) { list.innerHTML = '<li class="empty">总榜要在向上研究所站内（amazingindex.com/race）打开</li>'; return; }
  try {
    const [rows, me] = await Promise.all([LB.top(50), LB.myBest()]);
    list.innerHTML = rows.length ? rows.map(r => `<li class="${r.me ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.nickname)}</span><span>${fmt(r.total_ms / 1000)}</span><span>${fmt(r.best_lap_ms / 1000)}</span>${recordTime(r.created_at)}</li>`).join('')
      : '<li class="empty">还没有人上榜，跑完两圈就是第一名</li>';
    $('lb-me').innerHTML = me ? `我的最佳：<b>${fmt(me.total_ms / 1000)}</b> · 第 <b>${me.rank}</b> 名` : '我还没有上榜成绩';
  } catch (err) { list.innerHTML = `<li class="empty">${esc(LB.why(err))}</li>`; }
}
function closeBoard() { $('lb').hidden = true; canvas.focus(); }
$('lb-open').addEventListener('click', openBoard);
$('lb-open2').addEventListener('click', openBoard);
$('lb-close').addEventListener('click', closeBoard);
$('lb').addEventListener('click', e => { if (e.target === $('lb')) closeBoard(); });
updatePB();

if (ADVANCED) import('./advanced.js').then(({ mountTuning }) => mountTuning({
  canvas,
  onChange() {
    // Cached AI and autopilot speed profiles depend on live grip, braking and top speed.
    pilot = null;
    for (const key of Object.keys(track)) if (key.startsWith('aiProf')) delete track[key];
  },
  restart() {
    if (!player || state === 'loading') return;
    paused = false; $('paused').hidden = true; $('result').hidden = true;
    resetRace(); startRace();
  },
  telemetry: () => player,
})).catch(err => console.error('高级调参面板加载失败', err));

function render(dt) {
  updateCamera(dt);
  updateLandmarks();
  post.post.uniforms.uFar.value = camera.far;
  post.post.uniforms.uHazeScale.value = state === 'title' || state === 'loading' ? 0.35 : 1;
  if (updateBoats) updateBoats(elapsed);
  updateLOD(camera.position, qualityMode === 'low' ? 0.4 : 1);
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
    slow = fps < 45 && state !== 'loading' && !paused && !document.hidden && qualityMode === 'standard' && !PIN ? slow + 1 : 0;
    if (slow >= 2 && pr > 1) { pr = Math.max(1, pr - 0.25); slow = 0; resize(); }
    else if (slow >= 3 && pr <= 1 && lowTier < 2) { slow = 0; lowTier++; if (lowTier === 1) setShadows(false); }
    if (DEBUG) { const i = renderer.info.render; stats.hidden = false; stats.innerHTML = `${fps} fps · 像素比 ${pr.toFixed(2)} · 档位 ${lowTier}<br>${i.calls} draw calls · ${(i.triangles / 1000).toFixed(0)}k 三角形`; }
  }
}

// ---------- 启动 ----------
const bootT = performance.now();
bindQualityButton($('quality'), qualityMode, applyQuality);
frame();
build().then(() => {
  $('loading').hidden = true; $('title').hidden = false;
  state = 'title';
  if (Q.has('go') || AUTO) startRace();
  window.__race = {
    track, player, ais, camera, renderer, get state() { return state; }, get fps() { return fps; }, get info() { return { ...renderer.info.render }; },
    buildMs: Math.round(performance.now() - bootT),
    finishNow() { tainted = true; player.prog = LAPS * track.length - 30; player.lapSeen = LAPS - 1; ais.forEach((a, k) => { a.dist = D_START + LAPS * track.length + 20 - k * 70; }); },
    // 测试用：把玩家（和 AI 车队）挪到起点后 d 米处
    teleport(d, lat = 0) {
      tainted = true;
      player.reset(D_START + d, lat); player.prog = d; player.lastD = player.d; player.lapSeen = 0;
      ais.forEach((a, k) => { a.reset(D_START + d + 18 + k * 9, (k % 2 ? 5 : -5)); a.s = 40; });
      player.s = 40; cam.pos.set(0, 0, 0); cam.yaw = player.h;
    },
  };
}).catch(err => { console.error(err); $('loadmsg').textContent = `加载失败：${err.message}`; });



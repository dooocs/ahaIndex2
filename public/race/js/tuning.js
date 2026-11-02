// One registry for the current handling defaults, live controls and shareable URLs.
// Speeds stay in m/s internally; the panel displays them in km/h.
const group = (id, label, rows) => ({ id, label, fields: rows.map(([key, label, value, min, max, step, unit = '', help = '']) => ({ key, label, value, min, max, step, unit, help })) });
export const TUNING_GROUPS = [
  group('power', '动力与刹车', [
    ['vmax', '普通极速', 50, 10, 100, 0.1, 'km/h'],
    ['vmaxBoost', '喷气极速', 72.2, 10, 140, 0.1, 'km/h'],
    ['accel', '油门加速度', 16.2, 0, 60, 0.1, 'm/s²'],
    ['nitroAccel', '氮气加速度', 27.7, 0, 100, 0.1, 'm/s²'],
    ['brake', '刹车力度', 40, 1, 100, 0.1, 'm/s²'],
    ['reverseMax', '倒车极速', 10, 1, 30, 0.1, 'km/h'],
    ['reverseAccel', '倒车加速度', 14, 0, 50, 0.1, 'm/s²'],
    ['roll', '松油门基础阻力', 2, 0, 15, 0.1, 'm/s²'],
    ['coastDrag', '松油门速度阻力', 0.05, 0, 0.5, 0.01],
    ['slopeForce', '坡道减速系数', 7, 0, 30, 0.1],
  ]),
  group('steering', '转向与抓地', [
    ['turn', '转向力度', 1.75, 0.1, 6, 0.01, 'rad/s'],
    ['steerResponse', '方向输入响应', 12, 0.5, 40, 0.1, '', '越大，方向键响应越快'],
    ['grip', '抓地回正速度', 11, 0.1, 40, 0.1, '', '越大，运动方向越快跟上车头'],
    ['highSpeedTurnLoss', '高速转向衰减', 0.5, 0, 0.75, 0.01],
    ['nitroTurn', '氮气转向倍率', 0.72, 0.1, 2, 0.01],
    ['airSteer', '空中转向倍率', 0.35, 0, 2, 0.01],
    ['latGrip', '自动驾驶横向加速度', 22, 1, 50, 0.1, 'm/s²', '仅影响 ?auto 车手的目标速度，手动驾驶不使用此上限'],
  ]),
  group('drift', '漂移与集气', [
    ['driftMin', '漂移最低速度', 12, 0, 40, 0.1, 'km/h'],
    ['driftYaw', '漂移基础转向', 1.35, 0, 5, 0.01, 'rad/s'],
    ['driftYawAlign', '漂移方向修正', 0.8, 0, 3, 0.01, 'rad/s'],
    ['driftFlick', '入漂甩头角', 0.04, 0, 0.4, 0.01, 'rad'],
    ['driftGrip', '漂移跟头速度', 1.9, 0.1, 15, 0.1],
    ['driftRelease', '松漂回正速度', 5.5, 0.1, 25, 0.1],
    ['maxDrift', '最大漂移角', 1.1, 0.1, 1.5, 0.01, 'rad'],
    ['driftCommitDelay', '余滑起算时间', 0.12, 0, 0.8, 0.01, 's'],
    ['driftCommitTime', '余滑蓄满时间', 0.6, 0.05, 2, 0.01, 's'],
    ['driftReleaseDecay', '余滑转向衰减', 3, 0.1, 15, 0.1],
    ['driftExitSpeed', '自动结束漂移速度', 7, 0, 20, 0.1, 'km/h'],
    ['driftDrag', '漂移基础阻力', 4.5, 0, 30, 0.1, 'm/s²'],
    ['driftDragAngle', '漂移角度阻力', 12, 0, 40, 0.1],
    ['driftDragSpeed', '漂移速度阻力', 0.3, 0, 2, 0.01],
    ['driftThrottle', '漂移油门倍率', 0.3, 0, 1.5, 0.01],
    ['airDrift', '空中漂移转向倍率', 0.4, 0, 2, 0.01],
    ['gaugeRate', '漂移集气速度', 0.3, 0, 2, 0.01],
    ['gaugeDelay', '有效集气等待', 0.25, 0, 1, 0.01, 's'],
  ]),
  group('nitro', '氮气与双喷', [
    ['nitroTime', '每瓶氮气时长', 2.6, 0.1, 10, 0.1, 's'],
    ['nitroMaxTime', '氮气叠加上限', 5, 0.1, 20, 0.1, 's'],
    ['nitroKick', '氮气点火推力', 3, 0, 20, 0.1, 'm/s'],
    ['doubleWindow', '双喷触发窗口', 0.45, 0, 2, 0.01, 's'],
    ['doubleTime', '双喷额外时长', 0.5, 0, 5, 0.1, 's'],
    ['doubleKick', '双喷点火推力', 5, 0, 30, 0.1, 'm/s'],
  ]),
  group('small', '小喷与落地喷', [
    ['smallWindow', '小喷触发窗口', 0.5, 0.05, 2, 0.01, 's'],
    ['smallMinDrift', '小喷最短漂移', 0.4, 0, 2, 0.01, 's'],
    ['smallPerfectWindow', '完美小喷窗口', 0.2, 0, 1, 0.01, 's'],
    ['smallTime', '小喷持续时间', 0.45, 0.05, 3, 0.01, 's'],
    ['smallPerfectTime', '完美小喷持续时间', 0.6, 0.05, 3, 0.01, 's'],
    ['smallPower', '小喷极速增量', 3, 0, 30, 0.1, 'm/s'],
    ['smallPerfectPower', '完美小喷极速增量', 4, 0, 30, 0.1, 'm/s'],
    ['smallKick', '小喷点火推力', 1.5, 0, 15, 0.1, 'm/s'],
    ['smallPerfectKick', '完美小喷点火推力', 2, 0, 15, 0.1, 'm/s'],
    ['smallAccel', '小喷额外加速度', 16, 0, 60, 0.1, 'm/s²'],
    ['landWindow', '落地喷触发窗口', 0.45, 0.05, 2, 0.01, 's'],
  ]),
  group('boost', '加速带与起步', [
    ['padSpeed', '加速带极速增量', 14, 0, 40, 0.1, 'm/s'],
    ['padAccel', '加速带额外加速度', 22, 0, 80, 0.1, 'm/s²'],
    ['padTime', '加速带持续时间', 1.1, 0.1, 5, 0.1, 's'],
    ['padKick', '加速带点火推力', 6, 0, 25, 0.1, 'm/s'],
    ['startSpeed', '起步极速增量', 12, 0, 40, 0.1, 'm/s'],
    ['startAccel', '起步额外加速度', 18, 0, 80, 0.1, 'm/s²'],
    ['startTime', '起步加速时长', 1.2, 0.1, 5, 0.1, 's'],
  ]),
  group('world', '腾空与碰撞', [
    ['gravity', '重力', 30, 1, 80, 0.1, 'm/s²'],
    ['wallBounce', '护栏反弹系数', 1.25, 0, 2, 0.01],
    ['wallLoss', '撞墙速度损失', 0.42, 0, 1, 0.01],
    ['wallAlign', '撞墙回正力度', 0.6, 0, 1.5, 0.01],
    ['carCollision', '车辆碰撞传速', 0.3, 0, 0.5, 0.01],
  ]),
  group('camera', '跟车镜头', [
    ['camDistance', '远视角距离', 9.5, 3, 25, 0.1, 'm'],
    ['camHeight', '远视角高度', 3.7, 1, 12, 0.1, 'm'],
    ['camNearDistance', '近视角距离', 6.5, 2, 15, 0.1, 'm'],
    ['camNearHeight', '近视角高度', 2.6, 1, 8, 0.1, 'm'],
    ['camSpeedDistance', '高速拉远距离', 1.5, 0, 8, 0.1, 'm'],
    ['camDriftLook', '漂移偏向车头', 0.35, 0, 1, 0.01],
    ['camYaw', '镜头转向响应', 6, 0.5, 20, 0.1],
    ['camDriftYaw', '漂移镜头响应', 4, 0.5, 20, 0.1],
    ['camFollow', '水平跟随响应', 14, 0.5, 40, 0.1],
    ['camFollowY', '高度跟随响应', 7, 0.5, 30, 0.1],
    ['camLookAhead', '镜头前瞻距离', 6, 0, 20, 0.1, 'm'],
    ['camFov', '基础视野', 60, 35, 100, 1, '°'],
    ['camSpeedFov', '高速视野增量', 9, 0, 25, 0.1, '°'],
    ['camNitroFov', '氮气视野增量', 8, 0, 25, 0.1, '°'],
    ['camFovResponse', '视野变化响应', 4, 0.5, 20, 0.1],
    ['camShake', '镜头震动幅度', 0.35, 0, 2, 0.01],
  ]),
  group('ai', 'AI 对手', [
    ['aiLat', 'AI 过弯横向加速度', 8.4, 1, 40, 0.1, 'm/s²'],
    ['aiBrake', 'AI 刹车力度', 9.5, 1, 60, 0.1, 'm/s²'],
  ]),
];

export const TUNING_FIELDS = TUNING_GROUPS.flatMap(g => g.fields);
export const DEFAULT_TUNE = Object.freeze(Object.fromEntries(TUNING_FIELDS.map(f => [f.key, f.value])));
export const TUNE = { ...DEFAULT_TUNE };
const byKey = new Map(TUNING_FIELDS.map(f => [f.key, f]));

export function isAdvanced(search) {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  return q.has('advanced') && ['', '1', 'true'].includes(q.get('advanced').toLowerCase());
}

export function setTune(key, raw, target = TUNE) {
  const field = byKey.get(key);
  if (!field || raw === null || !['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return false;
  const value = Number(raw);
  if (!Number.isFinite(value)) return false;
  target[key] = Math.max(field.min, Math.min(field.max, value));
  return true;
}

export function resetTune(target = TUNE) { Object.assign(target, DEFAULT_TUNE); }

export function applyTuning(search, target = TUNE) {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  if (!isAdvanced(q)) return;
  for (const f of TUNING_FIELDS) if (q.has(`t.${f.key}`)) setTune(f.key, q.get(`t.${f.key}`), target);
}

// Only the new, explicitly enabled mode is forwarded by the site's static iframe wrapper.
export function advancedSearch(search) {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  if (!isAdvanced(q)) return '';
  const forwarded = new URLSearchParams({ advanced: '1' });
  for (const f of TUNING_FIELDS) if (q.has(`t.${f.key}`)) forwarded.set(`t.${f.key}`, q.get(`t.${f.key}`));
  return `?${forwarded}`;
}

export function tuningURL(href, target = TUNE) {
  const url = new URL(href);
  // Recording and test switches must not hitch a ride in a shared manual test drive.
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('t.') || ['auto', 'go', 'skipcount', 'laps', 'cam'].includes(key)) url.searchParams.delete(key);
  url.searchParams.set('advanced', '1');
  for (const f of TUNING_FIELDS) if (target[f.key] !== f.value) url.searchParams.set(`t.${f.key}`, String(target[f.key]));
  return url.href;
}

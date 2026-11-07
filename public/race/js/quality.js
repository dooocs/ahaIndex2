// 画质只影响渲染；不改变车辆、AI、圈数或计时。
const KEY = 'westlake-race-quality';

export function readQuality(search, storage) {
  const override = search.get('quality');
  if (override === 'low') return 'low';
  if (override === 'high' || override === 'standard') return 'standard';
  try { return (storage ?? globalThis.localStorage)?.getItem(KEY) === 'low' ? 'low' : 'standard'; }
  catch { return 'standard'; }
}

export function qualityProfile(mode, { dpr = 1, coarse = false, width = 1, height = 1 } = {}) {
  const low = mode === 'low';
  return {
    pixelRatio: low ? Math.min(dpr, 1, Math.sqrt(1440 * 900 / Math.max(1, width * height))) : Math.min(dpr, coarse ? 1.5 : 2),
    shadows: !low, samples: low ? 0 : 4, grain: !low, lodScale: low ? 0.4 : 1, smokeLimit: low ? 90 : 260,
  };
}

export function bindQualityButton(button, initial, apply, storage) {
  let mode;
  function select(next, persist = false) {
    mode = next === 'low' ? 'low' : 'standard';
    apply(mode);
    const low = mode === 'low';
    button.textContent = `画质：${low ? '流畅' : '标准'}`;
    button.setAttribute('aria-pressed', String(low));
    button.setAttribute('aria-label', `${button.textContent}，点击切换${low ? '标准' : '流畅'}画质`);
    button.title = low ? '切换标准画质' : '切换流畅画质，适合运行卡顿的设备';
    if (persist) {
      try { (storage ?? globalThis.localStorage)?.setItem(KEY, mode); } catch { /* 禁用存储时仍可切换 */ }
    }
  }
  button.addEventListener('click', () => { select(mode === 'low' ? 'standard' : 'low', true); button.blur(); });
  select(initial);
  return { get mode() { return mode; } };
}

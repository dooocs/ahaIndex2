import { TUNE, TUNING_GROUPS, DEFAULT_TUNE, resetTune, setTune, tuningURL } from './tuning.js';

const display = (field, value) => Number((value * (field.unit === 'km/h' ? 3.6 : 1)).toFixed(4));

export function mountTuning({ canvas, onChange, restart, telemetry }) {
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/race/advanced.css'; document.head.append(css);
  document.body.classList.add('advanced');
  const toggle = document.createElement('button');
  toggle.id = 'tuning-toggle'; toggle.type = 'button'; toggle.textContent = '高级调参';
  toggle.setAttribute('aria-controls', 'tuning-panel'); toggle.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('aside');
  panel.id = 'tuning-panel'; panel.setAttribute('aria-label', '高级模式参数');
  panel.innerHTML = `
    <header><div><strong>高级模式</strong><span>操控实验室</span></div><button type="button" id="tuning-close" aria-label="收起调参面板">×</button></header>
    <p class="tuning-hint">调整立即生效，仅当前页面有效，不自动保存。点击赛道继续驾驶；调参局不计个人纪录和总榜。</p>
    <output id="tuning-telemetry" aria-label="车辆实时状态">等待车辆就绪……</output>
    <div class="tuning-actions"><button type="button" id="tuning-reset">恢复默认</button><button type="button" id="tuning-restart">重新试跑</button><button type="button" id="tuning-json">复制参数</button><button type="button" id="tuning-copy">复制参数链接</button></div>
    <p id="tuning-status" role="status">当前为默认参数</p>
    <div class="tuning-fields">${TUNING_GROUPS.map((group, i) => `
      <details${i < 2 ? ' open' : ''}><summary>${group.label}<span>${group.fields.length} 项</span></summary>
      ${group.fields.map(f => `<div class="tuning-field" data-param="${f.key}">
        <label for="tune-${f.key}">${f.label}<small>${f.unit}</small></label>
        <div class="tuning-values"><input type="range" id="tune-${f.key}" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.label}">
        <input type="number" data-number="${f.key}" min="${display(f, f.min)}" max="${display(f, f.max)}" step="any" aria-label="${f.label}数值">
        <button type="button" data-reset="${f.key}" title="恢复默认 ${display(f, f.value)} ${f.unit}" aria-label="恢复${f.label}默认值">↺</button></div>
        ${f.help ? `<p>${f.help}</p>` : ''}</div>`).join('')}</details>`).join('')}</div>`;
  document.body.append(toggle, panel);
  const status = panel.querySelector('#tuning-status');
  const controls = new Map(TUNING_GROUPS.flatMap(g => g.fields).map(f => [f.key, {
    field: f, row: panel.querySelector(`[data-param="${f.key}"]`),
    range: panel.querySelector(`[data-key="${f.key}"]`), number: panel.querySelector(`[data-number="${f.key}"]`),
  }]));
  function sync() {
    let changed = 0;
    for (const [key, c] of controls) {
      c.range.value = TUNE[key]; c.number.value = display(c.field, TUNE[key]);
      c.range.setAttribute('aria-valuetext', `${display(c.field, TUNE[key])} ${c.field.unit}`);
      const modified = TUNE[key] !== DEFAULT_TUNE[key];
      c.row.classList.toggle('modified', modified);
      if (modified) changed++;
    }
    status.textContent = changed ? `已调整 ${changed} 项 · 立即生效` : '当前为默认参数';
  }
  function edit(key, raw, numeric = false) {
    const c = controls.get(key);
    if (!c || String(raw).trim() === '') return;
    if (setTune(key, numeric ? Number(raw) / (c.field.unit === 'km/h' ? 3.6 : 1) : raw)) { onChange(); sync(); }
  }
  // Number fields commit on change so entering 180 doesn't clamp the intermediate "1".
  panel.addEventListener('input', e => { if (e.target.dataset.key) edit(e.target.dataset.key, e.target.value); });
  panel.addEventListener('change', e => { if (e.target.dataset.number) { edit(e.target.dataset.number, e.target.value, true); sync(); } });
  panel.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input[type="number"]')) { e.preventDefault(); e.target.blur(); canvas.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); show(false); }
  });
  panel.addEventListener('click', e => {
    const key = e.target.closest('[data-reset]')?.dataset.reset;
    if (key) { setTune(key, DEFAULT_TUNE[key]); onChange(); sync(); }
  });
  const show = open => { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (!open) canvas.focus(); };
  toggle.addEventListener('click', () => show(panel.hidden));
  panel.querySelector('#tuning-close').addEventListener('click', () => show(false));
  panel.querySelector('#tuning-reset').addEventListener('click', () => { resetTune(); onChange(); sync(); canvas.focus(); });
  panel.querySelector('#tuning-restart').addEventListener('click', () => { restart(); canvas.focus(); });
  async function copy(value, message) {
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = message;
    } catch {
      let fallback = panel.querySelector('#tuning-link');
      if (!fallback) { fallback = document.createElement('textarea'); fallback.id = 'tuning-link'; fallback.readOnly = true; fallback.setAttribute('aria-label', '待复制的参数'); status.after(fallback); }
      fallback.value = value; fallback.focus(); fallback.select(); status.textContent = '请手动复制下方内容';
    }
  }
  panel.querySelector('#tuning-json').addEventListener('click', () => copy(JSON.stringify(TUNE, null, 2), '当前参数已复制，不会自动保存'));
  panel.querySelector('#tuning-copy').addEventListener('click', () => {
    let href = location.href;
    try { if (parent !== window) href = parent.location.href; } catch { /* standalone iframe */ }
    copy(tuningURL(href), '参数链接已复制，打开即可复现这份设置');
  });
  sync();
  setInterval(() => {
    if (panel.hidden) return;
    const p = telemetry();
    if (p) panel.querySelector('#tuning-telemetry').textContent = `${p.kmh.toFixed(0)} km/h · 漂移角 ${(Math.abs(p.slip) * 180 / Math.PI).toFixed(0)}° · 集气 ${(p.gauge * 100).toFixed(0)}% · 氮气 ${p.nitroN}`;
  }, 200);
}

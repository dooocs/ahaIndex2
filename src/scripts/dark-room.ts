import { communityClient } from '../lib/community-client';
import { community } from '../lib/community-config';
import { communityFunctionFetch } from '../lib/community-transport';
import { DarkRoomSync, accountKey, guestKey, parseState, canonicalState, type CloudSave, type GameState, type SaveOperation, type SaveSlot } from '../lib/dark-room-sync';

interface GameBridge { start(owner: string | null): void; snapshot(): GameState | null }
interface GameWindow extends Window { DarkRoomGame?: GameBridge }
interface SaveResponse { latest: CloudSave | null; slots?: SaveSlot[]; error?: string }
interface Choice { label: string; detail?: string; run(): void | Promise<void> }

const frame = document.querySelector<HTMLIFrameElement>('#dark-room-app')!;
const status = document.querySelector<HTMLElement>('#dark-room-save-status')!;
const manual = document.querySelector<HTMLButtonElement>('#dark-room-save')!;
const load = document.querySelector<HTMLButtonElement>('#dark-room-load')!;
const retry = document.querySelector<HTMLButtonElement>('#dark-room-retry')!;
const login = document.querySelector<HTMLAnchorElement>('#dark-room-login')!;
const notice = document.querySelector<HTMLElement>('#dark-room-start-note')!;
const dialog = document.querySelector<HTMLDialogElement>('#dark-room-saves')!;
let owner: string | null | undefined;
let sync: DarkRoomSync | null = null;
let generation = 0;
let canStart = false;
let frameReady = false;
let blocked = false;
let restoring = false;
let modalRequired = false;
let releaseLock: (() => void) | undefined;
let flight: { sync: DarkRoomSync; promise: Promise<boolean> } | null = null;

const game = () => (frame.contentWindow as GameWindow | null)?.DarkRoomGame;
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
function message(text: string, allowRetry = false) {
  status.textContent = text;
  retry.hidden = !allowRetry;
}
function controls() {
  manual.disabled = !canStart || !frameReady || !owner || blocked || restoring;
  load.disabled = manual.disabled;
  login.hidden = Boolean(owner);
}
function startGame() {
  if (!canStart || !frameReady) return;
  game()?.start(owner || null);
  if (game()?.snapshot()) notice.hidden = true;
  controls();
}
function reloadGame() {
  frameReady = false;
  controls();
  notice.hidden = false;
  notice.textContent = '正在载入进度…';
  const url = new URL(frame.src);
  url.searchParams.set('reload', crypto.randomUUID());
  frame.src = url.href;
}
function snapshot() {
  if (!canStart || !frameReady) return null;
  return game()?.snapshot() || null;
}
function choose(title: string, description: string, choices: Choice[], required = false) {
  modalRequired = required;
  dialog.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = title;
  const note = document.createElement('p');
  note.textContent = description;
  dialog.append(heading, note);
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    const label = document.createElement('strong');
    label.textContent = choice.label;
    button.append(label);
    if (choice.detail) {
      const detail = document.createElement('span');
      detail.textContent = choice.detail;
      button.append(detail);
    }
    button.addEventListener('click', () => {
      dialog.close();
      void Promise.resolve().then(choice.run).catch(error => report(error));
    });
    dialog.append(button);
  }
  if (!required) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '返回游戏';
    cancel.addEventListener('click', () => dialog.close());
    dialog.append(cancel);
  }
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('cancel', event => { if (modalRequired) event.preventDefault(); });

function report(error: unknown) {
  if (error instanceof DOMException && ['QuotaExceededError', 'SecurityError'].includes(error.name)) {
    message('本机存储不可用，请在游戏设置中导出备份', true);
    return;
  }
  message(error instanceof Error && error.message === 'login_required'
    ? '登录已过期，进度已留在本机，请重新登录'
    : '云端暂时不可用，进度已留在本机', true);
}
async function api(action: string, payload: object, expectedOwner: string): Promise<SaveResponse> {
  if (!community || !communityClient) throw new Error('service_unavailable');
  const { data: { session } } = await communityClient.auth.getSession();
  if (!session || session.user.id !== expectedOwner) throw new Error('login_required');
  const response = await communityFunctionFetch(community)(`${community.url}/functions/v1/meet-api/dark-room`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(25000),
    headers: { apikey: community.key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  const body = await response.json();
  const data = body.data || body;
  if ((!response.ok && response.status !== 409) || (data.error && data.error !== 'conflict')) throw new Error(data.error || 'service_unavailable');
  if (!Object.hasOwn(data, 'latest')) throw new Error('invalid_response');
  return data;
}

function showConflict(latest: CloudSave | null, local?: GameState) {
  blocked = true;
  controls();
  const active = sync!;
  const epoch = generation;
  message('另一处进度已更新，请选择要继续的存档');
  choose('发现不同的游戏进度', '选择后再继续云端同步。覆盖前会保留一份本机恢复副本。', [
    ...(latest ? [{ label: '继续云端进度', detail: `云端保存于 ${time(latest.updated_at)}`, run: () => {
      if (epoch !== generation) return;
      const state = local || snapshot();
      if (state) active.archive(state);
      active.useCloud(latest);
      blocked = false;
      canStart = true;
      reloadGame();
      message(`已读取云端进度 · ${time(latest.updated_at)}`);
      controls();
    } }] : []),
    { label: '继续本机进度并同步', detail: '保留待同步的手动存档，云端旧进度进入历史备份', run: async () => {
      if (epoch !== generation) return;
      const state = local || snapshot();
      if (!state) return;
      active.archive(state);
      active.rebase(latest);
      active.capture(state, 'conflict');
      blocked = false;
      canStart = true;
      startGame();
      await flush();
    } },
  ], true);
}

async function flush(): Promise<boolean> {
  const active = sync;
  if (!active || blocked) return false;
  if (flight?.sync === active) return flight.promise;
  const epoch = generation;
  const task = { sync: active, promise: Promise.resolve(false) };
  flight = task;
  task.promise = (async () => {
    try {
      let request = active.next();
      while (request && epoch === generation && !blocked) {
        message(request.operation === 'manual' ? '正在保存手动存档…' : '正在同步进度…');
        const result = await api('save', request, active.owner);
        if (epoch !== generation) return false;
        if (result.error === 'conflict') { showConflict(result.latest); return false; }
        if (!result.latest) throw new Error('invalid_response');
        active.acknowledge(result.latest);
        message(`已同步 · ${time(result.latest.updated_at)}`);
        request = active.next();
      }
      return epoch === generation && !blocked;
    } catch (error) {
      if (epoch === generation) report(error);
      return false;
    } finally { if (flight === task) flight = null; }
  })();
  return task.promise;
}

function capture(operation: SaveOperation = 'autosave') {
  const state = snapshot();
  if (state && sync) sync.capture(state, operation);
  return state;
}
async function save(operation: SaveOperation = 'autosave') {
  if (restoring) return;
  try {
    capture(operation);
    if (!blocked) await flush();
  } catch (error) { report(error); }
}

async function bootstrap(epoch: number) {
  if (!owner) {
    canStart = true;
    message('进度保存在本机，登录后可同步');
    startGame();
    return;
  }
  let device = localStorage.getItem('amazingindex.dark-room.device');
  if (!device) { device = crypto.randomUUID(); localStorage.setItem('amazingindex.dark-room.device', device); }
  const active = sync = new DarkRoomSync(owner, localStorage, device);
  const local = parseState(localStorage.getItem(accountKey(owner)));
  let latest: CloudSave | null;
  try {
    message('正在读取云端存档…');
    latest = (await api('read', {}, owner)).latest;
    if (epoch !== generation) return;
    if (latest && (latest.schema_version !== 1 || !parseState(JSON.stringify(latest.state)))) throw new Error('unsupported_save');
  } catch (error) {
    if (epoch !== generation) return;
    // Expected revision stays at the last acknowledged value (zero for a new
    // device), so reconnecting can never silently replace an unseen cloud save.
    canStart = true;
    startGame();
    report(error);
    return;
  }
  const guest = !active.record.guestChoice && !local ? parseState(localStorage.getItem(guestKey)) : null;
  if (guest) {
    choose('选择这次要继续的进度', '本机有一份游客存档。登录后，每 30 秒检查并同步变化，也可以随时手动保存。游客原存档会保留。', [
      { label: '继续本机游客存档', detail: '将这份进度绑定到当前账号', run: async () => {
        if (epoch !== generation) return;
        active.record.guestChoice = true;
        active.rebase(latest);
        localStorage.setItem(active.key, JSON.stringify(guest));
        localStorage.setItem(`${active.key}.operation`, 'import');
        canStart = true;
        startGame();
        await flush();
      } },
      { label: latest ? '继续云端存档' : '开始新游戏', detail: latest ? time(latest.updated_at) : '为当前账号创建独立进度', run: () => {
        if (epoch !== generation) return;
        active.record.guestChoice = true;
        if (latest) active.useCloud(latest);
        else active.persist();
        canStart = true;
        startGame();
        message(latest ? '已读取云端进度' : '自动同步已开启');
      } },
    ], true);
    return;
  }
  const dirty = local && canonicalState(local) !== active.record.synced;
  const pending = active.record.pending[0];
  if (local && (dirty || pending)) {
    if ((latest?.revision || 0) !== active.record.revision && latest?.last_request_id !== pending?.request_id) {
      showConflict(latest, local);
      return;
    }
    if (local.version === 1.3) active.capture(local);
    else localStorage.setItem(`${active.key}.operation`, 'import');
  } else if (latest) active.useCloud(latest);
  canStart = true;
  startGame();
  message(latest ? `已读取云端进度 · ${time(latest.updated_at)}` : '自动同步已开启');
  await flush();
}

async function switchAccount(next: string | null, force = false) {
  if (owner === next && !force) return;
  try { capture(); } catch (error) { report(error); }
  const hadAccount = owner !== undefined;
  const epoch = ++generation;
  owner = next;
  canStart = false;
  blocked = false;
  restoring = false;
  sync = null;
  releaseLock?.();
  releaseLock = undefined;
  dialog.close();
  controls();
  notice.hidden = false;
  notice.textContent = '正在准备存档…';
  if (hadAccount) reloadGame();
  const run = async () => {
    try { await bootstrap(epoch); }
    catch (error) { if (epoch === generation) report(error); }
  };
  if (!navigator.locks) { await run(); return; }
  void navigator.locks.request(`amazingindex-dark-room:${next || 'guest'}`, { ifAvailable: true }, async lock => {
    if (epoch !== generation) return;
    if (!lock) {
      notice.textContent = '小黑屋正在另一个标签页运行。关闭该页后，点击“重试”继续。';
      message('另一个标签页正在使用此存档', true);
      return;
    }
    const held = new Promise<void>(resolve => { releaseLock = resolve; });
    await run();
    await held;
  }).catch(error => report(error));
}

async function readSaves() {
  const active = sync;
  const epoch = generation;
  if (!active || !canStart || blocked) return;
  load.disabled = true;
  try {
    capture();
    if (!await flush()) return;
    const result = await api('read', {}, active.owner);
    if (epoch !== generation) return;
    const choices: Choice[] = [];
    if (result.latest) {
      const latest = result.latest;
      choices.push({ label: '最新进度', detail: time(latest.updated_at), run: async () => {
        if (epoch !== generation) return;
        const state = snapshot();
        if (state) active.archive(state);
        capture();
        if (!await flush()) return;
        restoring = true;
        controls();
        try {
          const current = await api('read', {}, active.owner);
          if (epoch !== generation || !current.latest) return;
          active.useCloud(current.latest);
          reloadGame();
          message('已读取最新进度');
        } finally { if (epoch === generation) { restoring = false; controls(); } }
      } });
    }
    const slots = (result.slots || []).sort((a, b) => Number(b.is_manual_slot) - Number(a.is_manual_slot) || b.revision - a.revision);
    for (const slot of slots) {
      choices.push({ label: slot.is_manual_slot ? '手动存档' : '历史备份', detail: `${time(slot.saved_at)} · 第 ${slot.revision} 版`, run: async () => {
        if (epoch !== generation) return;
        const state = capture();
        if (state) active.archive(state);
        if (!await flush()) return;
        restoring = true;
        controls();
        try {
          const restored = await api('restore', { revision: slot.revision, expected_revision: active.record.revision, request_id: crypto.randomUUID(), device_id: active.device }, active.owner);
          if (epoch !== generation) return;
          if (restored.error === 'conflict') { showConflict(restored.latest); return; }
          if (!restored.latest) throw new Error('invalid_response');
          active.useCloud(restored.latest);
          reloadGame();
          message('已读取存档，原进度已备份');
        } finally { if (epoch === generation) { restoring = false; controls(); } }
      } });
    }
    const recovery = JSON.parse(localStorage.getItem(`${active.key}.recovery`) || 'null');
    const recoveryState = parseState(JSON.stringify(recovery?.state));
    if (recoveryState) choices.push({ label: '本机恢复副本', detail: time(recovery.saved_at), run: async () => {
      if (epoch !== generation) return;
      const state = snapshot();
      if (state) active.archive(state);
      active.capture(recoveryState, 'import');
      restoring = true;
      controls();
      try {
        if (!await flush()) return;
        reloadGame();
        message('已读取本机恢复副本');
      } finally { if (epoch === generation) { restoring = false; controls(); } }
    } });
    choose('读取存档', '手动存档会一直保留到下次手动保存。历史备份最多保留十份，读档前会备份当前进度。', choices);
  } catch (error) { if (epoch === generation) report(error); }
  finally { controls(); }
}
manual.addEventListener('click', () => { void save('manual'); });
load.addEventListener('click', () => { void readSaves(); });
retry.addEventListener('click', () => {
  if (canStart && sync) { void save(); }
  else void switchAccount(owner || null, true);
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'dark-room:ready' && event.data.url === frame.src) { frameReady = true; startGame(); }
  if (event.data?.type === 'dark-room:operation' && canStart && sync && ['import', 'reset'].includes(event.data.operation)) {
    const state = parseState(JSON.stringify(event.data.state));
    if (state) { sync.capture(state, event.data.operation); void flush(); }
  }
});
function frameLoaded() {
  if (game() && frame.contentWindow?.location.href === frame.src) { frameReady = true; startGame(); }
}
frame.addEventListener('load', frameLoaded);
frameLoaded();
window.setInterval(() => { if (canStart && !document.hidden) void save(); }, 30000);
window.addEventListener('online', () => { void save(); });
document.addEventListener('visibilitychange', () => { void save(); });
window.addEventListener('pagehide', () => { try { capture(); } catch (error) { report(error); } });
communityClient?.auth.onAuthStateChange((_event, session) => {
  // Let Supabase release its auth lock before any getSession call.
  window.setTimeout(() => { void switchAccount(session?.user.id || null); }, 0);
});
if (communityClient) {
  void communityClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return switchAccount(data.session?.user.id || null);
  }).catch(error => report(error));
} else void switchAccount(null);

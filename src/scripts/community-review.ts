import { Check, X, Ban, LogOut, RefreshCw, createElement } from 'lucide';
import { community } from '../lib/community-config';
import { communityStorageKey } from '../lib/community-model';
import { communityFunctionFetch } from '../lib/community-transport';

type Post = { id: number; nickname: string; city: string; age: number; gender: string; title: string; status: string; occupation?: string; about?: string; looking_for?: string; review_reason?: string; reviewed_at?: string };
type Photo = { id: string; url: string; thumb: string };
type Detail = { post: Post; contact: { contact: string; share_contact: boolean } | null; photos: Photo[]; version: string };
type Session = { session: string; expiresAt: number };
const labels: Record<string, string> = { pending: '待审核', published: '已发布', rejected: '未通过', withdrawn: '已下架' };
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const statusMessage = (text: string, error = false) => { $('#review-message').textContent = text; $('#review-message').dataset.error = String(error); };
const storageKey = community ? communityStorageKey(community.url, 'review') : 'amazingindex-review-disabled';
const reviewFetch = community ? communityFunctionFetch(community) : fetch;
// Fragments are not sent in HTTP requests; remove the credential from the visible URL immediately.
let entryKey = new URLSearchParams(location.hash.slice(1)).get('key') || '';
history.replaceState(null, '', location.pathname);
let session: Session | null = null;
let selected: Detail | null = null;
let currentStatus = 'pending', cursor: number | null = null, listGeneration = 0, detailGeneration = 0;
let acting = false, photosReady = false;
let authGeneration = 0;
let renewal: Promise<void> | null = null;
const dialog = $<HTMLDialogElement>('#review-photo-dialog');
const confirmDialog = $<HTMLDialogElement>('#review-confirm-dialog');
$('#review-exit').append(createElement(LogOut, { width: 18, height: 18 }));
$('#review-refresh').append(createElement(RefreshCw, { width: 18, height: 18 }));
$('#review-photo-close').append(createElement(X, { width: 18, height: 18 }));
$('#review-photo-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => $<HTMLImageElement>('#review-photo-full').removeAttribute('src'));
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

function clearAccess() {
  session = null; entryKey = ''; selected = null; renewal = null; listGeneration++; detailGeneration++; authGeneration++;
  try { sessionStorage.removeItem(storageKey); } catch { /* Session may be memory-only. */ }
  $('#review-workspace').hidden = true; $('#review-exit').hidden = true; $('#review-session').textContent = '';
  $('#review-list').replaceChildren(); $('#review-detail').replaceChildren();
  if (dialog.open) dialog.close();
  if (confirmDialog.open) confirmDialog.close('cancel');
}
function explain(error: unknown) {
  const code = (error as Error).message;
  return ({ review_unauthorized: '审核授权已失效，请重新打开专属审核链接。', post_changed: '帖子已被修改或处理，请重新查看最新内容后再审核。', post_missing: '帖子已被删除。', invalid_review: '当前状态不允许此操作，或未填写拒绝 / 下架原因。', photos_not_ready: '照片尚未就绪，暂不能审核。', forbidden_origin: '当前网址未获准使用审核服务。' } as Record<string, string>)[code] || '审核服务暂不可用，请稍后重试。';
}
async function send(input: Record<string, unknown>, token = '') {
  if (!community) throw new Error('review_unavailable');
  const response = await reviewFetch(`${community.url}/functions/v1/meet-review`, {
    method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', apikey: community.key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'review_unavailable');
  return data;
}
async function ensureSession() {
  if (session && session.expiresAt > Date.now() + 300000) return;
  if (!entryKey) {
    if (session && session.expiresAt > Date.now()) return;
    throw new Error('review_unauthorized');
  }
  if (!renewal) {
    const generation = authGeneration;
    renewal = (async () => {
    const data = await send({ action: 'exchange', key: entryKey });
    if (generation !== authGeneration) throw new Error('review_unauthorized');
    session = { session: data.session, expiresAt: data.expiresAt };
    try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* Keep the session in memory. */ }
    })().finally(() => { if (generation === authGeneration) renewal = null; });
  }
  await renewal;
}
async function request(input: Record<string, unknown>) {
  try {
    await ensureSession();
    return await send(input, session!.session);
  } catch (error) {
    if ((error as Error).message === 'review_unauthorized') { clearAccess(); statusMessage(explain(error), true); }
    throw error;
  }
}
function element(tag: string, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function photoUrl(value: string) {
  const url = new URL(value);
  if (!community || url.origin !== community.url || !url.pathname.startsWith('/storage/v1/object/sign/meet-photos/')) throw new Error('invalid_photo');
  return url.href;
}
function syncButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-status], #review-refresh, #review-more, .review-row, [data-decision]').forEach(button => {
    button.disabled = acting || (button.dataset.decision === 'published' && !photosReady);
  });
}
async function loadList(reset = true) {
  const generation = ++listGeneration;
  if (reset) { cursor = null; selected = null; detailGeneration++; $('#review-list').replaceChildren(); $('#review-detail').replaceChildren(element('p', '选择一条帖子', 'empty-state')); }
  $('#review-more').hidden = true;
  statusMessage('正在加载帖子…');
  try {
    const data = await request({ action: 'list', status: currentStatus, before: cursor });
    if (generation !== listGeneration) return;
    for (const post of data.posts as Post[]) {
      const button = document.createElement('button'); button.className = 'review-row'; button.dataset.id = String(post.id);
      button.append(element('small', `#${post.id} · ${post.city} · ${post.age} 岁 · ${post.gender}`), element('strong', post.title), element('small', post.nickname));
      button.addEventListener('click', () => { void loadDetail(post.id); });
      $('#review-list').append(button);
    }
    cursor = data.posts.at(-1)?.id || cursor;
    $('#review-more').hidden = !data.more;
    statusMessage(data.posts.length || !reset ? '' : '当前没有此状态的帖子。');
    if (reset && data.posts.length) await loadDetail(data.posts[0].id);
  } catch (error) { if (generation === listGeneration) statusMessage(explain(error), true); }
}
async function loadDetail(id: number) {
  const generation = ++detailGeneration;
  selected = null;
  $('#review-detail').replaceChildren(element('p', '正在加载资料与照片…', 'empty-state'));
  document.querySelectorAll<HTMLElement>('.review-row').forEach(row => row.setAttribute('aria-current', String(row.dataset.id === String(id))));
  try {
    const data: Detail = await request({ action: 'detail', id });
    if (generation !== detailGeneration) return;
    selected = data; renderDetail(data);
  } catch (error) { statusMessage(explain(error), true); }
}
function renderDetail(data: Detail) {
  const { post } = data;
  const target = $('#review-detail'); target.replaceChildren();
  const heading = element('div', '', 'detail-heading');
  heading.append(element('h2', post.title), element('span', labels[post.status], 'status')); target.append(heading);
  const facts = element('dl', '', 'review-facts');
  for (const [label, value] of [['编号', String(post.id)], ['昵称', post.nickname], ['城市', post.city], ['年龄 / 性别', `${post.age} 岁 / ${post.gender}`]]) {
    const row = element('div'); row.append(element('dt', label), element('dd', value)); facts.append(row);
  }
  target.append(facts);
  const section = (title: string, text: string) => { const node = element('section', '', 'review-section'); node.append(element('h3', title), element('div', text || '未填写', 'review-text')); target.append(node); };
  section('职业方向', post.occupation || ''); section('关于我', post.about || ''); section('希望认识的你', post.looking_for || '');
  section(`联系方式 · ${data.contact?.share_contact ? '已同意向登录用户展示' : '未同意对外展示'}`, data.contact?.contact || '');
  const photoSection = element('section', '', 'review-section'); photoSection.append(element('h3', `照片 · ${data.photos.length} 张`));
  const gallery = element('div', '', 'review-photos'); photoSection.append(gallery); target.append(photoSection);
  photosReady = !data.photos.length;
  const loaded = new Set<string>();
  for (const [index, photo] of data.photos.entries()) {
    const button = document.createElement('button'); button.className = 'photo-button'; button.setAttribute('aria-label', `查看第 ${index + 1} 张原图`);
    const img = document.createElement('img'); img.alt = `相亲帖照片 ${index + 1}`; img.width = 144; img.height = 180; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { if (selected !== data) return; loaded.add(photo.id); photosReady = loaded.size === data.photos.length; syncButtons(); });
    img.addEventListener('error', () => { if (selected === data) { photosReady = false; syncButtons(); statusMessage('照片加载失败，请刷新列表后再审核。', true); } });
    img.src = photoUrl(photo.thumb); button.append(img);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const latest: Detail = await request({ action: 'detail', id: post.id });
        if (selected !== data) return;
        if (latest.version !== data.version) { await loadDetail(post.id); throw new Error('post_changed'); }
        const full = latest.photos.find(p => p.id === photo.id);
        if (!full) throw new Error('post_changed');
        $<HTMLImageElement>('#review-photo-full').src = photoUrl(full.url); dialog.showModal();
      } catch (error) { statusMessage(explain(error), true); }
      finally { button.disabled = false; }
    });
    gallery.append(button);
  }
  if (!data.photos.length) gallery.append(element('p', '未上传照片', 'review-text'));
  if (post.review_reason) section('审核反馈', post.review_reason);
  if (post.reviewed_at) section('最近审核时间', new Date(post.reviewed_at).toLocaleString('zh-CN'));
  if (!['pending', 'published'].includes(post.status)) return;
  const actions = element('div', '', 'review-actions');
  const label = element('label', '审核备注（拒绝 / 下架时必填）');
  const reason = document.createElement('textarea'); reason.id = 'review-reason'; reason.maxLength = 500; reason.rows = 3; label.append(reason); actions.append(label);
  const buttons = element('div', '', 'action-buttons'); actions.append(buttons);
  const decisions = post.status === 'pending' ? ['published', 'rejected'] : ['withdrawn'];
  for (const status of decisions) {
    const button = document.createElement('button'); button.dataset.decision = status; button.className = `action-button ${status === 'published' ? 'approve' : 'reject'}`;
    button.append(createElement(status === 'published' ? Check : status === 'rejected' ? X : Ban, { width: 18, height: 18 }), document.createTextNode(status === 'published' ? '审核通过' : status === 'rejected' ? '拒绝' : '下架'));
    button.addEventListener('click', () => { void decide(data, status, reason.value.trim()); }); buttons.append(button);
  }
  target.append(actions); syncButtons();
}
async function decide(data: Detail, status: string, reason: string) {
  if (acting || selected !== data || (status === 'published' && !photosReady)) return;
  if (status !== 'published' && !reason) { statusMessage('请填写拒绝或下架原因。', true); $('#review-reason').focus(); return; }
  acting = true; syncButtons();
  try {
    $('#review-confirm-message').textContent = `确认${status === 'published' ? '通过并公开展示' : status === 'rejected' ? '拒绝' : '下架'}帖子 #${data.post.id}？`;
    confirmDialog.returnValue = 'cancel';
    const confirmed = new Promise<boolean>(resolve => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true }));
    confirmDialog.showModal();
    if (!await confirmed || selected !== data) return;
    await request({ action: 'review', id: data.post.id, version: data.version, status, reason });
    await loadList(); statusMessage(`帖子 #${data.post.id}：${labels[status]}。`);
  } catch (error) {
    if ((error as Error).message === 'post_changed') await loadDetail(data.post.id);
    statusMessage(explain(error), true);
  } finally { acting = false; syncButtons(); }
}
document.querySelectorAll<HTMLButtonElement>('[data-status]').forEach(button => button.addEventListener('click', () => {
  currentStatus = button.dataset.status!;
  document.querySelectorAll('[data-status]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
  void loadList();
}));
$('#review-refresh').addEventListener('click', () => { void loadList(); });
$('#review-more').addEventListener('click', () => { void loadList(false); });
$('#review-exit').addEventListener('click', () => { clearAccess(); statusMessage('已退出审核。'); });

async function init() {
  try {
    if (!entryKey) {
      try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (typeof saved?.session === 'string' && saved.expiresAt > Date.now()) session = saved; } catch { /* Require a valid link. */ }
    }
    if (!entryKey && !session) { statusMessage('请使用专属审核链接进入。'); return; }
    await ensureSession();
    $('#review-workspace').hidden = false; $('#review-exit').hidden = false; $('#review-session').textContent = '审核权限已验证';
    await loadList();
  } catch (error) { clearAccess(); statusMessage(explain(error), true); }
}
// Keep an open link-authorized tab usable without making the permanent key persistent.
window.setInterval(() => {
  if (!session) return;
  void ensureSession().catch(error => {
    if ((error as Error).message === 'review_unauthorized' || (session && session.expiresAt <= Date.now())) { clearAccess(); statusMessage('审核授权已结束，请重新打开原来的专属链接。', true); }
  });
}, 60000);
window.addEventListener('hashchange', () => {
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (!key) return;
  clearAccess(); entryKey = key; history.replaceState(null, '', location.pathname);
  void init();
});
void init();

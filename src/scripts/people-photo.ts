import { communityClient } from '../lib/community-client';
import { community } from '../lib/community-config';
import { communityFunctionFetch } from '../lib/community-transport';
import { isSiteOwnerCandidate, validPortraitUrl } from '../lib/site-admin';

let cleanup = () => {};
let active: HTMLDialogElement | null = null;

function init() {
  const found = document.querySelector<HTMLDialogElement>('[data-portrait-dialog]');
  const client = communityClient;
  const config = community;
  if (!found || found === active || !client || !config) return;
  const dialog: HTMLDialogElement = found;
  cleanup(); active = dialog;
  const $ = <T extends HTMLElement>(s: string) => dialog.querySelector<T>(s)!;
  const form = $<HTMLFormElement>('[data-portrait-form]');
  const fileInput = $<HTMLInputElement>('[data-portrait-file]');
  const save = $<HTMLButtonElement>('[data-portrait-save]');
  const drop = $<HTMLButtonElement>('[data-portrait-drop]');
  const editor = $('[data-portrait-editor]');
  const canvas = $<HTMLCanvasElement>('[data-portrait-canvas]');
  const thumb = $<HTMLCanvasElement>('[data-portrait-thumb]');
  const sliders = ['zoom', 'x', 'y'].map(key => $<HTMLInputElement>(`[data-portrait-${key}]`));
  const entries = [...document.querySelectorAll<HTMLButtonElement>('[data-portrait-edit]')];
  const slots = [...document.querySelectorAll<HTMLElement>('[data-person-photo]')];
  const controller = new AbortController();
  let uploadController: AbortController | undefined;
  let bitmap: ImageBitmap | null = null;
  let disposed = false, authorized = false, busy = false, generation = 0, imageGeneration = 0, photoGeneration = 0;
  let selected: HTMLButtonElement | null = null;
  const message = (text: string, error = false) => {
    $('[data-portrait-message]').textContent = text;
    $('[data-portrait-message]').dataset.error = String(error);
  };
  const errorText = (error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    return ({ login_required: '登录已过期，请重新登录。', owner_required: '当前账号没有照片管理权限。',
      photo_conflict: '照片已在其他页面更新，请关闭后重新打开编辑。', invalid_image: '请选择可以正常打开的 JPG、PNG 或 WebP 图片。',
      image_too_large: '图片过大，请选择 10 MB 以内、4000 万像素以内的照片。',
      not_found: '人物不存在或尚未发布。' } as Record<string, string>)[code] || '保存失败，当前照片仍保留，请稍后重试。';
  };
  async function request(body: Record<string, unknown> | FormData, owner = false, signal = controller.signal) {
    let token = config!.key;
    if (owner) {
      const { data: { session }, error } = await client!.auth.getSession();
      if (error || !session || !isSiteOwnerCandidate(session.user)) throw new Error('owner_required');
      token = session.access_token;
    }
    const multipart = body instanceof FormData;
    const response = await communityFunctionFetch(config!)(`${config!.url}/functions/v1/meet-api/people-photos`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { apikey: config!.key, Authorization: `Bearer ${token}`, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: multipart ? body : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'service_unavailable');
    return result;
  }
  function updatePhoto(slug: string, url: string | null) {
    entries.filter(entry => entry.dataset.slug === slug).forEach(entry => {
      entry.dataset.avatar = url || ''; entry.textContent = url ? '更换照片' : '添加照片';
    });
    if (!url || !validPortraitUrl(url, config!.url)) return;
    slots.filter(slot => slot.dataset.personPhoto === slug).forEach(slot => {
      const image = new Image(); image.alt = ''; image.decoding = 'async';
      image.onload = () => { if (!disposed) slot.replaceChildren(image); };
      image.src = url;
    });
  }
  async function loadPhotos() {
    const current = ++photoGeneration;
    const slugs = [...new Set(slots.map(slot => slot.dataset.personPhoto!))];
    if (!slugs.length) return;
    try {
      const result = await request({ action: 'list', slugs });
      if (disposed || current !== photoGeneration) return;
      for (const photo of result.photos || []) if (slugs.includes(photo.slug)) updatePhoto(photo.slug, photo.avatar_url);
    } catch { /* Keep the build-time image or initial when the service is unavailable. */ }
  }
  function reset() {
    imageGeneration++; bitmap?.close(); bitmap = null; fileInput.value = '';
    editor.hidden = true; drop.hidden = false; save.disabled = true;
    sliders.forEach((slider, i) => { slider.value = i ? '50' : '1'; });
    message('');
  }
  function setBusy(value: boolean) {
    busy = value;
    dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(el => { el.disabled = value; });
    save.disabled = value || !bitmap || !authorized;
    save.textContent = value ? '正在保存…' : '保存照片';
  }
  function hide() {
    authorized = false; entries.forEach(entry => { entry.hidden = true; });
    uploadController?.abort(); if (dialog.open) dialog.close(); reset(); selected = null; setBusy(false);
  }
  async function checkAccess() {
    const current = ++generation; hide();
    try {
      const { data: { user }, error } = await client!.auth.getUser();
      if (error || !isSiteOwnerCandidate(user) || disposed || current !== generation) return;
      const result = await request({ action: 'access' }, true);
      if (disposed || current !== generation || result.owner !== true) return;
      authorized = true; entries.forEach(entry => { entry.hidden = false; });
    } catch { /* Fail closed: a failed owner check never reveals management controls. */ }
  }
  function draw() {
    if (!bitmap) return;
    const side = Math.min(bitmap.width, bitmap.height) / Number(sliders[0].value);
    const x = (bitmap.width - side) * Number(sliders[1].value) / 100;
    const y = (bitmap.height - side) * Number(sliders[2].value) / 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 640);
    ctx.drawImage(bitmap, x, y, side, side, 0, 0, 640, 640);
    thumb.getContext('2d')!.drawImage(canvas, 0, 0, 96, 96);
  }
  async function choose(file: File) {
    if (!authorized || busy || !dialog.open) return;
    const current = ++imageGeneration;
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('invalid_image');
      if (file.size > 10 * 1024 * 1024) throw new Error('image_too_large');
      let image: ImageBitmap;
      try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { throw new Error('invalid_image'); }
      if (disposed || current !== imageGeneration) { image.close(); return; }
      if (!image.width || !image.height || image.width * image.height > 40000000) { image.close(); throw new Error('image_too_large'); }
      bitmap?.close(); bitmap = image;
      sliders.forEach((slider, i) => { slider.value = i ? '50' : '1'; });
      draw(); editor.hidden = false; drop.hidden = true; save.disabled = false;
      message('调整照片位置，预览满意后保存。');
    } catch (error) { if (current === imageGeneration) message(errorText(error), true); }
  }
  entries.forEach(entry => entry.addEventListener('click', () => {
    if (!authorized) return;
    reset(); selected = entry;
    $('[data-portrait-title]').textContent = `${entry.dataset.name} · ${entry.dataset.avatar ? '更换' : '添加'}照片`;
    dialog.showModal(); drop.focus();
  }, { signal: controller.signal }));
  dialog.querySelectorAll('[data-portrait-close]').forEach(button => button.addEventListener('click', () => {
    if (!busy) dialog.close();
  }, { signal: controller.signal }));
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }, { signal: controller.signal });
  dialog.addEventListener('close', () => { reset(); if (authorized) selected?.focus(); }, { signal: controller.signal });
  [drop, $('[data-portrait-reselect]')].forEach(button => button.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); }, { signal: controller.signal }));
  fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void choose(fileInput.files[0]); }, { signal: controller.signal });
  document.addEventListener('paste', event => {
    if (!dialog.open || !authorized || busy) return;
    const file = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); void choose(file); }
  }, { signal: controller.signal });
  dialog.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-dragging'); }, { signal: controller.signal });
  dialog.addEventListener('dragleave', () => drop.classList.remove('is-dragging'), { signal: controller.signal });
  dialog.addEventListener('drop', event => {
    event.preventDefault(); drop.classList.remove('is-dragging');
    if (event.dataTransfer?.files[0]) void choose(event.dataTransfer.files[0]);
  }, { signal: controller.signal });
  sliders.forEach(slider => slider.addEventListener('input', draw, { signal: controller.signal }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !bitmap || !selected || !authorized) return;
    const entry = selected, current = generation;
    setBusy(true); message('正在上传并保存照片…'); uploadController = new AbortController();
    void (async () => {
      try {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
        if (!blob || blob.size > 900000) throw new Error('image_too_large');
        const body = new FormData();
        body.set('slug', entry.dataset.slug!); body.set('expected_avatar', entry.dataset.avatar || ''); body.set('photo', blob, 'portrait.jpg');
        const result = await request(body, true, uploadController!.signal);
        if (disposed || current !== generation || !authorized) return;
        if (!validPortraitUrl(result.avatar_url, config!.url)) throw new Error('invalid_photo_url');
        photoGeneration++; updatePhoto(entry.dataset.slug!, result.avatar_url);
        message('照片已保存，首页和详情页会自动显示新照片。');
      } catch (error) {
        if (!disposed && current === generation) {
          message(errorText(error), true);
          if (error instanceof Error && error.message === 'photo_conflict') void loadPhotos();
          if (error instanceof Error && ['login_required', 'owner_required'].includes(error.message)) hide();
        }
      } finally { if (!disposed && current === generation) setBusy(false); }
    })();
  }, { signal: controller.signal });
  const { data: listener } = client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { generation++; hide(); }
    else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') queueMicrotask(() => { void checkAccess(); });
  });
  cleanup = () => { disposed = true; generation++; controller.abort(); uploadController?.abort(); listener.subscription.unsubscribe(); hide(); active = null; };
  void loadPhotos(); void checkAccess();
}
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => cleanup());
window.addEventListener('pageshow', event => { if (event.persisted) { cleanup(); init(); } });
init();

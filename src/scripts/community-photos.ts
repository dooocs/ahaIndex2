import { ArrowLeft, ArrowRight, Plus, RotateCcw, Trash2, createElement, type IconNode } from 'lucide';
import { closeLightbox, openLightbox } from './lightbox';
import { communityClient } from '../lib/community-client';
import { listPhotos, MAX_PHOTOS, photoError, photoRequest, preparePhoto, uploadPhoto, type MeetPhoto } from '../lib/community-photos';

function iconButton(label: string, icon: IconNode, action: () => void) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'photo-tool'; button.title = label; button.setAttribute('aria-label', label);
  button.append(createElement(icon, { width: 16, height: 16, 'aria-hidden': 'true' }));
  button.addEventListener('click', action);
  return button;
}

export async function photoEditor(root: HTMLElement, form: HTMLFormElement) {
  const controller = new AbortController();
  let disposed = false, uploading = false;
  type Item = { photo?: MeetPhoto; file?: File; preview: string; error?: string; progress?: number | null };
  const items: Item[] = (await listPhotos([], true)).map(photo => ({ photo, preview: photo.url! }));
  const input = root.querySelector<HTMLInputElement>('#photo-files')!;
  const grid = root.querySelector<HTMLElement>('#photo-editor-list')!;
  const status = root.querySelector<HTMLElement>('#photo-message')!;
  const add = iconButton('添加照片', Plus, () => input.click()); add.classList.add('photo-add');
  root.querySelector('#photo-add')!.append(add);
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  let submitLocked = false;
  const updateSubmit = () => { submit.disabled = submitLocked || uploading || items.some(item => !item.photo) || items.length > MAX_PHOTOS; };
  function render() {
    if (disposed) return;
    grid.replaceChildren();
    add.disabled = uploading || items.length >= MAX_PHOTOS;
    updateSubmit();
    root.querySelector('#photo-counter')!.textContent = `${items.length} / ${MAX_PHOTOS}`;
    items.forEach((item, index) => {
      const figure = document.createElement('figure'); figure.className = 'photo-editor-item';
      const img = document.createElement('img'); img.src = item.preview; img.alt = `第 ${index + 1} 张照片`; img.width = 160; img.height = 200;
      const caption = document.createElement('figcaption'); caption.textContent = index === 0 ? '首图' : `照片 ${index + 1}`;
      const tools = document.createElement('div'); tools.className = 'photo-tools';
      const move = (offset: number) => { [items[index], items[index + offset]] = [items[index + offset], items[index]]; render(); };
      const left = iconButton('向前移动', ArrowLeft, () => move(-1)); left.disabled = uploading || index === 0;
      const right = iconButton('向后移动', ArrowRight, () => move(1)); right.disabled = uploading || index === items.length - 1;
      const remove = iconButton('移除照片', Trash2, () => {
        void (async () => {
          remove.disabled = true;
          try {
            if (item.photo && !item.photo.post_id) await photoRequest({ action: 'discard', id: item.photo.id });
            if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
            items.splice(index, 1); status.textContent = ''; render();
          } catch (error) { status.textContent = photoError(error); remove.disabled = false; }
        })();
      }); remove.disabled = uploading;
      tools.append(left, right, remove); figure.append(img, caption, tools);
      if (!item.photo) {
        const progress = document.createElement('p'); progress.className = 'photo-progress'; progress.textContent = item.error || (item.progress === undefined ? '正在压缩…' : item.progress === null ? '正在上传与处理…' : item.progress >= 90 ? '正在处理…' : `正在上传 ${item.progress}%`);
        figure.append(progress);
        if (item.error) { const retry = iconButton('重试上传', RotateCcw, () => { void upload(item); }); retry.disabled = uploading; figure.append(retry); }
      }
      grid.append(figure);
    });
  }
  async function upload(item: Item) {
    uploading = true; item.error = undefined; render();
    try {
      const file = await preparePhoto(item.file!);
      if (disposed) return;
      item.photo = await uploadPhoto(file, progress => { item.progress = progress; render(); }, controller.signal);
      item.file = undefined;
      status.textContent = '照片已上传，提交后与资料一起审核。';
    } catch (error) { item.error = photoError(error); status.textContent = item.error; }
    finally { uploading = false; render(); }
  }
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []); input.value = '';
    if (items.length + files.length > MAX_PHOTOS) { status.textContent = `每则启事最多 ${MAX_PHOTOS} 张照片。`; return; }
    for (const file of files) {
      if (disposed) break;
      const item: Item = { file, preview: URL.createObjectURL(file) }; items.push(item); await upload(item);
    }
  });
  render();
  return {
    setSubmitLocked(locked: boolean) { submitLocked = locked; updateSubmit(); },
    ids() {
      if (uploading || items.some(item => !item.photo) || items.length > MAX_PHOTOS) throw new Error('请先完成照片上传，或移除上传失败的照片。');
      return items.map(item => item.photo!.id);
    },
    dispose() { disposed = true; controller.abort(); items.forEach(item => { if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview); }); },
  };
}

export function photoViewer(root: HTMLElement) {
  let disposed = false;
  let generation = 0, lastPosts: number[] = [], lastDetail = false;
  // Display is the shared viewer; this only decides which (signed) URLs it gets.
  const view = (photos: MeetPhoto[], start: number) => openLightbox(
    photos.map(photo => ({ src: photo.url!, alt: `相亲帖照片 ${photo.sort_order + 1}`, width: photo.width, height: photo.height })),
    start, { label: '查看照片' },
  );
  const clear = () => {
    closeLightbox();
    root.querySelectorAll<HTMLElement>('[data-private-photo]').forEach(element => { element.replaceChildren(document.createTextNode('登录后可见')); element.dataset.locked = 'true'; });
  };
  const listener = communityClient!.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_OUT' && event !== 'SIGNED_IN') return;
    generation++;
    clear();
    const ids = [...lastPosts];
    void (async () => {
      for (let start = 0; start < ids.length; start += 20) await load(ids.slice(start, start + 20), lastDetail);
    })().catch(() => {});
  });

  async function load(posts: number[], detail = false) {
    const requestGeneration = generation;
    lastPosts = detail ? [...posts] : [...new Set([...lastPosts, ...posts])]; lastDetail = detail;
    const { data: { session } } = await communityClient!.auth.getSession();
    const target = root.querySelector<HTMLElement>('#post-photos');
    const userId = session?.user.id;
    const rows = await listPhotos(posts);
    const current = await communityClient!.auth.getSession();
    if (disposed || generation !== requestGeneration || current.data.session?.user.id !== userId) return;
    const refreshOnExpiry = (img: HTMLImageElement, photo: MeetPhoto) => {
      img.addEventListener('error', () => {
        void (async () => {
          try {
            const fresh = await listPhotos([photo.post_id!]);
            const session = await communityClient!.auth.getSession();
            const match = fresh.find(row => row.id === photo.id);
            if (!disposed && generation === requestGeneration && img.isConnected && session.data.session?.user.id === userId && match) img.src = match.url!;
            else img.alt = '照片已不可见';
          } catch { img.alt = '照片暂不可用'; }
        })();
      }, { once: true });
    };
    if (detail && target) {
      target.replaceChildren(); target.className = 'photo-gallery';
      if (!rows.length) {
        if (session) target.textContent = '暂未上传照片';
        else {
          const login = document.createElement('a'); login.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; login.className = 'post-photo'; login.dataset.locked = 'true'; login.textContent = '暂无公开照片，登录查看其他照片'; target.append(login);
        }
        return;
      }
      for (const photo of rows) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'post-photo'; button.dataset.privatePhoto = ''; button.setAttribute('aria-label', `查看第 ${photo.sort_order + 1} 张照片`);
        const img = document.createElement('img'); img.src = photo.url!; img.alt = `相亲帖照片 ${photo.sort_order + 1}`; img.loading = 'lazy'; img.width = photo.width; img.height = photo.height;
        refreshOnExpiry(img, photo);
        button.append(img);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const full = await listPhotos(posts, false, true);
            const active = await communityClient!.auth.getSession();
            if (disposed || generation !== requestGeneration || active.data.session?.user.id !== userId || !full.length) return;
            view(full, Math.max(0, full.findIndex(row => row.id === photo.id)));
          } catch { button.title = '照片暂不可用，请稍后重试'; }
          finally { button.disabled = false; }
        });
        target.append(button);
      }
    } else {
      for (const postId of posts) {
        const photo = rows.find(row => row.post_id === postId);
        const cover = root.querySelector<HTMLElement>(`[data-post-photo="${postId}"]`);
        if (!photo || !cover) continue;
        const img = document.createElement('img'); img.src = photo.url!; img.alt = '启事照片'; img.loading = 'lazy'; img.width = 104; img.height = 130;
        refreshOnExpiry(img, photo);
        cover.dataset.privatePhoto = ''; cover.dataset.locked = 'false'; cover.replaceChildren(img);
        const count = document.createElement('span'); count.className = 'photo-count'; count.textContent = String(rows.filter(row => row.post_id === postId).length); cover.append(count);
      }
    }
  }
  return { load, dispose() { disposed = true; generation++; listener.data.subscription.unsubscribe(); closeLightbox(); } };
}

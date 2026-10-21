// The site's one image viewer: a full-screen <dialog> showing a set of images
// with previous / next, a counter, ←/→ keys, swipe, Esc and click-outside to
// close. It only shows what it is given — callers load the images (signed URLs,
// fresh detail requests) and pass plain sources.
//
// Two ways in:
// - openLightbox(items, index): from code (相亲帖 photos, the review page).
// - Declarative links: <a href="full.jpg" data-lightbox="group"><img …></a>.
//   bindLightboxLinks() handles plain left-clicks on them; links in the same
//   group (a 动态 post's photos) page together. Cmd/Ctrl/Shift/middle clicks,
//   and pages where the script did not load, still open the image itself.
//
// One dialog for the whole page, created on first use. Under Astro's
// ClientRouter the body is replaced on navigation, so it is recreated when it
// is no longer in the document.
import { ArrowLeft, ArrowRight, X, createElement, type IconNode } from 'lucide';
import '../styles/lightbox.css';

export interface LightboxItem {
  src: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
}

interface Viewer {
  dialog: HTMLDialogElement;
  image: HTMLImageElement;
  counter: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
}

const SWIPE_PX = 48;
let viewer: Viewer | null = null;
let items: LightboxItem[] = [];
let index = 0;
let label = '查看图片';
let scrollLock: { overflow: string; paddingRight: string } | null = null;

function button(className: string, text: string, icon: IconNode, action: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `lightbox-button ${className}`;
  element.title = text;
  element.setAttribute('aria-label', text);
  element.append(createElement(icon, { width: 22, height: 22, 'aria-hidden': 'true' }));
  element.addEventListener('click', action);
  return element;
}

// Scrolling stops on <html>. Where the site reserves the scrollbar lane
// (scrollbar-gutter: stable) nothing shifts; elsewhere the width the scrollbar
// gave back is padded. The lane itself is painted dark (html.lightbox-open),
// since the overlay does not cover it.
function lockScroll() {
  if (scrollLock) return;
  const root = document.documentElement;
  const { body } = document;
  scrollLock = { overflow: root.style.overflow, paddingRight: body.style.paddingRight };
  const before = root.clientWidth;
  root.style.overflow = 'hidden';
  root.classList.add('lightbox-open');
  const freed = root.clientWidth - before;
  if (freed > 0) body.style.paddingRight = `${freed}px`;
}

function unlockScroll() {
  if (!scrollLock) return;
  document.documentElement.style.overflow = scrollLock.overflow;
  document.documentElement.classList.remove('lightbox-open');
  document.body.style.paddingRight = scrollLock.paddingRight;
  scrollLock = null;
}

function build(): Viewer {
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  const stage = document.createElement('div');
  stage.className = 'lightbox-stage';
  const image = document.createElement('img');
  image.className = 'lightbox-img';
  image.decoding = 'async';
  stage.append(image);
  const counter = document.createElement('p');
  counter.className = 'lightbox-count';
  counter.setAttribute('aria-live', 'polite');
  const previous = button('lightbox-prev', '上一张', ArrowLeft, () => show(index - 1));
  const next = button('lightbox-next', '下一张', ArrowRight, () => show(index + 1));
  const close = button('lightbox-close', '关闭', X, () => dialog.close());
  dialog.append(stage, previous, next, counter, close);

  dialog.addEventListener('close', () => {
    image.removeAttribute('src');
    items = [];
    unlockScroll();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
  });

  // Swipe left / right to page; a vertical drag scrolls or pinches as usual
  // (touch-action: pan-y pinch-zoom on the stage). A swipe is not a click.
  let start: { x: number; y: number } | null = null;
  let swiped = false;
  stage.addEventListener('pointerdown', (event) => {
    start = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
    swiped = false;
  });
  stage.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (items.length > 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped = true;
      show(index + (dx < 0 ? 1 : -1));
    }
  });
  stage.addEventListener('pointercancel', () => { start = null; });
  // Clicking anywhere but the image or a button closes.
  dialog.addEventListener('click', (event) => {
    if (swiped) { swiped = false; return; }
    if (event.target === dialog || event.target === stage) dialog.close();
  });

  document.body.append(dialog);
  return { dialog, image, counter, previous, next };
}

function current(): Viewer {
  if (!viewer || !viewer.dialog.isConnected) viewer = build();
  return viewer;
}

function preload(item: LightboxItem | undefined) {
  if (!item) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = item.src;
}

function show(value: number) {
  if (!viewer || !items.length) return;
  index = (value + items.length) % items.length;
  const item = items[index];
  const { image, counter, previous, next } = viewer;
  image.src = item.src;
  image.alt = item.alt || (items.length > 1 ? `${label} ${index + 1}` : label);
  if (item.width && item.height) { image.width = item.width; image.height = item.height; }
  else { image.removeAttribute('width'); image.removeAttribute('height'); }
  const many = items.length > 1;
  counter.textContent = many ? `${index + 1} / ${items.length}` : '';
  counter.hidden = previous.hidden = next.hidden = !many;
  if (many) { preload(items[(index + 1) % items.length]); preload(items[(index - 1 + items.length) % items.length]); }
}

/** Show `list` starting at `start`. Replaces whatever is open. */
export function openLightbox(list: LightboxItem[], start = 0, options: { label?: string } = {}) {
  const usable = list.filter((item) => item.src);
  if (!usable.length) return;
  const v = current();
  items = usable;
  label = options.label || '查看图片';
  v.dialog.setAttribute('aria-label', label);
  show(Math.min(Math.max(0, start), usable.length - 1));
  if (!v.dialog.open) {
    lockScroll();
    v.dialog.showModal();
  }
}

export function closeLightbox() {
  if (viewer?.dialog.open) viewer.dialog.close();
}

function itemOf(link: HTMLAnchorElement): LightboxItem {
  const img = link.querySelector('img');
  const size = (name: 'width' | 'height') => Number(img?.getAttribute(name)) || null;
  return { src: link.href, alt: img?.alt || undefined, width: size('width'), height: size('height') };
}

let bound = false;

/** Open [data-lightbox] links in the viewer. Safe to call more than once. */
export function bindLightboxLinks() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-lightbox]');
    if (!link?.href) return;
    event.preventDefault();
    const group = link.dataset.lightbox || '';
    const links = group
      ? Array.from(document.querySelectorAll<HTMLAnchorElement>(`a[data-lightbox="${CSS.escape(group)}"]`))
      : [link];
    openLightbox(links.map(itemOf), Math.max(0, links.indexOf(link)), { label: link.dataset.lightboxLabel });
  });
  // Close before a ClientRouter navigation swaps the page out.
  document.addEventListener('astro:before-swap', closeLightbox);
}

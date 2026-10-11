import { communityClient } from './community-client';
import { community } from './community-config';

export const MAX_PHOTOS = 3;
export interface MeetPhoto { id: string; post_id: number | null; sort_order: number; width: number; height: number; url?: string; }
export function photoError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'login_required') return '登录已过期，请重新登录。';
  if (message === 'upload_rate_limit') return '今天上传次数已达上限，请明天再试。';
  if (message === 'photo_limit') return '暂存照片已达上限，请先移除不需要的照片。';
  if (message === 'invalid_image') return '无法读取这张图片，请选择 JPG、PNG 或 WebP 照片。';
  if (message === 'image_too_large') return '图片过大，请选择 10 MB 以内的照片。';
  if (message === 'photo_service_unavailable') return '图片服务暂时不可用，请稍后重试。';
  return '图片处理失败，请重试。';
}

async function token() {
  const { data: { session }, error } = await communityClient!.auth.getSession();
  if (error || !session) throw new Error('login_required');
  return session.access_token;
}
export async function photoRequest(body: Record<string, unknown>) {
  const response = await fetch(`${community!.url}/functions/v1/meet-photos`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, apikey: community!.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'photo_service_unavailable');
  return result;
}
export async function listPhotos(posts: number[], own = false, full = false): Promise<MeetPhoto[]> {
  const result = await photoRequest({ action: 'list', posts, own, full });
  return result.photos.map((photo: MeetPhoto) => {
    const url = new URL(photo.url!);
    if (url.origin !== community!.url || !url.pathname.startsWith('/storage/v1/object/sign/meet-photos/')) throw new Error('invalid_photo_url');
    return photo;
  });
}

export async function preparePhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('invalid_image');
  if (file.size > 10 * 1024 * 1024) throw new Error('image_too_large');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('invalid_image'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error('image_too_large');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.85, .75, .65, .5]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 900000) return blob;
    }
    throw new Error('image_too_large');
  } finally { bitmap.close(); }
}

export async function uploadPhoto(file: Blob, progress: (value: number) => void, signal: AbortSignal): Promise<MeetPhoto> {
  const accessToken = await token();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) { reject(new Error('aborted')); return; }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('POST', `${community!.url}/functions/v1/meet-photos`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', community!.key);
    xhr.timeout = 90000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 90)); };
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) { progress(100); resolve(result.photo); }
        else reject(new Error(result.error || 'upload_failed'));
      } catch { reject(new Error('upload_failed')); }
    };
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('upload_failed'));
    const form = new FormData(); form.set('file', file, 'photo.jpg'); xhr.send(form);
  });
}

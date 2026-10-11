import { communityClient } from './community-client';
import { community } from './community-config';
import { requestCommunityPhoto } from './community-transport';

export const MAX_PHOTOS = 6;
const bucket = 'meet-photos';
export interface PreparedPhoto { photo: Blob; thumb: Blob; width: number; height: number; }
export interface MeetPhoto { id: string; post_id: number | null; sort_order: number; width: number; height: number; url?: string; }
export function photoError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'login_required') return '登录已过期，请重新登录。';
  if (message === 'upload_rate_limit') return '今天上传次数已达上限，请明天再试。';
  if (message === 'photo_limit') return '暂存照片已达上限，请先移除不需要的照片。';
  if (/Too many uploaded photos/i.test(message)) return '暂存照片已达上限，请先移除不需要的照片。';
  if (/row.level security|permission denied|not authorized/i.test(message)) return '没有照片上传权限，请重新登录后重试。';
  if (message === 'invalid_image') return '无法读取这张图片，请选择 JPG、PNG 或 WebP 照片。';
  if (message === 'image_too_large') return '图片过大，请选择 10 MB 以内的照片。';
  if (message === 'photo_service_unavailable') return '图片服务暂时不可用，请稍后重试。';
  console.error('Photo upload failed:', error);
  return '照片上传失败，请稍后重试。';
}

async function token() {
  const { data: { session }, error } = await communityClient!.auth.getSession();
  if (error || !session) throw new Error('login_required');
  return session.access_token;
}
export async function photoRequest(body: Record<string, unknown>) {
  return requestCommunityPhoto(community!,await token(),body,AbortSignal.timeout(30000));
}
export async function listPhotos(posts: number[], own = false, full = false): Promise<MeetPhoto[]> {
  const result = await photoRequest({ action: 'list', posts, own, full });
  return result.photos.map((photo: MeetPhoto) => {
    const url = new URL(photo.url!);
    if (url.origin !== community!.url || !url.pathname.startsWith('/storage/v1/object/sign/meet-photos/')) throw new Error('invalid_photo_url');
    return photo;
  });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
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
    async function jpeg(source: HTMLCanvasElement) {
      for (const quality of [.85, .75, .65, .5]) {
        const blob = await new Promise<Blob | null>(resolve => source.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= 900000) return blob;
      }
      throw new Error('image_too_large');
    }
    const photo = await jpeg(canvas);
    const thumbCanvas = document.createElement('canvas');
    const thumbScale = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
    thumbCanvas.width = Math.max(1, Math.round(canvas.width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(canvas.height * thumbScale));
    thumbCanvas.getContext('2d')!.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    return { photo, thumb: await jpeg(thumbCanvas), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

export async function uploadPhoto(file: PreparedPhoto, progress: (value: number | null) => void, signal: AbortSignal): Promise<MeetPhoto> {
  const { data: { session } } = await communityClient!.auth.getSession();
  if (!session) throw new Error('login_required');
  if (signal.aborted) throw new Error('aborted');
  const id = crypto.randomUUID();
  const owner = session.user.id;
  const paths = [`${owner}/${id}/photo.jpg`, `${owner}/${id}/thumb.jpg`];
  const inserted = await communityClient!.from('meet_photos').insert({ id, owner_id: owner });
  if (inserted.error) throw new Error(inserted.error.message);
  try {
    for (const [index, blob] of [file.photo, file.thumb].entries()) {
      if (signal.aborted) throw new Error('aborted');
      const uploaded = await communityClient!.storage.from(bucket).upload(paths[index], blob, {
        contentType: 'image/jpeg', cacheControl: '120', upsert: false,
      });
      if (uploaded.error) throw new Error(uploaded.error.message);
      progress(index === 0 ? 50 : 90);
    }
    if (signal.aborted) throw new Error('aborted');
    const ready = await communityClient!.from('meet_photos')
      .update({ state: 'ready', width: file.width, height: file.height, bytes: file.photo.size })
      .eq('id', id).eq('owner_id', owner).eq('state', 'uploading')
      .select('id,post_id,sort_order,width,height').single();
    if (ready.error) throw new Error(ready.error.message);
    progress(100);
    return ready.data;
  } catch (error) {
    await photoRequest({ action: 'discard', id }).catch(() => {});
    throw error;
  }
}

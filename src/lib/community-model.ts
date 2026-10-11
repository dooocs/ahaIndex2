export type PostStatus = 'pending' | 'published' | 'rejected' | 'withdrawn';
export interface MeetPost {
  id: number;
  nickname: string;
  age: number;
  gender: string;
  city: string;
  occupation: string;
  title: string;
  about: string;
  looking_for: string;
  created_at: string;
  expires_at: string;
  status?: PostStatus;
  photo_count?: number;
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  pending: '待审核', published: '已发布', rejected: '未通过审核', withdrawn: '已撤回',
};
export const POST_FIELDS = {
  nickname: [1, 30], city: [1, 40], occupation: [0, 60],
  title: [2, 60], about: [20, 2000], looking_for: [0, 1000], contact: [0, 100],
} as const;

export function validatePost(values: Record<string, unknown>) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, [min, max]] of Object.entries(POST_FIELDS)) {
    const text = String(values[key] ?? '').trim();
    if ([...text].length < min || [...text].length > max) throw new Error('请检查资料长度，完成所有必填项。');
    result[`p_${key}`] = text;
  }
  const age = Number(values.age);
  if (!Number.isInteger(age) || age < 18 || age > 100) throw new Error('相亲栏目仅限年满 18 周岁的成年人。');
  const gender = String(values.gender ?? '');
  if (!['女', '男', '其他'].includes(gender)) throw new Error('请选择性别。');
  if (values.consent !== true) throw new Error('请确认资料为本人发布，并同意展示规则。');
  if (result.p_contact && values.share_contact !== true) throw new Error('填写联系方式时，需要同意向已登录用户展示。');
  return { ...result, p_age: age, p_gender: gender, p_consent: true, p_share_contact: values.share_contact === true };
}

export function safeReturnPath(value: string | null): string {
  if (!value || /[\\\u0000-\u001f]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/account/';
  try {
    const url = new URL(value, 'https://www.amazingindex.com');
    if (url.origin !== 'https://www.amazingindex.com' || url.pathname.startsWith('/login') || url.pathname.startsWith('/auth/')) return '/account/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/account/'; }
}

export function communityConfig(values: Record<string, string | undefined>, allowMock = false) {
  if (values.enabled !== 'true') return null;
  const url = new URL(values.url || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Community Supabase URL must be an HTTPS origin.');
  }
  const key = values.key?.trim();
  if (!key || !isCommunityPublicKey(key)) throw new Error('Community requires a publishable or legacy anon key, never a secret/service-role key.');
  const placeholder = url.hostname === 'community-preview.supabase.co' || key === 'sb_publishable_preview';
  if (placeholder && !allowMock) throw new Error('Community mock credentials are only allowed in explicit development tests. Configure the real project before enabling community.');
  return { url: url.origin, key, captchaKey: values.captchaKey?.trim() || '' };
}

export function isCommunityPublicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // This classifies credentials, not their signatures; the service verifies JWTs.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
  try {
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const [header, payload] = key.split('.').slice(0, 2).map(decode);
    return header?.alg === 'HS256' && header?.typ === 'JWT' && payload?.role === 'anon';
  } catch { return false; }
}

export function communityStorageKey(url: string, scope: 'auth' | 'review' = 'auth'): string {
  return `amazingindex-community-${scope}:${new URL(url).origin}`;
}

type ServiceError = { code?: string; status?: number; message?: string; details?: { code?: string } };

function retrySeconds(error: ServiceError | null | undefined): number {
  const match = error?.message?.match(/(?:request this after|wait)\s+(\d+)\s+seconds?/i);
  return match ? Math.min(3600, Math.max(1, Number(match[1]))) : 0;
}

export function loginRetrySeconds(error: unknown): number {
  const e = error as ServiceError;
  if (e?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(e?.code || '')) {
    return retrySeconds(e) || 60;
  }
  return 0;
}

export function postRetrySeconds(error: unknown): number {
  const e = error as ServiceError;
  return e?.code === 'P0001' ? retrySeconds(e) : 0;
}

export function friendlyError(error: unknown): string {
  const e = error as ServiceError;
  if (postRetrySeconds(e)) return '帖子提交间隔需满一分钟，请稍后再试。';
  if (e?.code === 'otp_expired' || e?.details?.code === 'otp_expired') return '登录链接无效或已过期，请重新发送。';
  if (e?.code === 'email_address_not_authorized') return '当前为封闭测试，仅支持项目团队成员邮箱。';
  if (loginRetrySeconds(e) && retrySeconds(e)) return `登录链接发送间隔过短，请等待 ${retrySeconds(e)} 秒后再试。`;
  if (e?.code === 'over_email_send_rate_limit') return '登录邮件发送已达到服务限额，这次未发送。请稍后再试；若持续出现，请联系站点管理员配置邮件服务。';
  if (e?.code === 'over_request_rate_limit') return '登录请求过于频繁，请等待几分钟后再试。';
  if (e?.status === 429 || /rate[ _-]?limit|too many requests/i.test(e?.message || '')) return '操作太频繁，请稍后再试。';
  if (e?.code === 'captcha_failed') return '安全验证未通过，请刷新后重试。';
  if (e?.code === '42501' || e?.status === 401) return '请重新登录后再试。';
  if (e?.code === '23514' || e?.code === '22023') return '资料不符合发布要求，请检查后重试。';
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205') return '相亲服务尚未准备就绪，请稍后再试。';
  return '服务暂时不可用，请稍后重试。';
}

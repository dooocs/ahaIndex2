export function localPreviewOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Login regression checks require a local preview origin.');
  }
  return url.origin;
}

export function loginTestRequestAction(requestUrl, method, origin) {
  const url = new URL(requestUrl);
  if (method === 'POST' && url.pathname === '/auth/v1/otp') return 'mock';
  if (url.origin === origin && ['GET', 'HEAD'].includes(method)) return 'continue';
  return 'abort';
}

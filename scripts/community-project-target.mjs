export function communityProjectTarget(value, projectRef) {
  if (!projectRef || !/^(?:[a-z]{20}|spb-[a-z0-9]{8,40})$/.test(projectRef)) {
    throw new Error('An explicit community project ref is required.');
  }
  if (projectRef === 'wyhpcfjtmtitorinkevj') throw new Error('Never operate on the news project.');
  const url = new URL(value);
  const aliyun = projectRef.startsWith('spb-');
  const expected = `https://${projectRef}.${aliyun ? 'supabase.opentrust.net' : 'supabase.co'}`;
  if (url.origin !== expected || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Community URL and explicit project ref do not match.');
  }
  return { url: url.origin, projectRef, aliyun };
}

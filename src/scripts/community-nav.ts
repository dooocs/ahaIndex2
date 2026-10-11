import { communityClient } from '../lib/community-client';

function render(signedIn: boolean) {
  document.querySelectorAll<HTMLAnchorElement>('[data-community-account]').forEach(link => {
    link.textContent = signedIn ? '我的账号' : '登录 / 注册';
    link.href = signedIn ? '/account/' : `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
  });
}
async function refresh() {
  if (!communityClient) return;
  const { data } = await communityClient.auth.getSession();
  render(Boolean(data.session));
}
communityClient?.auth.onAuthStateChange((_event, session) => render(Boolean(session)));
document.addEventListener('astro:page-load', refresh);
void refresh();

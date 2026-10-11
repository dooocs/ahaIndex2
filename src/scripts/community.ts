import { communityClient } from '../lib/community-client';
import { communityRpc } from '../lib/community-api';
import { friendlyError, loginRetrySeconds, postRetrySeconds, safeReturnPath, STATUS_LABELS, validatePost, type MeetPost } from '../lib/community-model';
import { photoEditor, photoViewer } from './community-photos';

type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; reset: (id: string) => void; remove: (id: string) => void };
let cleanup = () => {};
let activeRoot: Element | null = null;

async function init() {
  const client = communityClient;
  const root = document.querySelector<HTMLElement>('[data-community]');
  if (!root || root === activeRoot || !client) return;
  cleanup();
  activeRoot = root;
  const view = root.querySelector<HTMLElement>('[data-view]')?.dataset.view;
  if (!view) return;
  let disposed = false;
  let signingOut = false;
  let redirectingToLogin = false;
  const disposers: (() => void)[] = [];
  cleanup = () => { disposed = true; disposers.forEach(fn => fn()); activeRoot = null; };
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const message = (text: string, error = false) => {
    if (disposed) return;
    const target = $('#community-message');
    target.textContent = text;
    target.dataset.error = String(error);
  };
  const login = () => {
    if (disposed || redirectingToLogin) return;
    redirectingToLogin = true;
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  };
  const rpc = communityRpc;
  const busy = async (button: HTMLButtonElement, action: () => Promise<void>) => {
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); } catch (error) { message(friendlyError(error), true); }
    finally { if (!disposed) button.disabled = false; }
  };
  const requireUser = async () => {
    const { data: { user }, error } = await client.auth.getUser();
    if (error) {
      if (error.name !== 'AuthSessionMissingError' && error.status !== 401 && error.status !== 403) throw error;
      await client.auth.signOut({ scope: 'local' });
      login();
      return null;
    }
    if (!user) { login(); return null; }
    return user;
  };
  const { data: listener } = client.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_OUT') return;
    if (!signingOut && (view === 'editor' || view === 'account')) login();
    const contact = root.querySelector('#post-contact');
    if (contact) contact.textContent = '';
    const button = root.querySelector<HTMLButtonElement>('#show-contact');
    if (button) button.hidden = false;
  });
  disposers.push(() => listener.subscription.unsubscribe());
  const photos = photoViewer(root);
  disposers.push(() => photos.dispose());

  function node(tag: string, text: string, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }
  function card(post: MeetPost) {
    const element = node('article', '', 'meet-card');
    const photo = document.createElement('a');
    photo.className = 'post-photo';
    photo.href = `/meet/post?id=${post.id}`;
    photo.dataset.postPhoto = String(post.id);
    photo.textContent = [...post.city][0] || [...post.nickname][0];
    if (post.photo_count) { photo.textContent = '登录后可见'; photo.dataset.locked = 'true'; }
    photo.setAttribute('aria-label', `${post.nickname}的相亲帖`);
    const content = node('div', '', 'meet-card-main');
    const meta = node('p', '', 'post-meta');
    meta.append(node('span', String(post.id).padStart(3, '0'), 'post-number'), document.createTextNode(`${post.city} · ${post.age} 岁 · ${post.gender}${post.occupation ? ` · ${post.occupation}` : ''}`));
    content.append(meta);
    const title = node('h2', '');
    const link = document.createElement('a');
    link.href = `/meet/post?id=${post.id}`;
    link.dataset.astroReload = '';
    link.textContent = post.title;
    title.append(link);
    const footer = node('div', '', 'post-footer');
    footer.append(node('span', post.nickname), node('time', new Date(post.created_at).toLocaleDateString('zh-CN')));
    content.append(title, node('p', post.about, 'post-excerpt'), footer);
    element.append(photo, content);
    return element;
  }

  try {
    if (view === 'callback') {
      const next = safeReturnPath(new URLSearchParams(location.search).get('next'));
      const { error } = await client.auth.initialize();
      // Remove auth fragments and error details before leaving the callback.
      history.replaceState(null, '', location.pathname);
      if (error) throw error;
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user?.email_confirmed_at) throw { code: 'otp_expired' };
      location.replace(next);
      return;
    }
    if (view === 'login') {
      const { data } = await client.auth.getSession();
      const next = safeReturnPath(new URLSearchParams(location.search).get('next'));
      if (data.session) { location.replace(next); return; }
      const emailForm = $<HTMLFormElement>('#email-form');
      const emailInput = emailForm.querySelector<HTMLInputElement>('[name=email]')!;
      const submit = emailForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const sent = $('#email-sent');
      const resend = $<HTMLButtonElement>('#resend-link');
      const changeEmail = $<HTMLButtonElement>('#change-email');
      const cooldownKey = 'amazingindex-community-login-retry-at';
      let email = '';
      let resendAt = 0;
      let sendingLink = false;
      let captchaToken = '';
      let widget = '';
      const captcha = root.querySelector<HTMLElement>('#community-captcha');
      const turnstile = () => (window as Window & { turnstile?: Turnstile }).turnstile;
      if (captcha) {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        const loaded = new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('captcha_timeout')), 15000);
          script.onload = () => { clearTimeout(timer); resolve(); };
          script.onerror = () => { clearTimeout(timer); reject(new Error('captcha_unavailable')); };
        });
        document.head.append(script);
        await loaded;
        if (disposed) return;
        widget = turnstile()!.render(captcha, {
          sitekey: captcha.dataset.sitekey,
          callback: (token: string) => { captchaToken = token; },
          'expired-callback': () => { captchaToken = ''; },
          'error-callback': () => { captchaToken = ''; message('安全验证暂不可用，请刷新重试。', true); },
        });
        disposers.push(() => { turnstile()?.remove(widget); script.remove(); });
      }
      const updateCountdown = () => {
        if (disposed) return;
        // Share only a deadline, never the email address, across reloads and tabs.
        try {
          const saved = Number(localStorage.getItem(cooldownKey));
          if (Number.isFinite(saved) && saved <= Date.now() + 3600000) resendAt = Math.max(resendAt, saved);
        } catch { /* In-memory cooldown still works when storage is unavailable. */ }
        const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
        submit.disabled = sendingLink || seconds > 0;
        resend.disabled = sendingLink || seconds > 0;
        emailInput.readOnly = sendingLink;
        changeEmail.disabled = sendingLink;
        submit.textContent = sendingLink ? '正在发送…' : seconds ? `${seconds} 秒后可发送` : '发送登录链接';
        resend.textContent = sendingLink ? '正在发送…' : seconds ? `${seconds} 秒后重发` : '重新发送';
      };
      const cooldown = (seconds: number) => {
        resendAt = Math.max(resendAt, Date.now() + seconds * 1000);
        try { localStorage.setItem(cooldownKey, String(resendAt)); } catch { /* Keep the in-memory deadline. */ }
      };
      const timer = window.setInterval(updateCountdown, 1000);
      const onStorage = (event: StorageEvent) => { if (event.key === cooldownKey) updateCountdown(); };
      window.addEventListener('storage', onStorage);
      disposers.push(() => { clearInterval(timer); window.removeEventListener('storage', onStorage); });
      updateCountdown();
      if (resendAt > Date.now()) message('请等待倒计时结束后再发送；如已收到邮件，请使用最新一封中的链接。');
      async function sendLink() {
        if (sendingLink || disposed) return;
        updateCountdown();
        if (Date.now() < resendAt) { message('请稍后再发送登录链接。', true); return; }
        if (captcha && !captchaToken) { message('请先完成安全验证。', true); return; }
        sendingLink = true;
        updateCountdown();
        message('正在发送登录链接…');
        try {
          const redirect = new URL('/auth/callback', location.origin);
          redirect.searchParams.set('next', next);
          const { error } = await client!.auth.signInWithOtp({ email, options: {
            shouldCreateUser: true, emailRedirectTo: redirect.href, captchaToken: captchaToken || undefined,
          } });
          if (error) throw error;
          cooldown(60);
          if (disposed) return;
          emailForm.hidden = true;
          sent.hidden = false;
          if (captcha) sent.prepend(captcha);
          $('#email-recipient').textContent = `登录链接已发送至 ${email}`;
          message('请在邮箱中打开登录链接，10 分钟内有效。');
        } catch (error) {
          const seconds = loginRetrySeconds(error);
          if (seconds) cooldown(seconds);
          message(friendlyError(error), true);
        } finally {
          sendingLink = false;
          if (captcha && !disposed) { captchaToken = ''; turnstile()?.reset(widget); }
          updateCountdown();
        }
      }
      emailForm.addEventListener('submit', event => {
        event.preventDefault();
        if (!emailForm.reportValidity()) return;
        email = String(new FormData(emailForm).get('email')).trim();
        void sendLink();
      });
      resend.addEventListener('click', () => { void sendLink(); });
      changeEmail.addEventListener('click', () => {
        sent.hidden = true; emailForm.hidden = false;
        if (captcha) emailForm.append(captcha);
        message('');
      });
    }

    if (view === 'list') {
      const list = $('#post-list');
      const more = $<HTMLButtonElement>('#load-more');
      let cursor: number | null = null;
      let generation = 0;
      async function load(reset: boolean) {
        const request = reset ? ++generation : generation;
        if (reset) { cursor = null; list.replaceChildren(); }
        more.hidden = true;
        message('正在加载帖子…');
        try {
          const posts: MeetPost[] = await rpc('list_meet_posts', { p_before: cursor, p_limit: 20 });
          if (request !== generation || disposed) return;
          posts.forEach(post => list.append(card(post)));
          void photos.load(posts.map(post => post.id)).catch(() => {});
          cursor = posts.at(-1)?.id ?? cursor;
          more.hidden = posts.length < 20;
          more.textContent = '加载更多';
          message(list.childElementCount ? '' : '还没有相亲帖，来写下第一份自我介绍吧。');
        } catch (error) {
          if (request === generation) { message(friendlyError(error), true); more.hidden = false; more.textContent = '重试'; }
        }
      }
      more.addEventListener('click', () => { void busy(more, () => load(false)); });
      await load(true);
      void rpc('meet_post_count').then(count => { if (!disposed) $('#post-total').textContent = String(count); }).catch(() => { if (!disposed) $('#post-total').textContent = '暂无数据'; });
    }

    if (view === 'editor') {
      const user = await requireUser();
      if (!user || disposed) return;
      const form = $<HTMLFormElement>('#post-form');
      const editor = await photoEditor($('#photo-editor'), form);
      if (disposed) { editor.dispose(); return; }
      disposers.push(() => editor.dispose());
      const { data: post, error } = await client.from('meet_posts').select('*').eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (post) {
        const { data: contact, error: contactError } = await client.from('meet_contacts').select('contact,share_contact').eq('owner_id', user.id).maybeSingle();
        if (contactError) throw contactError;
        const fields = { ...post, contact: contact?.contact || '', share_contact: contact?.share_contact || false };
        for (const [name, value] of Object.entries(fields)) {
          const input = form.elements.namedItem(name);
          if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(value);
          else if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) input.value = String(value ?? '');
        }
      }
      message(post ? '提交修改后，帖子将重新进入审核。' : '');
      const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      const cooldownNote = $('#post-cooldown');
      let retryAt = post?.updated_at ? Date.parse(post.updated_at) + 60000 : 0;
      let submitting = false;
      let rateLimited = false;
      const updateSubmit = () => {
        if (disposed) return;
        const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) || 0;
        editor.setSubmitLocked(submitting || seconds > 0);
        submit.textContent = submitting ? '正在提交…' : seconds ? `${seconds} 秒后可提交` : '提交审核';
        cooldownNote.hidden = seconds === 0;
        cooldownNote.textContent = seconds ? `刚刚保存过帖子，${seconds} 秒后可再次提交。可以继续编辑，等待不会清空当前修改。` : '';
        if (!seconds && rateLimited) { rateLimited = false; message('现在可以再次提交，当前修改仍保留在页面中。'); }
      };
      const timer = window.setInterval(updateSubmit, 1000);
      disposers.push(() => clearInterval(timer));
      updateSubmit();
      form.hidden = false;
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (submitting || Date.now() < retryAt || !form.reportValidity()) return;
        void (async () => {
          const data = new FormData(form);
          let values;
          try { values = validatePost({ ...Object.fromEntries(data), consent: data.has('consent'), share_contact: data.has('share_contact') }); }
          catch (error) { message((error as Error).message, true); return; }
          let ids: string[];
          try { ids = editor.ids(); } catch (error) { message((error as Error).message, true); return; }
          submitting = true;
          updateSubmit();
          try {
            await rpc('submit_meet_post', { ...values, p_photo_ids: ids });
            location.assign('/account?submitted=1');
          } catch (error) {
            const seconds = postRetrySeconds(error);
            if (seconds) { retryAt = Date.now() + seconds * 1000; rateLimited = true; }
            message(friendlyError(error), true);
          } finally { submitting = false; updateSubmit(); }
        })();
      });
    }

    if (view === 'account') {
      const user = await requireUser();
      if (!user || disposed) return;
      $('#account-email').textContent = user.email || '';
      const signout = $<HTMLButtonElement>('#sign-out');
      signout.hidden = false;
      signout.addEventListener('click', () => { void busy(signout, async () => {
        signingOut = true;
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) { signingOut = false; throw error; }
        location.assign('/meet');
      }); });
      const { data: post, error } = await client.from('meet_posts').select('*').eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!post) {
        message('你还没有发布相亲帖。');
        const link = document.createElement('a'); link.href = '/meet/new'; link.dataset.astroReload = ''; link.className = 'community-button'; link.textContent = '发布相亲帖';
        $('#my-post').append(link);
      } else {
        const expired = post.status === 'published' && new Date(post.expires_at).getTime() <= Date.now();
        message(expired ? '帖子已到期，可编辑后重新提交。' : STATUS_LABELS[post.status as keyof typeof STATUS_LABELS]);
        $('#my-post').append(card(post));
        if (post.review_reason) $('#my-post').append(node('p', `审核反馈：${post.review_reason}`, 'community-note'));
        void photos.load([post.id]).catch(() => {});
        $('#my-post-actions').hidden = false;
        const withdraw = $<HTMLButtonElement>('#withdraw-post');
        withdraw.hidden = post.status === 'withdrawn';
        withdraw.addEventListener('click', () => {
          if (!window.confirm('确认撤回这条相亲帖？撤回后其他用户将无法查看。')) return;
          void busy(withdraw, async () => { await rpc('withdraw_meet_post'); location.reload(); });
        });
      }
    }

    if (view === 'detail') {
      const rawId = new URLSearchParams(location.search).get('id') || '';
      if (!/^[1-9][0-9]*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) { message('帖子不存在。'); return; }
      const posts: MeetPost[] = await rpc('get_meet_post', { p_id: Number(rawId) });
      if (disposed) return;
      const post = posts[0];
      if (!post) { message('帖子不存在、已撤回或已到期。'); return; }
      message('');
      const detail = $('#post-detail');
      const facts = node('dl', '', 'post-facts');
      for (const [label, value] of [['坐标', post.city], ['年龄', `${post.age} 岁`], ['性别', post.gender], ['职业', post.occupation]]) {
        if (!value) continue;
        const fact = node('div', ''); fact.append(node('dt', label), node('dd', value)); facts.append(fact);
      }
      detail.append(node('p', `NO. ${String(post.id).padStart(3, '0')} · ${new Date(post.created_at).toLocaleDateString('zh-CN')}`, 'post-meta'), node('h1', post.title), facts, node('h2', '关于我'), node('p', post.about, 'post-body'));
      $('#post-author').textContent = post.nickname;
      void photos.load([post.id], true).catch(() => { if (!disposed) $('#post-photos').textContent = '照片暂不可用，请刷新重试。'; });
      if (post.looking_for) detail.append(node('h2', '希望认识的你'), node('p', post.looking_for, 'post-body'));
      $('#contact-section').hidden = false;
      const report = $('#report-post');
      report.hidden = false;
      report.querySelector('a')!.href = `mailto:hi@amazingindex.com?subject=${encodeURIComponent(`相亲帖举报 #${post.id}`)}`;
      const contactButton = $<HTMLButtonElement>('#show-contact');
      contactButton.addEventListener('click', () => { void busy(contactButton, async () => {
        const user = await requireUser();
        if (!user || disposed) return;
        const contact = await rpc('get_meet_contact', { p_id: post.id });
        const { data: { session } } = await client.auth.getSession();
        if (disposed || session?.user.id !== user.id) return;
        $('#post-contact').textContent = contact || '发布者未提供联系方式，或帖子已不可见。';
        contactButton.hidden = true;
      }); });
      // Published data is never saved locally; recheck after returning to a backgrounded tab.
      const visibility = () => { if (document.visibilityState === 'visible') location.reload(); };
      document.addEventListener('visibilitychange', visibility);
      disposers.push(() => document.removeEventListener('visibilitychange', visibility));
    }
  } catch (error) { message(friendlyError(error), true); }
}
document.addEventListener('astro:page-load', () => { void init(); });
document.addEventListener('astro:before-swap', () => cleanup());
window.addEventListener('pageshow', event => { if (event.persisted && document.querySelector('[data-community]')) location.reload(); });
void init();

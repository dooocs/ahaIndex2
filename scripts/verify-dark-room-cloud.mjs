// Exercise the real page, auth client, iframe engine and save buttons. All
// network traffic outside the isolated dev server is mocked or denied.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.COMMUNITY_TEST_URL || 'http://127.0.0.1:4328';
const apiOrigin = process.env.PUBLIC_COMMUNITY_SUPABASE_URL || 'https://community-preview.supabase.co';
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'dark-room@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString() };
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`;
let latest = null;
let slots = [];
let offline = false;
const errors = [];
const calls = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
let page;
try {
  await context.addInitScript(({ apiOrigin, token, user }) => {
    if (localStorage.getItem('dark-room-test-seeded')) return;
    localStorage.setItem('dark-room-test-seeded', 'yes');
    localStorage.setItem(`amazingindex-community-auth:${apiOrigin}`, JSON.stringify({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
    localStorage.setItem('amazingindex.dark-room.gameState', JSON.stringify({ version: 1.3, stores: { wood: 80 } }));
    localStorage.setItem('amazingindex.dark-room.lang', 'en');
  }, { apiOrigin, token, user });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== apiOrigin) return route.abort();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.endsWith('/user')) return ok(user);
    if (!url.pathname.endsWith('/functions/v1/meet-api/dark-room')) return route.abort();
    if (offline) return route.abort();
    const { action, payload } = route.request().postDataJSON();
    calls.push({ action, payload });
    if (action === 'read') return ok({ latest, slots: slots.map(({ state, ...metadata }) => metadata) });
    if (latest?.last_request_id === payload.request_id) return ok({ latest });
    if (payload.expected_revision !== (latest?.revision || 0)) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'conflict', latest }) });
    let state = payload.state;
    if (action === 'restore') state = slots.find(slot => slot.revision === payload.revision)?.state;
    assert.ok(state, 'restore target exists');
    if (latest && !slots.some(slot => slot.revision === latest.revision)) slots.push({ ...latest, saved_at: latest.updated_at, is_manual_slot: false, reason: payload.operation || 'restore' });
    latest = { state: structuredClone(state), revision: (latest?.revision || 0) + 1, schema_version: 1, game_version: '1.3', updated_at: new Date().toISOString(), last_request_id: payload.request_id, last_operation: payload.operation || 'restore' };
    if (payload.operation === 'manual') {
      slots.forEach(slot => { slot.is_manual_slot = false; });
      slots.push({ ...latest, saved_at: latest.updated_at, is_manual_slot: true, reason: 'manual' });
    }
    return ok({ latest });
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.clock.install({ time: new Date() });
  await page.goto(`${origin}/dark-room?ignorebrowser=true`);
  await page.getByRole('button', { name: '继续本机游客存档', exact: false }).click();
  await page.waitForFunction(() => document.querySelector('#dark-room-save-status')?.textContent.includes('已同步'));
  assert.equal(latest.state.stores.wood, 80, 'guest binding');
  const gameFrame = page.frameLocator('#dark-room-app');
  await page.clock.fastForward(3100);
  await gameFrame.getByText('是否开启声音？', { exact: true }).waitFor();
  await gameFrame.getByText('保持静音', { exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('amazingindex.dark-room.lang')), 'zh_cn', 'Chinese is the default even with an old English preference');
  assert.equal(await gameFrame.locator('.game-settings').count(), 0, 'settings live below the account');
  const settings = page.locator('#dark-room-settings-host .game-settings');
  await settings.locator('summary').click();
  await settings.getByRole('button', { name: '开启声音', exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.State.config.soundOn), true, 'hosted sound control reaches the engine');
  await settings.locator('summary').click();
  await settings.getByRole('button', { name: '夜间模式', exact: true }).click();
  await page.locator('.dark-room-page[data-theme="dark"]').waitFor({ state: 'attached' });
  await settings.locator('summary').click();
  await settings.getByRole('button', { name: '开灯', exact: true }).click();
  await page.locator('.dark-room-page[data-theme="light"]').waitFor({ state: 'attached' });
  for (const width of [1920, 1365, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const aligned = await page.evaluate(() => {
      const account = document.querySelector('[data-community-account]').getBoundingClientRect();
      const controls = document.querySelector('.dark-room-cloud').getBoundingClientRect();
      return Math.abs(account.right - controls.right) < 2 && controls.top >= account.bottom && controls.left >= 0 && controls.right <= innerWidth;
    });
    assert(aligned, `controls align below account at ${width}px`);
  }
  await page.setViewportSize({ width: 1365, height: 900 });
  const wood = () => page.evaluate(() => document.querySelector('iframe').contentWindow.State.stores.wood);
  const setWood = value => page.evaluate(value => { document.querySelector('iframe').contentWindow.$SM.set('stores.wood', value); }, value);
  await page.locator('#dark-room-save').click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('amazingindex.dark-room.user.11111111-1111-4111-8111-111111111111.gameState.sync')).pending.length);
  assert.equal(slots.find(slot => slot.is_manual_slot).state.stores.wood, 80, 'manual exact snapshot');
  await setWood(81);
  await page.clock.fastForward(31000);
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('amazingindex.dark-room.user.11111111-1111-4111-8111-111111111111.gameState.sync')).pending.length);
  assert.equal(latest.state.stores.wood, 81, '30-second autosave');
  assert.equal(slots.find(slot => slot.is_manual_slot).state.stores.wood, 80, 'autosave preserves manual');
  offline = true;
  await setWood(82);
  await page.locator('#dark-room-save').click();
  await page.locator('#dark-room-save-status').filter({ hasText: '已留在本机' }).waitFor();
  await setWood(83);
  await page.clock.fastForward(31000);
  await page.reload();
  await page.locator('#dark-room-save-status').filter({ hasText: '已留在本机' }).waitFor();
  assert.equal(await wood(), 83, 'offline local resume');
  offline = false;
  await page.locator('#dark-room-retry').click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('amazingindex.dark-room.user.11111111-1111-4111-8111-111111111111.gameState.sync')).pending.length);
  assert.equal(latest.state.stores.wood, 83, 'offline latest flushed');
  assert.equal(slots.find(slot => slot.is_manual_slot).state.stores.wood, 82, 'offline manual survives reload and later autosave');
  await setWood(84);
  await page.locator('#dark-room-load').click();
  await page.locator('dialog').getByRole('button', { name: /^手动存档/ }).click();
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow.State?.stores?.wood === 82);
  assert.equal(await page.locator('#dark-room-settings-host .game-settings').count(), 1, 'one working settings menu after restore');
  assert.equal(latest.state.stores.wood, 82, 'manual restore creates latest');
  assert(slots.some(slot => slot.state.stores.wood === 84), 'pre-restore progress backed up');
  latest = { ...latest, state: { ...latest.state, stores: { ...latest.state.stores, wood: 900 } }, revision: latest.revision + 1, last_request_id: 'other-device' };
  await setWood(85);
  await page.locator('#dark-room-save').click();
  await page.getByRole('heading', { name: '发现不同的游戏进度' }).waitFor();
  assert.equal(latest.state.stores.wood, 900, 'CAS never overwrites unseen state');
  await page.getByRole('button', { name: /^继续云端进度/ }).click();
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow.State?.stores?.wood === 900);
  const second = await context.newPage();
  await second.goto(`${origin}/dark-room`);
  await second.locator('#dark-room-save-status').filter({ hasText: '另一个标签页' }).waitFor();
  assert.equal(await second.locator('#dark-room-save').isDisabled(), true, 'only one tab writes');
  await second.close();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('iframe').contentWindow.State?.stores?.wood === 900);
  await page.evaluate(() => {
    const manager = document.querySelector('iframe').contentWindow.$SM;
    manager.set('game.builder.level', 4);
    manager.set('stores.wood', 250);
    manager.set('stores.fur', 9);
    manager.set('stores.meat', 5);
  });
  await gameFrame.locator('#build_trading-post').waitFor();
  await gameFrame.locator('#build_lodge').waitFor();
  await setWood(28);
  await page.evaluate(() => document.querySelector('iframe').contentWindow.$SM.set('stores.fur', 0));
  await page.locator('#dark-room-save').click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('amazingindex.dark-room.user.11111111-1111-4111-8111-111111111111.gameState.sync')).pending.length);
  assert.equal(latest.state.features.craftables['trading post'], true, 'cloud snapshot includes building discoveries');
  await page.reload();
  await gameFrame.locator('#build_trading-post').waitFor();
  await gameFrame.locator('#build_lodge').waitFor();
  assert.equal(await wood(), 28, 'restoring discoveries does not replenish spent resources');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('amazingindex.dark-room.gameState')).stores.wood), 80, 'original guest save retained');
  await page.evaluate(() => {
    const game = document.querySelector('iframe').contentWindow;
    if (!game.Outside.panel) game.Outside.init();
    game.$SM.set('game.buildings.hut', 5);
    game.Engine.travelTo(game.Outside);
  });
  await page.clock.runFor(400);
  for (const width of [1920, 1365, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.runFor(100);
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe'), doc = frame.contentDocument;
      const nav = document.querySelector('.nav-tab').getBoundingClientRect();
      const settings = document.querySelector('#dark-room-settings-host summary').getBoundingClientRect();
      return Math.abs(doc.getElementById('notifications').getBoundingClientRect().left + frame.getBoundingClientRect().left - nav.left) < 1 && Math.abs(doc.getElementById('village').getBoundingClientRect().right + frame.getBoundingClientRect().left - settings.right) < 1;
    });
    const edges = await page.evaluate(() => {
      const frame = document.querySelector('iframe'), doc = frame.contentDocument;
      const nav = document.querySelector('.nav-tab').getBoundingClientRect();
      const settings = document.querySelector('#dark-room-settings-host summary').getBoundingClientRect();
      const notifications = doc.getElementById('notifications').getBoundingClientRect();
      const inventory = doc.getElementById('stores').getBoundingClientRect();
      const village = doc.getElementById('village').getBoundingClientRect();
      const action = doc.getElementById('gatherButton').getBoundingClientRect();
      const workers = doc.getElementById('workers')?.getBoundingClientRect();
      doc.documentElement.removeAttribute('data-site-edges');
      const original = doc.getElementById('gatherButton').getBoundingClientRect();
      doc.documentElement.setAttribute('data-site-edges', '');
      return { left: notifications.left + frame.getBoundingClientRect().left - nav.left, inventoryRight: inventory.right + frame.getBoundingClientRect().left - settings.right, villageRight: village.right + frame.getBoundingClientRect().left - settings.right, unchanged: action.left === original.left && action.width === original.width, clear: !workers || workers.right < village.left, stacked: inventory.top > village.bottom };
    });
    assert(Math.abs(edges.left) < 1 && Math.abs(edges.inventoryRight) < 1 && Math.abs(edges.villageRight) < 1, `game columns align with navigation and settings at ${width}px: ${JSON.stringify(edges)}`);
    assert(edges.unchanged && edges.clear && edges.stacked, `middle stays in place and village remains above inventory at ${width}px`);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/dark-room-cloud.png' });
  console.log(JSON.stringify({ result: 'PASS', cloudRequests: calls.length, checks: ['Chinese sound prompt and default language', 'account-aligned controls at desktop and mobile widths', 'hosted sound and theme settings', 'guest binding', 'manual snapshot', '30s autosave', 'offline queue and reload', 'manual restore and backup', 'CAS conflict choice', 'tab locking', 'cloud resume', 'building discoveries survive spending and cloud reload', 'masthead-aligned outer columns at three desktop widths with unchanged central actions'] }));
} catch (error) {
  if (page) {
    console.error(await page.locator('#dark-room-save-status').textContent(), errors);
    await page.screenshot({ path: '/tmp/dark-room-cloud-failure.png' });
  }
  throw error;
} finally { await browser.close(); }

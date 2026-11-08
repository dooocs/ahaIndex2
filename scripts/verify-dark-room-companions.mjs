// Real game, fresh browser contexts only. Never touches a player's browser or saves.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve('public');
const guestKey = 'amazingindex.dark-room.gameState';
const owner = '11111111-1111-4111-8111-111111111111';
const accountKey = `amazingindex.dark-room.user.${owner}.gameState`;
const village = {
  version: 1.3, config: { soundOn: false }, playStats: { audioAlertShown: true },
  features: { location: { room: true, outside: true } },
  stores: { wood: 1000, fur: 100, meat: 100, 'cured meat': 50 },
  game: { builder: { level: 4 }, population: 8, workers: {}, buildings: { hut: 2, cart: 1 }, fire: { value: 4 }, temperature: { value: 4 } }
};
const preferences = gender => ({ version: 1, prompted: true, preferences: { gender, ages: ['19-21'] }, people: {}, nextEncounterAt: 0 });
const wav = Buffer.alloc(204);
wav.write('RIFF', 0); wav.writeUInt32LE(196, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160, 40);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__embedded') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset="utf-8"><div id="dark-room-settings-host"></div><iframe id="game" style="width:100%;height:900px" src="/dark-room/app.html?ignorebrowser=true&embedded=1"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='dark-room:ready')document.getElementById('game').contentWindow.DarkRoomGame.start('${owner}')})</script>`);
      return;
    }
    if (url.pathname.includes('/audio/')) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) throw Error('path');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
async function context(state, embedded = false, mobile = false) {
  const c = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  await c.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await c.addInitScript(({ key, state }) => {
    if (state && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    const originalNow = Date.now;
    Date.now = () => originalNow() + Number(sessionStorage.getItem('companion-test-clock') || 0);
  }, { key: embedded ? accountKey : guestKey, state });
  const page = await c.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + (embedded ? '/__embedded' : '/dark-room/app.html?ignorebrowser=true'));
  const frame = embedded ? page.frames().find(f => f.url().includes('/dark-room/app.html')) : page;
  await frame.waitForFunction(() => window.Companions && window.Engine && Engine.activeModule && (document.querySelector('[data-companion-action="manager"]') || parent.document.querySelector('[data-companion-action="manager"]')));
  return { c, page, frame };
}
async function advance(frame, ms, tick = false) {
  await frame.evaluate(({ ms, tick }) => {
    sessionStorage.setItem('companion-test-clock', String(Number(sessionStorage.getItem('companion-test-clock') || 0) + ms));
    if (tick) Companions.tick();
  }, { ms, tick });
}
async function close(frame) {
  await frame.locator('[data-companion-action="close"]').click();
  await frame.waitForFunction(() => !Companions.isOpen());
}
async function manager(page, frame = page) {
  await page.locator('.game-settings > summary').click();
  await page.locator('[data-companion-action="manager"]').click();
  await frame.locator('.companion-panel').waitFor();
}
try {
  const launch = { headless: true };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (process.env.PLAYWRIGHT_ARGS) launch.args = JSON.parse(process.env.PLAYWRIGHT_ARGS);
  browser = await chromium.launch(launch);

  const fresh = await context(null);
  await fresh.page.waitForTimeout(1700);
  assert.equal(await fresh.page.locator('.companion-panel').count(), 0, 'new game keeps the opening/tutorial clear');
  await fresh.c.close();

  const game = await context(village);
  const { page } = game;
  await page.locator('#companion-preferences').waitFor();
  await page.locator('[data-companion-action="save-preferences"]').click();
  assert.match(await page.locator('.companion-error').innerText(), /请选择/);
  await page.locator('input[name="gender"][value="female"]').check();
  await page.locator('.companion-more > summary').click();
  await page.locator('input[name="ages"][value="36-41"]').check();
  await page.locator('input[name="temperaments"][value="assertive"]').check();
  await page.locator('[data-companion-action="save-preferences"]').click();
  await close(page);
  await advance(page, 31000, true);
  await page.locator('[data-companion-action="details"]').waitFor();
  const first = await page.evaluate(() => ({ id: State.game.companions.pendingId, pref: JSON.stringify(State.game.companions.preferences) }));
  const candidate = await page.evaluate(() => CompanionModel.person(State.game.companions.pendingId));
  assert.equal(candidate.gender, 'female'); assert(candidate.age >= 36 && candidate.age <= 41);
  await page.locator('[data-companion-action="details"]').click();
  assert.equal(await page.evaluate(() => JSON.stringify(State.game.companions.preferences)), first.pref);
  await page.screenshot({ path: '/tmp/dark-room-companions-desktop.png' });
  await close(page); await page.reload();
  await page.waitForFunction(() => window.Companions && window.Engine && Engine.activeModule);
  assert.equal(await page.evaluate(() => State.game.companions.pendingId), first.id, 'pending person survives a reload');
  await advance(page, 181000, true);
  await page.locator('[data-companion-action="decline"]').waitFor();
  assert.equal(await page.evaluate(() => State.game.companions.pendingId), first.id);
  await page.locator('[data-companion-action="decline"]').click();
  await page.waitForFunction(() => !Companions.isOpen());
  assert.equal(await page.evaluate(() => JSON.stringify(State.game.companions.preferences)), first.pref);
  assert.equal(await page.evaluate(id => State.game.companions.people[id].status, first.id), 'declined');
  await advance(page, 181000, true);
  await page.locator('[data-companion-action="accept"]').waitFor();
  const accepted = await page.evaluate(() => State.game.companions.pendingId);
  assert.notEqual(accepted, first.id);
  await page.locator('[data-companion-action="accept"]').click();
  await page.waitForFunction(id => State.game.companions.people[id]?.status === 'known', accepted, { timeout: 3000 }).catch(async error => {
    console.error('Acceptance diagnostics', await page.evaluate(() => ({ state: State.game.companions, text: document.querySelector('.companion-panel')?.innerText, events: Events.eventStack.map(e => e.title) })));
    throw error;
  });
  assert.equal(await page.evaluate(() => State.game.companions.partnerId), null);
  await page.locator('[data-companion-action="finish-accept"]').click();
  await page.waitForFunction(() => !Companions.isOpen());
  await manager(page);
  await page.locator(`[data-companion-action="profile"][data-companion-id="${accepted}"]`).click();
  assert.equal(await page.locator('[data-companion-action="interact"]').isDisabled(), true);
  await advance(page, 121000, true);
  assert.equal(await page.locator('[data-companion-action="interact"]').isDisabled(), false, 'cooldown buttons become available while their dialog stays open');
  await close(page);
  for (let i = 0; i < 2; i++) {
    await advance(page, 121000);
    await manager(page);
    await page.locator(`[data-companion-action="profile"][data-companion-id="${accepted}"]`).click();
    await page.locator('[data-companion-action="interact"]').click();
    await page.locator('[data-companion-action="finish-story"]').click();
    if (!i) await close(page);
  }
  assert.equal(await page.evaluate(() => State.game.companions.partnerId), null);
  await page.locator('[data-companion-action="confirm-partner"]').click();
  await page.locator('[data-companion-action="commit-partner"]').click();
  assert.equal(await page.evaluate(() => State.game.companions.partnerId), accepted);
  await page.locator('[data-companion-action="finish-story"]').click();
  await page.locator('[data-companion-action="prepare-home"]').click();
  assert.equal(await page.evaluate(id => DarkRoomGame.snapshot().game.companions.people[id].homeReady, accepted), true);
  await close(page); await page.reload();
  await page.waitForFunction(() => window.Companions && window.Engine && Engine.activeModule);
  assert.equal(await page.evaluate(() => State.game.companions.partnerId), accepted);
  await advance(page, 601000, true);
  assert.equal(await page.locator('.companion-panel').count(), 0, 'a partner stops new romantic invitations');
  await game.c.close();
  console.log('PASS preferences, details, rejection, persisted invitation, paced acquaintance, explicit partner and household');

  const men = await context({ ...village, game: { ...village.game, companions: preferences('male') } }, false, true);
  await men.page.locator('[data-companion-action="details"]').waitFor();
  const man = await men.page.evaluate(() => CompanionModel.person(State.game.companions.pendingId));
  assert.equal(man.gender, 'male'); assert(man.age >= 19 && man.age <= 21);
  await men.page.locator('[data-companion-action="details"]').click();
  const bounds = await men.page.locator('.companion-panel').boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'mobile dialog stays inside the viewport');
  await men.page.screenshot({ path: '/tmp/dark-room-companions-mobile.png' });
  await men.page.keyboard.press('Escape'); await men.page.waitForFunction(() => !Companions.isOpen());
  await men.c.close();
  console.log('PASS male preference, adult age filter, narrow dialog and Escape close');

  const paused = await context({ ...village, game: { ...village.game, companions: preferences('off') } }, true);
  await paused.page.waitForTimeout(1700);
  assert.equal(await paused.frame.locator('.companion-panel').count(), 0);
  await manager(paused.page, paused.frame);
  assert.match(await paused.frame.locator('.companion-panel').innerText(), /暂时不考虑/);
  assert.equal(await paused.frame.evaluate(() => JSON.parse(localStorage.getItem('amazingindex.dark-room.gameState'))), null, 'account game never writes a guest save');
  await close(paused.frame);
  await paused.frame.evaluate(() => Events.startEvent({ title: '原版事件', scenes: { start: { text: ['仍在进行的原版事件'], buttons: {} } } }));
  await advance(paused.frame, 999000, true);
  assert.equal(await paused.frame.locator('.companion-panel').count(), 0);
  assert.equal(await paused.frame.locator('.eventTitle').innerText(), '原版事件');
  await paused.c.close();
  console.log('PASS opt-out, embedded menu, account storage isolation and original event coexistence');

  const startup = await context({ ...village, playStats: { audioAlertShown: false } });
  await startup.page.locator('#companion-preferences').waitFor();
  await startup.page.waitForTimeout(1800);
  assert.equal(await startup.page.evaluate(() => Events.eventStack.length), 1, 'startup audio notice must not stack over a companion dialog');
  assert.equal(await startup.page.evaluate(() => Boolean(State.playStats.audioAlertShown)), false);
  await close(startup.page);
  await startup.page.waitForFunction(() => State.playStats.audioAlertShown && Events.activeEvent());
  assert.equal(await startup.page.locator('.companion-panel').count(), 0);
  await startup.page.locator('#event #no').click();
  await startup.page.waitForFunction(() => !Events.activeEvent());
  await startup.c.close();
  console.log('PASS delayed startup audio notice waits for the active dialog');
  assert.deepEqual(errors, [], 'real game must have no uncaught browser errors');
} catch (error) {
  if (browser) for (const [index, c] of browser.contexts().entries()) {
    const page = c.pages()[0];
    if (page) await page.screenshot({ path: `/tmp/dark-room-companions-failure-${index}.png` }).catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

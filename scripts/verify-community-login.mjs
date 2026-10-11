import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localPreviewOrigin, loginTestRequestAction } from './community-login-test-network.mjs';

const origin = localPreviewOrigin(process.env.COMMUNITY_TEST_URL || 'http://127.0.0.1:4328');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const cases = [
  { code: 'over_email_send_rate_limit', status: 429, text: '邮件发送已达到服务限额', seconds: 60 },
  { code: 'over_request_rate_limit', status: 429, text: '登录请求过于频繁', seconds: 60 },
  { code: 'over_email_send_rate_limit', status: 429, text: '等待 47 秒', seconds: 47, msg: 'For security purposes, you can only request this after 47 seconds.' },
  { code: 'email_address_not_authorized', status: 403, text: '仅支持项目团队成员邮箱', seconds: 0 },
];
let currentPage;

try {
  for (const fixture of cases) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    let calls = 0;
    // Deny all external traffic, including Aliyun and future custom domains.
    // Only local preview assets may reach the network; OTP is always simulated.
    await context.route('**/*', async route => {
      const action = loginTestRequestAction(route.request().url(), route.request().method(), origin);
      if (action === 'continue') return route.continue();
      if (action === 'abort') return route.abort();
      calls++;
      await new Promise(resolve => setTimeout(resolve, 100));
      return route.fulfill({
        status: calls === 1 ? fixture.status : 200,
        contentType: 'application/json',
        headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'x-supabase-api-version' },
        body: JSON.stringify(calls === 1 ? { code: fixture.code, msg: fixture.msg || fixture.code } : {}),
      });
    });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date() });
    await page.goto(`${origin}/login/?next=%2Fmeet%2F`);
    await page.waitForFunction(() => !document.querySelector('#email-form button')?.disabled);
    const fill = async () => {
      await page.getByLabel('邮箱', { exact: true }).fill('login-regression@example.test');
      await page.locator('[name=terms]').check();
    };
    await fill();
    await page.locator('#email-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.locator('#community-message').filter({ hasText: fixture.text }).waitFor();
    assert.equal(calls, 1, 'Concurrent submissions must not send duplicate requests');
    assert.equal(await page.locator('#email-sent').isVisible(), false);
    const button = page.locator('#email-form button[type=submit]');
    assert.equal(await button.isDisabled(), fixture.seconds > 0);

    if (fixture.seconds) {
      await page.setViewportSize({ width: 375, height: 812 });
      const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(sizes.scroll <= sizes.width, 'Rate-limit text must fit on mobile');
      if (fixture === cases[0]) await page.screenshot({ path: join(tmpdir(), 'community-login-rate-limit.png'), fullPage: true });
      const secondTab = await context.newPage();
      await secondTab.goto(`${origin}/login/`);
      await secondTab.waitForFunction(() => document.querySelector('#email-form button')?.disabled);
      await secondTab.close();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#email-form button')?.disabled);
      await fill();
      await page.locator('#email-form').evaluate(form => form.requestSubmit());
      assert.equal(calls, 1, 'Reloading cannot bypass the resend cooldown');
      await page.clock.fastForward((fixture.seconds + 1) * 1000);
      await page.waitForFunction(() => !document.querySelector('#email-form button')?.disabled);
    }

    await button.click();
    await page.getByText('登录链接已发送至 login-regression@example.test').waitFor();
    assert.equal(calls, 2);
    assert.equal(await page.locator('#resend-link').isDisabled(), true);
    await page.locator('#change-email').click();
    assert.equal(await button.isDisabled(), true, 'Changing email cannot reset the cooldown');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ result: 'PASS', emailsSent: 0, checks: ['mail quota vs request rate vs resend interval', 'duplicate submit guard', 'cooldown survives reload and new tab', 'cooldown expiry and successful retry', 'changing email retains cooldown', 'team-only error', 'mobile overflow'] }));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error('Login page:', await currentPage.locator('#community-message').textContent());
    await currentPage.screenshot({ path: join(tmpdir(), 'community-login-test-failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
}

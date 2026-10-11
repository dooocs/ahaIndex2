import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { communityStorageKey } from '../src/lib/community-model.ts';

const origin = process.env.COMMUNITY_TEST_URL || 'http://127.0.0.1:4328';
const service = process.env.PUBLIC_COMMUNITY_SUPABASE_URL;
if (!service) throw new Error('Run with --env-file=.env');
const sessionKey = communityStorageKey(service, 'review');
const key = 'a'.repeat(64);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 960 } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], requests = [];
  let exchanges = 0, decisions = 0, stale = false, revoked = false;
  let post = { id: 41, nickname: '审核测试用户', city: '杭州', age: 28, gender: '女', title: '喜欢散步，也喜欢认真生活', occupation: '设计师', about: '周末喜欢看展和阅读。希望认识真诚友善的人。<img src=x onerror=alert(1)>', looking_for: '认真沟通，尊重彼此。', status: 'pending', review_reason: '' };
  let version = '1'.repeat(32);
  const photoUrl = `${service}/storage/v1/object/sign/meet-photos/test/photo.jpg?token=fixture`;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.clock.install({ time: new Date() });
  await context.route(`${service}/**`, async route => {
    const url = new URL(route.request().url());
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.startsWith('/storage/')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
    assert.equal(url.pathname, '/functions/v1/meet-review');
    const input = route.request().postDataJSON();
    if (input.action === 'exchange') {
      exchanges++;
      if (revoked || input.key !== key) return reply({error:'review_unauthorized'},401);
      return reply({session:'review-test-session',expiresAt:await page.evaluate(()=>Date.now()+3600000)});
    }
    assert.equal(route.request().headers().authorization,'Bearer review-test-session');
    if (input.action === 'list') return reply({posts:post.status===input.status?[post]:[],more:false});
    if (input.action === 'detail') return reply({post,version,contact:{contact:'test-contact',share_contact:true},photos:[{id:'photo-1',url:photoUrl,thumb:photoUrl}]});
    assert.equal(input.action,'review');
    if (stale) { stale=false; post={...post,about:'用户刚刚修改了内容，需要重新查看。'}; version='2'.repeat(32); return reply({error:'post_changed'},409); }
    assert.equal(input.version,version);
    decisions++; post={...post,status:input.status,review_reason:input.reason}; version='3'.repeat(32); return reply({ok:true});
  });
  await page.goto(`${origin}/meet/review`);
  await page.getByText('请使用专属审核链接进入。').waitFor();
  assert.equal(exchanges,0);
  await page.goto(`${origin}/meet/review#key=${'b'.repeat(64)}`);
  await page.getByText('审核授权已失效，请重新打开专属审核链接。').waitFor();
  assert.equal(await page.locator('#review-workspace').isVisible(),false);
  await page.goto(`${origin}/meet/review#key=${key}`);
  await page.locator('#review-detail h2').waitFor();
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#review-detail .review-text img').count(),0,'post text is not HTML');
  await page.waitForFunction(()=>!document.querySelector('[data-decision=published]')?.disabled);
  assert.equal(await page.locator('script[src*="googletagmanager"]').count(),0);
  const stored = await page.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)}));
  assert.ok(!stored.local.includes(key) && !stored.session.includes(key),'permanent key is never persisted');
  await page.screenshot({path:join(tmpdir(),'community-review-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'查看第 1 张原图'}).click();
  await page.locator('dialog[open]').waitFor();
  await page.getByRole('button',{name:'关闭原图'}).click();
  const beforeRenew = exchanges;
  await page.clock.fastForward(61*60000);
  await page.waitForFunction(key=>{const s=JSON.parse(sessionStorage.getItem(key));return s?.expiresAt>Date.now()+300000;},sessionKey);
  assert.ok(exchanges>beforeRenew,'open tab silently renews beyond one hour');
  await page.getByRole('button',{name:'拒绝',exact:true}).click();
  await page.getByText('请填写拒绝或下架原因。',{exact:true}).waitFor();
  assert.equal(decisions,0);
  await page.getByRole('button',{name:'审核通过'}).click();
  await page.getByRole('dialog',{name:'确认审核决定'}).getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(decisions,0,'cancel never submits a decision');
  stale=true;
  await page.getByRole('button',{name:'审核通过'}).click();
  await page.getByRole('dialog',{name:'确认审核决定'}).getByRole('button',{name:'确认',exact:true}).click();
  await page.getByText('帖子已被修改或处理，请重新查看最新内容后再审核。').waitFor();
  await page.getByText('用户刚刚修改了内容，需要重新查看。').waitFor();
  assert.equal(decisions,0);
  await page.getByRole('button',{name:'审核通过'}).click();
  await page.getByRole('dialog',{name:'确认审核决定'}).getByRole('button',{name:'确认',exact:true}).click();
  await page.getByText('帖子 #41：已发布。').waitFor();
  assert.equal(decisions,1);
  await page.getByRole('tab',{name:'已发布',exact:true}).click();
  await page.getByRole('button',{name:'下架',exact:true}).waitFor();
  await page.locator('#review-reason').fill('资料需要进一步核实');
  await page.getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('dialog',{name:'确认审核决定'}).getByRole('button',{name:'确认',exact:true}).click();
  await page.getByText('帖子 #41：已下架。').waitFor();
  assert.equal(decisions,2);
  await page.getByRole('tab',{name:'已下架'}).click();
  await page.getByText('资料需要进一步核实',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-decision]').count(),0,'withdrawn posts cannot be republished');
  for (const width of [375,320]) {
    await page.setViewportSize({width,height:812});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width===375) await page.screenshot({path:join(tmpdir(),'community-review-mobile.png'),fullPage:true});
  }
  await page.reload();
  await page.getByRole('tab',{name:'待审核'}).waitFor();
  assert.equal(exchanges,beforeRenew+1,'reload reuses the short-lived session');
  await page.getByRole('button',{name:'退出审核'}).click();
  await page.getByText('已退出审核。',{exact:true}).waitFor();
  assert.equal(await page.locator('#review-detail').textContent(),'');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),sessionKey),null);
  revoked=true;
  await page.goto(`${origin}/meet/review#key=${key}`);
  await page.getByText('审核授权已失效，请重新打开专属审核链接。').waitFor();
  assert.ok(requests.every(url=>!url.includes(key)),'entry key never appears in request URLs');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',checks:['locked without key','invalid and revoked key','fragment scrubbing','no persistent entry key','automatic renewal after one hour','photo preview','reason required','confirmation cancellation','stale version rejection','approval and withdrawal','withdrawn cannot republish','reload and logout','mobile/desktop layout','no analytics or XSS']}));
} catch(error) {
  if(page) { console.error(await page.locator('#review-message').textContent()); await page.screenshot({path:join(tmpdir(),'community-review-failure.png'),fullPage:true}); }
  throw error;
} finally { await browser.close(); }

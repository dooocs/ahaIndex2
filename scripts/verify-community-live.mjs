import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { communityConfig, communityStorageKey } from '../src/lib/community-model.ts';
import { getBuildKeyInfo } from '../src/lib/supabase-key.ts';
import { communityProjectTarget } from './community-project-target.mjs';
import { requestCommunityRpc, communityFunctionFetch } from '../src/lib/community-transport.ts';

// Opt-in only: creates isolated fixtures, never sends email, cleans up in finally.
assert.equal(process.env.COMMUNITY_LIVE_TEST, 'true', 'Explicit live-test opt-in required');
const config = communityConfig({ enabled: 'true', url: process.env.PUBLIC_COMMUNITY_SUPABASE_URL, key: process.env.PUBLIC_COMMUNITY_SUPABASE_KEY });
communityProjectTarget(config.url, process.env.COMMUNITY_TEST_PROJECT_REF);
const origin = process.env.COMMUNITY_TEST_URL || 'http://127.0.0.1:4328';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use a local browser preview');
const adminKey = process.env.COMMUNITY_TEST_ADMIN_KEY;
assert.equal(getBuildKeyInfo(adminKey || '').role, 'service_role', 'A server-only admin key is required');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: communityFunctionFetch(config,(url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) })) } };
const admin = createClient(config.url, adminKey, options);
const anon = createClient(config.url, config.key, options);
const tokens=new Map();
const rpc=(client,name,params={})=>requestCommunityRpc(config,client,name,params,tokens.get(client));
async function photos(client,posts) {
  const result=await client.functions.invoke('meet-photos',{body:{action:'list',posts}});
  return {data:result.data?.photos,error:result.error};
}
const run = randomUUID();
const users = [];
const secrets = [adminKey];
let browser;
let stage = 'initialize';
let postId;
let baselineCount;
let photoRows = [];
function checked(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'request failed'}`);
  return result.data;
}
async function fixture(label, next) {
  const email = `community-${run}-${label}@example.test`;
  const link = checked(await admin.auth.admin.generateLink({
    type: 'magiclink', email,
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, data: { community_test_run: run } },
  }), 'generate test login');
  users.push(link.user.id);
  secrets.push(link.properties.action_link);
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  await page.goto(link.properties.action_link);
  await page.waitForURL(`${origin}${next}`);
  assert.equal(new URL(page.url()).hash, '', 'Auth fragment must not remain in browser history');
  assert.equal(await page.locator('script[src*="googletagmanager"]').count(), 0);
  const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), communityStorageKey(config.url));
  assert.equal(session.user.id, link.user.id);
  assert.ok(session.user.email_confirmed_at);
  secrets.push(session.access_token, session.refresh_token);
  const client = createClient(config.url, config.key, { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${session.access_token}` } } });
  tokens.set(client,session.access_token);
  return { context, page, client, id: link.user.id };
}
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  baselineCount = checked(await rpc(anon,'meet_post_count'), 'baseline count');
  stage = 'real link callback and verified owner session';
  const owner = await fixture('owner', '/meet/new');
  await owner.page.locator('#post-form').waitFor({ state: 'visible' });
  await owner.page.getByLabel('昵称', { exact: true }).fill('自动化测试账号');
  await owner.page.getByLabel('年龄', { exact: true }).fill('28');
  await owner.page.getByLabel('性别', { exact: true }).selectOption('女');
  await owner.page.getByLabel('城市', { exact: true }).fill('杭州');
  await owner.page.getByLabel('标题', { exact: true }).fill('临时联调测试帖，稍后自动删除');
  await owner.page.getByLabel('关于我', { exact: true }).fill('这是一条自动化联调测试资料，用于验证发布、审核、隐私权限和撤回流程，不代表真实用户。');
  await owner.page.getByLabel('联系方式（选填）', { exact: true }).fill('test-contact-not-a-real-person');
  await owner.page.locator('[name=consent]').check();
  await owner.page.locator('[name=share_contact]').check();
  stage = 'real image upload and private storage';
  const png = await owner.page.evaluate(() => {
    const canvas=document.createElement('canvas'); canvas.width=1000; canvas.height=1400;
    const context=canvas.getContext('2d'); context.fillStyle='#a83226'; context.fillRect(0,0,1000,1400);
    context.fillStyle='#efe9df'; context.fillRect(100,100,800,1200); context.fillStyle='#283f44'; context.fillRect(180,180,640,400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await owner.page.locator('#photo-files').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await owner.page.getByText('照片已上传，提交后与资料一起审核。',{exact:true}).waitFor({timeout:120000});
  await owner.page.locator('#photo-files').setInputFiles({name:'fixture-2.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await owner.page.waitForFunction(()=>document.querySelectorAll('.photo-editor-item').length===2 && !document.querySelector('.photo-progress'),{},{timeout:120000});
  await owner.page.locator('.photo-editor-item').nth(1).getByRole('button',{name:'向前移动',exact:true}).click();
  photoRows = checked(await admin.from('meet_photos').select('id,owner_id,width,height,bytes').eq('owner_id',owner.id).order('created_at'), 'uploaded photo');
  assert.equal(photoRows.length,2);
  assert.ok(photoRows[0].bytes<1024*1024);
  const imagePath=`${owner.id}/${photoRows[0].id}/photo.jpg`;
  assert.ok((await anon.storage.from('meet-photos').download(imagePath)).error);
  assert.ok((await owner.client.storage.from('meet-photos').createSignedUrl(imagePath,86400)).error,'Clients cannot mint arbitrary long-lived URLs');
  const invalid = new FormData(); invalid.set('file',new Blob(['not an image'],{type:'image/jpeg'}),'invalid.jpg');
  assert.ok((await owner.client.functions.invoke('meet-photos',{body:invalid})).error,'Forged JPEG must be rejected by the server');
  for (const field of ['city', 'age', 'gender']) assert.ok(await owner.page.locator(`[name=${field}]`).getAttribute('required') !== null);
  stage = 'real form submission';
  await owner.page.getByRole('button', { name: '提交审核' }).click();
  await owner.page.waitForURL(`${origin}/account?submitted=1`);
  await owner.page.getByText('待审核', { exact: true }).waitFor();
  const row = checked(await owner.client.from('meet_posts').select('id,status').eq('owner_id', owner.id).single(), 'owner post');
  postId = row.id;
  const ordered=checked(await photos(owner.client,[postId]),'photo order');
  assert.equal(ordered[0].id,photoRows[1].id,'Uploaded photo order must persist');
  assert.equal(row.status, 'pending');
  assert.deepEqual(checked(await rpc(anon,'get_meet_post', { p_id: postId }), 'pending visibility'), []);
  assert.equal((await rpc(anon,'get_meet_contact', { p_id: postId })).error?.code, '42501');
  assert.equal((await owner.client.from('meet_posts').update({ status: 'published' }).eq('id', postId)).error?.code, '42501');
  stage = 'second user isolation';
  const reader = await fixture('reader', '/account');
  assert.deepEqual(checked(await reader.client.from('meet_posts').select('*').eq('id', postId), 'reader raw posts'), []);
  assert.deepEqual(checked(await reader.client.from('meet_contacts').select('*').eq('post_id', postId), 'reader raw contacts'), []);
  assert.equal(checked(await rpc(reader.client,'get_meet_contact', { p_id: postId }), 'pending contact'), null);
  assert.deepEqual(checked(await photos(reader.client,[postId]),'pending photos'),[]);
  stage = 'moderation and public display';
  checked(await admin.from('meet_posts').update({ status: 'published' }).eq('id', postId).eq('owner_id', owner.id), 'test moderation');
  const published = checked(await rpc(anon,'get_meet_post', { p_id: postId }), 'public detail');
  assert.equal(published[0].city, '杭州');
  assert.equal(published[0].age, 28);
  assert.equal(published[0].gender, '女');
  assert.equal(published[0].photo_count, 2);
  assert.equal(Object.hasOwn(published[0], 'owner_id'), false);
  assert.equal(Object.hasOwn(published[0], 'contact'), false);
  await reader.page.goto(`${origin}/meet/post?id=${postId}`);
  await reader.page.getByRole('heading', { name: '临时联调测试帖，稍后自动删除' }).waitFor();
  await reader.page.getByRole('button', { name: '查看联系方式' }).click();
  await reader.page.getByText('test-contact-not-a-real-person').waitFor();
  await reader.page.locator('#post-photos img').first().waitFor();
  await reader.page.waitForFunction(()=>document.querySelector('#post-photos img')?.naturalWidth>0);
  await reader.page.getByRole('button',{name:'查看第 1 张照片',exact:true}).click();
  await reader.page.locator('.lightbox[open]').waitFor();
  await reader.page.waitForFunction(()=>document.querySelector('.lightbox-img')?.naturalWidth>0);
  await reader.page.getByRole('button',{name:'关闭照片',exact:true}).click();
  await reader.page.screenshot({ path: join(tmpdir(), 'community-live-detail.png'), fullPage: true });
  stage = 'edit prefill and withdrawal';
  // The editor now reads the saved timestamp to display its cooldown on entry.
  checked(await admin.from('meet_posts').update({updated_at:new Date(Date.now()-61000).toISOString()}).eq('id',postId).eq('owner_id',owner.id),'reset fixture cooldown');
  await owner.page.getByRole('link', { name: '编辑资料' }).click();
  await owner.page.locator('#post-form').waitFor({ state: 'visible' });
  assert.equal(await owner.page.getByLabel('城市', { exact: true }).inputValue(), '杭州');
  assert.equal(await owner.page.getByLabel('联系方式（选填）', { exact: true }).inputValue(), 'test-contact-not-a-real-person');
  assert.equal(await owner.page.locator('.photo-editor-item').count(),2);
  stage='photo removal and re-review';
  await owner.page.locator('.photo-editor-item').nth(1).getByRole('button',{name:'移除照片',exact:true}).click();
  await owner.page.locator('[name=consent]').check();
  await owner.page.getByRole('button',{name:'提交审核',exact:true}).click();
  await owner.page.waitForURL(`${origin}/account?submitted=1`);
  await owner.page.getByText('待审核',{exact:true}).waitFor();
  assert.deepEqual(checked(await photos(reader.client,[postId]),'edited photos hidden'),[]);
  assert.equal(checked(await admin.from('meet_photos').select('id').eq('post_id',postId),'remaining photo').length,1);
  checked(await admin.from('meet_posts').update({status:'published'}).eq('id',postId).eq('owner_id',owner.id),'review changed photo');
  await owner.page.goto(`${origin}/account`);
  await owner.page.getByText('已发布', { exact: true }).waitFor();
  owner.page.once('dialog', dialog => dialog.accept());
  await owner.page.getByRole('button', { name: '撤回帖子' }).click();
  await owner.page.getByText('已撤回', { exact: true }).waitFor();
  assert.deepEqual(checked(await rpc(anon,'get_meet_post', { p_id: postId }), 'withdrawn visibility'), []);
  assert.equal(checked(await rpc(reader.client,'get_meet_contact', { p_id: postId }), 'withdrawn contact'), null);
  assert.deepEqual(checked(await photos(reader.client,[postId]),'withdrawn photos'),[]);
  await owner.page.getByRole('button', { name: '退出登录' }).click();
  await owner.page.waitForURL(`${origin}/meet`);
  await owner.page.locator('#post-total').getByText(String(baselineCount),{exact:true}).waitFor();
  stage = 'real empty feed and mobile layout';
  await owner.page.screenshot({ path: join(tmpdir(), 'community-live-feed.png'), fullPage: true });
  if (process.env.COMMUNITY_TEST_HOMEPAGE === 'true') {
    stage = 'real homepage navigation';
    for (const selector of ['nav a[href="/"]', '.masthead .logo']) {
      const response = owner.page.waitForResponse(r => r.request().isNavigationRequest() && r.url() === `${origin}/`, { timeout: 180000 });
      await owner.page.locator(selector).click({ noWaitAfter: true });
      assert.equal((await response).status(), 200);
      await owner.page.getByRole('heading', { name: '向上研究所 · 每天来一点 Amazing', exact: true }).waitFor();
      assert.ok(await owner.page.locator('#article-list a.article').count());
      await owner.page.getByRole('link', { name: '相亲贴', exact: true }).click();
      await owner.page.locator('#post-total').getByText(String(baselineCount),{exact:true}).waitFor();
    }
  }
  for (const width of [375, 320]) {
    await owner.page.setViewportSize({ width, height: 812 });
    for (const path of ['/meet', '/login']) {
      await owner.page.goto(origin + path);
      const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `No horizontal overflow at ${width}`);
    }
  }
  await owner.page.screenshot({ path: join(tmpdir(), 'community-live-login-mobile.png'), fullPage: true });
  console.log(JSON.stringify({ result: 'PASS', smtpDeliveryTested: false, checks: ['real magic-link callbacks', 'two verified sessions', 'required city/age/gender', 'real photo upload and thumbnail', 'multi-photo reorder', 'forged image rejection', 'private storage and bounded signing', 'real form submission', 'pending moderation', 'cross-user RLS', 'private contact', 'public field isolation', 'full-image viewer', 'photo removal and re-review', 'withdrawal', 'signout', 'mobile layouts'] }));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({path:join(tmpdir(),'community-live-failure.png'),fullPage:true}).catch(()=>{});
    const notice=await page.locator('#community-message').textContent().catch(()=>null);
    if(notice) console.error(`Page notice: ${notice}`);
  }
  let message = String(error.message);
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted]');
  console.error(`Live check failed at ${stage}: ${message}`);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { process.exitCode = 1; }
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) { console.error(`Fixture cleanup failed for user ${id}`); process.exitCode = 1; }
  }
  for (const row of photoRows) {
    if(process.env.COMMUNITY_TEST_SCHEDULED_CLEANUP==='true') continue;
    const paths=[`${row.owner_id}/${row.id}/photo.jpg`,`${row.owner_id}/${row.id}/thumb.jpg`];
    const removed=await admin.storage.from('meet-photos').remove(paths);
    if (removed.error) {console.error('Fixture photo cleanup failed');process.exitCode=1;}
    else await admin.from('meet_photo_deletions').delete().eq('id',row.id).eq('owner_id',row.owner_id);
  }
  if (postId) {
    const remaining = await admin.from('meet_posts').select('id').eq('id', postId);
    const contacts = await admin.from('meet_contacts').select('post_id').eq('post_id', postId);
    if (remaining.error || contacts.error || remaining.data.length || contacts.data.length) {
      console.error('Fixture cascade cleanup failed'); process.exitCode = 1;
    } else console.log('Temporary users, posts and contacts removed.');
  }
}

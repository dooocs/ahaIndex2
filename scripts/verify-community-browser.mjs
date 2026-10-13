import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const origin = process.env.COMMUNITY_TEST_URL || 'http://127.0.0.1:4328';
const checkHomepage = process.env.COMMUNITY_TEST_HOMEPAGE === 'true';
const supabaseOrigin = process.env.PUBLIC_COMMUNITY_SUPABASE_URL || 'https://community-preview.supabase.co';
const screenshot = name => join(tmpdir(), `community-${name}.png`);
for (let attempt = 0; ; attempt++) {
  try { if ((await fetch(`${origin}/login`)).ok) break; } catch {}
  if (attempt >= 30) throw new Error('Start the community test dev server first (docs/community-mvp.md).');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'mvp@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString() };
const token = `${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test-signature`;
let ownPost = null;
let contact = null;
let rateLimitNextPost = false;
let publicContactFor18 = false;
let legacyBackendOnce = true; // first submit hits a backend without migration 010
let legacyRetrySeen = false;
let published = [{ id: 18, nickname: '周末散步的人', age: 29, gender: '女', city: '杭州', occupation: '产品设计', title: '想找一个一起逛书店的人', about: '工作日认真工作，周末喜欢散步、看展和逛书店。比起热闹的聚会，更喜欢两个人慢慢聊天。', looking_for: '真诚、独立，有自己的兴趣，也愿意分享日常。', created_at: new Date().toISOString(), expires_at: new Date(Date.now()+86400000).toISOString() }];
const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
let testPage;
const errors = [], apiCalls = [], requestFailures = [];
let loginNavigations = 0;
try {
 const context = await browser.newContext({viewport:{width:1365,height:900}});
 const page = await context.newPage();
 await page.clock.install({time:new Date()});
 testPage = page;
 page.on('pageerror', e => errors.push(e.message));
 page.on('request', request => { if(request.isNavigationRequest() && new URL(request.url()).pathname==='/login') loginNavigations++; });
 page.on('requestfailed', request => requestFailures.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
 await context.route(`${supabaseOrigin}/**`, async route => {
   const url = new URL(route.request().url());
   const body = route.request().headers()['content-type']?.includes('application/json') ? route.request().postDataJSON() : undefined;
   apiCalls.push(url.pathname);
   const ok = data => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   if (url.pathname.endsWith('/otp')) {
     assert.equal(body.create_user,true);
     const redirect = new URL(url.searchParams.get('redirect_to'));
     assert.equal(redirect.origin, origin);
     assert.equal(redirect.pathname, '/auth/callback');
     assert.equal(redirect.searchParams.get('next'), '/meet/new');
     return ok({});
   }
   if (url.pathname.endsWith('/user')) return ok(user);
   if (url.pathname.endsWith('/logout')) return route.fulfill({status:204});
   if (url.pathname.endsWith('/functions/v1/meet-photos')) return ok({photos:[]});
   if (url.pathname.endsWith('/rpc/meet_post_count')) return ok(published.length);
   if (url.pathname.endsWith('/rpc/list_meet_posts')) {
     assert.ok(!Object.hasOwn(body,'p_city'));
     return ok(published.filter(p => !body.p_before || p.id<body.p_before).map(p=>({...p,photo_count:1})));
   }
   if (url.pathname.endsWith('/rpc/get_meet_post')) return ok([...published,...(ownPost ? [ownPost] : [])].filter(p=>p.id===body.p_id));
   if (url.pathname.endsWith('/rpc/get_public_meet_contact')) return ok(publicContactFor18 && body.p_id===18 ? 'wechat-public-test' : null);
   if (url.pathname.endsWith('/rpc/get_meet_contact')) return ok(body.p_id===18 ? 'wechat-test-only' : contact?.contact);
   if (url.pathname.endsWith('/rpc/submit_meet_post')) {
     assert.equal(body.p_public_photos,true);
     if (legacyBackendOnce && Object.hasOwn(body,'p_public_contact')) {
       legacyBackendOnce=false;
       return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Could not find the function public.submit_meet_post'})});
     }
     if (!Object.hasOwn(body,'p_public_contact')) legacyRetrySeen=true;
     else assert.equal(body.p_public_contact,body.p_share_contact);
     if (rateLimitNextPost) {
       rateLimitNextPost=false;
       return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'Please wait 60 seconds'})});
     }
     ownPost={id:19,owner_id:user.id,status:'pending',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()};
     for (const [key,value] of Object.entries(body)) ownPost[key.replace(/^p_/,'')]=value;
     contact={contact:body.p_contact,share_contact:body.p_share_contact};
     return ok(19);
   }
   if (url.pathname.endsWith('/rpc/withdraw_meet_post')) {ownPost.status='withdrawn';return ok(null);}
   if (url.pathname.endsWith('/functions/v1/meet-public-photos')) return ok({photos:body.posts.includes(18)?[{id:'public-photo',post_id:18,sort_order:0,width:16,height:16,url:`${supabaseOrigin}/storage/v1/object/sign/meet-photos/fixture/${body.full?'photo':'thumb'}.jpg?token=fixture`}]:[]});
   if (url.pathname.includes('/storage/v1/object/sign/meet-photos/')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')});
   if (url.pathname.includes('/storage/v1/object/meet-photos/')) return ok({Key:url.pathname});
   if (url.pathname.endsWith('/meet_photos')) {
     if (route.request().method()==='PATCH') return ok({id:url.searchParams.get('id')?.replace('eq.',''),post_id:null,sort_order:0,width:1600,height:1600});
     return ok([]);
   }
   if (url.pathname.endsWith('/meet_posts')) return ok(ownPost ? [ownPost] : []);
   if (url.pathname.endsWith('/meet_contacts')) return ok(contact ? [contact] : []);
   throw new Error(`Unexpected API ${url.pathname}`);
 });
 await page.goto(origin+'/meet');
 await page.getByRole('link',{name:'想找一个一起逛书店的人'}).waitFor();
 await page.locator('[data-post-photo="18"] img').waitFor();
 assert.equal(await page.locator('.community-page').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
 await page.getByRole('link',{name:'想找一个一起逛书店的人'}).click();
 await page.getByRole('button',{name:'查看第 1 张照片',exact:true}).click();
 await page.getByRole('dialog',{name:'查看照片'}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'关闭照片',exact:true}).click();
 await page.getByRole('link',{name:'返回相亲广场',exact:true}).click();
 await page.getByRole('link',{name:'想找一个一起逛书店的人'}).waitFor();
 assert.equal(await page.locator('script[src*="googletagmanager"]').count(),0);
 if (checkHomepage) {
   for (const link of [page.getByRole('link',{name:'AI 日报',exact:true}),page.locator('.masthead .logo')]) {
     const response = page.waitForResponse(r => r.request().isNavigationRequest() && r.url() === `${origin}/`,{timeout:180000});
     await link.click({noWaitAfter:true});
     assert.equal((await response).status(),200,'Homepage must load with the news Supabase configuration');
     await page.getByRole('heading',{name:'蜗牛杂货站 · 让生活多一点 Amazing',exact:true}).waitFor();
     assert.ok(await page.locator('#article-list a.article').count(),'Homepage must contain real news articles');
     await page.getByRole('link',{name:'相亲贴',exact:true}).click();
     await page.getByRole('link',{name:'想找一个一起逛书店的人'}).waitFor();
     assert.equal(await page.locator('script[src*="googletagmanager"]').count(),0);
   }
 }
 await page.screenshot({path:screenshot('feed-desktop'),fullPage:true});
 assert.equal(await page.getByRole('button',{name:'筛选',exact:true}).count(),0);
 assert.equal(await page.getByLabel('城市',{exact:true}).count(),0);
 await page.locator('.post-meta').filter({hasText:'杭州 · 29 岁 · 女'}).waitFor();
 const savedPosts = published;
 published = [];
 await page.reload();
 await page.getByText('还没有相亲帖，来写下第一份自我介绍吧。').waitFor();
 published = savedPosts;
 await page.reload();
 await page.getByRole('link',{name:'想找一个一起逛书店的人'}).waitFor();
 await page.getByRole('link',{name:'发布相亲帖',exact:true}).filter({visible:true}).click();
 await page.waitForURL('**/login**');
 assert.equal(loginNavigations,1,'Clearing a missing session must redirect to login only once');
 await page.getByLabel('邮箱',{exact:true}).fill(user.email);
 await page.locator('[name=terms]').check();
 await page.getByRole('button',{name:'发送登录链接',exact:true}).click();
 await page.getByText(`登录链接已发送至 ${user.email}`).waitFor();
 assert.equal(await page.locator('#resend-link').isDisabled(),true);
 await page.goto(origin+'/auth/callback#error=access_denied&error_code=otp_expired&error_description=expired');
 await page.getByText('登录链接无效或已过期，请重新发送。').waitFor();
 assert.equal(new URL(page.url()).hash,'');
 await page.goto(origin+'/auth/callback?next=%2Fmeet%2Fnew%2F#'+new URLSearchParams({access_token:token,refresh_token:'test-refresh-token',expires_in:'3600',token_type:'bearer',type:'magiclink'}));
 await page.waitForURL('**/meet/new**');
 await page.locator('#post-form').waitFor({state:'visible'});
 const fixture = await page.evaluate(() => {
   const canvas=document.createElement('canvas'); canvas.width=16; canvas.height=16;
   canvas.getContext('2d').fillRect(0,0,16,16);
   return canvas.toDataURL('image/png').split(',')[1];
 });
 const fixtureFile={name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')};
 assert.equal(await page.locator('#photo-counter').textContent(),'0 / 6');
 await page.locator('#photo-files').setInputFiles(fixtureFile);
 await page.getByText('照片已上传，提交后与资料一起审核。',{exact:true}).waitFor();
 assert.equal(await page.locator('#photo-counter').textContent(),'1 / 6');
 assert.equal(apiCalls.filter(path=>path.includes('/storage/v1/object/meet-photos/')).length,2);
 assert.equal(apiCalls.filter(path=>path.endsWith('/functions/v1/meet-photos')).length,1,'Only initial photo list may use FC');
 await page.locator('#photo-files').setInputFiles(Array.from({length:6},()=>fixtureFile));
 await page.getByText('每则启事最多 6 张照片。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'移除照片'}).click();
 await page.waitForFunction(()=>document.querySelector('#photo-counter')?.textContent==='0 / 6');
 await page.getByLabel('昵称',{exact:true}).fill('测试发布者');
 await page.getByLabel('年龄',{exact:true}).fill('28');
 await page.getByLabel('城市',{exact:true}).fill('杭州');
 await page.getByLabel('性别',{exact:true}).selectOption('女');
 assert.ok(!(await page.locator('[name=gender] option').allTextContents()).includes('不公开'));
 await page.getByLabel('标题',{exact:true}).fill('<img src=x onerror=alert(1)> 普通文字');
 await page.getByLabel('关于我',{exact:true}).fill('我喜欢阅读、散步和认真生活，希望在这里认识志趣相投、真诚友善的人。');
 await page.getByLabel('联系方式（选填）',{exact:true}).fill('test-contact');
 await page.locator('[name=consent]').check();
 await page.getByRole('button',{name:'提交审核'}).click();
 await page.getByText('填写联系方式时，需要同意公开展示。').waitFor();
 await page.locator('[name=share_contact]').check();
 for (const name of ['city','age','gender']) {
   const input = page.locator(`[name=${name}]`);
   const saved = await input.inputValue();
   if (name === 'gender') await input.selectOption(''); else await input.fill('');
   assert.equal(await input.evaluate(element=>element.validity.valueMissing),true);
   await page.getByRole('button',{name:'提交审核'}).click();
   assert.equal(apiCalls.filter(path=>path.endsWith('/rpc/submit_meet_post')).length,0);
   if (name === 'gender') await input.selectOption(saved); else await input.fill(saved);
 }
 await page.screenshot({path:screenshot('editor-desktop'),fullPage:true});
 await page.getByRole('button',{name:'提交审核'}).click();
 await page.waitForURL('**/account**');
 await page.getByText('待审核',{exact:true}).waitFor();
 assert.equal(await page.locator('#my-post img').count(),0);
 await page.reload();
 await page.getByText('待审核',{exact:true}).waitFor();
 await page.getByRole('link',{name:'编辑资料'}).click();
 await page.locator('#post-form').waitFor({state:'visible'});
 assert.equal(await page.getByLabel('昵称',{exact:true}).inputValue(),'测试发布者');
 assert.equal(await page.getByLabel('联系方式（选填）',{exact:true}).inputValue(),'test-contact');
 const submitPost = page.locator('#post-form button[type=submit]');
 assert.equal(await submitPost.isDisabled(),true,'Editing immediately after saving must show the post cooldown');
 await page.reload();
 await page.locator('#post-form').waitFor({state:'visible'});
 assert.equal(await submitPost.isDisabled(),true,'Reload must restore cooldown from the saved post timestamp');
 await page.getByLabel('昵称',{exact:true}).fill('等待期间修改的昵称');
 await page.locator('[name=consent]').check();
 await page.locator('#post-form').evaluate(form=>form.requestSubmit());
 assert.equal(apiCalls.filter(path=>path.endsWith('/rpc/submit_meet_post')).length,2); // first submit + its retry without p_public_contact
 await page.clock.fastForward(61000);
 await page.waitForFunction(()=>!document.querySelector('#post-form button[type=submit]').disabled);
 rateLimitNextPost=true;
 await submitPost.click();
 await page.getByText('帖子提交间隔需满一分钟，请稍后再试。',{exact:true}).waitFor();
 assert.equal(await submitPost.isDisabled(),true);
 assert.equal(await page.getByLabel('昵称',{exact:true}).inputValue(),'等待期间修改的昵称');
 await page.screenshot({path:screenshot('editor-cooldown'),fullPage:true});
 await page.clock.fastForward(61000);
 await page.waitForFunction(()=>!document.querySelector('#post-form button[type=submit]').disabled);
 await submitPost.click();
 await page.waitForURL('**/account**');
 assert.equal(ownPost.nickname,'等待期间修改的昵称');
 await page.goto(origin+'/meet/post?id=18');
 await page.getByRole('heading',{name:'想找一个一起逛书店的人'}).waitFor();
 assert.equal(await page.getByText('wechat-test-only').count(),0);
 await page.getByRole('button',{name:'查看联系方式'}).click();
 await page.getByText('wechat-test-only').waitFor();
 await page.goto(origin+'/account');
 await page.getByText('待审核',{exact:true}).waitFor();
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'撤回帖子'}).click();
 await page.getByText('已撤回',{exact:true}).waitFor();
 const contactTab = await context.newPage();
 await contactTab.goto(origin+'/meet/post?id=18');
 await contactTab.getByRole('button',{name:'查看联系方式'}).click();
 await contactTab.getByText('wechat-test-only').waitFor();
 await page.getByRole('button',{name:'退出登录'}).click();
 await page.waitForURL('**/meet**');
 await contactTab.getByText('wechat-test-only').waitFor({state:'hidden'});
 await contactTab.close();
 await page.goto(origin+'/meet/post?id=18');
 await page.getByRole('button',{name:'查看联系方式'}).click();
 await page.waitForURL('**/login**');
 // A post submitted under the public-contact terms shows its contact to signed-out visitors.
 publicContactFor18 = true;
 await page.goto(origin+'/meet/post?id=18');
 await page.getByText('wechat-public-test').waitFor();
 assert.equal(await page.getByRole('button',{name:'查看联系方式'}).isVisible(),false);
 publicContactFor18 = false;
 assert.ok(legacyRetrySeen,'Submission did not retry without p_public_contact');
 for(const width of [375,320]) {
   await page.setViewportSize({width,height:812});
   for(const path of ['/login','/meet','/meet/post?id=18']) {
     await page.goto(origin+path);
     if(path==='/meet') await page.getByRole('link',{name:'想找一个一起逛书店的人'}).waitFor();
     const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
     assert.ok(sizes.scroll<=sizes.width,`${path} overflow at ${width}: ${sizes.scroll}`);
     if(width===375) await page.screenshot({path:screenshot(`${path.startsWith('/login')?'login':path.includes('post')?'detail':'feed'}-mobile`),fullPage:true});
   }
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',checks:[...(checkHomepage ? ['homepage navigation via daily tab and logo'] : []),'email link error/success','callback fragment cleanup','return path','no city filter/empty state','required city/age/gender','submit consent','post persistence','edit prefill','post cooldown on load and reload','server cooldown and form preservation','XSS rendering','legacy contact login','public contact without login','submit retry on pre-010 backend','withdraw','sign out across tabs','no analytics','320px/375px/1365px layout'],apiCalls:apiCalls.length}));
} catch(error) {
 if(testPage) {
   await testPage.screenshot({path:screenshot('mock-failure'),fullPage:true});
   console.error('Page message:',await testPage.locator('#community-message').textContent().catch(()=>null));
   console.error('Browser diagnostics:',JSON.stringify({errors,apiCalls,requestFailures}));
 }
 throw error;
} finally { await browser.close(); }

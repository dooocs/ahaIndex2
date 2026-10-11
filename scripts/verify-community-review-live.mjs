import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { getBuildKeyInfo } from '../src/lib/supabase-key.ts';
import { communityProjectTarget } from './community-project-target.mjs';
import { localPreviewOrigin } from './community-login-test-network.mjs';
import { requestCommunityRpc, communityFunctionFetch } from '../src/lib/community-transport.ts';

assert.equal(process.env.COMMUNITY_LIVE_TEST, 'true', 'Explicit live-test opt-in required');
const url = process.env.PUBLIC_COMMUNITY_SUPABASE_URL;
const publishable = process.env.PUBLIC_COMMUNITY_SUPABASE_KEY;
communityProjectTarget(url, process.env.COMMUNITY_TEST_PROJECT_REF);
const link = (await readFile('.local/community-review-link.txt','utf8')).trim();
const origin = localPreviewOrigin(new URL(link).origin);
const key = new URLSearchParams(new URL(link).hash.slice(1)).get('key');
const secret = process.env.COMMUNITY_TEST_ADMIN_KEY;
assert.equal(getBuildKeyInfo(secret || '').role, 'service_role', 'A server-only admin key is required');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,secret,options), anon=createClient(url,publishable,options);
const publicRpc=(name,params)=>requestCommunityRpc({url,key:publishable},anon,name,params);
const reviewFetch=communityFunctionFetch({url});
const checked=(result,label)=>{if(result.error) throw new Error(`${label}: ${result.error.code||'failed'}`);return result.data;};
const api=async(input,session='',requestOrigin=origin)=>{
  const response=await reviewFetch(`${url}/functions/v1/meet-review`,{method:'POST',headers:{'Content-Type':'application/json',apikey:publishable,Origin:requestOrigin,...(session?{Authorization:`Bearer ${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
  return {status:response.status,data:await response.json()};
};
let userId,postId,browser;
try {
  assert.equal((await api({action:'list',status:'pending'})).status,401);
  assert.equal((await api({action:'exchange',key:'0'.repeat(64)})).status,401);
  assert.equal((await api({action:'exchange',key},'','https://example.invalid')).status,403);
  const auth=await api({action:'exchange',key});assert.equal(auth.status,200);
  const session=auth.data.session;
  assert.equal((await api({action:'list',status:'pending'},session+'x')).status,401);
  const list=await api({action:'list',status:'pending'},session);assert.equal(list.status,200);
  assert.ok((await anon.rpc('get_meet_review_post',{p_id:1})).error,'public cannot call review RPC');
  assert.ok((await anon.from('meet_review_events').select('*')).error,'public cannot read audit events');
  userId=checked(await admin.auth.admin.createUser({email:`review-${randomUUID()}@example.test`,email_confirm:true}),'create fixture').user.id;
  postId=checked(await admin.from('meet_posts').insert({owner_id:userId,nickname:'Review test',age:28,gender:'女',city:'杭州',title:'Temporary review integration fixture',about:'This is a temporary isolated review integration test.',consent_version:'test'}).select('id').single(),'fixture post').id;
  const detail=await api({action:'detail',id:postId},session);assert.equal(detail.status,200);
  checked(await admin.from('meet_posts').update({about:'Changed during review; this new text must be reviewed.'}).eq('id',postId),'concurrent edit');
  assert.equal((await api({action:'review',id:postId,version:detail.data.version,status:'published',reason:''},session)).status,409);
  const fresh=await api({action:'detail',id:postId},session);
  assert.equal((await api({action:'review',id:postId,version:fresh.data.version,status:'rejected',reason:''},session)).status,400);
  assert.equal((await api({action:'review',id:postId,version:fresh.data.version,status:'rejected',reason:'Test rejection'},session)).status,200);
  assert.equal(checked(await admin.from('meet_posts').select('review_reason').eq('id',postId).single(),'feedback').review_reason,'Test rejection');
  checked(await admin.from('meet_posts').update({status:'pending'}).eq('id',postId),'fixture resubmission');
  const pending=await api({action:'detail',id:postId},session);
  assert.equal(pending.data.post.review_reason,'');
  assert.equal((await api({action:'review',id:postId,version:pending.data.version,status:'published',reason:''},session)).status,200);
  assert.equal(checked(await publicRpc('get_meet_post',{p_id:postId}),'published post').length,1);
  const published=await api({action:'detail',id:postId},session);
  assert.equal((await api({action:'review',id:postId,version:published.data.version,status:'withdrawn',reason:'Test withdrawal'},session)).status,200);
  assert.equal(checked(await publicRpc('get_meet_post',{p_id:postId}),'withdrawn post').length,0);
  const withdrawn=await api({action:'detail',id:postId},session);
  assert.equal((await api({action:'review',id:postId,version:withdrawn.data.version,status:'published',reason:''},session)).status,400);
  assert.equal(checked(await admin.from('meet_review_events').select('id').eq('post_id',postId),'audit').length,3);

  checked(await admin.from('meet_posts').update({status:'pending'}).eq('id',postId),'isolated browser review fixture');
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const page=await browser.newPage();
  await page.goto(link);
  await page.getByText('审核权限已验证',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash,'');
  if(postId) {
    const id=postId;
    await page.locator(`.review-row[data-id="${id}"]`).click();
    await page.locator('#review-detail h2').waitFor();
    const actual=await api({action:'detail',id},session);
    assert.equal(actual.status,200);
    if(actual.data.photos.length) await page.waitForFunction(()=>[...document.querySelectorAll('.photo-button img')].length>0&&[...document.querySelectorAll('.photo-button img')].every(img=>img.naturalWidth>0));
  }
  await page.getByRole('button',{name:'退出审核'}).click();
  await page.getByText('已退出审核。',{exact:true}).waitFor();
  console.log(JSON.stringify({result:'PASS',checks:['real key exchange','no-key/tampered-key/origin rejection','public RPC/audit denied','stale snapshot rejected','rejection reason','resubmission','publish and withdraw','audit events','real browser auth and isolated fixture detail'],existingPostsModified:false,privatePhotoLoadingTested:false}));
} finally {
  if(browser) await browser.close();
  if(postId) checked(await admin.from('meet_review_events').delete().eq('post_id',postId),'fixture audit cleanup');
  if(userId) checked(await admin.auth.admin.deleteUser(userId),'fixture account cleanup');
}

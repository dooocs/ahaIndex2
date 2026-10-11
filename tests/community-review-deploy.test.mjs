import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDeployCommand, verifyReviewDeployment } from '../scripts/community-review-deploy.mjs';

const aliyun={PUBLIC_COMMUNITY_SUPABASE_URL:'https://spb-example123.supabase.opentrust.net',COMMUNITY_PROJECT_REF:'spb-example123'};
const legacy=role=>[{alg:'HS256',typ:'JWT'},{role}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.testSignature';
test('official cloud keeps the existing project-scoped secrets command',()=>{
  const ref='abcdefghijklmnopqrst';
  const result=reviewDeployCommand({PUBLIC_COMMUNITY_SUPABASE_URL:`https://${ref}.supabase.co`,COMMUNITY_PROJECT_REF:ref});
  assert.ok(result.args.includes('--project-ref'));
  assert.ok(result.args.includes(ref));
});
test('successful key setup requires an actual session exchange and authenticated database listing',async()=>{
  const env={...aliyun,PUBLIC_COMMUNITY_SUPABASE_KEY:'sb_publishable_test'};
  const session=`review-v1.${Math.floor(Date.now()/1000)+3600}.11111111-1111-4111-8111-111111111111.${'b'.repeat(64)}`;
  const calls=[];
  await verifyReviewDeployment(env,'http://127.0.0.1:4328','a'.repeat(64),async(url,options)=>{
    assert.equal(url,`${aliyun.PUBLIC_COMMUNITY_SUPABASE_URL}/functions/v1/meet-review`);
    const body=JSON.parse(options.body); calls.push(body.action);
    if(body.action==='exchange') return Response.json({session,expiresAt:Date.now()+3600000});
    assert.equal(options.headers.get('authorization'),`Bearer ${session}`);
    assert.equal(options.headers.get('x-community-authorization'),`Bearer ${session}`);
    return Response.json({posts:[],more:false});
  });
  assert.deepEqual(calls,['exchange','list']);
});
test('a green CLI or health response does not substitute for working review access',async()=>{
  const env={...aliyun,PUBLIC_COMMUNITY_SUPABASE_KEY:'sb_publishable_test'};
  await assert.rejects(verifyReviewDeployment(env,'http://127.0.0.1:4328','a'.repeat(64),async()=>Response.json({error:'not_ready'},{status:503})),/HTTP 503/);
  await assert.rejects(verifyReviewDeployment(env,'http://127.0.0.1:4328','a'.repeat(64),async()=>Response.json({status:'ok'})),/session/);
});
test('Aliyun refuses the misleading general CLI and browser keys',()=>{
  assert.throws(()=>reviewDeployCommand({...aliyun,SUPABASE_CLI:'/tmp/general-cli'}),/standalone/);
  for(const key of [undefined,'sb_publishable_test',legacy('anon')]) {
    assert.throws(()=>reviewDeployCommand({...aliyun,ALIYUN_FUNCTIONS_CLI:'/tmp/functions-cli',COMMUNITY_SERVICE_ROLE_KEY:key}),/trusted server/);
  }
});
test('Aliyun deploy uses the validated origin and server-only credentials',()=>{
  const key=legacy('service_role');
  const result=reviewDeployCommand({...aliyun,ALIYUN_FUNCTIONS_CLI:'/tmp/functions-cli',COMMUNITY_SERVICE_ROLE_KEY:key,SUPABASE_API_URL:'https://wrong.example',HTTPS_PROXY:'http://proxy.example'});
  assert.deepEqual(result.args,['secrets','set','--env-file','/dev/stdin']);
  assert.equal(result.env.SUPABASE_API_URL,aliyun.PUBLIC_COMMUNITY_SUPABASE_URL);
  assert.equal(result.env.SUPABASE_API_KEY,key);
  assert.equal(result.env.HTTPS_PROXY,undefined);
});
test('wrong or missing project refs fail before passing credentials to a CLI',()=>{
  assert.throws(()=>reviewDeployCommand({...aliyun,COMMUNITY_PROJECT_REF:undefined}));
  assert.throws(()=>reviewDeployCommand({...aliyun,PUBLIC_COMMUNITY_SUPABASE_URL:'https://wrong.example'}));
});

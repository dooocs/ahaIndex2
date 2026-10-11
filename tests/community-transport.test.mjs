import assert from 'node:assert/strict';
import test from 'node:test';
import { requestCommunityRpc, communityFunctionFetch } from '../src/lib/community-transport.ts';

const config={url:'https://spb-example.supabase.opentrust.net',key:'public-anon-key'};
const noRpc={rpc:()=>assert.fail('Browser roles cannot call Aliyun business RPCs directly')};
test('Aliyun anonymous feed and count use the public Edge gateway',async()=>{
  for(const [action,data] of [['list_meet_posts',[]],['meet_post_count',0]]) {
    const result=await requestCommunityRpc(config,noRpc,action,{},undefined,async(url,options)=>{
      assert.equal(url,`${config.url}/functions/v1/meet-api`);
      assert.equal(options.headers.get('authorization'),'Bearer public-anon-key');
      assert.equal(options.headers.get('x-community-authorization'),'Bearer public-anon-key');
      assert.deepEqual(JSON.parse(options.body),{action,params:{}});
      return Response.json({data});
    });
    assert.deepEqual(result,{data,error:null});
  }
});
test('verified session tokens are forwarded without accepting an actor ID from the caller',async()=>{
  const result=await requestCommunityRpc(config,noRpc,'submit_meet_post',{p_city:'杭州'},'user-session-token',async(url,options)=>{
    assert.equal(url,`${config.url}/functions/v1/meet-api`);
    assert.equal(options.headers.get('apikey'),config.key);
    assert.equal(options.headers.get('authorization'),'Bearer user-session-token');
    assert.equal(options.headers.get('x-community-authorization'),'Bearer user-session-token');
    assert.deepEqual(JSON.parse(options.body),{action:'submit_meet_post',params:{p_city:'杭州'}});
    return Response.json({data:123});
  });
  assert.equal(result.data,123);
});
test('cooldown, login errors and null contacts retain their existing response semantics',async()=>{
  const error={code:'P0001',message:'Please wait 60 seconds'};
  assert.deepEqual(await requestCommunityRpc(config,noRpc,'submit_meet_post',{},undefined,async()=>Response.json({error},{status:429})),{data:null,error});
  const login={code:'42501',message:'Verified email required'};
  assert.deepEqual(await requestCommunityRpc(config,noRpc,'get_meet_contact',{},undefined,async()=>Response.json({error:login},{status:401})),{data:null,error:login});
  assert.deepEqual(await requestCommunityRpc(config,noRpc,'get_meet_contact',{},undefined,async()=>Response.json({data:null})),{data:null,error:null});
  await assert.rejects(requestCommunityRpc(config,noRpc,'get_meet_post',{},undefined,async()=>Response.json({status:'ok'})),/Invalid community response/);
});
test('official Supabase Cloud keeps its existing authenticated SDK RPC transport',async()=>{
  const official={url:'https://community.supabase.co',key:'public-key'};
  const expected={data:[],error:null};
  const result=await requestCommunityRpc(official,{rpc:async(name,params)=>{
    assert.equal(name,'list_meet_posts'); assert.deepEqual(params,{p_limit:1}); return expected;
  }},'list_meet_posts',{p_limit:1},undefined,async()=>assert.fail('Unexpected Edge gateway'));
  assert.deepEqual(result,expected);
});

test('SDK photo requests preserve credentials only at the owned Aliyun function gateway',async()=>{
  const original=new Headers({Authorization:'Bearer user-token',apikey:'public-key'});
  const wrapped=communityFunctionFetch(config,async(_input,options)=>{
    assert.equal(options.headers.get('x-community-authorization'),'Bearer user-token');
    assert.equal(options.headers.get('apikey'),'public-key');
    assert.equal(options.redirect,'error');
    return Response.json({photos:[]});
  });
  await wrapped(new Request(`${config.url}/functions/v1/meet-photos`,{headers:original}));
  assert.equal(original.has('x-community-authorization'),false);
  for(const url of [`${config.url}/auth/v1/user`,`${config.url}/rest/v1/meet_posts`,'https://other.example/functions/v1/test']) {
    const fetcher=communityFunctionFetch(config,async(_input,options)=>{
      assert.equal(options.headers,original);
      assert.equal(options.headers.has('x-community-authorization'),false);
      return Response.json({});
    });
    await fetcher(url,{headers:original});
  }
});

test('standard cloud requests and anonymous requests never invent credentials',async()=>{
  const fetcher=async(_input,options)=>{
    assert.equal(new Headers(options?.headers).has('x-community-authorization'),false);
    return Response.json({});
  };
  assert.equal(communityFunctionFetch({url:'https://community.supabase.co'},fetcher),fetcher);
  await communityFunctionFetch(config,fetcher)(`${config.url}/functions/v1/meet-api`);
});

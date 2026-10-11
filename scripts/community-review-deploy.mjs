import { communityProjectTarget } from './community-project-target.mjs';
import { getBuildKeyInfo } from '../src/lib/supabase-key.ts';
import { isCommunityPublicKey } from '../src/lib/community-model.ts';
import { communityFunctionFetch } from '../src/lib/community-transport.ts';

export function reviewDeployCommand(input) {
  const target=communityProjectTarget(input.PUBLIC_COMMUNITY_SUPABASE_URL,input.COMMUNITY_PROJECT_REF);
  const env={...input};
  for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete env[name];
  if (!target.aliyun) return {
    cli:input.SUPABASE_CLI || '/opt/homebrew/bin/supabase',env,
    args:['secrets','set','--project-ref',target.projectRef,'--env-file','/dev/stdin','--agent','no'],
  };
  if (!input.ALIYUN_FUNCTIONS_CLI) throw new Error('Aliyun review secrets require the official standalone functions-cli.');
  const key=input.COMMUNITY_SERVICE_ROLE_KEY || input.SUPABASE_API_KEY;
  try {
    if (getBuildKeyInfo(key || '').role!=='service_role') throw new Error('Wrong role');
  } catch { throw new Error('An Aliyun service key is required in the trusted server environment.'); }
  // The validated project origin overrides unrelated inherited API settings.
  env.SUPABASE_API_URL=target.url;
  env.SUPABASE_API_KEY=key;
  return {cli:input.ALIYUN_FUNCTIONS_CLI,env,args:['secrets','set','--env-file','/dev/stdin']};
}

export async function verifyReviewDeployment(input,origin,key,fetcher=fetch) {
  const target=communityProjectTarget(input.PUBLIC_COMMUNITY_SUPABASE_URL,input.COMMUNITY_PROJECT_REF);
  if (!['http://127.0.0.1:4328','http://localhost:4328','https://www.amazingindex.com'].includes(origin) ||
      !isCommunityPublicKey(input.PUBLIC_COMMUNITY_SUPABASE_KEY || '') || !/^[0-9a-f]{64}$/.test(key)) {
    throw new Error('Invalid review verification configuration');
  }
  async function request(body,token) {
    const response=await communityFunctionFetch(target,fetcher)(`${target.url}/functions/v1/meet-review`,{
      method:'POST',cache:'no-store',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json',Origin:origin,apikey:input.PUBLIC_COMMUNITY_SUPABASE_KEY,
        ...(token ? {Authorization:`Bearer ${token}`} : !input.PUBLIC_COMMUNITY_SUPABASE_KEY.startsWith('sb_publishable_') ? {Authorization:`Bearer ${input.PUBLIC_COMMUNITY_SUPABASE_KEY}`} : {})},
      body:JSON.stringify(body),
    });
    if(!response.ok) throw new Error(`Review verification failed (HTTP ${response.status}); no credentials were printed.`);
    try { return await response.json(); } catch { throw new Error('Invalid review verification response'); }
  }
  const exchanged=await request({action:'exchange',key});
  if(typeof exchanged.session!=='string' || !/^review-v1\.[0-9]{10,11}\.[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(exchanged.session) ||
    !Number.isFinite(exchanged.expiresAt) || exchanged.expiresAt<=Date.now() || exchanged.expiresAt>Date.now()+3610000) {
    throw new Error('Review session was not verified');
  }
  const listed=await request({action:'list',status:'pending'},exchanged.session);
  if(!Array.isArray(listed.posts) || typeof listed.more!=='boolean') throw new Error('Review database access was not verified');
}

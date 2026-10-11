import type { SupabaseClient } from '@supabase/supabase-js';

export const usesCommunityEdgeApi = (url: string) => new URL(url).hostname.endsWith('.supabase.opentrust.net');

export function communityFunctionFetch(config: {url: string},fetcher: typeof fetch = fetch): typeof fetch {
  if (!usesCommunityEdgeApi(config.url)) return fetcher;
  const origin = new URL(config.url).origin;
  return (input,options) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); }
    catch { return fetcher(input,options); }
    if (url.origin !== origin || !url.pathname.startsWith('/functions/v1/')) return fetcher(input,options);
    const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get('authorization');
    if (authorization) headers.set('x-community-authorization',authorization);
    return fetcher(input,{...options,headers,redirect:'error'});
  };
}

export async function requestCommunityRpc(config: {url: string;key: string},client: Pick<SupabaseClient,'rpc'>,
  name: string,params: Record<string,unknown> = {},accessToken?: string,fetcher: typeof fetch = fetch) {
  if(!usesCommunityEdgeApi(config.url)) return await client.rpc(name,params);
  const response=await communityFunctionFetch(config,fetcher)(`${config.url}/functions/v1/meet-api`,{
    method:'POST',cache:'no-store',signal:AbortSignal.timeout(30000),
    headers:{'Content-Type':'application/json',apikey:config.key,Authorization:`Bearer ${accessToken || config.key}`},
    body:JSON.stringify({action:name,params}),
  });
  const result=await response.json();
  if(!response.ok || result.error) return {data:null,error:result.error || {code:String(response.status),message:'Community unavailable'}};
  if(!Object.hasOwn(result,'data')) throw new Error('Invalid community response');
  return {data:result.data,error:null};
}

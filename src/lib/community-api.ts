import { communityClient } from './community-client';
import { community } from './community-config';
import { requestCommunityRpc, usesCommunityEdgeApi } from './community-transport';

export async function communityRpc(name: string,params: Record<string,unknown> = {}) {
  if (!community || !communityClient) throw new Error('Community unavailable');
  let token: string | undefined;
  if(usesCommunityEdgeApi(community.url)) {
    const {data:{session},error}=await communityClient.auth.getSession();
    if(error) throw error;
    token=session?.access_token;
  }
  const {data,error}=await requestCommunityRpc(community,communityClient,name,params,token);
  if(error) throw error;
  return data;
}

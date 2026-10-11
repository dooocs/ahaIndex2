import { createClient } from '@supabase/supabase-js';
import { community } from './community-config';
import { communityStorageKey } from './community-model';
import { communityFunctionFetch } from './community-transport';

export const communityClient = community ? createClient(community.url, community.key, {
  auth: {
    storageKey: communityStorageKey(community.url),
    detectSessionInUrl: typeof window !== 'undefined' && window.location.pathname === '/auth/callback/',
    persistSession: true,
    autoRefreshToken: true,
  },
  global: { fetch: communityFunctionFetch(community,(url, options) => fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(15000) })) },
}) : null;

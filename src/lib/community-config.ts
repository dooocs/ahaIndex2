import { communityConfig } from './community-model';

export const community = communityConfig({
  enabled: import.meta.env.PUBLIC_COMMUNITY_ENABLED,
  url: import.meta.env.PUBLIC_COMMUNITY_SUPABASE_URL,
  key: import.meta.env.PUBLIC_COMMUNITY_SUPABASE_KEY,
  captchaKey: import.meta.env.PUBLIC_COMMUNITY_TURNSTILE_KEY,
}, import.meta.env.DEV && import.meta.env.PUBLIC_COMMUNITY_MOCK_TEST === 'true');

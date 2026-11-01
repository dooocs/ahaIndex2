-- =====================================================================
-- 阿里云 Supabase · 检查同步通道（在官方库配置好令牌之后执行）
-- 从阿里云调用官方库的 people_sync_state，期望 status = 200，content = {}
-- =====================================================================
set http.curlopt_timeout_ms = '15000';

select status, content
from extensions.http((
  'POST',
  (select decrypted_secret from vault.decrypted_secrets where name = 'people_sync_official_url')
    || '/rest/v1/rpc/people_sync_state',
  array[extensions.http_header('apikey',
    (select decrypted_secret from vault.decrypted_secrets where name = 'people_sync_official_key'))],
  'application/json',
  json_build_object('p_token',
    (select decrypted_secret from vault.decrypted_secrets where name = 'people_sync_token'))::text
)::extensions.http_request);

-- =====================================================================
-- 阿里云 Supabase · 同步任务的连接配置（只执行一次）
-- 在阿里云 Vault 里生成同步令牌，并存好官方库的地址和公开 key。
-- 令牌明文只存在这里；执行后把输出的 token_sha256 填到官方库里。
-- =====================================================================
set search_path = public, extensions;

do $$
begin
  if exists (select 1 from vault.secrets where name = 'people_sync_token') then
    raise exception '同步令牌已存在，无需重复执行。如需重新生成，先删除 vault.secrets 里的 people_sync_token。';
  end if;
  perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'people_sync_token',
                              '人物同步令牌：调用官方库 people_sync_* 函数');
  perform vault.create_secret('https://wyhpcfjtmtitorinkevj.supabase.co', 'people_sync_official_url',
                              '官方 Supabase（aha index）地址');
  perform vault.create_secret('sb_publishable_Mhngg1gf4z4dkj-xh5TsMg_Pz3crwfo', 'people_sync_official_key',
                              '官方 Supabase 的 publishable key（公开 key，不是密钥）');
end $$;

select encode(digest(decrypted_secret, 'sha256'), 'hex') as token_sha256
from vault.decrypted_secrets where name = 'people_sync_token';

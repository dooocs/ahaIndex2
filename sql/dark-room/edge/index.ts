// Deploy as meet-api on Aliyun, retaining its existing community dispatcher.
// /meet-api/dark-room uses separate game tables and the same verified account.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

export async function handleDarkRoom(request: Request, env: (name: string) => string | undefined, fetcher = fetch) {
  const origin = request.headers.get('origin') || '';
  const allowed = ['https://www.amazingindex.com', 'https://amazingindex.com'].includes(origin);
  const headers = new Headers({
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-community-authorization, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  if (allowed) headers.set('Access-Control-Allow-Origin', origin);
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowed) return reply({ error: 'origin_denied' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('x-community-authorization') || request.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return reply({ error: 'login_required' }, 401);
  const url = env('SUPABASE_LOCAL_URL') || env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return reply({ error: 'service_unavailable' }, 503);
  try {
    // Auth verifies the actual caller. Never accept an account ID from the body.
    const auth = await fetcher(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: token }, signal: AbortSignal.timeout(10000),
    });
    if (auth.status >= 500 || auth.status === 429) return reply({ error: 'service_unavailable' }, 503);
    if (!auth.ok) return reply({ error: 'login_required' }, 401);
    const user = await auth.json();
    if (!user.id || !user.email_confirmed_at || user.is_anonymous || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return reply({ error: 'login_required' }, 401);
    if (Number(request.headers.get('content-length')) > 1200000) return reply({ error: 'invalid_state' }, 413);
    // Read the stream with a byte limit, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'invalid_request' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1200000) { await reader.cancel(); return reply({ error: 'invalid_state' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!['read', 'save', 'restore'].includes(body.action)) return reply({ error: 'invalid_request' }, 400);
    const result = await fetcher(`${url}/rest/v1/rpc/dark_room_api`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: user.id, p_action: body.action, p_payload: body.payload || {} }),
    });
    const data = await result.json();
    if (!result.ok) return reply({ error: ['22023', '23514', '22P02'].includes(data.code) ? 'invalid_save' : 'service_unavailable' }, result.status < 500 ? 400 : 503);
    return reply(data, data.error === 'conflict' ? 409 : 200);
  } catch (error) {
    return reply({ error: error instanceof SyntaxError ? 'invalid_request' : 'service_unavailable' }, error instanceof SyntaxError ? 400 : 503);
  }
}

// The previous meet-api deployment used these six actions, the same GoTrue
// validation, and service-role-only public.meet_api. Preserve that contract.
export async function handleCommunity(request: Request, env: (name: string) => string | undefined, fetcher = fetch) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-community-authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store',
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const invalid = { error: { code: '22023', message: 'Invalid request' } };
  const unavailable = { error: { code: '503', message: 'Community service unavailable' } };
  const loginRequired = { error: { code: '42501', message: 'Verified email required' } };
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(invalid, 405);
  const url = env('SUPABASE_LOCAL_URL') || env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return reply(unavailable, 503);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(invalid, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20000) { await reader.cancel(); return reply({ error: { code: '22023', message: 'Request too large' } }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const publicActions = ['list_meet_posts', 'meet_post_count', 'get_meet_post'];
    const privateActions = ['get_meet_contact', 'submit_meet_post', 'withdraw_meet_post'];
    if (!body || ![...publicActions, ...privateActions].includes(body.action)
      || (body.params != null && (typeof body.params !== 'object' || Array.isArray(body.params)))) return reply(invalid, 400);
    const token = request.headers.get('x-community-authorization') ?? request.headers.get('authorization');
    let actor = null;
    if (token?.startsWith('Bearer ') && token.slice(7) !== env('SUPABASE_ANON_KEY')) {
      const auth = await fetcher(`${url}/auth/v1/user`, {
        headers: { apikey: key, Authorization: token }, signal: AbortSignal.timeout(15000),
      });
      if (auth.status >= 500) return reply(unavailable, 503);
      if (!auth.ok) return reply(loginRequired, 401);
      const user = await auth.json();
      if (!user.id || !user.email_confirmed_at || user.is_anonymous || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return reply(loginRequired, 401);
      actor = user.id;
    }
    if (privateActions.includes(body.action) && !actor) return reply(loginRequired, 401);
    const response = await fetcher(`${url}/rest/v1/rpc/meet_api`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action: body.action, p_actor: actor, p_params: body.params || {} }),
    });
    const data = await response.json();
    if (response.ok) return reply({ data });
    if (['22023', '22P02', '23514', '23502'].includes(data.code)) return reply({ error: { code: '22023', message: 'Invalid post' } }, 400);
    if (data.code === '42501') return reply(loginRequired, 401);
    if (data.code === 'P0001' && data.message === 'Please wait 60 seconds') return reply({ error: { code: 'P0001', message: 'Please wait 60 seconds' } }, 429);
    return reply(unavailable, 503);
  } catch (error) { return reply(error instanceof SyntaxError ? invalid : unavailable, error instanceof SyntaxError ? 400 : 503); }
}

// Shared owner guard for this and future administration routes. GoTrue
// authenticates the token; the SQL function pins the original account UUID.
export async function authorizeSiteOwner(request: Request, env: (name: string) => string | undefined, fetcher = fetch) {
  const token = request.headers.get('x-community-authorization') || request.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return { error: 'login_required', status: 401 } as const;
  const url = env('SUPABASE_LOCAL_URL') || env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return { error: 'service_unavailable', status: 503 } as const;
  const auth = await fetcher(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: token }, signal: AbortSignal.timeout(10000),
  });
  if (auth.status >= 500 || auth.status === 429) return { error: 'service_unavailable', status: 503 } as const;
  if (!auth.ok) return { error: 'login_required', status: 401 } as const;
  const user = await auth.json();
  if (!user.id || !user.email_confirmed_at || user.is_anonymous
    || user.email?.trim().toLowerCase() !== 'szqsunny@outlook.com'
    || (user.banned_until && Date.parse(user.banned_until) > Date.now())) return { error: 'owner_required', status: 403 } as const;
  const owner = await fetcher(`${url}/rest/v1/rpc/site_admin_authorize`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_actor: user.id }),
  });
  if (!owner.ok) return { error: 'service_unavailable', status: 503 } as const;
  if (await owner.json() !== true) return { error: 'owner_required', status: 403 } as const;
  return { id: user.id, url, key };
}

async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('image_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('image_too_large'); }
    parts.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.length; }
  return body;
}

export function portraitJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 512 || bytes.length > 900000 || bytes[0] !== 255 || bytes[1] !== 216
    || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return false;
  for (let i = 2; i + 8 < bytes.length;) {
    if (bytes[i++] !== 255) return false;
    while (bytes[i] === 255) i++;
    const marker = bytes[i++];
    if (marker === 218 || marker === 217) return false;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) return false;
    if ([192, 193, 194].includes(marker)) return length >= 8
      && ((bytes[i + 3] << 8) | bytes[i + 4]) === 640 && ((bytes[i + 5] << 8) | bytes[i + 6]) === 640;
    i += length;
  }
  return false;
}

export async function handlePeoplePhotos(request: Request, env: (name: string) => string | undefined, fetcher = fetch) {
  const origin = request.headers.get('origin') || '';
  const allowed = ['https://www.amazingindex.com', 'https://amazingindex.com'].includes(origin);
  const headers = new Headers({
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-community-authorization, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  if (allowed) headers.set('Access-Control-Allow-Origin', origin);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && !allowed) return reply({ error: 'origin_denied' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const url = env('SUPABASE_LOCAL_URL') || env('SUPABASE_URL');
  const publicUrl = env('SUPABASE_URL')?.replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publicUrl || !key) return reply({ error: 'service_unavailable' }, 503);
  const rpc = async (action: string, actor: string | null, payload: unknown) => fetcher(`${url}/rest/v1/rpc/people_photo_api`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: action, p_actor: actor, p_payload: payload }),
  });
  const rpcError = async (response: Response) => {
    const data = await response.json();
    if (data.message === 'photo_conflict') return reply({ error: 'photo_conflict' }, 409);
    if (data.code === '42501') return reply({ error: 'owner_required' }, 403);
    if (data.code === 'P0002') return reply({ error: 'not_found' }, 404);
    return reply({ error: 'service_unavailable' }, 503);
  };
  try {
    const type = request.headers.get('content-type') || '';
    if (type.startsWith('application/json')) {
      const body = JSON.parse(new TextDecoder().decode(await boundedBody(request, 12000)));
      if (body?.action === 'list') {
        if (!Array.isArray(body.slugs) || body.slugs.length > 100 || body.slugs.some((s: unknown) => typeof s !== 'string' || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(s))) return reply({ error: 'invalid_request' }, 400);
        const result = await rpc('list', null, { slugs: body.slugs });
        return result.ok ? reply(await result.json()) : rpcError(result);
      }
      if (body?.action !== 'access') return reply({ error: 'invalid_request' }, 400);
      const owner = await authorizeSiteOwner(request, env, fetcher);
      return 'error' in owner ? reply({ error: owner.error }, owner.status) : reply({ owner: true });
    }
    if (!type.startsWith('multipart/form-data;')) return reply({ error: 'invalid_request' }, 400);
    // Check identity BEFORE reading image bytes or making any Storage write.
    const owner = await authorizeSiteOwner(request, env, fetcher);
    if ('error' in owner) return reply({ error: owner.error }, owner.status);
    const bytes = await boundedBody(request, 920000);
    const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': type }, body: bytes }).formData();
    const slug = form.get('slug'), expected = form.get('expected_avatar'), photo = form.get('photo');
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug)
      || typeof expected !== 'string' || expected.length > 2048 || !(photo instanceof File) || photo.type !== 'image/jpeg') return reply({ error: 'invalid_request' }, 400);
    const image = new Uint8Array(await photo.arrayBuffer());
    if (!portraitJpeg(image)) return reply({ error: 'invalid_image' }, 400);
    const payload = { slug, expected_avatar: expected };
    const inspected = await rpc('inspect', owner.id, payload);
    if (!inspected.ok) return rpcError(inspected);
    const objectPath = `${slug}/${crypto.randomUUID()}.jpg`;
    const avatarUrl = `${publicUrl}/storage/v1/object/public/people-portraits/${objectPath}`;
    const upload = await fetcher(`${url}/storage/v1/object/people-portraits/${objectPath}`, {
      method: 'POST', signal: AbortSignal.timeout(20000), body: image,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
    });
    if (!upload.ok) return reply({ error: 'service_unavailable' }, 503);
    const saved = await rpc('save', owner.id, { ...payload, object_path: objectPath, avatar_url: avatarUrl });
    if (!saved.ok) {
      // Only clean up a definitely rejected transaction. On a network timeout
      // the commit outcome is unknown, so retain the object to avoid a broken URL.
      await fetcher(`${url}/storage/v1/object/people-portraits`, { method: 'DELETE', signal: AbortSignal.timeout(10000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [objectPath] }),
      }).catch(() => {});
      return rpcError(saved);
    }
    return reply(await saved.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'image_too_large') return reply({ error: message }, 413);
    return reply({ error: error instanceof SyntaxError ? 'invalid_request' : 'service_unavailable' }, error instanceof SyntaxError ? 400 : 503);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(request => {
  const path = new URL(request.url).pathname;
  const env = (name: string) => Deno.env.get(name);
  if (path.endsWith('/people-photos')) return handlePeoplePhotos(request, env);
  return path.endsWith('/dark-room') ? handleDarkRoom(request, env) : handleCommunity(request, env);
});

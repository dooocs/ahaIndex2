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

if (typeof Deno !== 'undefined') Deno.serve(request => new URL(request.url).pathname.endsWith('/dark-room')
  ? handleDarkRoom(request, name => Deno.env.get(name))
  : handleCommunity(request, name => Deno.env.get(name)));

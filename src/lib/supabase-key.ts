export function getBuildKeyInfo(key: string): { type: string; role: string } {
  if (key.startsWith('sb_publishable_')) return { type: 'publishable', role: 'anon' };
  if (key.startsWith('sb_secret_')) return { type: 'secret', role: 'service_role' };

  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const { role } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (role === 'anon' || role === 'service_role') return { type: 'legacy_jwt', role };
    }
  } catch {
    // Report only the key type, never the credential or decoded payload.
  }
  throw new Error('SUPABASE_BUILD_KEY must be a publishable, secret, or legacy anon/service_role key');
}

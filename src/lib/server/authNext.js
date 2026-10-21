// Where to send a user after they sign in.
//
// Keycloak's round-trip used to always land on a bare /cfps, which silently
// dropped the query string — so a shared link like /cfps?batch=<id,id,…>,
// opened by someone not yet signed in, lost its batch the moment they signed
// in. /cfps/auth/login stashes the destination here; /cfps/auth/callback reads
// it back.
export const NEXT_COOKIE = 'cfps_kc_next';

// Only a path on this site is allowed: an absolute URL, a protocol-relative
// "//evil.com", or a path outside /cfps is refused, so neither the query
// parameter nor the cookie (both client-supplied) can be used as an open
// redirect. Returns the cleaned path, or null when it isn't one of ours.
export function safeNext(value) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let u;
  try { u = new URL(raw, 'http://x'); } catch { return null; }
  if (u.pathname !== '/cfps' && !u.pathname.startsWith('/cfps/')) return null;
  return `${u.pathname}${u.search}${u.hash}`;
}

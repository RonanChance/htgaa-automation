// Minimal stateless session: an HMAC-signed cookie carrying the Keycloak
// identity we need for attribution + one-vote-per-user enforcement. No session
// store required — the signature makes the cookie tamper-evident.
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';

export const KC_COOKIE = 'cfps_kc';

// Prefer a dedicated secret; fall back to PB_PASSWORD (always present in this
// deployment) so sessions are signed even before KC_SESSION_SECRET is set.
const SECRET = () => env.KC_SESSION_SECRET || env.PB_PASSWORD || 'dev-insecure-secret';

function sign(data) {
  return createHmac('sha256', SECRET()).update(data).digest('base64url');
}

export function createSession(user, ttlSec = 60 * 60 * 24 * 7) {
  const payload = {
    sub: user.sub,
    name: user.name,
    email: user.email ?? null,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readSession(cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const [body, sig] = cookie.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return { sub: p.sub, name: p.name, email: p.email ?? null };
  } catch {
    return null;
  }
}

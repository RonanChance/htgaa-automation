import { createHash } from 'crypto';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured, getUserInfo } from '$lib/server/keycloak.js';

// Who is calling a /cfps JSON endpoint? Browsers carry the signed `cfps_kc`
// session cookie. Agents acting for a user send `Authorization: Bearer <token>`,
// where the token is either:
//   • an agent token the user minted from the page (POST /cfps/agent-token) — the
//     same signed session payload as the cookie, so it verifies locally; or
//   • a Keycloak access token from the realm, verified against Keycloak's
//     userinfo endpoint (cached briefly so a busy agent doesn't hammer Keycloak).
// Returns { sub, name, email, via } or null. `via` records who is acting: 'user'
// (the person in their own browser) or 'agent' (anything authenticating with a
// bearer token, i.e. an AI agent acting on the user's behalf). Writes store it as
// `submitted_via`, so the database keeps track of agent-made content.
const KC_TOKEN_TTL_MS = 5 * 60 * 1000;
const kcTokenCache = new Map(); // sha256(token) → { user, exp }

export async function requestUser({ request, cookies }) {
  const fromCookie = readSession(cookies.get(KC_COOKIE));
  if (fromCookie) return { ...fromCookie, via: 'user' };

  const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  const token = m[1];

  const fromAgentToken = readSession(token);
  if (fromAgentToken) return { ...fromAgentToken, via: 'agent' };

  if (!isConfigured()) return null;
  const key = createHash('sha256').update(token).digest('hex');
  const hit = kcTokenCache.get(key);
  if (hit && hit.exp > Date.now()) return { ...hit.user, via: 'agent' };
  try {
    const user = await getUserInfo(token);
    if (!user?.sub) return null;
    if (kcTokenCache.size > 500) kcTokenCache.clear();
    kcTokenCache.set(key, { user, exp: Date.now() + KC_TOKEN_TTL_MS });
    return { ...user, via: 'agent' };
  } catch {
    return null;
  }
}

import { json } from '@sveltejs/kit';
import { readSession, createSession, KC_COOKIE } from '$lib/server/session.js';

// Mint an agent token for the signed-in user: the same signed session payload the
// browser cookie carries, handed out so an AI agent can act for them by sending
// `Authorization: Bearer <token>` (see $lib/server/auth.js). Cookie-only on
// purpose — an agent can't use its token to mint itself a fresh one, so access
// lapses when the token expires unless the user hands over another.
const AGENT_TOKEN_TTL_SEC = 60 * 60 * 24 * 7;

export async function POST({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return json({ error: 'Sign in to create an agent token.' }, { status: 401 });
  const token = createSession(kcUser, AGENT_TOKEN_TTL_SEC);
  return json({
    token,
    name: kcUser.name,
    expiresAt: new Date(Date.now() + AGENT_TOKEN_TTL_SEC * 1000).toISOString()
  });
}

import { redirect } from '@sveltejs/kit';
import { isConfigured, exchangeCode, getUserInfo } from '$lib/server/keycloak.js';
import { createSession, KC_COOKIE } from '$lib/server/session.js';

const STATE_COOKIE = 'cfps_kc_state';

// Handle the Keycloak redirect: verify state, exchange the code, load the
// user's identity, and mint a signed session cookie.
export async function GET({ url, cookies }) {
  if (!isConfigured()) redirect(303, '/cfps?kc=unconfigured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = cookies.get(STATE_COOKIE);
  cookies.delete(STATE_COOKIE, { path: '/cfps' });

  if (!code || !state || !saved || state !== saved) redirect(303, '/cfps?kc=error');

  try {
    const redirectUri = `${url.origin}/cfps/auth/callback`;
    const tokens = await exchangeCode({ code, redirectUri });
    const user = await getUserInfo(tokens.access_token);
    cookies.set(KC_COOKIE, createSession(user), {
      path: '/cfps', httpOnly: true, sameSite: 'lax',
      secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 7,
    });
  } catch {
    redirect(303, '/cfps?kc=error');
  }

  redirect(303, '/cfps');
}

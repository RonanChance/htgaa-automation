import { redirect } from '@sveltejs/kit';
import { isConfigured, exchangeCode, getUserInfo } from '$lib/server/keycloak.js';
import { createSession, KC_COOKIE } from '$lib/server/session.js';
import { NEXT_COOKIE, safeNext } from '$lib/server/authNext.js';

const STATE_COOKIE = 'cfps_kc_state';

// Handle the Keycloak redirect: verify state, exchange the code, load the
// user's identity, and mint a signed session cookie.
export async function GET({ url, cookies }) {
  if (!isConfigured()) redirect(303, '/cfps?kc=unconfigured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const saved = cookies.get(STATE_COOKIE);
  cookies.delete(STATE_COOKIE, { path: '/cfps' });
  // Where the user was when they clicked sign in; re-validated rather than
  // trusted, since a cookie is still client-supplied input.
  const next = safeNext(cookies.get(NEXT_COOKIE)) || '/cfps';
  cookies.delete(NEXT_COOKIE, { path: '/cfps' });

  // Log WHICH precondition failed — all four look identical to the user, and a
  // silent failure here is impossible to debug from the browser alone.
  if (!code || !state || !saved || state !== saved) {
    console.error('[cfps auth] callback rejected before token exchange:', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasStateCookie: Boolean(saved),
      stateMatches: Boolean(state && saved && state === saved),
      // Keycloak sends these when it refuses the request itself.
      oauthError: url.searchParams.get('error'),
      oauthErrorDescription: url.searchParams.get('error_description')
    });
    redirect(303, '/cfps?kc=error');
  }

  try {
    const redirectUri = `${url.origin}/cfps/auth/callback`;
    const tokens = await exchangeCode({ code, redirectUri });
    const user = await getUserInfo(tokens.access_token);
    cookies.set(KC_COOKIE, createSession(user), {
      path: '/cfps', httpOnly: true, sameSite: 'lax',
      secure: url.protocol === 'https:', maxAge: 60 * 60 * 24 * 7,
    });
  } catch (err) {
    // Never swallow this: it's the only place the real reason exists.
    console.error('[cfps auth] token exchange or userinfo failed:', err);
    redirect(303, '/cfps?kc=error');
  }

  redirect(303, next);
}

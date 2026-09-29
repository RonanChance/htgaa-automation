import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { dev } from '$app/environment';
import { isConfigured, getAuthorizationUrl } from '$lib/server/keycloak.js';
import { createSession, KC_COOKIE } from '$lib/server/session.js';

const STATE_COOKIE = 'cfps_kc_state';

// Kick off the Keycloak Authorization Code flow.
export async function GET({ url, cookies }) {
  // Localhost preview: on `vite dev` Keycloak usually isn't configured, so sign
  // the developer in as a dummy user. This lets the logged-in sections (designer
  // submit, community reagents) be previewed with dummy data. Never runs in prod.
  if (dev) {
    const dummy = { sub: 'dev-preview-user', name: 'Dev Preview', email: 'dev@localhost' };
    cookies.set(KC_COOKIE, createSession(dummy), {
      path: '/cfps', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 60 * 60 * 24 * 7,
    });
    redirect(303, '/cfps');
  }

  if (!isConfigured()) redirect(303, '/cfps?kc=unconfigured');

  const state = randomBytes(16).toString('hex');
  cookies.set(STATE_COOKIE, state, {
    path: '/cfps', httpOnly: true, sameSite: 'lax',
    secure: url.protocol === 'https:', maxAge: 600,
  });

  const redirectUri = `${url.origin}/cfps/auth/callback`;
  const authUrl = await getAuthorizationUrl({ state, redirectUri });
  redirect(303, authUrl);
}

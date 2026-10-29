import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';

// The walkthrough itself is public: the toy chapters need no data. The chapters
// that run on the real designs fetch ./data, which checks the session the same
// way the planner does, so a signed-out visitor sees the maths and a sign-in
// prompt where the real numbers would be.
export function load({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  return { signedIn: !!kcUser, kcConfigured: kcIsConfigured() };
}

import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';

// Login gate for /cfps/clusters, matching /cfps/analysis and /cfps/final-plates.
//
// This only decides what the PAGE renders. The data itself is protected
// independently by src/routes/cfps/clusters-data/[file], which re-checks the
// session on every fetch — so a signed-out visitor who calls the data URL
// directly still gets 401, with or without this gate.
export function load({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return { locked: true, kcConfigured: kcIsConfigured() };
  return { locked: false, kcUser: { name: kcUser.name } };
}

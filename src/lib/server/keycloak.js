// Keycloak OIDC (Authorization Code flow) helper — server only.
//
// Config comes from RUNTIME env (`$env/dynamic/private`) so the app still
// builds and runs before the Keycloak credentials are provisioned. Until all
// three of the vars below are set, `isConfigured()` returns false and the
// login routes short-circuit with a friendly message instead of erroring.
//
// Required env:
//   KEYCLOAK_ISSUER         e.g. https://auth.example.com/realms/ginkgo
//   KEYCLOAK_CLIENT_ID      the OIDC client id registered in Keycloak
//   KEYCLOAK_CLIENT_SECRET  the client secret (confidential client)
// Optional:
//   KEYCLOAK_SCOPES         defaults to "openid profile email"
//   KEYCLOAK_POST_LOGOUT_REDIRECT  where Keycloak sends the user after logout
import { env } from '$env/dynamic/private';

export function isConfigured() {
  return Boolean(env.KEYCLOAK_ISSUER && env.KEYCLOAK_CLIENT_ID && env.KEYCLOAK_CLIENT_SECRET);
}

const SCOPES = () => env.KEYCLOAK_SCOPES || 'openid profile email';

let _discoveryCache = null;
async function discovery() {
  if (_discoveryCache) return _discoveryCache;
  const issuer = env.KEYCLOAK_ISSUER.replace(/\/$/, '');
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  _discoveryCache = await res.json();
  return _discoveryCache;
}

export async function getAuthorizationUrl({ state, redirectUri }) {
  const meta = await discovery();
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set('client_id', env.KEYCLOAK_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES());
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode({ code, redirectUri }) {
  const meta = await discovery();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.KEYCLOAK_CLIENT_ID,
    client_secret: env.KEYCLOAK_CLIENT_SECRET,
  });
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getUserInfo(accessToken) {
  const meta = await discovery();
  const res = await fetch(meta.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const info = await res.json();
  return {
    sub: info.sub,
    name: info.name || info.preferred_username || info.email || info.sub,
    email: info.email || null,
  };
}

export async function getEndSessionUrl({ idToken, postLogoutRedirect }) {
  const meta = await discovery();
  if (!meta.end_session_endpoint) return null;
  const u = new URL(meta.end_session_endpoint);
  if (idToken) u.searchParams.set('id_token_hint', idToken);
  const dest = postLogoutRedirect || env.KEYCLOAK_POST_LOGOUT_REDIRECT;
  if (dest) u.searchParams.set('post_logout_redirect_uri', dest);
  return u.toString();
}

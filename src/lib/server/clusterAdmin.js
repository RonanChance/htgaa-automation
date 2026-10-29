import { env } from '$env/dynamic/private';

// Who may replace the cluster model. There is no admin concept anywhere else in
// /cfps — every other write is scoped to the caller's own submissions — so this
// is a deliberately small one: an allowlist of Keycloak emails (or subs) in
// CFPS_ADMIN_EMAILS, comma-separated. Unset means nobody, because the upload
// overwrites the model every signed-in participant then sees.
const allow = () =>
  new Set(
    String(env.CFPS_ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

export const adminConfigured = () => allow().size > 0;

export function isClusterAdmin(user) {
  if (!user) return false;
  const list = allow();
  if (!list.size) return false;
  return list.has(String(user.email ?? '').toLowerCase()) || list.has(String(user.sub ?? '').toLowerCase());
}

// Why a given account isn't an admin. Both failure modes — the var unset, and
// the signed-in identity not matching it — look identical from the page (no
// button), and the var is only read at server start, so say which it is.
export function adminDenialReason(user) {
  if (!adminConfigured()) {
    return 'CFPS_ADMIN_EMAILS is not set on this server. Add it to .env and restart — it is read at startup.';
  }
  const seen = user?.email || `(no email on your session; sub ${user?.sub ?? 'unknown'})`;
  return `Signed in as ${seen}, which is not in CFPS_ADMIN_EMAILS. Add that exact value, or your Keycloak sub, and restart the server.`;
}

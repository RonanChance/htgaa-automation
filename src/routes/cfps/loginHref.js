// Build the sign-in link so Keycloak returns the user to the page they were on,
// query string and all. Without this, opening a shared /cfps?batch=<id,id,…>
// link while signed out and then signing in lands you on a bare /cfps and the
// batch is silently lost — the round-trip is the only place the parameter can go
// missing, since the server never sees it again.
//
// `page.url` on the server is the real request URL, and on the client it tracks
// navigation, so the same call works in SSR and in the browser.
export function loginHref(url) {
  const here = url ? `${url.pathname}${url.search}` : '';
  // A bare /cfps needs no round-trip hint; keep those links short.
  return here && here !== '/cfps'
    ? `/cfps/auth/login?next=${encodeURIComponent(here)}`
    : '/cfps/auth/login';
}

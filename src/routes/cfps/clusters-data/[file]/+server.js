import { error } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { loadClusterFile, CLUSTER_FILES } from '$lib/server/clusterData.js';

// Keycloak-gated delivery of the CFPS Arena cluster export.
//
// The data names every participant and their submitted recipe, so it is served
// only to a signed-in user (session cookie) or an agent acting for one (bearer
// token) — the same gate as the rest of /cfps. The page's loader script resolves
// its data relative to its own URL, so these land here with no change to it:
//
//   /cfps/clusters-data/clusters_page.js   → static/ (public: the implementation)
//   /cfps/clusters-data/clusters.css       → static/ (public)
//   /cfps/clusters-data/clusters.json.gz   → HERE (gated: the results)
//   /cfps/clusters-data/clusters_designs.json → HERE (gated: every design)
//
// The two gated names MUST NOT exist under static/, or the adapter's static
// handler would answer first and skip this check entirely.
export async function GET(event) {
  const name = event.params.file;
  if (!(name in CLUSTER_FILES)) throw error(404, 'Unknown cluster file.');

  const user = await requestUser(event);
  if (!user) {
    // 401 rather than a redirect: the caller is fetch(), not a navigation.
    throw error(401, 'Sign in to load the CFPS cluster data.');
  }

  let file;
  try {
    file = await loadClusterFile(name);
  } catch (e) {
    console.error(`Failed to load cluster file ${name}:`, e);
    throw error(503, 'Cluster data is unavailable right now.');
  }
  if (!file) throw error(404, 'Unknown cluster file.');

  if (event.request.headers.get('if-none-match') === file.etag) {
    return new Response(null, { status: 304, headers: { ETag: file.etag } });
  }
  // Both records are stored gzipped. clusters.json.gz goes out as-is — the
  // loader sniffs the gzip magic bytes and inflates it itself. The designs file
  // is reached by a download link, so it goes out with Content-Encoding: gzip
  // and a JSON type, and the browser inflates it to readable JSON on the way in.
  const { type, encoded } = CLUSTER_FILES[name];
  return new Response(file.body, {
    headers: {
      'Content-Type': type,
      ...(encoded ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': String(file.body.length) }),
      ETag: file.etag,
      // Per-user data: cacheable in the browser, never in a shared proxy.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

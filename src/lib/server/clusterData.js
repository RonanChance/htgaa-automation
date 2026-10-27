import { pbAdmin, PB_URL } from '$lib/server/pb.js';

// Runtime source for the /cfps/clusters page. The CFPS Arena export names every
// coopetition design with its author, sample_id, recipe and model forecast, so
// it is NOT in static/ (world-readable) and NOT in git (public repo): it lives
// as gzipped attachments on the superuser-only `cfps_cluster_data` collection,
// published by scripts/pb-publish-cluster-data.mjs.
//
// Only the authed endpoint (src/routes/cfps/clusters-data/[file]) calls this,
// so every byte has passed a Keycloak check before it leaves the server.
const COLLECTION = 'cfps_cluster_data';

// The two files the browser loader asks for → the record key holding each.
// Anything not in this map is refused, so the [file] param can't be used to
// reach another record or walk the filesystem.
// `encoded` marks the ones we hand back with Content-Encoding: gzip so the
// browser inflates them transparently — clusters_designs.json is reached by a
// plain download link, so it has to arrive as readable JSON, not a .gz blob
// wearing a .json name.
export const CLUSTER_FILES = {
  'clusters.json.gz': { key: 'clusters', type: 'application/gzip', encoded: false },
  'clusters_designs.json': { key: 'designs', type: 'application/json', encoded: true }
};

// key → { body: Buffer, etag } once fetched. The export only changes when
// someone re-publishes, and it is ~1.3 MB gzipped in total, so holding it is
// cheaper than re-fetching per request. A failure is never memoized.
const cache = new Map();

async function fetchFile(key) {
  const pb = await pbAdmin();
  const record = await pb
    .collection(COLLECTION)
    .getFirstListItem(pb.filter('key = {:k}', { k: key }));
  if (!record?.file) throw new Error(`cluster record "${key}" has no file`);

  // The collection has no public view rule, so the file URL needs a short-lived
  // token; without it PocketBase answers 403.
  const token = await pb.files.getToken();
  const url = pb.files.getURL(record, record.file, { token });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PocketBase returned ${res.status} for ${key}`);

  return {
    body: Buffer.from(await res.arrayBuffer()),
    // Record id + updated stamp change whenever the export is re-published.
    etag: `"${record.id}-${record.updated}"`
  };
}

export async function loadClusterFile(name) {
  const key = CLUSTER_FILES[name]?.key;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const promise = fetchFile(key).catch((error) => {
    cache.delete(key); // transient failure must not stick
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

export { PB_URL };

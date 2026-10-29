import { pbAdmin, PB_URL } from '$lib/server/pb.js';
import { activeModel, PUBLISHED } from '$lib/server/clusterModels.js';

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

// "<model id>:<key>" → { body: Buffer, etag } once fetched. The export only
// changes when someone uploads or switches version, and it is ~1.3 MB gzipped
// in total, so holding it is cheaper than re-fetching per request. Keying on the
// model id means switching version can never serve the previous one's bytes.
// A failure is never memoized.
const cache = new Map();

async function download(pb, record, field, what) {
  if (!record?.[field]) throw new Error(`${what} has no ${field} file`);
  // The collection has no public view rule, so the file URL needs a short-lived
  // token; without it PocketBase answers 403.
  const token = await pb.files.getToken();
  const res = await fetch(pb.files.getURL(record, record[field], { token }));
  if (!res.ok) throw new Error(`PocketBase returned ${res.status} for ${what}`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    // Record id + updated stamp change whenever the bytes change.
    etag: `"${record.id}-${record.updated}"`
  };
}

async function fetchFile(key) {
  const pb = await pbAdmin();
  const model = await activeModel();
  if (model) {
    // An uploaded version may carry designs only; fall through for clusters.
    if (model[key]) return download(pb, model, key, `model ${model.id}`);
    if (key === 'designs') throw new Error(`model ${model.id} has no designs file`);
  }
  const record = await pb
    .collection(COLLECTION)
    .getFirstListItem(pb.filter('key = {:k}', { k: key }));
  return download(pb, record, 'file', `cluster record "${key}"`);
}

export async function loadClusterFile(name, modelId) {
  const key = CLUSTER_FILES[name]?.key;
  if (!key) return null;
  const id = modelId ?? (await activeModel())?.id ?? PUBLISHED;
  const cacheKey = `${id}:${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = fetchFile(key).catch((error) => {
    cache.delete(cacheKey); // transient failure must not stick
    throw error;
  });
  cache.set(cacheKey, promise);
  return promise;
}

// A fresh upload must not keep serving the old bytes from memory.
export function clearClusterCache() {
  cache.clear();
}

export { PB_URL };

import { pbAdmin } from '$lib/server/pb.js';

// Runtime source for the /cfps assay section (kinetic plate reads + reagent-range
// analysis). The heavy compute lives in loadPlateReader.js / loadPlateAnalysis.js
// and reads the local autonomous-cfps + catalyst-agent-skills reference files —
// those paths only exist on the authoring Mac, so scripts/pb-publish-plate-data.mjs
// precomputes the payloads and stores them in the `cfps_plate_data` PocketBase
// collection (one record per key). Reading from the DB here means the assay
// section renders on any host (the droplet included), whether or not the visitor
// is signed in.
//
// The collection is superuser-only (no public read rule), so we go through the
// admin client — same pattern as static_values / cfps_reagent_groups.
//
// Both records are fetched together in ONE authed query and the resolved promise
// is memoized. Crucially we only keep the memo when it SUCCEEDS: a transient
// failure clears it so the next request retries, instead of caching an empty
// section for the life of the process. (An earlier version cached per-key with
// two concurrent auths, which could poison one key's cache on a transient blip.)
const COLLECTION = 'cfps_plate_data';

let dataPromise;

async function fetchAll() {
  const pb = await pbAdmin();
  const records = await pb.collection(COLLECTION).getFullList({
    filter: 'key="plate_reader" || key="plate_analysis"',
  });
  const byKey = {};
  for (const rec of records) {
    const data = rec?.data;
    // PocketBase json fields come back already parsed; the string guard is a
    // safety net for records stored as a JSON string.
    byKey[rec.key] = typeof data === 'string' ? JSON.parse(data) : (data ?? null);
  }
  return {
    reader: byKey.plate_reader ?? null,
    analysis: byKey.plate_analysis ?? null,
  };
}

function loadAll() {
  if (dataPromise) return dataPromise;
  dataPromise = fetchAll().catch((error) => {
    console.error('Failed to load plate data from PocketBase:', error);
    dataPromise = undefined; // allow the next request to retry
    return { reader: null, analysis: null };
  });
  return dataPromise;
}

export async function loadPlateReader() {
  return (await loadAll()).reader;
}

export async function loadPlateAnalysis() {
  return (await loadAll()).analysis;
}

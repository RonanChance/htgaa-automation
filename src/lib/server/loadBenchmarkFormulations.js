import { pbAdmin } from '$lib/server/pb.js';
import { augmentFormulations } from '$lib/cfps-benchmarks.js';

// The benchmark composition table lives in the static_values collection (record id
// below) so the numbers can be tuned in PocketBase without a redeploy — it is the
// single source of truth. If the record is missing, malformed, or the read fails,
// we return an empty list: the table then renders reagent names + the Custom Mix
// column with no reference columns (a graceful degrade) rather than stale data.
// viewRule is null on static_values, so this read must go through the
// superuser-authed admin client.
const STATIC_VALUES = 'static_values';
const BENCHMARKS_RECORD_ID = 'cfpsbenchmk0001';

// A trusted row is an object with a non-empty string `key` and an object
// `components` map. Anything short of that means we can't trust the payload and
// should fall back to the file defaults rather than render a broken table.
function isValidFormulations(list) {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (b) =>
        b &&
        typeof b === 'object' &&
        typeof b.key === 'string' &&
        b.key.length > 0 &&
        b.components &&
        typeof b.components === 'object',
    )
  );
}

export async function loadBenchmarkFormulations() {
  try {
    const pb = await pbAdmin();
    const rec = await pb.collection(STATIC_VALUES).getOne(BENCHMARKS_RECORD_ID);
    // Prefer the structured json field; tolerate a stringified array in text.
    let raw = rec?.json;
    if (raw == null && typeof rec?.text === 'string' && rec.text.trim()) {
      try {
        raw = JSON.parse(rec.text);
      } catch {
        raw = null;
      }
    }
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    if (!isValidFormulations(raw)) return [];
    // Re-derive paperUrl / echoNative from category for the loaded rows.
    return augmentFormulations(raw);
  } catch {
    return [];
  }
}

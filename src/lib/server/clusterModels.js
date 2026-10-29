import { pbAdmin } from '$lib/server/pb.js';

// Versions of the CFPS Arena export.
//
// Uploading used to overwrite the one live copy, so a bad export meant the page
// was broken until someone re-published. Each upload now creates a row in
// `cfps_cluster_models` holding both files, and exactly one row is `active`.
// Switching back is a single click.
//
// The pre-existing `cfps_cluster_data` records (written by
// `npm run clusters:publish`) stay as a permanent fallback version under the
// sentinel id below, so the CLI tooling keeps working and there is always
// something to return to.
export const COLLECTION = 'cfps_cluster_models';
export const PUBLISHED = 'published';

// Model record field → the name the loader asks for.
export const MODEL_FILE_FIELD = { designs: 'designs', clusters: 'clusters' };

// PocketBase 0.23+ dropped the implicit created/updated columns — they have to
// be declared, or `sort: '-created'` and the etag below both fail.
const FIELDS = [
  { name: 'label', type: 'text', required: true },
  { name: 'built', type: 'text' },
  { name: 'n_designs', type: 'number' },
  { name: 'n_groups', type: 'number' },
  { name: 'uploaded_by', type: 'text' },
  { name: 'active', type: 'bool' },
  { name: 'designs', type: 'file', maxSelect: 1, maxSize: 67_108_864 },
  { name: 'clusters', type: 'file', maxSelect: 1, maxSize: 67_108_864 },
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

let schemaReady = false;
async function ensureCollection(pb) {
  if (schemaReady) return;
  const existing = await pb.collections.getOne(COLLECTION).catch(() => null);
  if (!existing) {
    await pb.collections.create({ name: COLLECTION, type: 'base', fields: FIELDS });
  } else {
    // Add anything a older deployment's collection is missing, so upgrading
    // doesn't need a manual migration.
    const have = new Set(existing.fields.map((f) => f.name));
    const missing = FIELDS.filter((f) => !have.has(f.name));
    if (missing.length) {
      await pb.collections.update(existing.id, { fields: [...existing.fields, ...missing] });
    }
  }
  schemaReady = true;
}

const slim = (r) => ({
  id: r.id,
  label: r.label,
  built: r.built || null,
  designs: r.n_designs ?? null,
  groups: r.n_groups ?? null,
  uploadedBy: r.uploaded_by || null,
  created: r.created,
  active: !!r.active,
  hasClusters: !!r.clusters
});

async function records(pb) {
  await ensureCollection(pb);
  return pb.collection(COLLECTION).getFullList({ sort: '-created' });
}

/**
 * Every version, newest first, with the CLI-published copy last. Exactly one
 * carries active:true — the published fallback when no uploaded row claims it.
 */
export async function listModels() {
  const pb = await pbAdmin();
  const rows = (await records(pb)).map(slim);
  const anyActive = rows.some((r) => r.active);
  rows.push({
    id: PUBLISHED,
    label: 'Published via clusters:publish',
    built: null,
    designs: null,
    groups: null,
    uploadedBy: null,
    created: null,
    active: !anyActive,
    hasClusters: true
  });
  return rows;
}

/** The record for the active version, or null when that is the CLI copy. */
export async function activeModel() {
  const pb = await pbAdmin();
  const rows = await records(pb);
  return rows.find((r) => r.active) ?? null;
}

/** Id of the active version — doubles as the cache key for its bytes. */
export async function activeModelId() {
  return (await activeModel())?.id ?? PUBLISHED;
}

/** Make one version live. `PUBLISHED` hands back to the CLI-published copy. */
export async function activateModel(id) {
  const pb = await pbAdmin();
  const rows = await records(pb);
  if (id !== PUBLISHED && !rows.some((r) => r.id === id)) return null;
  // Clearing every other row first means a crash mid-way leaves the published
  // fallback live rather than two rows both claiming to be active.
  for (const r of rows) {
    if (r.active && r.id !== id) await pb.collection(COLLECTION).update(r.id, { active: false });
  }
  if (id !== PUBLISHED) await pb.collection(COLLECTION).update(id, { active: true });
  return id;
}

export async function createModel({ label, built, nDesigns, nGroups, uploadedBy, files }) {
  const pb = await pbAdmin();
  await ensureCollection(pb);
  const fd = new FormData();
  fd.append('label', label);
  if (built) fd.append('built', built);
  fd.append('n_designs', String(nDesigns ?? 0));
  fd.append('n_groups', String(nGroups ?? 0));
  if (uploadedBy) fd.append('uploaded_by', uploadedBy);
  fd.append('active', 'false');
  for (const [field, blob] of Object.entries(files)) {
    fd.append(field, blob.body, blob.name);
  }
  const rec = await pb.collection(COLLECTION).create(fd);
  await activateModel(rec.id);
  return slim({ ...rec, active: true });
}

export async function deleteModel(id) {
  if (id === PUBLISHED) return false;
  const pb = await pbAdmin();
  await ensureCollection(pb);
  await pb.collection(COLLECTION).delete(id);
  return true;
}

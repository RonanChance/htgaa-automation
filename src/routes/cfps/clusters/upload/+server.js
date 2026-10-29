import { json, error } from '@sveltejs/kit';
import zlib from 'node:zlib';
import { requestUser } from '$lib/server/auth.js';
import { isClusterAdmin, adminDenialReason } from '$lib/server/clusterAdmin.js';
import { clearClusterCache } from '$lib/server/clusterData.js';
import { clearPlanCache, TARGETS } from '$lib/server/clusterPlan.js';
import { createModel } from '$lib/server/clusterModels.js';

// POST (multipart) a freshly generated CFPS Arena export and make it live.
//
// This is the browser equivalent of `npm run clusters:publish`: same two files,
// same gzip-on-store. It exists so refreshing the model does not require a
// checkout and superuser credentials. Each upload is a new *version* rather
// than an overwrite — see clusterModels.js — so a bad export is one click away
// from being undone. Still allowlist-only: it changes what everyone sees.
const MAX_BYTES = 64 * 1024 * 1024;
const FILES = [
  { field: 'designs', key: 'designs', name: 'clusters_designs.json', required: true },
  { field: 'clusters', key: 'clusters', name: 'clusters.json.gz', required: false }
];

const gunzipIfNeeded = (buf) =>
  buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;

// Refuse anything that is not actually the designs export, so a mistyped file
// cannot take the page down until someone re-publishes.
function checkDesigns(buf) {
  let parsed;
  try {
    parsed = JSON.parse(gunzipIfNeeded(buf).toString('utf8'));
  } catch {
    throw error(400, 'clusters_designs.json is not valid JSON (or valid gzipped JSON).');
  }
  const proteins = parsed?.proteins;
  if (!proteins || typeof proteins !== 'object') {
    throw error(400, 'That file has no "proteins" object — is it the clusters_designs export?');
  }
  const missing = TARGETS.filter((t) => !proteins[t]?.designs?.length);
  if (missing.length) throw error(400, `No designs for ${missing.join(', ')} in that file.`);
  return {
    built: parsed.built ?? null,
    designs: TARGETS.reduce((n, t) => n + proteins[t].designs.length, 0),
    groups: TARGETS.reduce((n, t) => n + (proteins[t].groups?.length ?? 0), 0)
  };
}

export async function POST(event) {
  const user = await requestUser(event);
  if (!user) throw error(401, 'Sign in to upload a model.');
  if (!isClusterAdmin(user)) throw error(403, adminDenialReason(user));

  const form = await event.request.formData().catch(() => null);
  if (!form) throw error(400, 'Expected a multipart upload.');

  const uploads = [];
  for (const f of FILES) {
    const file = form.get(f.field);
    if (!file || typeof file === 'string') {
      if (f.required) throw error(400, `Missing the ${f.name} file.`);
      continue;
    }
    if (file.size > MAX_BYTES) throw error(413, `${f.name} is larger than ${MAX_BYTES / 1e6} MB.`);
    uploads.push({ ...f, buf: Buffer.from(await file.arrayBuffer()) });
  }

  const summary = checkDesigns(uploads.find((u) => u.key === 'designs').buf);

  const files = {};
  for (const u of uploads) {
    // Stored gzipped whatever arrived, matching tools/cfps-clusters.mjs.
    const body = u.buf[0] === 0x1f && u.buf[1] === 0x8b ? u.buf : zlib.gzipSync(u.buf, { level: 9 });
    files[u.key] = {
      body: new Blob([body], { type: 'application/gzip' }),
      name: `${u.key}.json.gz`
    };
  }

  const label = String(form.get('label') ?? '').trim()
    || (summary.built ? `Export built ${summary.built}` : `Uploaded ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);

  const model = await createModel({
    label,
    built: summary.built,
    nDesigns: summary.designs,
    nGroups: summary.groups,
    uploadedBy: user.name ?? user.email ?? null,
    files
  });

  // Both layers hold the previous version's bytes; drop them.
  clearClusterCache();
  clearPlanCache();

  return json({ ok: true, model, uploaded: uploads.map((u) => u.name), ...summary });
}

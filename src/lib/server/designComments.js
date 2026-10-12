import { dev } from '$app/environment';
import { pbAdmin } from '$lib/server/pb.js';
import { clampComment } from '$lib/server/suggestions.js';

// Comment threads on community compositions (HTBAA contributions), mirroring the
// community-reagent threads. One row per comment in cfps_design_comments:
// { design → cfps_designs (cascade delete), author_sub, author_name, body }. A
// separate collection (not a JSON array on the design) so concurrent posts can't
// clobber each other and a thread can grow without rewriting the design record.
// Admin-only collection; all reads/writes go through the superuser client.
//
// On localhost (`vite dev`) an in-memory store stands in, keyed by the dummy
// community design ids in loadCommunityDesigns.js.
export const DESIGN_COMMENTS = 'cfps_design_comments';

// Client-facing comment: the Keycloak subject stays server-side; `mine` lets the
// author (and only the author) delete it.
function clientComment(c, mySub) {
  return { id: c.id, author: c.author, body: c.body, created: c.created, mine: !!mySub && c.authorSub === mySub };
}

function normalize(rec) {
  return {
    id: rec.id,
    designId: rec.design,
    author: String(rec.author_name || '').trim() || 'anonymous',
    authorSub: String(rec.author_sub || '').trim() || null,
    body: String(rec.body || '').trim(),
    created: rec.created
  };
}

// ── localhost dummy store ───────────────────────────────────────────────────
const DEV_COMMENTS = [
  { id: 'ddc-1', designId: 'dev-design-1', author: 'Grace H.', authorSub: 'dev-grace',
    body: 'Did the brighter signal hold up past the 4 h read, or does it plateau early?', created: '2026-09-21T10:00:00Z' },
  { id: 'ddc-2', designId: 'dev-design-1', author: 'Ada L.', authorSub: 'dev-ada',
    body: 'Plateaus around 5 h — we think Mg is no longer limiting by then.', created: '2026-09-21T13:20:00Z' }
];
let devSeq = DEV_COMMENTS.length;

// Every thread, grouped: { [designId]: [clientComment, ...] } oldest first. Never
// throws — a backend hiccup just renders empty threads.
export async function loadDesignComments(kcUser) {
  const mySub = kcUser?.sub || '';
  if (!mySub) return {};
  let all;
  if (dev) {
    all = DEV_COMMENTS;
  } else {
    try {
      const pb = await pbAdmin();
      all = (await pb.collection(DESIGN_COMMENTS).getFullList({ sort: 'created' })).map(normalize);
    } catch {
      return {};
    }
  }
  const byDesign = {};
  for (const c of all) (byDesign[c.designId] ??= []).push(clientComment(c, mySub));
  return byDesign;
}

// One design's thread (after a write), oldest first.
export async function loadThread(kcUser, designId) {
  const mySub = kcUser?.sub || '';
  if (dev) return DEV_COMMENTS.filter((c) => c.designId === designId).map((c) => clientComment(c, mySub));
  const pb = await pbAdmin();
  const rows = await pb.collection(DESIGN_COMMENTS).getFullList({
    filter: pb.filter('design = {:d}', { d: designId }),
    sort: 'created'
  });
  return rows.map((r) => clientComment(normalize(r), mySub));
}

// Post a comment (word-capped). Returns { ok, reason? } — reason 'empty' or 'not_found'.
export async function postDesignComment(kcUser, designId, body) {
  const text = clampComment(body);
  if (!text) return { ok: false, reason: 'empty' };
  if (dev) {
    DEV_COMMENTS.push({
      id: `ddc-${++devSeq}`, designId, author: kcUser?.name || 'anonymous',
      authorSub: kcUser?.sub || null, body: text, created: new Date().toISOString()
    });
    return { ok: true };
  }
  const pb = await pbAdmin();
  try {
    await pb.collection('cfps_designs').getOne(designId, { fields: 'id' });
  } catch (e) {
    if (e?.status === 404) return { ok: false, reason: 'not_found' };
    throw e;
  }
  await pb.collection(DESIGN_COMMENTS).create({
    design: designId, author_sub: kcUser.sub, author_name: kcUser.name || 'anonymous', body: text,
    submitted_via: kcUser.via === 'agent' ? 'agent' : 'user'
  });
  return { ok: true };
}

// Delete a comment — only its author may. Returns { ok, designId?, reason? }.
export async function deleteDesignComment(kcUser, commentId) {
  const mySub = String(kcUser?.sub || '');
  if (dev) {
    const i = DEV_COMMENTS.findIndex((c) => c.id === commentId);
    if (i < 0) return { ok: false, reason: 'not_found' };
    if (DEV_COMMENTS[i].authorSub !== mySub) return { ok: false, reason: 'forbidden' };
    const [c] = DEV_COMMENTS.splice(i, 1);
    return { ok: true, designId: c.designId };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(DESIGN_COMMENTS).getOne(commentId).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  if (String(rec.author_sub) !== mySub) return { ok: false, reason: 'forbidden' };
  await pb.collection(DESIGN_COMMENTS).delete(commentId);
  return { ok: true, designId: rec.design };
}

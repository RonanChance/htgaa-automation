import { DEV_STUBS } from '$lib/server/devStubs.js';
import { pbAdmin } from '$lib/server/pb.js';
import { clampComment } from '$lib/server/suggestions.js';

// Metascience: how should we DECIDE which compositions go forward to the wet lab?
// The coopetition will have far more submitted designs than wells, so the choosing
// is itself an experiment-design problem — this is where students propose and
// argue for selection criteria (top-by-predicted-titer, diversity sampling,
// replicate-the-disagreements, cost-weighted, …).
//
// Deliberately the simplest shape that supports a real argument: a title, the
// idea in prose, one upvote per Keycloak user, and a comment thread. No DOI
// lookup, no tags — unlike the literature list, nothing here is a citation.
//
// Storage mirrors the literature list exactly: ideas in cfps_metascience, one
// upvote per (idea, voter) enforced by a unique index on cfps_metascience_votes,
// comments in cfps_metascience_comments. All three are admin-only, so every
// read/write goes through the superuser client after the caller's Keycloak
// session has been verified. On localhost an in-memory store stands in.
export const METASCIENCE = 'cfps_metascience';
export const METASCIENCE_VOTES = 'cfps_metascience_votes';
export const METASCIENCE_COMMENTS = 'cfps_metascience_comments';

const LIMITS = { title: 300, body: 4000 };

// ── validation ──────────────────────────────────────────────────────────────

// Raw input → { idea, errors[] }. Each error is { field, message } so an agent can
// fix exactly what's wrong, the same contract the literature endpoint uses.
export function prepareIdea(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];
  const idea = {
    title: String(src.title ?? src.name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title),
    body: clampComment(src.body ?? src.idea ?? src.description ?? src.summary ?? '')
  };
  if (!idea.title) {
    errors.push({ field: 'title', message: 'title is required — a short name for the criterion, e.g. "Rank by predicted titer, cap one per student".' });
  }
  if (!idea.body) {
    errors.push({ field: 'body', message: 'body is required — how the criterion would pick compositions, and why that is the right call.' });
  }
  return { idea, errors };
}

// Comparable form of a title, for catching the same idea submitted twice.
const titleKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── shapes ──────────────────────────────────────────────────────────────────

function normalizeComment(rec) {
  return {
    id: rec.id,
    ideaId: rec.idea,
    author: String(rec.author_name || '').trim() || 'anonymous',
    authorSub: String(rec.author_sub || '').trim() || null,
    body: String(rec.body || '').trim(),
    submittedVia: rec.submitted_via || null,
    created: rec.created || null
  };
}
// Client-facing comment: drops the Keycloak subject, adds `mine` so only the
// author sees a delete control.
const clientComment = (c, mySub) => ({
  id: c.id, author: c.author, body: c.body, created: c.created,
  submittedVia: c.submittedVia, mine: !!mySub && c.authorSub === mySub
});

function normalize(rec, mySub, voted, comments = []) {
  return {
    id: rec.id,
    title: rec.title || '',
    body: rec.body || '',
    addedBy: rec.added_by_name || 'anonymous',
    submittedVia: rec.submitted_via || null,
    created: rec.created || null,
    votes: Number(rec.votes) || 0,
    voted: voted.has(rec.id),
    mine: !!mySub && rec.added_by_sub === mySub,
    comments
  };
}

const byRank = (a, b) => (b.votes - a.votes) || String(b.created || '').localeCompare(String(a.created || ''));

// ── localhost dummy store ───────────────────────────────────────────────────
const DEV_IDEAS = [
  { id: 'dev-ms-1', title: 'Spend some wells on testing the widest parameter space',
    body: 'Rank every composition by predicted titer, then take the top 40 wells from the ranking and the other 40 from designs where the models disagree most. The leaderboard half tells us who won; the disagreement half is where we actually learn something, because those are the conditions our priors are worst at.',
    added_by_name: 'Grace H.', added_by_sub: 'dev-grace', submitted_via: 'user', votes: 5, created: '2026-10-12T09:00:00Z' },
  { id: 'dev-ms-2', title: 'Cap each student at two wells before anyone gets three',
    body: 'Fill the plate breadth-first: every student who submitted gets their best two compositions run before anyone gets a third. Keeps one prolific contributor from taking a whole plate, and the coverage is better for it.',
    added_by_name: 'Ada L.', added_by_sub: 'dev-ada', submitted_via: 'user', votes: 3, created: '2026-10-14T12:00:00Z' }
];
const DEV_MS_VOTES = new Map();   // voter_sub → Set(ideaId)
const DEV_MS_COMMENTS = [
  { id: 'dev-msc-1', idea: 'dev-ms-1', author_name: 'Ada L.', author_sub: 'dev-ada',
    body: 'Agreed, though "disagreement" needs a definition we can compute before the plate is laid out.', created: '2026-10-13T08:00:00Z' }
];
let devSeq = DEV_IDEAS.length;
let devCommentSeq = DEV_MS_COMMENTS.length;

// ── public API (dev-or-PocketBase) ──────────────────────────────────────────

// Ranked list + the viewer's votes. Never throws — a hiccup renders an empty list.
export async function getMetascience(kcUser) {
  const mySub = kcUser?.sub || '';
  if (!mySub) return { items: [], votedIds: [] };
  const thread = (all, id) => all.filter((c) => c.ideaId === id)
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))
    .map((c) => clientComment(c, mySub));

  if (DEV_STUBS) {
    const voted = DEV_MS_VOTES.get(mySub) ?? new Set();
    const comments = DEV_MS_COMMENTS.map(normalizeComment);
    return {
      items: DEV_IDEAS.map((r) => normalize(r, mySub, voted, thread(comments, r.id))).sort(byRank),
      votedIds: [...voted]
    };
  }
  try {
    const pb = await pbAdmin();
    const [rows, votes, commentRows] = await Promise.all([
      pb.collection(METASCIENCE).getFullList({ sort: '-votes,-created' }),
      pb.collection(METASCIENCE_VOTES).getFullList({ filter: pb.filter('voter_sub = {:s}', { s: mySub }) }),
      pb.collection(METASCIENCE_COMMENTS).getFullList({ sort: 'created' })
    ]);
    const voted = new Set(votes.map((v) => v.idea));
    const comments = commentRows.map(normalizeComment);
    return {
      items: rows.map((r) => normalize(r, mySub, voted, thread(comments, r.id))).sort(byRank),
      votedIds: [...voted]
    };
  } catch {
    return { items: [], votedIds: [] };
  }
}

// Add an idea. Returns { ok, item } or { ok:false, reason:'invalid', errors } /
// { ok:false, reason:'duplicate', existing }.
export async function addIdea(kcUser, input) {
  const { idea, errors } = prepareIdea(input);
  if (errors.length) return { ok: false, reason: 'invalid', errors };
  const mySub = String(kcUser.sub);
  const record = {
    ...idea,
    added_by_sub: mySub,
    added_by_name: String(kcUser.name || 'anonymous').slice(0, 200),
    votes: 0,
    submitted_via: kcUser.via === 'agent' ? 'agent' : 'user'
  };
  const isDup = (r) => titleKey(r.title) === titleKey(idea.title);

  if (DEV_STUBS) {
    const dup = DEV_IDEAS.find(isDup);
    if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, DEV_MS_VOTES.get(mySub) ?? new Set()) };
    const rec = { id: `dev-ms-${++devSeq}`, ...record, created: new Date().toISOString() };
    DEV_IDEAS.push(rec);
    return { ok: true, item: normalize(rec, mySub, new Set()) };
  }
  const pb = await pbAdmin();
  const existing = await pb.collection(METASCIENCE).getFullList({ fields: 'id,title,votes,created,added_by_name,added_by_sub' });
  const dup = existing.find(isDup);
  if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
  const rec = await pb.collection(METASCIENCE).create(record);
  return { ok: true, item: normalize(rec, mySub, new Set()) };
}

// Edit an idea — only whoever added it may. `input` may be partial: it's laid over
// the stored values, then re-validated exactly like an add.
export async function updateIdea(kcUser, id, input) {
  const mySub = String(kcUser.sub);
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  let pb = null;
  let rec = DEV_STUBS ? DEV_IDEAS.find((p) => p.id === id) : null;
  if (!DEV_STUBS) {
    pb = await pbAdmin();
    rec = await pb.collection(METASCIENCE).getOne(id).catch(() => null);
  }
  if (!rec) return { ok: false, reason: 'not_found' };
  if (rec.added_by_sub !== mySub) return { ok: false, reason: 'forbidden' };

  const { idea, errors } = prepareIdea({ title: rec.title, body: rec.body, ...src });
  if (errors.length) return { ok: false, reason: 'invalid', errors };

  const isDup = (r) => r.id !== id && titleKey(r.title) === titleKey(idea.title);
  if (DEV_STUBS) {
    const dup = DEV_IDEAS.find(isDup);
    if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
    Object.assign(rec, idea);
    return { ok: true, item: normalize(rec, mySub, DEV_MS_VOTES.get(mySub) ?? new Set()) };
  }
  const others = await pb.collection(METASCIENCE).getFullList({ fields: 'id,title,votes,created,added_by_name,added_by_sub' });
  const dup = others.find(isDup);
  if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
  const saved = await pb.collection(METASCIENCE).update(id, idea);
  return { ok: true, item: normalize(saved, mySub, new Set()) };
}

// One upvote per user (idempotent). Returns { ok, reason? }.
export async function voteIdea(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const rec = DEV_IDEAS.find((p) => p.id === id);
    if (!rec) return { ok: false, reason: 'not_found' };
    const set = DEV_MS_VOTES.get(sub) ?? new Set();
    if (!set.has(id)) { set.add(id); rec.votes += 1; DEV_MS_VOTES.set(sub, set); }
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(METASCIENCE).getOne(id).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  try {
    await pb.collection(METASCIENCE_VOTES).create({ idea: id, voter_sub: sub, voter_name: kcUser.name || 'anonymous' });
  } catch {
    return { ok: true, dup: true }; // unique index → already voted
  }
  await pb.collection(METASCIENCE).update(id, { votes: (Number(rec.votes) || 0) + 1 });
  return { ok: true };
}

export async function unvoteIdea(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const rec = DEV_IDEAS.find((p) => p.id === id);
    const set = DEV_MS_VOTES.get(sub);
    if (rec && set?.delete(id)) rec.votes = Math.max(0, rec.votes - 1);
    return { ok: true };
  }
  const pb = await pbAdmin();
  const existing = await pb.collection(METASCIENCE_VOTES).getFullList({
    filter: pb.filter('idea = {:p} && voter_sub = {:s}', { p: id, s: sub })
  });
  if (!existing.length) return { ok: true };
  for (const v of existing) await pb.collection(METASCIENCE_VOTES).delete(v.id);
  const rec = await pb.collection(METASCIENCE).getOne(id).catch(() => null);
  if (rec) await pb.collection(METASCIENCE).update(id, { votes: Math.max(0, (Number(rec.votes) || 0) - existing.length) });
  return { ok: true };
}

// Delete an idea — only whoever added it may (votes + comments cascade-delete).
export async function deleteIdea(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const i = DEV_IDEAS.findIndex((p) => p.id === id);
    if (i < 0) return { ok: false, reason: 'not_found' };
    if (DEV_IDEAS[i].added_by_sub !== sub) return { ok: false, reason: 'forbidden' };
    DEV_IDEAS.splice(i, 1);
    for (const set of DEV_MS_VOTES.values()) set.delete(id);
    for (let j = DEV_MS_COMMENTS.length - 1; j >= 0; j--) if (DEV_MS_COMMENTS[j].idea === id) DEV_MS_COMMENTS.splice(j, 1);
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(METASCIENCE).getOne(id).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  if (rec.added_by_sub !== sub) return { ok: false, reason: 'forbidden' };
  await pb.collection(METASCIENCE).delete(id);
  return { ok: true };
}

// Add one comment to an idea's thread (capped length). Returns { ok, reason? }.
export async function commentOnIdea(kcUser, id, body) {
  const text = clampComment(body);
  if (!text) return { ok: false, reason: 'empty' };
  if (DEV_STUBS) {
    if (!DEV_IDEAS.some((p) => p.id === id)) return { ok: false, reason: 'not_found' };
    DEV_MS_COMMENTS.push({
      id: `dev-msc-${++devCommentSeq}`, idea: id,
      author_name: kcUser?.name || 'anonymous', author_sub: kcUser?.sub || null,
      body: text, submitted_via: kcUser?.via === 'agent' ? 'agent' : 'user',
      created: new Date().toISOString()
    });
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(METASCIENCE).getOne(id).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  await pb.collection(METASCIENCE_COMMENTS).create({
    idea: id, author_sub: kcUser.sub, author_name: kcUser.name || 'anonymous',
    body: text, submitted_via: kcUser?.via === 'agent' ? 'agent' : 'user'
  });
  return { ok: true };
}

// Delete a comment — only its own author may.
export async function deleteIdeaComment(kcUser, commentId) {
  if (!commentId) return { ok: false, reason: 'not_found' };
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const i = DEV_MS_COMMENTS.findIndex((c) => c.id === commentId && c.author_sub === sub);
    if (i < 0) return { ok: false, reason: 'forbidden' };
    DEV_MS_COMMENTS.splice(i, 1);
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(METASCIENCE_COMMENTS).getOne(commentId).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  if (String(rec.author_sub) !== sub) return { ok: false, reason: 'forbidden' };
  await pb.collection(METASCIENCE_COMMENTS).delete(commentId);
  return { ok: true };
}

// The ranked list as plain text — for the "↓" button and for agents that would
// rather read prose than JSON.
export function metascienceAsText(items) {
  const lines = [
    'Cell-Free Synthesis Coopetition — metascience: how to choose what goes to the bench',
    `Exported ${new Date().toISOString().slice(0, 10)} · ${items.length} idea${items.length === 1 ? '' : 's'} · ranked by upvotes`,
    ''
  ];
  items.forEach((p, i) => {
    lines.push(`${i + 1}. [▲ ${p.votes}] ${p.title}`);
    lines.push(`   ${String(p.body || '').replace(/\s*\n\s*/g, ' ')}`);
    lines.push(`   Added by ${p.addedBy}${p.created ? ` on ${String(p.created).slice(0, 10)}` : ''} · id ${p.id}`);
    for (const c of p.comments ?? []) {
      lines.push(`     ↳ ${c.author}: ${String(c.body).replace(/\s*\n\s*/g, ' ')}`);
    }
    lines.push('');
  });
  if (!items.length) lines.push('No ideas yet.');
  return lines.join('\n');
}

import { pbAdmin } from '$lib/server/pb.js';
import { dev } from '$app/environment';

// Community-suggested reagents + upvotes. The suggestion payload is a free-form
// JSON dict (name, pH, other attributes, link) stored on cfps_suggested_reagents.
// One upvote per Keycloak user is enforced by a unique (suggestion, voter_sub)
// index on cfps_suggestion_votes. All reads/writes go through the superuser
// client since both collections are admin-only (no public list/view rules).
//
// On localhost (`vite dev`) everything is served from an in-memory dummy store
// instead, so the logged-in community section can be previewed without Keycloak
// or PocketBase. See DEV_* below. Never used in a production build.
export const SUGGESTED = 'cfps_suggested_reagents';
export const SUGGESTION_VOTES = 'cfps_suggestion_votes';
export const SUGGESTION_COMMENTS = 'cfps_suggestion_comments';

// A suggestion record → client shape. The owner's Keycloak subject is stored inside
// the suggestion JSON under the reserved `_owner_sub` key (there's no author_sub
// COLUMN on cfps_suggested_reagents, so this avoids a schema migration). We STRIP
// every underscore-prefixed reserved key from what we hand the client and instead
// expose a single `mine` boolean so the author — and only the author — gets a delete
// control. Suggestions created before owner-tracking carry no owner and are never
// deletable from the UI (safe default).
function normalizeSuggestion(rec, mySub = '') {
  let dict = rec.suggestion;
  if (typeof dict === 'string') {
    try { dict = JSON.parse(dict); } catch { dict = {}; }
  }
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) dict = {};
  const ownerSub = typeof dict._owner_sub === 'string' ? dict._owner_sub : '';
  const publicDict = {};
  for (const [k, v] of Object.entries(dict)) {
    if (!String(k).startsWith('_')) publicDict[k] = v; // never leak reserved keys
  }
  return {
    id: rec.id,
    suggestion: publicDict,
    votes: Number(rec.votes ?? 0) || 0,
    created: rec.created,
    mine: !!mySub && ownerSub === mySub,
    comments: [],
  };
}

// The reserved owner subject stored inside a suggestion's JSON, or '' if none.
function ownerSubOf(rec) {
  let dict = rec?.suggestion;
  if (typeof dict === 'string') {
    try { dict = JSON.parse(dict); } catch { dict = {}; }
  }
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) return '';
  return typeof dict._owner_sub === 'string' ? dict._owner_sub : '';
}

// A comment record → internal shape (keeps author_sub for ownership checks).
function normalizeComment(rec) {
  return {
    id: rec.id,
    suggestionId: rec.suggestion,
    author: String(rec.author_name || '').trim() || 'anonymous',
    authorSub: String(rec.author_sub || '').trim() || null,
    body: String(rec.body || '').trim(),
    created: rec.created,
  };
}

// Client-facing comment: drops the Keycloak subject, adds `mine` so the author
// (and only the author) sees a delete control.
function clientComment(c, mySub) {
  return { id: c.id, author: c.author, body: c.body, created: c.created, mine: !!mySub && c.authorSub === mySub };
}

// Attach each suggestion's comment thread (oldest-first) by suggestion id.
function attachComments(suggestions, allComments, mySub) {
  const byS = new Map();
  for (const c of allComments) {
    if (!byS.has(c.suggestionId)) byS.set(c.suggestionId, []);
    byS.get(c.suggestionId).push(clientComment(c, mySub));
  }
  for (const s of suggestions) s.comments = byS.get(s.id) ?? [];
  return suggestions;
}

// ── localhost dummy store ───────────────────────────────────────────────────
// Module-level so it survives across requests within a single `vite dev`
// process. Only touched when `dev` is true.
const DEV_SUGGESTIONS = [
  { id: 'dev-1', votes: 9, created: '2026-09-18T09:00:00Z',
    suggestion: { name: 'Spermidine', concentration: '1.5 mM', category: 'Cofactors',
      description: 'Polyamine that stabilises ribosome complexes — commonly lifts CFPS yield.',
      link: 'https://doi.org/10.1038/nprot.2016.038', proposed_by: 'Ada L.' } },
  { id: 'dev-2', votes: 6, created: '2026-09-19T14:30:00Z',
    suggestion: { name: 'Putrescine', concentration: '1 mM', category: 'Cofactors',
      description: 'Second polyamine — pairs with spermidine to tune translation.', proposed_by: 'Grace H.' } },
  { id: 'dev-3', votes: 4, created: '2026-09-21T11:15:00Z',
    suggestion: { name: 'Potassium glutamate', concentration: '120 mM', category: 'Salts', ph: '7.5',
      description: 'Preferred K⁺ source — swap for KOAc to probe ionic-strength effects.',
      proposed_by: 'Dev Preview', _owner_sub: 'dev-preview-user' } },
  { id: 'dev-4', votes: 3, created: '2026-09-23T16:45:00Z',
    suggestion: { name: 'PEG-8000', concentration: '2% w/v', category: 'Other',
      description: 'Molecular crowding agent — mimics cytoplasmic density.', proposed_by: 'Rosalind F.' } },
  { id: 'dev-5', votes: 1, created: '2026-09-25T08:20:00Z',
    suggestion: { name: 'tRNA (E. coli)', concentration: '0.2 mg/mL', category: 'Nucleotides',
      description: 'Extra bulk tRNA to relieve codon-usage bottlenecks.', proposed_by: 'Barbara M.' } },
  // Owned by the dev-preview user with zero votes — exercises the delete-immediately
  // (no-confirmation) path; dev-3 (owned, 4 votes) exercises the confirm path.
  { id: 'dev-6', votes: 0, created: '2026-09-26T10:00:00Z',
    suggestion: { name: '3-PGA', concentration: '30 mM', category: 'Energy',
      description: 'Phosphoenolpyruvate alternative as an energy source for the reaction.',
      proposed_by: 'Dev Preview', _owner_sub: 'dev-preview-user' } },
];
// voter_sub → Set(suggestionId)
const DEV_VOTES = new Map();
let devSeq = DEV_SUGGESTIONS.length;

// suggestionId → comment thread (shared across requests in one `vite dev`).
const DEV_COMMENTS = [
  { id: 'dc-1', suggestionId: 'dev-1', author: 'Grace H.', authorSub: 'dev-grace',
    body: 'Saw a reliable ~15% bump at 1.5 mM in our last two runs.', created: '2026-09-18T12:00:00Z' },
  { id: 'dc-2', suggestionId: 'dev-1', author: 'Dev Preview', authorSub: 'dev-preview-user',
    body: 'Worth pairing with putrescine — curious whether the effect stacks.', created: '2026-09-18T15:30:00Z' },
  { id: 'dc-3', suggestionId: 'dev-3', author: 'Ada L.', authorSub: 'dev-ada',
    body: 'Prefer this over KOAc for first-pass screens.', created: '2026-09-22T09:10:00Z' },
];
let devCommentSeq = DEV_COMMENTS.length;

function devRanked(kcUser) {
  const suggestions = [...DEV_SUGGESTIONS]
    .sort((a, b) => (b.votes - a.votes) || (a.created < b.created ? 1 : -1))
    .map((s) => normalizeSuggestion(s, kcUser?.sub || ''));
  let votedSuggestionIds = [];
  if (kcUser?.sub) votedSuggestionIds = [...(DEV_VOTES.get(kcUser.sub) ?? [])];
  attachComments(suggestions, DEV_COMMENTS, kcUser?.sub || '');
  return { suggestions, votedSuggestionIds };
}

// ── PocketBase reads/writes (production) ────────────────────────────────────
// Ranked list (most upvoted first) plus this user's vote set, if signed in.
export async function fetchRankedSuggestions(pb, kcUser) {
  const rows = await pb.collection(SUGGESTED).getFullList({ sort: '-votes,-created' });
  const suggestions = rows.map((r) => normalizeSuggestion(r, kcUser?.sub || ''));
  let votedSuggestionIds = [];
  if (kcUser?.sub) {
    const votes = await pb.collection(SUGGESTION_VOTES).getFullList({
      filter: pb.filter('voter_sub = {:s}', { s: kcUser.sub }),
    });
    votedSuggestionIds = votes.map((v) => v.suggestion);
  }
  // Comments live in a separate collection; an unprovisioned/missing collection
  // must not blank out the whole ranking, so this read is best-effort.
  let allComments = [];
  try {
    const crows = await pb.collection(SUGGESTION_COMMENTS).getFullList({ sort: 'created' });
    allComments = crows.map(normalizeComment);
  } catch { allComments = []; }
  attachComments(suggestions, allComments, kcUser?.sub || '');
  return { suggestions, votedSuggestionIds };
}

// Create a new community suggestion. `dict` is the free-form suggestion payload
// (name, pH, concentration, category, link, description). Returns the new record.
export async function createSuggestion(pb, kcUser, dict) {
  const clean = cleanDict(dict, kcUser);
  return pb.collection(SUGGESTED).create({ suggestion: clean, votes: 0 });
}

// Record one upvote. Returns { ok, dup } — dup=true means the unique index
// rejected a second vote from the same user (idempotent from the UI's view).
export async function castVote(pb, kcUser, suggestionId) {
  try {
    await pb.collection(SUGGESTION_VOTES).create({
      suggestion: suggestionId, voter_sub: kcUser.sub, voter_name: kcUser.name,
    });
  } catch {
    return { ok: false, dup: true };
  }
  const rec = await pb.collection(SUGGESTED).getOne(suggestionId);
  await pb.collection(SUGGESTED).update(suggestionId, { votes: (Number(rec.votes ?? 0) || 0) + 1 });
  return { ok: true, dup: false };
}

// Remove this user's upvote (idempotent). Returns { ok }.
export async function removeVote(pb, kcUser, suggestionId) {
  const existing = await pb.collection(SUGGESTION_VOTES).getFullList({
    filter: pb.filter('suggestion = {:p} && voter_sub = {:s}', { p: suggestionId, s: kcUser.sub }),
  });
  if (existing.length) {
    for (const v of existing) await pb.collection(SUGGESTION_VOTES).delete(v.id);
    const rec = await pb.collection(SUGGESTED).getOne(suggestionId);
    await pb.collection(SUGGESTED).update(suggestionId, {
      votes: Math.max(0, (Number(rec.votes ?? 0) || 0) - existing.length),
    });
  }
  return { ok: true };
}

// Keys treated as links — their values are URL-scheme validated so a stored value
// can never become a `javascript:`/`data:` URL that executes in a viewer's browser.
const LINK_KEYS = new Set(['link', 'url', 'href', 'reference', 'ref']);

// Allow only http(s). A bare domain is assumed https; anything carrying a non-http
// scheme (javascript:, data:, vbscript:, …) is rejected outright.
function sanitizeUrl(s) {
  const v = String(s).trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';
  return `https://${v}`;
}

// Normalise the free-form suggestion payload before storage. Text content is safe
// to render because Svelte escapes it on output, but we still bound the shape so a
// crafted request can't bloat the record: cap the number of keys, key length, and
// value length, and scheme-check any link field. The display name is server-stamped.
const MAX_KEYS = 24;
const MAX_KEY_LEN = 60;
const MAX_VAL_LEN = 2000;
function cleanDict(dict, kcUser) {
  const clean = {};
  let n = 0;
  for (const [k, v] of Object.entries(dict || {})) {
    if (v == null || n >= MAX_KEYS) continue;
    const key = String(k).trim().slice(0, MAX_KEY_LEN);
    // Reject reserved keys: `proposed_by` (server-stamped below) and any
    // underscore-prefixed key (reserved for server metadata like `_owner_sub`), so a
    // crafted request can't spoof ownership.
    if (!key || key.startsWith('_') || key.toLowerCase() === 'proposed_by') continue;
    let s = String(v).trim().slice(0, MAX_VAL_LEN);
    if (!s) continue;
    if (LINK_KEYS.has(key.toLowerCase())) { s = sanitizeUrl(s); if (!s) continue; }
    clean[key] = s;
    n += 1;
  }
  clean.proposed_by = String(kcUser?.name || 'anonymous').slice(0, 200);
  // Reserved owner key — stripped from client output in normalizeSuggestion and used
  // by deleteSuggestion to authorise removal (no author_sub column needed).
  if (kcUser?.sub) clean._owner_sub = String(kcUser.sub).slice(0, 200);
  return clean;
}

// Cap a comment to a word budget (and a hard character ceiling as a backstop).
const MAX_COMMENT_WORDS = 500;
const MAX_COMMENT_CHARS = 4000;
// A space-free blob longer than CHARS_PER_WORD counts as multiple words, so the
// limit can't be dodged by omitting spaces. Mirrors wordCount() in
// ReagentSuggestions.svelte — keep the two in sync.
const CHARS_PER_WORD = 15;
function clampComment(body) {
  const tokens = String(body ?? '').trim().split(/\s+/).filter(Boolean);
  const kept = [];
  let budget = MAX_COMMENT_WORDS;
  for (const tok of tokens) {
    if (budget <= 0) break;
    const cost = Math.max(1, Math.ceil(tok.length / CHARS_PER_WORD));
    if (cost <= budget) {
      kept.push(tok);
      budget -= cost;
    } else {
      // Token alone exceeds the remaining budget — keep only the part that fits.
      kept.push(tok.slice(0, budget * CHARS_PER_WORD));
      budget = 0;
    }
  }
  return kept.join(' ').slice(0, MAX_COMMENT_CHARS);
}

// ── dev-or-PocketBase public wrappers ───────────────────────────────────────
// These are what the routes call so the dev/prod split lives in one place.

// Ranked list + this user's votes. Never throws — a backend hiccup renders empty.
// LOGIN-GATED: anonymous visitors never receive the real community dataset (the
// client shows a scrambled, sign-in-prompting teaser instead), so the suggestions
// can't be scraped without an account.
export async function getRankedSuggestions(kcUser) {
  if (!kcUser?.sub) return { suggestions: [], votedSuggestionIds: [] };
  if (dev) return devRanked(kcUser);
  try {
    const pb = await pbAdmin();
    return await fetchRankedSuggestions(pb, kcUser);
  } catch {
    return { suggestions: [], votedSuggestionIds: [] };
  }
}

// SSR entry point (kept name for the page load import).
export async function loadSuggestions(kcUser) {
  return getRankedSuggestions(kcUser);
}

export async function submitSuggestion(kcUser, dict) {
  if (dev) {
    DEV_SUGGESTIONS.push({
      id: `dev-${++devSeq}`, votes: 0, created: new Date().toISOString(),
      suggestion: cleanDict(dict, kcUser),
    });
    return;
  }
  const pb = await pbAdmin();
  await createSuggestion(pb, kcUser, dict);
}

export async function upvote(kcUser, suggestionId) {
  if (dev) {
    const set = DEV_VOTES.get(kcUser.sub) ?? new Set();
    if (!set.has(suggestionId)) {
      const rec = DEV_SUGGESTIONS.find((s) => s.id === suggestionId);
      if (rec) { rec.votes += 1; set.add(suggestionId); DEV_VOTES.set(kcUser.sub, set); }
    }
    return;
  }
  const pb = await pbAdmin();
  await castVote(pb, kcUser, suggestionId);
}

export async function downvote(kcUser, suggestionId) {
  if (dev) {
    const set = DEV_VOTES.get(kcUser.sub);
    if (set?.has(suggestionId)) {
      const rec = DEV_SUGGESTIONS.find((s) => s.id === suggestionId);
      if (rec) rec.votes = Math.max(0, rec.votes - 1);
      set.delete(suggestionId);
    }
    return;
  }
  const pb = await pbAdmin();
  await removeVote(pb, kcUser, suggestionId);
}

// Add one comment to a suggestion's thread (capped length). No-op on empty text.
export async function postComment(kcUser, suggestionId, body) {
  const text = clampComment(body);
  if (!text || !suggestionId) return;
  if (dev) {
    DEV_COMMENTS.push({
      id: `dc-${++devCommentSeq}`, suggestionId,
      author: kcUser?.name || 'anonymous', authorSub: kcUser?.sub || null,
      body: text, created: new Date().toISOString(),
    });
    return;
  }
  const pb = await pbAdmin();
  await pb.collection(SUGGESTION_COMMENTS).create({
    suggestion: suggestionId, author_sub: kcUser.sub,
    author_name: kcUser.name || 'anonymous', body: text,
  });
}

// Delete a comment — only the comment's own author may remove it.
export async function deleteComment(kcUser, commentId) {
  if (!commentId) return;
  if (dev) {
    const i = DEV_COMMENTS.findIndex((c) => c.id === commentId && c.authorSub === kcUser?.sub);
    if (i >= 0) DEV_COMMENTS.splice(i, 1);
    return;
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(SUGGESTION_COMMENTS).getOne(commentId).catch(() => null);
  if (rec && String(rec.author_sub) === String(kcUser.sub)) {
    await pb.collection(SUGGESTION_COMMENTS).delete(commentId);
  }
}

// Delete a suggestion — only its original author may remove it, matched against the
// reserved owner subject stored inside the suggestion JSON (see cleanDict). Also
// clears the suggestion's votes + comments so no orphan rows linger. Returns
// { ok, reason? }. Suggestions with no owner sub (pre-dating owner tracking) can't be
// deleted, so this never silently removes someone else's or a legacy suggestion.
export async function deleteSuggestion(kcUser, suggestionId) {
  const mySub = kcUser?.sub ? String(kcUser.sub) : '';
  if (!mySub || !suggestionId) return { ok: false, reason: 'unauthorized' };
  if (dev) {
    const i = DEV_SUGGESTIONS.findIndex((s) => s.id === suggestionId);
    if (i < 0) return { ok: false, reason: 'not_found' };
    if (String(DEV_SUGGESTIONS[i].suggestion?._owner_sub || '') !== mySub) {
      return { ok: false, reason: 'forbidden' };
    }
    DEV_SUGGESTIONS.splice(i, 1);
    for (const set of DEV_VOTES.values()) set.delete(suggestionId);
    for (let j = DEV_COMMENTS.length - 1; j >= 0; j--) {
      if (DEV_COMMENTS[j].suggestionId === suggestionId) DEV_COMMENTS.splice(j, 1);
    }
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(SUGGESTED).getOne(suggestionId).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  const owner = ownerSubOf(rec);
  if (!owner || owner !== mySub) return { ok: false, reason: 'forbidden' };
  // Clear dependent rows first (best-effort) so deleting the suggestion doesn't leave
  // dangling votes/comments, then remove the suggestion itself.
  try {
    const votes = await pb.collection(SUGGESTION_VOTES).getFullList({
      filter: pb.filter('suggestion = {:p}', { p: suggestionId }),
    });
    for (const v of votes) await pb.collection(SUGGESTION_VOTES).delete(v.id).catch(() => {});
  } catch { /* ignore */ }
  try {
    const comments = await pb.collection(SUGGESTION_COMMENTS).getFullList({
      filter: pb.filter('suggestion = {:p}', { p: suggestionId }),
    });
    for (const c of comments) await pb.collection(SUGGESTION_COMMENTS).delete(c.id).catch(() => {});
  } catch { /* ignore */ }
  await pb.collection(SUGGESTED).delete(suggestionId);
  return { ok: true };
}

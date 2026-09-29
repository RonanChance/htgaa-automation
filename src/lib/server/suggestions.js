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

function normalizeSuggestion(rec) {
  let dict = rec.suggestion;
  if (typeof dict === 'string') {
    try { dict = JSON.parse(dict); } catch { dict = {}; }
  }
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) dict = {};
  return {
    id: rec.id,
    suggestion: dict,
    votes: Number(rec.votes ?? 0) || 0,
    created: rec.created,
  };
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
      description: 'Preferred K⁺ source — swap for KOAc to probe ionic-strength effects.', proposed_by: 'Dev Preview' } },
  { id: 'dev-4', votes: 3, created: '2026-09-23T16:45:00Z',
    suggestion: { name: 'PEG-8000', concentration: '2% w/v', category: 'Other',
      description: 'Molecular crowding agent — mimics cytoplasmic density.', proposed_by: 'Rosalind F.' } },
  { id: 'dev-5', votes: 1, created: '2026-09-25T08:20:00Z',
    suggestion: { name: 'tRNA (E. coli)', concentration: '0.2 mg/mL', category: 'Nucleotides',
      description: 'Extra bulk tRNA to relieve codon-usage bottlenecks.', proposed_by: 'Barbara M.' } },
];
// voter_sub → Set(suggestionId)
const DEV_VOTES = new Map();
let devSeq = DEV_SUGGESTIONS.length;

function devRanked(kcUser) {
  const suggestions = [...DEV_SUGGESTIONS].sort(
    (a, b) => (b.votes - a.votes) || (a.created < b.created ? 1 : -1)
  );
  let votedSuggestionIds = [];
  if (kcUser?.sub) votedSuggestionIds = [...(DEV_VOTES.get(kcUser.sub) ?? [])];
  return { suggestions, votedSuggestionIds };
}

// ── PocketBase reads/writes (production) ────────────────────────────────────
// Ranked list (most upvoted first) plus this user's vote set, if signed in.
export async function fetchRankedSuggestions(pb, kcUser) {
  const rows = await pb.collection(SUGGESTED).getFullList({ sort: '-votes,-created' });
  const suggestions = rows.map(normalizeSuggestion);
  let votedSuggestionIds = [];
  if (kcUser?.sub) {
    const votes = await pb.collection(SUGGESTION_VOTES).getFullList({
      filter: pb.filter('voter_sub = {:s}', { s: kcUser.sub }),
    });
    votedSuggestionIds = votes.map((v) => v.suggestion);
  }
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

function cleanDict(dict, kcUser) {
  const clean = {};
  for (const [k, v] of Object.entries(dict || {})) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) clean[k] = s;
  }
  clean.proposed_by = kcUser?.name || 'anonymous';
  return clean;
}

// ── dev-or-PocketBase public wrappers ───────────────────────────────────────
// These are what the routes call so the dev/prod split lives in one place.

// Ranked list + this user's votes. Never throws — a backend hiccup renders empty.
export async function getRankedSuggestions(kcUser) {
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

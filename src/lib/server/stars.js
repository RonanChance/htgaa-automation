import { DEV_STUBS } from '$lib/server/devStubs.js';
import { pbAdmin } from '$lib/server/pb.js';

// Stars on community compositions. Each cfps_designs record carries a `starred_by`
// JSON list of { sub, name } — one entry per Keycloak user who starred it. Only the
// display names ever leave the server; the subject is used to answer "did I star
// this?" and to keep it one star per user. All writes go through the superuser
// client (the collection's update rule is null).
//
// On localhost (`vite dev`) an in-memory store stands in for PocketBase, keyed by
// the dummy community design ids in loadCommunityDesigns.js.
const DESIGNS = process.env.CFPS_COLLECTION || 'cfps_designs';

// Cap on ids per request — a batch card stars all of its members at once.
export const MAX_STAR_IDS = 50;

export function parseStarredBy(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.sub === 'string' && s.sub);
}

// What the client sees for one record: count, starrers' names, and whether the
// viewer is one of them.
export function starSummary(list, mySub) {
  return {
    starCount: list.length,
    starredBy: list.map((s) => String(s.name || 'anonymous')),
    starredByMe: !!mySub && list.some((s) => s.sub === mySub)
  };
}

// ── localhost dummy store ───────────────────────────────────────────────────
const DEV_STARS = new Map([
  ['dev-design-1', [{ sub: 'dev-grace', name: 'Grace H.' }, { sub: 'dev-ada', name: 'Ada L.' }]],
  ['dev-design-2', [{ sub: 'dev-ada', name: 'Ada L.' }]],
  ['dev-design-5', [{ sub: 'dev-grace', name: 'Grace H.' }]],
  ['dev-design-6', [{ sub: 'dev-grace', name: 'Grace H.' }]],
  ['dev-design-7', [{ sub: 'dev-grace', name: 'Grace H.' }]]
]);

export function devStarredBy(id) {
  return DEV_STARS.get(id) ?? [];
}

// Star (on=true) or unstar every id for this user. Idempotent per record. Returns
// { stars: { [id]: summary }, missing: [ids that don't exist] }.
export async function setStars(kcUser, ids, on) {
  const sub = String(kcUser?.sub || '').trim();
  if (!sub) throw new Error('Your session has no identity to star with.');
  const me = { sub, name: String(kcUser.name || 'anonymous').trim() };
  const apply = (list) => {
    const has = list.some((s) => s.sub === sub);
    if (on && !has) return [...list, me];
    if (!on && has) return list.filter((s) => s.sub !== sub);
    return list;
  };

  const stars = {};
  const missing = [];
  if (DEV_STUBS) {
    for (const id of ids) {
      const next = apply(devStarredBy(id));
      DEV_STARS.set(id, next);
      stars[id] = starSummary(next, sub);
    }
    return { stars, missing };
  }

  const pb = await pbAdmin();
  for (const id of ids) {
    let rec;
    try {
      rec = await pb.collection(DESIGNS).getOne(id, { fields: 'id,starred_by' });
    } catch (e) {
      if (e?.status === 404) { missing.push(id); continue; }
      throw e;
    }
    const list = parseStarredBy(rec.starred_by);
    const next = apply(list);
    if (next !== list) await pb.collection(DESIGNS).update(id, { starred_by: next });
    stars[id] = starSummary(next, sub);
  }
  return { stars, missing };
}

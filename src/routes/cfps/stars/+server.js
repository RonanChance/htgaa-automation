import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { loadCommunityDesigns } from '$lib/server/loadCommunityDesigns.js';
import { setStars, MAX_STAR_IDS } from '$lib/server/stars.js';

// Stars on community compositions. Signed-in users (browser cookie or an agent's
// bearer token) only — community compositions are login-gated.

// GET → the community compositions with their star info, newest first. Reagent
// lists are left out: this is for finding a composition to star, not for bulk export.
export async function GET(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to continue.' }, { status: 401 });
  const designs = await loadCommunityDesigns(kcUser);
  return json({
    compositions: designs.map(({ reagentList, ...d }) => d)
  });
}

// POST { action: 'star' | 'unstar', ids: [recordId, ...] }  (or a single `id`)
// → { stars: { [id]: { starCount, starredBy, starredByMe } }, missing: [...] }
export async function POST(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to star compositions.' }, { status: 401 });

  let body;
  try { body = await event.request.json(); } catch { body = {}; }
  const action = body?.action;
  if (action !== 'star' && action !== 'unstar') {
    return json({ error: "action must be 'star' or 'unstar'." }, { status: 400 });
  }
  const raw = Array.isArray(body?.ids) ? body.ids : (body?.id != null ? [body.id] : []);
  const ids = [...new Set(raw.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
  if (!ids.length) return json({ error: 'Missing composition id(s).' }, { status: 400 });
  if (ids.length > MAX_STAR_IDS) {
    return json({ error: `At most ${MAX_STAR_IDS} ids per request.` }, { status: 400 });
  }

  try {
    const result = await setStars(kcUser, ids, action === 'star');
    if (result.missing.length === ids.length) {
      return json({ error: 'Composition not found.', ...result }, { status: 404 });
    }
    return json(result);
  } catch (e) {
    return json({ error: e?.message ?? 'Could not update stars.' }, { status: 500 });
  }
}

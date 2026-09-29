import { json } from '@sveltejs/kit';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { getRankedSuggestions, submitSuggestion, upvote, downvote } from '$lib/server/suggestions.js';

// Lightweight JSON API for the suggested-reagents upvote widget. Kept separate
// from the page load so the ranking can be polled live (real-time ordering)
// without re-running the whole /cfps load (reagent groups, plate data, etc.).
// On localhost these all resolve to the in-memory dummy store (see suggestions.js).

// GET → current ranked list + this user's votes.
export async function GET({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  const data = await getRankedSuggestions(kcUser);
  return json({ ...data, signedIn: !!kcUser });
}

// POST → three actions, all Keycloak-gated, each returns the refreshed ranking:
//   { action: 'vote' | 'unvote', id }          cast / remove one upvote
//   { action: 'suggest', suggestion: {...} }    add a new community suggestion
export async function POST({ request, cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return json({ error: 'Sign in to continue.' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const action = body?.action;

  try {
    if (action === 'suggest') {
      const dict = body?.suggestion && typeof body.suggestion === 'object' ? body.suggestion : {};
      const name = String(dict.name ?? '').trim();
      if (!name) return json({ error: 'Reagent name is required.' }, { status: 400 });
      await submitSuggestion(kcUser, dict);
    } else if (action === 'vote' || action === 'unvote') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'Missing suggestion id.' }, { status: 400 });
      if (action === 'vote') await upvote(kcUser, id);
      else await downvote(kcUser, id);
    } else {
      return json({ error: 'Unknown action.' }, { status: 400 });
    }

    const data = await getRankedSuggestions(kcUser);
    return json({ ...data, signedIn: true });
  } catch (e) {
    return json({ error: e?.message ?? 'Could not complete request.' }, { status: 500 });
  }
}

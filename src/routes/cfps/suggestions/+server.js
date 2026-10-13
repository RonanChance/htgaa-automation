import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { getRankedSuggestions, suggestionsAsText, submitSuggestion, upvote, downvote, postComment, deleteComment, deleteSuggestion, updateSuggestion } from '$lib/server/suggestions.js';

// Lightweight JSON API for the suggested-reagents upvote widget. Kept separate
// from the page load so the ranking can be polled live (real-time ordering)
// without re-running the whole /cfps load (reagent groups, plate data, etc.).
// On localhost these all resolve to the in-memory dummy store (see suggestions.js).
// Auth: the browser session cookie, or an agent's bearer token ($lib/server/auth.js).

// GET             → current ranked list + this user's votes.
// GET ?format=txt → the ranked list (with comment threads) as plain text.
export async function GET(event) {
  const kcUser = await requestUser(event);
  const data = await getRankedSuggestions(kcUser);
  if (event.url.searchParams.get('format') === 'txt') {
    return kcUser
      ? new Response(suggestionsAsText(data.suggestions), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      : new Response('Sign in at /cfps to view the community reagent suggestions.\n', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return json({ ...data, signedIn: !!kcUser });
}

// POST actions, all Keycloak-gated, each returns the refreshed ranking:
//   { action: 'vote' | 'unvote', id }          cast / remove one upvote
//   { action: 'suggest', suggestion: {...} }    add a new community suggestion
//   { action: 'comment', id, body }            add a comment to a suggestion
//   { action: 'uncomment', id }                 delete one of your own comments
//   { action: 'update', id, suggestion: {...} } replace one of your own suggestions
//   { action: 'delete', id }                    delete one of your own suggestions
export async function POST(event) {
  const { request } = event;
  const kcUser = await requestUser(event);
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
    } else if (action === 'comment') {
      const id = typeof body?.id === 'string' ? body.id : '';
      const text = String(body?.body ?? '').trim();
      if (!id) return json({ error: 'Missing suggestion id.' }, { status: 400 });
      if (!text) return json({ error: 'Comment cannot be empty.' }, { status: 400 });
      await postComment(kcUser, id, text);
    } else if (action === 'uncomment') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'Missing comment id.' }, { status: 400 });
      await deleteComment(kcUser, id);
    } else if (action === 'update') {
      const id = typeof body?.id === 'string' ? body.id : '';
      const dict = body?.suggestion && typeof body.suggestion === 'object' && !Array.isArray(body.suggestion) ? body.suggestion : {};
      if (!id) return json({ error: 'Missing suggestion id.' }, { status: 400 });
      if (!String(dict.name ?? '').trim()) return json({ error: 'Reagent name is required.' }, { status: 400 });
      const res = await updateSuggestion(kcUser, id, dict);
      if (!res?.ok) {
        const status = res?.reason === 'not_found' ? 404 : 403;
        const msg = res?.reason === 'not_found'
          ? 'That suggestion no longer exists.'
          : 'You can only edit your own suggestions.';
        return json({ error: msg }, { status });
      }
    } else if (action === 'delete') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return json({ error: 'Missing suggestion id.' }, { status: 400 });
      const res = await deleteSuggestion(kcUser, id);
      if (!res?.ok) {
        const status = res?.reason === 'not_found' ? 404 : 403;
        const msg = res?.reason === 'not_found'
          ? 'That suggestion no longer exists.'
          : 'You can only delete your own suggestions.';
        return json({ error: msg }, { status });
      }
    } else {
      return json({ error: 'Unknown action.' }, { status: 400 });
    }

    const data = await getRankedSuggestions(kcUser);
    return json({ ...data, signedIn: true });
  } catch (e) {
    return json({ error: e?.message ?? 'Could not complete request.' }, { status: 500 });
  }
}

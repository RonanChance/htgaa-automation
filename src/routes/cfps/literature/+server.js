import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { getLiterature, addPaper, updatePaper, lookupDoi, votePaper, unvotePaper, deletePaper, literatureAsText } from '$lib/server/literature.js';

// Literature research list. Signed-in users only (browser cookie or an agent's
// bearer token), like the community reagents.

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

// GET             → { items: [paper, ...] (most upvoted first), votedIds: [...], signedIn }
// GET ?format=txt → the same list as plain text (the "↓" button opens this in a tab)
export async function GET(event) {
  const kcUser = await requestUser(event);
  const asText = event.url.searchParams.get('format') === 'txt';
  if (!kcUser) {
    return asText
      ? new Response('Sign in at /cfps to view the literature list.\n', { status: 401, headers: TEXT })
      : json({ error: 'Sign in to continue.', signedIn: false }, { status: 401 });
  }
  const data = await getLiterature(kcUser);
  if (asText) return new Response(literatureAsText(data.items), { headers: TEXT });
  return json({ ...data, signedIn: true });
}

// POST, JSON body:
//   { action: 'add', paper: { title, authors, published, venue, url, doi, summary, tags } }
//        title + (url or doi) required; a DOI alone fills the rest in.
//   { action: 'update', id, paper: {...} } edit a paper you added (partial is fine)
//   { action: 'lookup', doi }          → { paper } citation metadata, nothing stored
//   { action: 'vote' | 'unvote', id }  one upvote per user
//   { action: 'delete', id }           remove a paper you added
// Writes return the refreshed list (plus `added` — the saved paper — for 'add' / 'update').
export async function POST(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to continue.' }, { status: 401 });

  let body;
  try { body = await event.request.json(); } catch { body = {}; }
  const action = body?.action;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';

  try {
    let added = null;
    if (action === 'lookup') {
      try {
        return json({ paper: await lookupDoi(body?.doi ?? body?.url ?? '') });
      } catch (e) {
        return json({ error: e?.message ?? 'DOI lookup failed.' }, { status: 400 });
      }
    } else if (action === 'add') {
      const res = await addPaper(kcUser, body?.paper);
      if (!res.ok && res.reason === 'invalid') {
        return json({
          error: `Paper not added: ${res.errors.map((e) => e.message).join(' ')}`,
          errors: res.errors
        }, { status: 400 });
      }
      if (!res.ok && res.reason === 'duplicate') {
        return json({
          error: `Already on the list as "${res.existing.title}" — upvote it instead (id ${res.existing.id}).`,
          existing: res.existing
        }, { status: 409 });
      }
      added = res.item;
    } else if (action === 'update') {
      if (!id) return json({ error: 'Missing paper id.' }, { status: 400 });
      const res = await updatePaper(kcUser, id, body?.paper);
      if (!res.ok) {
        if (res.reason === 'invalid') {
          return json({ error: `Paper not updated: ${res.errors.map((e) => e.message).join(' ')}`, errors: res.errors }, { status: 400 });
        }
        if (res.reason === 'duplicate') {
          return json({ error: `Another entry already has that link/DOI: "${res.existing.title}" (id ${res.existing.id}).`, existing: res.existing }, { status: 409 });
        }
        return res.reason === 'forbidden'
          ? json({ error: 'You can only edit papers you added.' }, { status: 403 })
          : json({ error: 'That paper is not on the list.' }, { status: 404 });
      }
      added = res.item;
    } else if (action === 'vote' || action === 'unvote' || action === 'delete') {
      if (!id) return json({ error: 'Missing paper id.' }, { status: 400 });
      const res = action === 'vote' ? await votePaper(kcUser, id)
        : action === 'unvote' ? await unvotePaper(kcUser, id)
        : await deletePaper(kcUser, id);
      if (!res.ok) {
        return res.reason === 'forbidden'
          ? json({ error: 'You can only delete papers you added.' }, { status: 403 })
          : json({ error: 'That paper is not on the list.' }, { status: 404 });
      }
    } else {
      return json({ error: "action must be one of 'add', 'update', 'lookup', 'vote', 'unvote', 'delete'." }, { status: 400 });
    }
    return json({ ...(await getLiterature(kcUser)), signedIn: true, ...(added ? { added } : {}) });
  } catch (e) {
    return json({ error: e?.message ?? 'Could not complete request.' }, { status: 500 });
  }
}

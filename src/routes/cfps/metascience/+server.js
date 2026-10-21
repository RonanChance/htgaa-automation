import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import {
  getMetascience, addIdea, updateIdea, voteIdea, unvoteIdea, deleteIdea,
  commentOnIdea, deleteIdeaComment, metascienceAsText
} from '$lib/server/metascience.js';

// Metascience list: proposals for how we should choose which compositions go to
// the wet lab. Signed-in users only (browser cookie or an agent's bearer token),
// exactly like the literature list.

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

// GET             → { items: [idea, ...] (most upvoted first), votedIds: [...], signedIn }
// GET ?format=txt → the same list as plain text (the "↓" button opens this in a tab)
export async function GET(event) {
  const kcUser = await requestUser(event);
  const asText = event.url.searchParams.get('format') === 'txt';
  if (!kcUser) {
    return asText
      ? new Response('Sign in at /cfps to view the metascience list.\n', { status: 401, headers: TEXT })
      : json({ error: 'Sign in to continue.', signedIn: false }, { status: 401 });
  }
  const data = await getMetascience(kcUser);
  if (asText) return new Response(metascienceAsText(data.items), { headers: TEXT });
  return json({ ...data, signedIn: true });
}

// POST, JSON body:
//   { action: 'add', idea: { title, body } }        both required
//   { action: 'update', id, idea: {...} }           edit one of yours (partial is fine)
//   { action: 'vote' | 'unvote', id }               one upvote per user
//   { action: 'delete', id }                        remove one of yours
//   { action: 'comment', id, body }                 add to an idea's thread
//   { action: 'delete-comment', commentId }         remove a comment you wrote
// Writes return the refreshed list (plus `added` — the saved idea — for add/update).
export async function POST(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to continue.' }, { status: 401 });

  let body;
  try { body = await event.request.json(); } catch { body = {}; }
  const action = body?.action;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';

  try {
    let added = null;
    if (action === 'add') {
      const res = await addIdea(kcUser, body?.idea ?? body);
      if (!res.ok && res.reason === 'invalid') {
        return json({ error: `Idea not added: ${res.errors.map((e) => e.message).join(' ')}`, errors: res.errors }, { status: 400 });
      }
      if (!res.ok && res.reason === 'duplicate') {
        return json({
          error: `Already proposed as "${res.existing.title}" — upvote or comment on it instead (id ${res.existing.id}).`,
          existing: res.existing
        }, { status: 409 });
      }
      added = res.item;
    } else if (action === 'update') {
      if (!id) return json({ error: 'Missing idea id.' }, { status: 400 });
      const res = await updateIdea(kcUser, id, body?.idea ?? body);
      if (!res.ok) {
        if (res.reason === 'invalid') {
          return json({ error: `Idea not updated: ${res.errors.map((e) => e.message).join(' ')}`, errors: res.errors }, { status: 400 });
        }
        if (res.reason === 'duplicate') {
          return json({ error: `Another idea already has that title: "${res.existing.title}" (id ${res.existing.id}).`, existing: res.existing }, { status: 409 });
        }
        return res.reason === 'forbidden'
          ? json({ error: 'You can only edit ideas you added.' }, { status: 403 })
          : json({ error: 'That idea is not on the list.' }, { status: 404 });
      }
      added = res.item;
    } else if (action === 'comment') {
      if (!id) return json({ error: 'Missing idea id.' }, { status: 400 });
      const res = await commentOnIdea(kcUser, id, body?.body ?? body?.comment);
      if (!res.ok) {
        return res.reason === 'empty'
          ? json({ error: 'A comment needs some text.' }, { status: 400 })
          : json({ error: 'That idea is not on the list.' }, { status: 404 });
      }
    } else if (action === 'delete-comment') {
      const commentId = typeof body?.commentId === 'string' ? body.commentId.trim() : '';
      if (!commentId) return json({ error: 'Missing comment id.' }, { status: 400 });
      const res = await deleteIdeaComment(kcUser, commentId);
      if (!res.ok) {
        return res.reason === 'forbidden'
          ? json({ error: 'You can only delete your own comments.' }, { status: 403 })
          : json({ error: 'That comment no longer exists.' }, { status: 404 });
      }
    } else if (action === 'vote' || action === 'unvote' || action === 'delete') {
      if (!id) return json({ error: 'Missing idea id.' }, { status: 400 });
      const res = action === 'vote' ? await voteIdea(kcUser, id)
        : action === 'unvote' ? await unvoteIdea(kcUser, id)
        : await deleteIdea(kcUser, id);
      if (!res.ok) {
        return res.reason === 'forbidden'
          ? json({ error: 'You can only delete ideas you added.' }, { status: 403 })
          : json({ error: 'That idea is not on the list.' }, { status: 404 });
      }
    } else {
      return json({ error: "action must be one of 'add', 'update', 'vote', 'unvote', 'delete', 'comment', 'delete-comment'." }, { status: 400 });
    }
    return json({ ...(await getMetascience(kcUser)), signedIn: true, ...(added ? { added } : {}) });
  } catch (e) {
    return json({ error: e?.message ?? 'Could not complete request.' }, { status: 500 });
  }
}

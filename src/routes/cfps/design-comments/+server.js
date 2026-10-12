import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { loadDesignComments, loadThread, postDesignComment, deleteDesignComment } from '$lib/server/designComments.js';

// Comment threads on community compositions. Signed-in users only (browser cookie
// or an agent's bearer token) — community compositions are login-gated.

// GET            → { threads: { [designId]: [comment, ...] } }
// GET ?id=<id>   → { id, comments: [...] } for one composition
export async function GET(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to continue.' }, { status: 401 });
  const id = event.url.searchParams.get('id');
  if (id) {
    try {
      return json({ id, comments: await loadThread(kcUser, id) });
    } catch (e) {
      return json({ error: e?.message ?? 'Could not load comments.' }, { status: 500 });
    }
  }
  return json({ threads: await loadDesignComments(kcUser) });
}

// POST { action: 'comment', id: <composition id>, body: '...' }   add a comment
//      { action: 'uncomment', id: <comment id> }                  delete your own
// → { id: <composition id>, comments: [...] } — the refreshed thread.
export async function POST(event) {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in to comment.' }, { status: 401 });

  let body;
  try { body = await event.request.json(); } catch { body = {}; }
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) return json({ error: 'Missing id.' }, { status: 400 });

  try {
    if (body?.action === 'comment') {
      const res = await postDesignComment(kcUser, id, body?.body);
      if (!res.ok) {
        return res.reason === 'not_found'
          ? json({ error: 'That composition no longer exists.' }, { status: 404 })
          : json({ error: 'Comment cannot be empty.' }, { status: 400 });
      }
      return json({ id, comments: await loadThread(kcUser, id) });
    }
    if (body?.action === 'uncomment') {
      const res = await deleteDesignComment(kcUser, id);
      if (!res.ok) {
        return res.reason === 'not_found'
          ? json({ error: 'That comment no longer exists.' }, { status: 404 })
          : json({ error: 'You can only delete your own comments.' }, { status: 403 });
      }
      return json({ id: res.designId, comments: await loadThread(kcUser, res.designId) });
    }
    return json({ error: "action must be 'comment' or 'uncomment'." }, { status: 400 });
  } catch (e) {
    return json({ error: e?.message ?? 'Could not complete request.' }, { status: 500 });
  }
}

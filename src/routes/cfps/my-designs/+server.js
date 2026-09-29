import { pbAdmin } from '$lib/server/pb.js';
import { json } from '@sveltejs/kit';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { dev } from '$app/environment';

// Manage the signed-in user's own CFPS compositions in the cfps_designs
// collection — rename / edit metadata (op: "update") or remove (op: "delete").
// Both operations are Keycloak-gated and ownership-checked: ownership prefers the
// stable Keycloak subject (`author_sub`), falling back to the display name
// (`author`) for legacy records submitted before author_sub was stored.
// updateRule / deleteRule are null on the collection, so the mutation goes
// through the superuser-authed admin client server-side.
const COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';
const PROTEIN_TARGETS = ['sfGFP', 'PETase', 'Reteplase'];

export const POST = async ({ request, cookies }) => {
  try {
    const kcUser = readSession(cookies.get(KC_COOKIE));
    if (!kcUser) {
      return json({ success: false, error: 'Sign in to manage your compositions.' }, { status: 401 });
    }
    const me = String(kcUser.name || '').trim();
    const mySub = String(kcUser.sub || '').trim();
    if (!me && !mySub) {
      return json({ success: false, error: 'Your session has no identity to match compositions against.' }, { status: 400 });
    }

    const body = await request.json();
    const op = body?.op;
    if (op !== 'update' && op !== 'delete' && op !== 'reorder') {
      return json({ success: false, error: 'Unknown operation.' }, { status: 400 });
    }

    // ── reorder: persist the drag-priority rank of a whole group of cards ────────
    // Payload: { op:'reorder', order: [{ id, rank }, ...] } with rank 1..N. Each
    // record is ownership-checked before its rank is written.
    if (op === 'reorder') {
      const order = Array.isArray(body?.order) ? body.order : null;
      if (!order || !order.length) {
        return json({ success: false, error: 'Missing reorder payload.' }, { status: 400 });
      }
      const clean = order
        .map((o) => ({ id: String(o?.id || '').trim(), rank: Number(o?.rank) }))
        .filter((o) => o.id && Number.isFinite(o.rank));
      if (!clean.length) {
        return json({ success: false, error: 'No valid entries to reorder.' }, { status: 400 });
      }
      if (dev) {
        return json({ success: true, reordered: clean.length, dev: true });
      }
      const pb = await pbAdmin();
      const updated = [];
      for (const o of clean) {
        let rec;
        try {
          rec = await pb.collection(COLLECTION).getOne(o.id);
        } catch {
          continue; // skip records that no longer exist
        }
        const recSub = String(rec.author_sub || '').trim();
        const owns = recSub ? recSub === mySub : (!!me && String(rec.author || '').trim() === me);
        if (!owns) continue; // silently skip cards the user doesn't own
        await pb.collection(COLLECTION).update(o.id, {
          rank: o.rank,
          ...(recSub ? {} : (mySub ? { author_sub: mySub } : {}))
        });
        updated.push(o.id);
      }
      return json({ success: true, reordered: updated.length });
    }

    // update / delete both target a single record by id.
    const id = String(body?.id || '').trim();
    if (!id) {
      return json({ success: false, error: 'Missing composition id.' }, { status: 400 });
    }

    // On localhost there's no PocketBase to talk to (the community/my-design
    // loaders return a dummy store), so treat mutations as a no-op success.
    if (dev) {
      return json({ success: true, id, dev: true });
    }

    const pb = await pbAdmin();
    let rec;
    try {
      rec = await pb.collection(COLLECTION).getOne(id);
    } catch {
      return json({ success: false, error: 'Composition not found.' }, { status: 404 });
    }

    // Ownership: prefer the stable Keycloak subject; fall back to display name for
    // legacy records that predate author_sub. A user may only touch their own.
    const recSub = String(rec.author_sub || '').trim();
    const owns = recSub ? recSub === mySub : (!!me && String(rec.author || '').trim() === me);
    if (!owns) {
      return json({ success: false, error: 'You can only edit your own compositions.' }, { status: 403 });
    }

    if (op === 'delete') {
      await pb.collection(COLLECTION).delete(id);
      return json({ success: true, deleted: id });
    }

    // op === 'update'
    const name = String(body?.name || '').trim();
    if (!name) {
      return json({ success: false, error: 'Name is required.' }, { status: 400 });
    }
    const proteinTarget = PROTEIN_TARGETS.includes(body?.proteinTarget) ? body.proteinTarget : null;
    const aiModel = String(body?.aiModel || '').trim();
    const acknowledgements = String(body?.acknowledgements || '').trim();
    const comments = String(body?.comments || '').trim();

    let dj = rec.design_json;
    if (typeof dj === 'string') {
      try { dj = JSON.parse(dj); } catch { dj = {}; }
    }
    dj = (dj && typeof dj === 'object' && !Array.isArray(dj)) ? dj : {};
    const md = (dj.metadata && typeof dj.metadata === 'object') ? dj.metadata : {};

    const nextDesignJson = {
      ...dj,
      sample_id: name,
      metadata: {
        ...md,
        ai_model: aiModel,
        protein_target: proteinTarget ?? md.protein_target ?? null,
        acknowledgements,
        comments
      }
    };

    const updated = await pb.collection(COLLECTION).update(id, {
      title: name,
      rationale: comments || null,
      design_json: nextDesignJson,
      // Backfill the stable id on legacy (name-matched) records so subsequent
      // ownership checks use author_sub.
      ...(recSub ? {} : (mySub ? { author_sub: mySub } : {}))
    });

    return json({ success: true, id: updated.id });
  } catch (error) {
    return json(
      { success: false, error: error?.message || 'Request failed.' },
      { status: 500 }
    );
  }
};

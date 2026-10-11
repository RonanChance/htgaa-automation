import { pbAdmin } from '$lib/server/pb.js';
import { json } from '@sveltejs/kit';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { dev } from '$app/environment';
import {
  PROTEIN_TEMPLATE_FIELD,
  TEMPLATE_FIELDS,
  validateReagentList
} from '$lib/cfpsReagentContract.js';

// Manage the signed-in user's own CFPS compositions in the cfps_designs
// collection — rename / edit metadata (op: "update") or remove (op: "delete").
// Both operations are Keycloak-gated and ownership-checked SOLELY against the
// stable Keycloak subject (`author_sub`); display names aren't unique, so matching
// on `author` is not trusted for ownership. updateRule / deleteRule are null on the
// collection, so the mutation goes through the superuser-authed admin client
// server-side.
const COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';
const PROTEIN_TARGETS = ['sfGFP', 'PETase', 'Reteplase'];

// Round a monetary value to two decimal places (cents). Non-finite → 0.
function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export const POST = async ({ request, cookies }) => {
  try {
    const kcUser = readSession(cookies.get(KC_COOKIE));
    if (!kcUser) {
      return json({ success: false, error: 'Sign in to manage your compositions.' }, { status: 401 });
    }
    const mySub = String(kcUser.sub || '').trim();
    if (!mySub) {
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
        const owns = String(rec.author_sub || '').trim() === mySub;
        if (!owns) continue; // silently skip cards the user doesn't own
        await pb.collection(COLLECTION).update(o.id, { rank: o.rank });
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

    // Ownership: the stable Keycloak subject must match. A user may only touch
    // their own compositions.
    const owns = String(rec.author_sub || '').trim() === mySub;
    if (!owns) {
      return json({ success: false, error: 'You can only edit your own compositions.' }, { status: 403 });
    }

    if (op === 'delete') {
      await pb.collection(COLLECTION).delete(id);
      return json({ success: true, deleted: id });
    }

    // op === 'update'
    // Two shapes:
    //  • Full composition update ({ sample }): the Designer's "Update existing"
    //    button rewrites the record's reagent_list + metadata in place, validated
    //    against the same CFPSReagentList contract as the submit flow. Used when a
    //    user loads one of their own compositions, tweaks the volumes/target, and
    //    saves over the original instead of creating a new submission.
    //  • Metadata-only update (name/proteinTarget/comments/…): the My Compositions
    //    inline editor, which never touches the reagent_list.
    const sample = body?.sample;
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      const reagentList = sample.reagent_list;
      if (!reagentList || typeof reagentList !== 'object' || Array.isArray(reagentList)) {
        return json({ success: false, error: 'reagent_list is required.' }, { status: 400 });
      }
      const listCheck = validateReagentList(reagentList);
      if (!listCheck.valid) {
        return json(
          { success: false, error: `Invalid reagent_list: ${listCheck.errors.join(' ')}` },
          { status: 400 }
        );
      }
      const md = (sample.metadata && typeof sample.metadata === 'object') ? sample.metadata : {};
      const target = String(md.protein_target || '').trim();
      const expectedTemplate = PROTEIN_TEMPLATE_FIELD[target];
      if (!expectedTemplate) {
        return json(
          { success: false, error: 'metadata.protein_target must be one of: sfGFP, PETase, Reteplase.' },
          { status: 400 }
        );
      }
      const templatesPresent = TEMPLATE_FIELDS.filter((t) => (Number(reagentList[t]) || 0) > 0);
      if (templatesPresent.length !== 1 || templatesPresent[0] !== expectedTemplate) {
        return json(
          {
            success: false,
            error: `reagent_list must contain exactly ${expectedTemplate} (the template for ${target}) and no other DNA template.`
          },
          { status: 400 }
        );
      }
      // Keep the record's existing sample_id (title) unless the client sent one; the
      // title is unique in the collection, so updating in place must not rename it to
      // something that collides with another record.
      const sampleId = String(sample.sample_id || rec.title || '').trim() || rec.title;
      const totalNl = Object.values(reagentList).reduce((s, v) => s + (Number(v) || 0), 0);
      const updated = await pb.collection(COLLECTION).update(id, {
        title: sampleId,
        rationale: String(md.comments || '').trim() || null,
        design_json: { ...sample, sample_id: sampleId },
        total_volume_nl: totalNl,
        total_cost_usd: round2(body.totalCostUsd),
        cost_per_ml_reaction: round2(body.costPerMlReaction)
      });
      return json({ success: true, id: updated.id });
    }

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
      design_json: nextDesignJson
    });

    return json({ success: true, id: updated.id });
  } catch (error) {
    return json(
      { success: false, error: error?.message || 'Request failed.' },
      { status: 500 }
    );
  }
};

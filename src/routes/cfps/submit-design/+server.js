import { pbAdmin } from '$lib/server/pb.js';
import { json } from '@sveltejs/kit';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import {
  PROTEIN_TEMPLATE_FIELD,
  TEMPLATE_FIELDS,
  validateReagentList
} from '$lib/cfpsReagentContract.js';

// Reagent-supplement compositions from the Cell-Free Reaction Designer are written
// to the same PocketBase collection as the older publish flow (cfps_designs), but
// in the autonomous-cfps CFPSReagentList shape ({ sample_id, sample_type,
// reagent_list, metadata }). createRule is null on the collection, so the write
// must go through the superuser-authed admin client server-side.
//
// The reagent_list contract (recognized fields, non-negative 25 nL-grid volumes,
// base_buffer=2000, lysate=5000, exactly one template at 2000 nL, total=20,000 nL)
// and the protein_target → template map live in $lib/cfpsReagentContract.js, shared
// with the browser designer so the two validators can never drift.
const COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';

// Round a monetary value to two decimal places (cents). Non-finite → 0.
function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export const POST = async ({ request, cookies }) => {
  try {
    // Composition submission is Keycloak-gated: only signed-in users may write.
    const kcUser = readSession(cookies.get(KC_COOKIE));
    if (!kcUser) {
      return json({ success: false, error: 'Sign in to submit a composition.' }, { status: 401 });
    }

    const body = await request.json();
    const sample = body?.sample;

    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      return json({ success: false, error: 'Missing composition.' }, { status: 400 });
    }
    const sampleId = String(sample.sample_id || '').trim();
    if (!sampleId) {
      return json({ success: false, error: 'sample_id is required.' }, { status: 400 });
    }
    const reagentList = sample.reagent_list;
    if (!reagentList || typeof reagentList !== 'object' || Array.isArray(reagentList)) {
      return json({ success: false, error: 'reagent_list is required.' }, { status: 400 });
    }

    const totalNl = Object.values(reagentList).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const metadata = (sample.metadata && typeof sample.metadata === 'object') ? sample.metadata : {};

    // Authoritative reagent_list validation against the shared CFPSReagentList
    // contract: recognized fields only, non-negative 25 nL-grid volumes,
    // base_buffer=2000, lysate=5000, exactly one DNA template at 2000 nL, and a
    // total of exactly 20,000 nL. This is the server's last line of defense — the
    // browser runs the same check, but nothing trusts the client.
    const listCheck = validateReagentList(reagentList);
    if (!listCheck.valid) {
      return json(
        { success: false, error: `Invalid reagent_list: ${listCheck.errors.join(' ')}` },
        { status: 400 }
      );
    }

    // Gate on the DNA template matching protein_target — the contract already
    // guarantees exactly one template at 2000 nL, so here we only confirm that the
    // single template present is the one for the chosen target. This blocks any
    // mismatched submission (e.g. protein_target PETase carrying template_sfgfp).
    const proteinTarget = String(metadata.protein_target || '').trim();
    const expectedTemplate = PROTEIN_TEMPLATE_FIELD[proteinTarget];
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
          error: `reagent_list must contain exactly ${expectedTemplate} (the template for ${proteinTarget}) and no other DNA template.`
        },
        { status: 400 }
      );
    }

    const pb = await pbAdmin();

    // Uniqueness gate: sample_id (stored as `title`) must not already exist —
    // duplicate ids can't be written to the database.
    try {
      await pb.collection(COLLECTION).getFirstListItem(pb.filter('title = {:t}', { t: sampleId }));
      return json(
        { success: false, error: `A composition with sample_id "${sampleId}" already exists — give it a unique id.` },
        { status: 409 }
      );
    } catch (lookupError) {
      // 404 = no existing record, which is what we want. Anything else is a real
      // failure and should abort the write.
      if (lookupError?.status && lookupError.status !== 404) throw lookupError;
    }

    const record = await pb.collection(COLLECTION).create({
      title: sampleId,
      author: (kcUser.name || String(body.author || metadata.acknowledgements || '')).trim(),
      // Stable per-user identity (Keycloak subject). Names aren't unique, so this
      // is what ownership checks and "My Compositions" filtering prefer.
      author_sub: String(kcUser.sub || '').trim() || null,
      rationale: String(metadata.comments || '').trim() || null,
      design_json: sample,
      total_volume_nl: totalNl,
      total_cost_usd: round2(body.totalCostUsd),
      cost_per_ml_reaction: round2(body.costPerMlReaction)
    });

    return json({ success: true, id: record.id });
  } catch (error) {
    return json(
      { success: false, error: error?.message || 'Unable to submit composition.' },
      { status: 500 }
    );
  }
};

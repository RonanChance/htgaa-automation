import { pbAdmin } from '$lib/server/pb.js';
import { json } from '@sveltejs/kit';
import { readSession, KC_COOKIE } from '$lib/server/session.js';

// Reagent-supplement compositions from the Cell-Free Reaction Designer are written
// to the same PocketBase collection as the older publish flow (cfps_designs), but
// in the autonomous-cfps CFPSReagentList shape ({ sample_id, sample_type,
// reagent_list, metadata }). createRule is null on the collection, so the write
// must go through the superuser-authed admin client server-side.
const COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';

// Best-effort request origin, mirrored from /save-cfps so both flows record the
// same submission_location shape.
function extractSubmissionLocation(headers, getClientAddress) {
  const forwardedFor = headers.get('x-forwarded-for') || '';
  const ip =
    forwardedFor.split(',')[0].trim() ||
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-client-ip') ||
    (typeof getClientAddress === 'function' ? getClientAddress() : null) ||
    null;
  return {
    ip,
    country: headers.get('cf-ipcountry') || headers.get('x-vercel-ip-country') || null,
    region: headers.get('x-vercel-ip-country-region') || null,
    city: headers.get('x-vercel-ip-city') || null
  };
}

export const POST = async ({ request, getClientAddress, cookies }) => {
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

    const pb = await pbAdmin();
    const record = await pb.collection(COLLECTION).create({
      title: sampleId,
      author: (kcUser.name || String(body.author || metadata.acknowledgements || '')).trim(),
      // Stable per-user identity (Keycloak subject). Names aren't unique, so this
      // is what ownership checks and "My Compositions" filtering prefer.
      author_sub: String(kcUser.sub || '').trim() || null,
      rationale: String(metadata.comments || '').trim() || null,
      submission_location: extractSubmissionLocation(request.headers, getClientAddress),
      design_json: sample,
      total_volume_nl: totalNl,
      total_cost_usd: Number(body.totalCostUsd) || 0,
      cost_per_ml_reaction: Number(body.costPerMlReaction) || 0
    });

    return json({ success: true, id: record.id });
  } catch (error) {
    return json(
      { success: false, error: error?.message || 'Unable to submit composition.' },
      { status: 500 }
    );
  }
};

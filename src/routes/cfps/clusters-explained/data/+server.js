import { json, error } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { modelPart, designPart } from '$lib/server/clusterExplain.js';

// GET ?target=sfGFP → what the walkthrough draws (see clusterExplain.js).
//
//   model    the GP and Ginkgo's control wells — public on Clinton's arena
//            page already, so everyone gets it
//   designs  every design as an anonymous vector, its group and role — derived
//            from the submissions, so only for a signed-in caller (null
//            otherwise, with locked: true)
export async function GET(event) {
  const target = event.url.searchParams.get('target') ?? 'sfGFP';
  const user = await requestUser(event);
  let model, designs = null;
  try {
    model = await modelPart(target);
    if (model && user) designs = await designPart(target);
  } catch (e) {
    console.error('clusters-explained data failed:', e);
    throw error(503, 'The cluster data is unavailable right now.');
  }
  if (!model) throw error(404, 'Unknown target.');
  return json(
    { model, designs, locked: !user },
    // Per-user once designs are in it: never in a shared cache.
    { headers: { 'Cache-Control': 'private, max-age=300', Vary: 'Cookie, Authorization' } }
  );
}

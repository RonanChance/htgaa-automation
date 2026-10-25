import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';
import { loadCommunityDesigns } from '$lib/server/loadCommunityDesigns.js';

// The final four-plates-per-target picker. Login-gated exactly like /cfps and
// /cfps/analysis: recipes, names and rationales never reach an anonymous visitor.
//
// Compositions are loaded LIVE (no cache) and the selection itself runs in the
// browser from this data, so editing a composition and reloading re-derives the
// plates from the edited recipe — the picked set is never stored.
export async function load({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return { locked: true, kcConfigured: kcIsConfigured() };

  const designs = await loadCommunityDesigns(kcUser, { live: true });
  return {
    locked: false,
    kcUser: { name: kcUser.name },
    loadedAt: new Date().toISOString(),
    // Only what the selector and the tables need, so the payload stays small.
    designs: designs.map((d) => ({
      id: d.id,
      name: d.name,
      author: d.author,
      contributorKey: d.contributorKey,
      proteinTarget: d.proteinTarget,
      reagentList: d.reagentList,
      batchId: d.batchId,
      batchSize: d.batchSize,
      batchIndex: d.batchIndex,
      experimentHypothesis: d.experimentHypothesis,
      comments: d.comments,
      created: d.created
    }))
  };
}

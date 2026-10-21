import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';
import { loadCommunityDesigns } from '$lib/server/loadCommunityDesigns.js';
import { loadBenchmarkFormulations } from '$lib/server/loadBenchmarkFormulations.js';
import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import { fetchRankedSuggestions } from '$lib/server/suggestions.js';
import { pbAdmin } from '$lib/server/pb.js';
import { analyzeSubmissions, TARGET_APPROACHES } from '$lib/cfpsSubmissionAnalysis.js';

// Community submissions analysis. Login-gated exactly like the community data on
// /cfps: an anonymous visitor gets no analysis (names, rationales and recipes never
// leave the server), just a sign-in prompt.
export async function load({ url, cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return { locked: true, kcConfigured: kcIsConfigured() };

  const [designs, formulations, catalog, suggestions] = await Promise.all([
    loadCommunityDesigns(kcUser, { live: true }),
    loadBenchmarkFormulations(),
    loadCfpsReagentGroups(url),
    pbAdmin()
      .then((pb) => fetchRankedSuggestions(pb, kcUser))
      .then((r) => r.suggestions)
      .catch(() => [])
  ]);
  // Carry each reagent's catalog group so stock added later lands on the right lever.
  const reagents = (catalog?.reagentGroups ?? []).flatMap((g) => (g.reagents ?? []).map((r) => ({ ...r, group: g.name })));

  return {
    locked: false,
    kcUser: { name: kcUser.name },
    approaches: TARGET_APPROACHES,
    analysis: analyzeSubmissions({ designs, reagents, formulations, suggestions })
  };
}

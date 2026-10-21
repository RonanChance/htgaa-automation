import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import { loadPlateAnalysis, loadPlateReader } from '$lib/server/plateStore.js';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';
import { loadSuggestions } from '$lib/server/suggestions.js';
import { loadCommunityDesigns, loadMyDesigns, loadSharedDesigns } from '$lib/server/loadCommunityDesigns.js';
import { loadBenchmarkFormulations } from '$lib/server/loadBenchmarkFormulations.js';
import { loadDesignComments } from '$lib/server/designComments.js';
import { getLiterature } from '$lib/server/literature.js';
import { getMetascience } from '$lib/server/metascience.js';
import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';

export async function load({ url, cookies }) {
  const data = await loadCfpsReagentGroups(url);
  const [plateAnalysis, plateReader] = await Promise.all([loadPlateAnalysis(), loadPlateReader()]);
  const kcUser = readSession(cookies.get(KC_COOKIE));
  // Community reagents are login-gated: anonymous visitors get no suggestions in
  // their page data (the client shows a scrambled sign-in teaser instead).
  const { suggestions, votedSuggestionIds } = kcUser
    ? await loadSuggestions(kcUser)
    : { suggestions: [], votedSuggestionIds: [] };
  // Personal compositions and the community list as a whole are only ever loaded
  // for a signed-in user, so an anonymous visitor's page data (SSR and
  // __data.json) never carries the dataset.
  // A signed-in user gets the whole community list. A signed-out visitor gets
  // ONLY the compositions a shared link names (?batch=<id,…> / ?design=<id>), so
  // the link works without an account while the rest of the dataset stays
  // members-only — see loadSharedDesigns for why that is safe.
  const communityDesigns = kcUser
    ? await loadCommunityDesigns(kcUser)
    : await loadSharedDesigns([
        ...String(url.searchParams.get('batch') ?? '').split(','),
        url.searchParams.get('design') ?? ''
      ]);
  const myDesigns = kcUser ? await loadMyDesigns(kcUser) : [];
  // Comment threads on those compositions ({ [designId]: [...] }) and the shared
  // literature list — both login-gated the same way.
  const designComments = kcUser ? await loadDesignComments(kcUser) : {};
  const literature = kcUser ? await getLiterature(kcUser) : { items: [], votedIds: [] };
  // Metascience: proposals for how we pick which compositions reach the bench.
  const metascience = kcUser ? await getMetascience(kcUser) : { items: [], votedIds: [] };
  const benchmarkFormulations = await loadBenchmarkFormulations();

  return {
    ...data,
    plateAnalysis,
    plateReader,
    kcConfigured: kcIsConfigured(),
    devMode: dev,
    kcUser: kcUser ? { name: kcUser.name } : null,
    suggestions,
    votedSuggestionIds,
    communityDesigns,
    myDesigns,
    designComments,
    literature,
    metascience,
    benchmarkFormulations,
  };
}

export const actions = {
  // Community reagent voting + suggesting is handled by the /cfps/suggestions
  // JSON endpoint (live-polled ranking). Only session logout lives here.
  kcLogout: async ({ cookies }) => {
    cookies.delete(KC_COOKIE, { path: '/cfps' });
    redirect(303, '/cfps');
  },
};

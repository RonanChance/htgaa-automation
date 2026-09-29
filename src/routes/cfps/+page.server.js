import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import { loadPlateAnalysis, loadPlateReader } from '$lib/server/plateStore.js';
import { pbAdmin } from '$lib/server/pb.js';
import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';
import { loadSuggestions } from '$lib/server/suggestions.js';
import { loadCommunityDesigns, loadMyDesigns } from '$lib/server/loadCommunityDesigns.js';
import { loadBenchmarkFormulations } from '$lib/server/loadBenchmarkFormulations.js';
import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';

// Editable reagent-prompt copy lives in the static_values collection so it can be
// changed on the fly (in PocketBase) without a redeploy. viewRule is null on that
// collection, so the read must go through the superuser-authed admin client.
const STATIC_VALUES = 'static_values';
const REAGENT_PROMPT_RECORD_ID = 'pbni942iw4vbq09';

async function loadReagentPrompt() {
  try {
    const pb = await pbAdmin();
    const rec = await pb.collection(STATIC_VALUES).getOne(REAGENT_PROMPT_RECORD_ID);
    const text = typeof rec?.text === 'string' ? rec.text : '';
    return text.trim() ? text : null;
  } catch {
    // Non-critical — fall back to the client-generated prompt if the read fails.
    return null;
  }
}

export async function load({ url, cookies }) {
  const data = await loadCfpsReagentGroups(url);
  const [plateAnalysis, plateReader] = await Promise.all([loadPlateAnalysis(), loadPlateReader()]);
  const kcUser = readSession(cookies.get(KC_COOKIE));
  const { suggestions, votedSuggestionIds } = await loadSuggestions(kcUser);
  const reagentPrompt = await loadReagentPrompt();
  const communityDesigns = await loadCommunityDesigns();
  const myDesigns = await loadMyDesigns(kcUser);
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
    reagentPrompt,
    communityDesigns,
    myDesigns,
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

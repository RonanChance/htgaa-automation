import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';

export async function load({ url }) {
  return {
    cfpsData: await loadCfpsReagentGroups(url)
  };
}

import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';

export async function load({ url }) {
  return loadCfpsReagentGroups(url);
}

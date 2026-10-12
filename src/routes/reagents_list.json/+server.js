import { json } from '@sveltejs/kit';
import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import { PYDANTIC_REAGENT_FIELDS } from '$lib/cfpsReagentContract.js';
import { REAGENT_ID_TO_PYDANTIC } from '$lib/cfpsReagentIdMap.js';

// Public reagent catalog at /reagents_list.json (read by the legacy agent guide,
// static/cfps/skill.md). Served live from PocketBase instead of a committed static
// copy, so it can't drift from the catalog the designer uses — and only reagents
// the autonomous-cfps model approves (CFPSReagentList fields) are listed. Same shape
// the old file had: [{ name, reagents: [{ id, name, concentration, in_stock, fixedNl? }] }].
// Costs and internal LIMS ids are deliberately left out.
const isApproved = (r) => PYDANTIC_REAGENT_FIELDS.has(REAGENT_ID_TO_PYDANTIC[r.id] || r.id);

export async function GET() {
  const { reagentGroups } = await loadCfpsReagentGroups(null);
  const groups = (reagentGroups || [])
    .map((g) => ({
      name: g.name,
      reagents: (g.reagents || []).filter(isApproved).map((r) => ({
        id: r.id,
        name: r.name,
        concentration: r.concentration,
        in_stock: r.in_stock !== false,
        ...(r.fixedNl != null ? { fixedNl: r.fixedNl } : {}),
        ...(r.molecular_weight_g_mol != null ? { molecular_weight_g_mol: r.molecular_weight_g_mol } : {})
      }))
    }))
    .filter((g) => g.reagents.length);
  if (!groups.length) return json({ error: 'Reagent catalog unavailable — try again shortly.' }, { status: 503 });
  return json(groups, { headers: { 'cache-control': 'public, max-age=300' } });
}

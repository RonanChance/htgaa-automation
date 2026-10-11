// Bridge between the CFPS designer's app-facing reagent ids (curated for the UI:
// grouping, display names, a single combined `dna_template`) and the autonomous-cfps
// CFPSReagentList field names. Only ids that DIFFER are listed; anything not here
// passes through unchanged (most ids already match the field name).
//
// Pure ESM, no imports -- shared by the browser designer (src/routes/cfps/+page.svelte),
// and by the Node sync tool (tools/sync-cfps.mjs) that maps model costs onto the
// PocketBase reagent-groups record. Keeping it in one place stops the map itself
// from drifting between client and tooling.
export const REAGENT_ID_TO_PYDANTIC = {
  aa_mix_17: 'amino_acid_mix_17',
  cell_lysate: 'lysate',
  dna_template: 'template_sfgfp',
  putrescine_dihydrochloride: 'putrescine',
  potassium_phosphate_ratio_monobasic_dibasic: 'kpo_monobasic_mix',
  potassium_phosphate_ratio_dibasic_monobasic: 'kpo_dibasic_mix'
  // NOTE: do NOT remap any app id onto 'pep_mono'. The app's PEP reagent id IS
  // 'pep_mono' (0.1 M, the canonical PANOx-SP PEP, == the contract field name), so it
  // passes through unchanged in both directions. A previous entry remapped a second,
  // duplicate reagent (phosphoenolpyruvic_acid_cyclohexylammonium_salt, 0.5 M) onto
  // 'pep_mono'; because the reverse map is derived from this one, that hijacked the
  // import of the 'pep_mono' field onto the wrong (0.5 M) reagent — PEP then vanished
  // from the pep_mono row on reopen / JSON paste. The duplicate reagent was removed.
};

// Reverse map: CFPSReagentList field name -> app reagent id. Lets a plate-reader
// well recipe (keyed by pydantic field names) be mapped back onto the design sliders.
export const PYDANTIC_TO_REAGENT_ID = Object.fromEntries(
  Object.entries(REAGENT_ID_TO_PYDANTIC).map(([appId, field]) => [field, appId])
);

// Single source of truth for the autonomous-cfps `CFPSReagentList` contract
// (models.py). Imported by BOTH the browser designer (src/routes/cfps/+page.svelte)
// and the submit endpoint (src/routes/cfps/submit-design/+server.js) so the
// client-side validation and the authoritative server-side gate can never drift.
//
// The DATA below (recognized field names, the 25 nL grid, the fixed 20 µL total,
// base_buffer / lysate / template volumes, the template list) is not hand-written:
// it is imported from ./cfpsReagentSpec.generated.json, which is regenerated from
// the pydantic model by `npm run sync:cfps`. Only the validation LOGIC lives here,
// in git, so behaviour changes stay reviewable.

import spec from './cfpsReagentSpec.generated.json';

// Echo dispense grid: every volume is a whole multiple of this many nL.
export const STEP_NL = spec.stepNl;
// The reaction is a fixed 20 µL well; all volumes must sum to exactly this.
export const MAX_TOTAL_NL = spec.maxTotalNl;
// Fixed-by-default backbone volumes and the per-template dose (all in nL).
export const BASE_BUFFER_NL = spec.baseBufferNl;
export const LYSATE_NL = spec.lysateNl;
export const TEMPLATE_VOLUME_NL = spec.templateVolumeNl;

// The recognized reagent field names. The reagent_list must use exactly these keys
// -- any other key is rejected. Every value is a dispense VOLUME in nL.
export const PYDANTIC_REAGENT_FIELDS = new Set(Object.keys(spec.fields));

// Cheap integrity guard: the generated file should agree with itself.
if (spec.fieldCount !== PYDANTIC_REAGENT_FIELDS.size) {
  throw new Error(
    `cfpsReagentSpec.generated.json is inconsistent: fieldCount=${spec.fieldCount} but ${PYDANTIC_REAGENT_FIELDS.size} fields present. Re-run \`npm run sync:cfps\`.`
  );
}

// Each protein target maps to exactly one DNA template plasmid (dosed at 2000 nL).
// The friendly names (sfGFP / PETase / Reteplase) are the app's UI vocabulary and
// are not in the model, so this map is hand-written -- but its template values must
// all be real template fields from the generated spec (asserted below).
export const PROTEIN_TEMPLATE_FIELD = {
  sfGFP: 'template_sfgfp',
  PETase: 'template_petase',
  Reteplase: 'template_reteplase'
};
export const TEMPLATE_FIELDS = spec.templateFields;

for (const [target, field] of Object.entries(PROTEIN_TEMPLATE_FIELD)) {
  if (!TEMPLATE_FIELDS.includes(field)) {
    throw new Error(
      `PROTEIN_TEMPLATE_FIELD["${target}"] = "${field}" is not a template field in the generated spec (${TEMPLATE_FIELDS.join(', ')}).`
    );
  }
}

export function templateFieldForTarget(target) {
  return PROTEIN_TEMPLATE_FIELD[target] || 'template_sfgfp';
}

// Validate a reagent_list against the CFPSReagentList contract: recognized keys,
// finite non-negative volumes on the 25 nL grid, base_buffer / lysate at their fixed
// volumes, EXACTLY one DNA template at its dose, and a total of EXACTLY 20,000 nL
// (water backfills the remainder). Returns { valid, errors }. Mirrors what the Python
// model enforces so a design that passes here is accepted downstream.
export function validateReagentList(rl) {
  if (!rl || typeof rl !== 'object' || Array.isArray(rl)) {
    return { valid: false, errors: ['reagent_list must be an object.'] };
  }
  const errors = [];
  let total = 0;
  for (const [key, value] of Object.entries(rl)) {
    if (!PYDANTIC_REAGENT_FIELDS.has(key)) {
      errors.push(`"${key}" is not a recognized reagent field.`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${key}: volume must be a number.`);
      continue;
    }
    if (value < 0) errors.push(`${key}: volume can't be negative.`);
    if (value % STEP_NL !== 0) errors.push(`${key}: ${value} nL is not divisible by ${STEP_NL} nL.`);
    total += value;
  }
  if (rl.base_buffer !== BASE_BUFFER_NL) errors.push(`base_buffer must equal ${BASE_BUFFER_NL} nL.`);
  if (rl.lysate !== LYSATE_NL) errors.push(`lysate must equal ${LYSATE_NL} nL.`);
  // Exactly one DNA template, dosed at TEMPLATE_VOLUME_NL.
  const templates = TEMPLATE_FIELDS.filter((t) => (Number(rl[t]) || 0) > 0);
  if (templates.length === 0) {
    errors.push(`Include exactly one DNA template at ${TEMPLATE_VOLUME_NL} nL (${TEMPLATE_FIELDS.join(', ')}).`);
  } else if (templates.length > 1) {
    errors.push(`Only one DNA template is allowed — found ${templates.join(', ')}.`);
  } else if (rl[templates[0]] !== TEMPLATE_VOLUME_NL) {
    errors.push(`${templates[0]} must equal ${TEMPLATE_VOLUME_NL} nL (found ${rl[templates[0]]}).`);
  }
  // The reaction is a fixed 20 µL: the volumes must sum to EXACTLY 20,000 nL —
  // undershoot is as invalid as overshoot (nuclease_free_water backfills the rest).
  if (total > MAX_TOTAL_NL) {
    errors.push(`Total ${total.toLocaleString()} nL exceeds the ${MAX_TOTAL_NL.toLocaleString()} nL (20 µL) reaction — those concentrations aren't reachable in this volume.`);
  } else if (total < MAX_TOTAL_NL) {
    const shortfall = MAX_TOTAL_NL - total;
    const water = typeof rl.nuclease_free_water === 'number' ? rl.nuclease_free_water : 0;
    errors.push(`Total ${total.toLocaleString()} nL is under the ${MAX_TOTAL_NL.toLocaleString()} nL (20 µL) reaction — add ${shortfall.toLocaleString()} nL of nuclease_free_water (set it to ${(water + shortfall).toLocaleString()} nL) so the volumes sum to exactly 20,000 nL.`);
  }
  return { valid: errors.length === 0, errors };
}

// Canonical fingerprint of a reagent_list: every non-zero field with its volume,
// sorted. Two compositions with the same key are the same reaction (the template
// field pins the protein target), however their JSON happened to be ordered. Used
// by the designer and the submit endpoint to flag duplicate submissions.
export function reagentListKey(rl) {
  if (!rl || typeof rl !== 'object') return '';
  return Object.keys(rl)
    .filter((k) => (Number(rl[k]) || 0) > 0)
    .sort()
    .map((k) => `${k}=${Number(rl[k])}`)
    .join('|');
}

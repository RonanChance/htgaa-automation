import spec from '$lib/cfpsReagentSpec.generated.json';
import {
  STEP_NL,
  MAX_TOTAL_NL,
  BASE_BUFFER_NL,
  LYSATE_NL,
  TEMPLATE_VOLUME_NL,
  PYDANTIC_REAGENT_FIELDS,
  PROTEIN_TEMPLATE_FIELD,
  TEMPLATE_FIELDS,
  validateReagentList
} from '$lib/cfpsReagentContract.js';
import { PYDANTIC_TO_REAGENT_ID } from '$lib/cfpsReagentIdMap.js';
import { evaluateRangeChecks, describeRangeFlag, ALLOW_OUT_OF_RANGE_FIELD, SITE_BAND } from '$lib/cfpsRangeChecks.js';

export { ALLOW_OUT_OF_RANGE_FIELD };

// Every rule a composition must pass before it's written to cfps_designs, in one
// place, so the browser designer and AI agents get the same verdict — and agents
// get field-specific messages they can act on. The reagent_list contract itself
// (fields, 25 nL grid, fixed volumes, one template, 20 µL total) lives in
// $lib/cfpsReagentContract.js; this layers the sample/metadata/batch rules on top.

export const LIMITS = {
  sampleId: 300,
  aiModel: 300,
  aiConversationLink: 2000,
  acknowledgements: 300,
  comments: 1500,
  experimentHypothesis: 1500,
  batchId: 300,
  batchMin: 2,
  batchMax: 50
};
export const PROTEIN_TARGETS = Object.keys(PROTEIN_TEMPLATE_FIELD);
export const WATER_FIELD = 'nuclease_free_water';
const OUT_OF_STOCK = new Set(Object.entries(spec.fields).filter(([, f]) => f.out_of_stock).map(([k]) => k));

// Closest recognized field name for a typo'd key (edit distance ≤ 3, or a
// substring match), so "magnesium_glutamte" → "magnesium_glutamate".
function closestField(key) {
  const k = String(key).toLowerCase();
  let best = null;
  let bestD = Infinity;
  for (const f of PYDANTIC_REAGENT_FIELDS) {
    if (f.includes(k) || k.includes(f)) return f;
    const d = editDistance(k, f);
    if (d < bestD) { bestD = d; best = f; }
  }
  return bestD <= 3 ? best : null;
}
function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const tooLong = (v, max) => typeof v === 'string' && v.length > max;

// A shareable link must be a real http(s) URL. Anything else (javascript:, data:,
// a bare note) is refused rather than quietly rewritten, so what gets stored is
// always something a reader can safely open.
export function httpUrlProblem(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return 'must be a full http(s) link (e.g. https://chatgpt.com/share/…).';
  try {
    new URL(v);
  } catch {
    return 'is not a valid URL.';
  }
  return null;
}

// One sample → { errors: [{ field, message }], warnings: [string] }.
// A conversation link publishes the user's chat, so an agent may only send one
// the user has explicitly approved sharing: it must also set
// ai_conversation_link_user_approved: true. Returns the error message, or null.
// (People submitting in the browser type the link themselves — that's consent.)
export const LINK_APPROVAL_FIELD = 'ai_conversation_link_user_approved';
export function conversationLinkApprovalProblem(link, approved, { linkField = 'ai_conversation_link', approvalField = LINK_APPROVAL_FIELD } = {}) {
  if (!String(link ?? '').trim() || approved === true) return null;
  return `${linkField} was sent without ${approvalField}: true. Ask your user whether they approve publicly sharing a link to this conversation; only if they say yes, resend with ${approvalField}: true — otherwise leave ${linkField} out.`;
}

// The autonomous-cfps advisory range checks (see $lib/cfpsRangeChecks.js) as
// submission rules: a warn-level flag rejects the composition unless the caller
// set ALLOW_OUT_OF_RANGE_FIELD, in which case it's downgraded to a warning.
// Info-level flags are always just warnings.
function rangeCheckFindings(rl, allowOutOfRange) {
  const { flags } = evaluateRangeChecks(rl);
  const errors = [];
  const warnings = [];
  for (const f of flags) {
    const field = f.component === 'energy' ? 'reagent_list' : `reagent_list.${f.component}`;
    const line = describeRangeFlag(f);
    if (f.kind !== 'warn') warnings.push(line);
    else if (allowOutOfRange) warnings.push(`Out of range (accepted via ${ALLOW_OUT_OF_RANGE_FIELD}): ${line}`);
    else errors.push({ field, check: 'range', message: `${line} To submit outside the reference range anyway, resend with "${ALLOW_OUT_OF_RANGE_FIELD}": true.` });
  }
  return { flags, errors, warnings };
}

// opts.requireLinkApproval: set for agent-token requests (see LINK_APPROVAL_FIELD).
// opts.allowOutOfRange: the request's ALLOW_OUT_OF_RANGE_FIELD (see rangeCheckFindings).
// → { errors, warnings, rangeFlags } — rangeFlags only when the reagent_list passed
//   the contract (range checks on a malformed list would just be noise).
export function validateSample(sample, { requireLinkApproval = false, allowOutOfRange = false } = {}) {
  const errors = [];
  const warnings = [];
  let rangeFlags = null;
  const err = (field, message) => errors.push({ field, message });
  if (!isObj(sample)) {
    err('sample', 'Each composition must be a JSON object: { sample_id, sample_type, reagent_list, metadata }.');
    return { errors, warnings };
  }

  const sampleId = typeof sample.sample_id === 'string' ? sample.sample_id.trim() : '';
  if (!sampleId) err('sample_id', 'sample_id is required — a unique name such as "ada_lovelace_2026-10-11_a1".');
  else if (sampleId.length > LIMITS.sampleId) err('sample_id', `sample_id is ${sampleId.length} characters; the limit is ${LIMITS.sampleId}.`);

  if (sample.sample_type !== 'experimental') {
    err('sample_type', `sample_type must be "experimental"${sample.sample_type == null ? ' (it is missing)' : ` (got ${JSON.stringify(sample.sample_type)})`}.`);
  }

  const rl = sample.reagent_list;
  if (!isObj(rl)) {
    err('reagent_list', `reagent_list is required: an object of { reagent_field: volume_nL }, e.g. { "base_buffer": ${BASE_BUFFER_NL}, "lysate": ${LYSATE_NL}, "template_sfgfp": ${TEMPLATE_VOLUME_NL}, …, "${WATER_FIELD}": … }.`);
  } else {
    for (const message of validateReagentList(rl).errors) {
      const m = /^"([^"]+)" is not a recognized reagent field\.$/.exec(message);
      if (m) {
        const guess = closestField(m[1]);
        err(`reagent_list.${m[1]}`, `${message}${guess ? ` Did you mean "${guess}"?` : ''} GET /cfps/submit-design lists every valid field.`);
      } else {
        const field = /^([a-z0-9_]+)[: ]/.exec(message)?.[1];
        err(field && PYDANTIC_REAGENT_FIELDS.has(field) ? `reagent_list.${field}` : 'reagent_list', message);
      }
    }
    for (const [k, v] of Object.entries(rl)) {
      if (OUT_OF_STOCK.has(k) && Number(v) > 0) warnings.push(`${k} is currently out of stock — this composition may not be run until it is restocked.`);
    }
    if (!errors.length) {
      const range = rangeCheckFindings(rl, allowOutOfRange);
      rangeFlags = range.flags;
      errors.push(...range.errors);
      warnings.push(...range.warnings);
    }
  }

  const md = sample.metadata;
  if (md != null && !isObj(md)) {
    err('metadata', 'metadata must be an object: { protein_target, comments, ai_model, acknowledgements }.');
  } else {
    const m = md ?? {};
    const target = String(m.protein_target || '').trim();
    const expected = PROTEIN_TEMPLATE_FIELD[target];
    if (!expected) {
      err('metadata.protein_target', `metadata.protein_target must be one of ${PROTEIN_TARGETS.map((t) => `"${t}"`).join(', ')}${target ? ` (got "${target}")` : ' (it is missing)'}.`);
    } else if (isObj(rl)) {
      const present = TEMPLATE_FIELDS.filter((t) => (Number(rl[t]) || 0) > 0);
      if (present.length === 1 && present[0] !== expected) {
        err('reagent_list', `protein_target "${target}" needs its own DNA template: use "${expected}": ${TEMPLATE_VOLUME_NL} instead of "${present[0]}".`);
      }
    }
    const comments = typeof m.comments === 'string' ? m.comments.trim() : '';
    if (!comments) {
      err('metadata.comments', 'metadata.comments is required — state the hypothesis this composition tests.');
    } else if (comments.length > LIMITS.comments) {
      err('metadata.comments', `metadata.comments is ${comments.length} characters; the limit is ${LIMITS.comments}.`);
    }
    if (m.ai_model != null && typeof m.ai_model !== 'string') err('metadata.ai_model', 'metadata.ai_model must be a string.');
    else if (tooLong(m.ai_model, LIMITS.aiModel)) err('metadata.ai_model', `metadata.ai_model is over ${LIMITS.aiModel} characters.`);
    // Optional public link to the conversation that produced the design — the
    // reasoning behind a composition is as useful to the community as the numbers.
    if (m.ai_conversation_link != null && typeof m.ai_conversation_link !== 'string') {
      err('metadata.ai_conversation_link', 'metadata.ai_conversation_link must be a string (a shareable http(s) URL).');
    } else if (tooLong(m.ai_conversation_link, LIMITS.aiConversationLink)) {
      err('metadata.ai_conversation_link', `metadata.ai_conversation_link is over ${LIMITS.aiConversationLink} characters.`);
    } else {
      const problem = httpUrlProblem(m.ai_conversation_link);
      if (problem) err('metadata.ai_conversation_link', `metadata.ai_conversation_link ${problem}`);
    }
    if (m[LINK_APPROVAL_FIELD] != null && typeof m[LINK_APPROVAL_FIELD] !== 'boolean') {
      err(`metadata.${LINK_APPROVAL_FIELD}`, `metadata.${LINK_APPROVAL_FIELD} must be true or false.`);
    } else if (requireLinkApproval) {
      const approvalField = `metadata.${LINK_APPROVAL_FIELD}`;
      const problem = conversationLinkApprovalProblem(m.ai_conversation_link, m[LINK_APPROVAL_FIELD], { linkField: 'metadata.ai_conversation_link', approvalField });
      if (problem) err(approvalField, problem);
    }
    if (m.acknowledgements != null && typeof m.acknowledgements !== 'string') err('metadata.acknowledgements', 'metadata.acknowledgements must be a string.');
    else if (tooLong(m.acknowledgements, LIMITS.acknowledgements)) err('metadata.acknowledgements', `metadata.acknowledgements is over ${LIMITS.acknowledgements} characters.`);
  }
  return { errors, warnings, rangeFlags };
}

// Per-sample range findings for API responses (dry runs, rejections, accepted
// overrides): the Python WellFlag fields plus the nL window that would fix each.
export function rangeReport(rangeFlags) {
  return (rangeFlags || []).map((f) => ({
    component: f.component,
    kind: f.kind,
    check: f.check,
    ratio: f.ratio,
    band: f.band,
    ...(f.unit ? { value: f.value, unit: f.unit } : {}),
    ...(f.referenceName ? { reference: f.referenceName } : {}),
    ...(f.suggestedNl ? { suggested_nl: f.suggestedNl } : {}),
    message: f.message
  }));
}

// Cost of a reagent_list from the PocketBase reagent catalog (costPerMl, keyed by
// app reagent id): Σ volume_nL / 1e6 × costPerMl. Used when the caller (an agent)
// doesn't send the designer's own cost figures.
export function costForReagentList(rl, reagentGroups) {
  const costById = new Map();
  for (const g of reagentGroups || []) for (const r of g.reagents || []) costById.set(r.id, Number(r.costPerMl) || 0);
  let usd = 0;
  for (const [field, nl] of Object.entries(rl || {})) {
    const appId = TEMPLATE_FIELDS.includes(field) ? 'dna_template' : (PYDANTIC_TO_REAGENT_ID[field] || field);
    usd += ((Number(nl) || 0) / 1_000_000) * (costById.get(appId) ?? costById.get(field) ?? 0);
  }
  return usd;
}

// "sfGFP: a, b, c; PETase: …" from the generated range-check watchlists.
function watchlistByTarget() {
  return PROTEIN_TARGETS.map((target) => {
    const modelTarget = spec.templateToProteinTarget[PROTEIN_TEMPLATE_FIELD[target]];
    return `${target}: ${(spec.rangeChecks.targets[modelTarget]?.watchlist || []).join(', ')}`;
  }).join('; ');
}

// The machine-readable contract an agent can fetch before designing.
export function submissionContract(base) {
  const example = (target, extra, comments) => {
    const rl = { base_buffer: BASE_BUFFER_NL, lysate: LYSATE_NL, [PROTEIN_TEMPLATE_FIELD[target]]: TEMPLATE_VOLUME_NL, ...extra };
    rl[WATER_FIELD] = MAX_TOTAL_NL - Object.values(rl).reduce((a, b) => a + b, 0);
    return {
      sample_type: 'experimental',
      reagent_list: rl,
      metadata: {
        protein_target: target,
        ai_model: '<your model>',
        ai_conversation_link: '<public link to this conversation — only if your user approved sharing it>',
        [LINK_APPROVAL_FIELD]: '<true, only after your user said yes to sharing the link>',
        comments,
        acknowledgements: ''
      }
    };
  };
  return {
    endpoint: `${base}/submit-design`,
    reagent_list: {
      fields: [...PYDANTIC_REAGENT_FIELDS].sort().map((name) => ({ name, out_of_stock: OUT_OF_STOCK.has(name) })),
      units: 'nL (every value is a dispense volume)',
      step_nl: STEP_NL,
      total_nl: MAX_TOTAL_NL,
      fixed_nl: { base_buffer: BASE_BUFFER_NL, lysate: LYSATE_NL },
      template_volume_nl: TEMPLATE_VOLUME_NL,
      template_for_target: PROTEIN_TEMPLATE_FIELD,
      water_field: WATER_FIELD,
      rules: [
        'Only the listed field names; every value a non-negative multiple of 25 nL.',
        `base_buffer = ${BASE_BUFFER_NL} and lysate = ${LYSATE_NL}.`,
        `Exactly one DNA template, at ${TEMPLATE_VOLUME_NL} nL, matching metadata.protein_target.`,
        `All volumes sum to exactly ${MAX_TOTAL_NL} nL — ${WATER_FIELD} fills the remainder.`
      ]
    },
    range_checks: {
      source: 'A deliberately loosened version of the autonomous-cfps validate_design advisory checks, applied to total delivered concentrations (base-buffer floors included). They catch highly concerning designs, not small deviations.',
      checks: [
        `At least one ATP-regeneration substrate (${spec.rangeChecks.energySubstrates.join(', ')}).`,
        `Watchlisted components present (not zero; only Reteplase's DsbC, GSSG and GSH can be missing, the rest have a base-buffer floor) and at most ${SITE_BAND.high}× the highest value across the target's reference controls — ${watchlistByTarget()}.`,
        `When the dosed energy substrates exactly match a same-target energy reference, each at most ${SITE_BAND.high}× of it.`,
        'Informational only: a reteplase redox extra (DsbC, GSSG, GSH) dosed where the target reference has none.'
      ],
      enforcement: `A composition that fails a check is rejected (HTTP 400, errors with check: "range" and a suggested nL window). To submit it anyway, add "${ALLOW_OUT_OF_RANGE_FIELD}": true to the request body; the findings then come back as warnings. Dry runs report the same verdict.`,
      bypass_field: ALLOW_OUT_OF_RANGE_FIELD
    },
    sample: {
      sample_id: `required, unique across all submissions, ≤ ${LIMITS.sampleId} chars`,
      sample_type: 'must be "experimental"'
    },
    metadata: {
      protein_target: `required: ${PROTEIN_TARGETS.join(' | ')}`,
      comments: `required: the hypothesis this composition tests, ≤ ${LIMITS.comments} chars`,
      ai_model: `optional, ≤ ${LIMITS.aiModel} chars`,
      ai_conversation_link: `optional but encouraged when an AI helped: a PUBLIC shareable link to the conversation that produced this design (http(s), ≤ ${LIMITS.aiConversationLink} chars). ChatGPT "Share", Claude "Share chat", a gist — anything a reader can open. Agents MUST ask the user and get an explicit yes before including it (once per submission or batch; never assume consent), and never include a link containing credentials or unpublished data.`,
      [LINK_APPROVAL_FIELD]: `required (true) whenever an agent sends ai_conversation_link: confirms the user explicitly approved sharing the conversation. A link without it is rejected. Don't set it unless the user said yes.`,
      acknowledgements: `optional, ≤ ${LIMITS.acknowledgements} chars`
    },
    batch: {
      shape: '{ "samples": [sample, ...], "experiment_hypothesis": "...", "batch_id": "optional" }',
      size: `${LIMITS.batchMin}–${LIMITS.batchMax} samples`,
      experiment_hypothesis: `required: what the batch as a whole tests, ≤ ${LIMITS.experimentHypothesis} chars`,
      batch_id: 'optional grouping key (defaults to the first sample_id); batch_id / batch_size / batch_index are stamped by the server',
      atomic: 'every sample is validated first — if any fails, nothing is written'
    },
    dry_run: 'add "dry_run": true to validate without saving',
    [ALLOW_OUT_OF_RANGE_FIELD]: 'add true to submit compositions that fail the range checks (see range_checks); only when your user has chosen to test outside the reference ranges',
    duplicates: 'a reagent_list identical to an existing composition is rejected for a single submission (409 + duplicate_of: star the original via POST /cfps/stars, or resend with "allow_duplicate": true); in a batch it is allowed and reported in "duplicates" / "warnings"',
    examples: {
      // Shape-only examples: the fixed backbone + water, with placeholder text. They
      // deliberately suggest no supplements or hypotheses, so they don't steer designs.
      single: { sample: { sample_id: 'ada_lovelace_2026-10-11_a1', ...example('sfGFP', {}, '<the hypothesis this composition tests>') } },
      batch: {
        experiment_hypothesis: '<what the batch as a whole tests>',
        samples: [
          { sample_id: 'ada_lovelace_2026-10-11_b1_1', ...example('sfGFP', {}, '<hypothesis for this composition>') },
          { sample_id: 'ada_lovelace_2026-10-11_b1_2', ...example('PETase', {}, '<hypothesis for this composition>') }
        ]
      }
    }
  };
}

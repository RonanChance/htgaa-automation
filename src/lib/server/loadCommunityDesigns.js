import { pbAdmin } from '$lib/server/pb.js';
import { dev } from '$app/environment';
import { parseStarredBy, starSummary, devStarredBy } from '$lib/server/stars.js';

// Community-submitted CFPS compositions, read from the same cfps_designs
// collection the Submit-composition flow writes to (see submit-design/+server.js).
// Each record stores the autonomous-cfps sample under `design_json`
// ({ sample_id, sample_type, reagent_list, metadata }); we surface just the bits
// the comparison table needs to render a column: a name, the author's protein
// target, and the reagent_list (pydantic field → nL) the client converts to
// per-reagent concentrations. listRule is null on the collection, so the read
// goes through the superuser-authed admin client.
//
// On localhost (`vite dev`) a small in-memory set is returned instead, so the
// "Community" comparison columns can be previewed without PocketBase. Never used
// in a production build.
const DESIGNS = process.env.CFPS_COLLECTION || 'cfps_designs';

// ── localhost dummy store ───────────────────────────────────────────────────
const DEV_DESIGNS = [
  {
    id: 'dev-design-1',
    name: 'ada_lovelace_2026-09-20',
    author: 'Ada L.',
    proteinTarget: 'sfGFP',
    created: '2026-09-20T09:00:00Z',
    rank: 1,
    acknowledgements: '',
    comments: 'Pushed Mg-glutamate to 300 nL to chase a brighter sfGFP signal; spermidine kept low.',
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_sfgfp: 2000,
      magnesium_glutamate: 300, potassium_glutamate: 1500, spermidine: 50,
      nuclease_free_water: 9150
    }
  },
  {
    id: 'dev-design-2',
    name: 'grace_hopper_2026-09-24',
    author: 'Grace H.',
    proteinTarget: 'PETase',
    created: '2026-09-24T14:30:00Z',
    rank: 1,
    acknowledgements: 'Grace H.',
    comments: 'Added maltodextrin as an energy source for the longer PETase run.',
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_sfgfp: 2000,
      magnesium_glutamate: 250, potassium_glutamate: 2000, maltodextrin_17: 400,
      nuclease_free_water: 8350
    }
  },
  {
    id: 'dev-design-3',
    name: 'ada_lovelace_2026-09-22',
    author: 'Ada L.',
    proteinTarget: 'sfGFP',
    created: '2026-09-22T11:15:00Z',
    rank: 2,
    acknowledgements: '',
    comments: 'Balanced K-glutamate down to 1800 nL; steadier expression, slightly dimmer peak.',
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_sfgfp: 2000,
      magnesium_glutamate: 275, potassium_glutamate: 1800, spermidine: 75,
      nuclease_free_water: 8850
    }
  },
  {
    id: 'dev-design-4',
    name: 'ada_lovelace_2026-09-25',
    author: 'Ada L.',
    proteinTarget: 'sfGFP',
    created: '2026-09-25T16:40:00Z',
    rank: 3,
    acknowledgements: 'Katherine J.',
    comments: 'Spermidine sweep — bumped to 100 nL to test polyamine headroom.',
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_sfgfp: 2000,
      magnesium_glutamate: 300, potassium_glutamate: 1500, spermidine: 100,
      nuclease_free_water: 9100
    }
  },
  // A three-member batch spanning all three targets, so the batch card + multi-target
  // tags can be previewed on localhost. All share one batch_id and auto-increment.
  {
    id: 'dev-design-5',
    name: 'ada_lovelace_2026-10-01_demo01_1',
    author: 'Ada L.',
    proteinTarget: 'sfGFP',
    created: '2026-10-01T10:00:00Z',
    rank: 1,
    acknowledgements: '',
    comments: 'Batch arm 1 — sfGFP baseline.',
    experimentHypothesis: 'Comparing a range of reaction conditions across our target proteins to see which formulations generalize.',
    batchId: 'ada_lovelace_2026-10-01_demo01',
    batchSize: 3,
    batchIndex: 1,
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_sfgfp: 2000,
      magnesium_glutamate: 300, potassium_glutamate: 1500, spermidine: 50,
      nuclease_free_water: 9150
    }
  },
  {
    id: 'dev-design-6',
    name: 'ada_lovelace_2026-10-01_demo01_2',
    author: 'Ada L.',
    proteinTarget: 'PETase',
    created: '2026-10-01T10:00:01Z',
    rank: 1,
    acknowledgements: '',
    comments: 'Batch arm 2 — PETase, extra maltodextrin.',
    experimentHypothesis: 'Comparing a range of reaction conditions across our target proteins to see which formulations generalize.',
    batchId: 'ada_lovelace_2026-10-01_demo01',
    batchSize: 3,
    batchIndex: 2,
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_petase: 2000,
      magnesium_glutamate: 250, potassium_glutamate: 2000, maltodextrin_17: 400,
      nuclease_free_water: 8350
    }
  },
  {
    id: 'dev-design-7',
    name: 'ada_lovelace_2026-10-01_demo01_3',
    author: 'Ada L.',
    proteinTarget: 'Reteplase',
    created: '2026-10-01T10:00:02Z',
    rank: 1,
    acknowledgements: '',
    comments: 'Batch arm 3 — Reteplase run.',
    experimentHypothesis: 'Comparing a range of reaction conditions across our target proteins to see which formulations generalize.',
    batchId: 'ada_lovelace_2026-10-01_demo01',
    batchSize: 3,
    batchIndex: 3,
    reagentList: {
      base_buffer: 2000, lysate: 5000, template_reteplase: 2000,
      magnesium_glutamate: 275, potassium_glutamate: 1800, spermidine: 75,
      nuclease_free_water: 8850
    }
  }
];

// Pull the batch-grouping fields the Submit flow stamps into metadata (see
// confirmSubmitDesign). A lone submission has none of these (renders as a standalone
// card); a batch shares one batch_id across its sibling records so the client can
// collapse them into a single batch card and load them all together.
function readBatch(md) {
  const batchId =
    typeof md.batch_id === 'string' && md.batch_id.trim() ? md.batch_id.trim() : null;
  const size = Number(md.batch_size) || 0;
  const index = Number(md.batch_index) || 0;
  return {
    batchId,
    batchSize: size > 0 ? size : null,
    batchIndex: index > 0 ? index : null
  };
}

// A cfps_designs record → the minimal shape the client needs, or null when the
// stored design_json has no usable reagent_list. `mySub` (the viewer) only decides
// starredByMe — other starrers are surfaced by display name alone.
function normalizeDesign(rec, mySub) {
  let dj = rec?.design_json;
  if (typeof dj === 'string') {
    try { dj = JSON.parse(dj); } catch { dj = null; }
  }
  if (!dj || typeof dj !== 'object' || Array.isArray(dj)) return null;
  const reagentList = dj.reagent_list;
  if (!reagentList || typeof reagentList !== 'object' || Array.isArray(reagentList)) return null;
  const metadata = (dj.metadata && typeof dj.metadata === 'object') ? dj.metadata : {};
  const name = String(rec.title || dj.sample_id || rec.author || 'community design').trim();
  return {
    id: rec.id,
    name: name || 'community design',
    author: String(rec.author || '').trim() || null,
    proteinTarget: metadata.protein_target || null,
    // Surfaced under the comparison table when a community column is loaded — the
    // same rationale/credits the author sees in "My Compositions". The write path
    // stores the rationale both top-level (`rec.rationale`) and in metadata.
    aiModel: typeof metadata.ai_model === 'string' ? metadata.ai_model : '',
    acknowledgements: typeof metadata.acknowledgements === 'string' ? metadata.acknowledgements : '',
    comments:
      typeof metadata.comments === 'string' ? metadata.comments
        : (typeof rec.rationale === 'string' ? rec.rationale : ''),
    // Group-level rationale shared across a batch's sibling records (Submit flow
    // stamps the same value on every member). Empty for lone submissions.
    experimentHypothesis:
      typeof metadata.experiment_hypothesis === 'string' ? metadata.experiment_hypothesis : '',
    created: rec.created || null,
    submittedVia: rec.submitted_via || null, // 'user' | 'agent' | null (before tracking)
    ...readBatch(metadata),
    ...starSummary(parseStarredBy(rec.starred_by), mySub),
    reagentList
  };
}

// Community compositions are LOGIN-GATED — only a signed-in user (with a valid
// Keycloak subject) may see other people's submissions, so anonymous visitors
// can't scrape the dataset. Without a subject this returns [] and nothing about
// the community designs ever leaves the server. Never throws — a backend hiccup
// just renders no Community options.
export async function loadCommunityDesigns(kcUser) {
  const mySub = kcUser?.sub ? String(kcUser.sub).trim() : '';
  if (!mySub) return [];
  if (dev) return DEV_DESIGNS.map((d) => ({ ...d, ...starSummary(devStarredBy(d.id), mySub) }));
  try {
    const pb = await pbAdmin();
    const rows = await pb.collection(DESIGNS).getFullList({ sort: '-created' });
    return rows.map((rec) => normalizeDesign(rec, mySub)).filter(Boolean);
  } catch {
    return [];
  }
}

// A cfps_designs record → the fuller shape the "My Compositions" manager needs:
// the editable metadata (protein target, ai_model, acknowledgements, comments)
// and the recorded cost, on top of the minimal comparison-column fields.
function normalizeMine(rec) {
  let dj = rec?.design_json;
  if (typeof dj === 'string') {
    try { dj = JSON.parse(dj); } catch { dj = null; }
  }
  dj = (dj && typeof dj === 'object' && !Array.isArray(dj)) ? dj : {};
  const md = (dj.metadata && typeof dj.metadata === 'object') ? dj.metadata : {};
  const reagentList =
    (dj.reagent_list && typeof dj.reagent_list === 'object' && !Array.isArray(dj.reagent_list))
      ? dj.reagent_list
      : {};
  const name = String(rec.title || dj.sample_id || 'composition').trim();
  return {
    id: rec.id,
    name: name || 'composition',
    author: String(rec.author || '').trim() || null,
    authorSub: String(rec.author_sub || '').trim() || null,
    proteinTarget: md.protein_target || null,
    aiModel: typeof md.ai_model === 'string' ? md.ai_model : '',
    acknowledgements: typeof md.acknowledgements === 'string' ? md.acknowledgements : '',
    comments: typeof md.comments === 'string' ? md.comments : '',
    experimentHypothesis:
      typeof md.experiment_hypothesis === 'string' ? md.experiment_hypothesis : '',
    // Drag-to-prioritise order within a target-protein group (1 = highest). 0 =
    // never dragged; those sort by recency as a stable fallback (see loadMyDesigns).
    rank: Number(rec.rank) || 0,
    created: rec.created || null,
    totalCostUsd: Number(rec.total_cost_usd) || null,
    costPerMlReaction: Number(rec.cost_per_ml_reaction) || null,
    ...readBatch(md),
    reagentList
  };
}

// The signed-in user's own compositions, grouped/managed in the "My Compositions"
// section. Matched SOLELY by the stable Keycloak subject (author_sub) — display
// names aren't unique, so matching on `author` caused ownership confusion. Never
// throws — a backend hiccup just renders an empty manager. On localhost the dummy
// store is returned so the section can be previewed without PocketBase.
export async function loadMyDesigns(kcUser) {
  const me = kcUser?.name ? String(kcUser.name).trim() : '';
  const mySub = kcUser?.sub ? String(kcUser.sub).trim() : '';
  if (!me && !mySub) return [];
  if (dev) {
    return DEV_DESIGNS.map((d) => ({
      id: d.id,
      name: d.name,
      author: d.author || me,
      authorSub: null,
      proteinTarget: d.proteinTarget || null,
      aiModel: '',
      acknowledgements: d.acknowledgements || '',
      comments: d.comments || '',
      experimentHypothesis: d.experimentHypothesis || '',
      rank: Number(d.rank) || 0,
      created: d.created || null,
      totalCostUsd: null,
      costPerMlReaction: null,
      batchId: d.batchId || null,
      batchSize: d.batchSize || null,
      batchIndex: d.batchIndex || null,
      reagentList: d.reagentList || {}
    }));
  }
  // Identity is the stable Keycloak subject only. Without one there's nothing we
  // can reliably attribute to this user, so the manager stays empty.
  if (!mySub) return [];
  try {
    const pb = await pbAdmin();
    const filter = pb.filter('author_sub = {:sub}', { sub: mySub });
    // Sort by rank (drag-priority) then recency; the client re-sorts the same way,
    // so unranked (rank 0) records fall back to newest-first.
    const rows = await pb.collection(DESIGNS).getFullList({ filter, sort: 'rank,-created' });
    return rows.map(normalizeMine).filter(Boolean);
  } catch {
    return [];
  }
}

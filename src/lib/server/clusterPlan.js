import zlib from 'node:zlib';
import { loadClusterFile } from '$lib/server/clusterData.js';
import { activeModelId } from '$lib/server/clusterModels.js';
import { validateReagentList } from '$lib/cfpsReagentContract.js';
import { evaluateRangeChecks, describeRangeFlag } from '$lib/cfpsRangeChecks.js';

// Shape the CFPS Arena export into what the clusters planner needs.
//
// The raw export is ~6 MB: every design's full recipe, each group's virtual-
// recipe analysis, and the predicted curve for every sweep. The page only needs
// enough to list hypotheses and count wells, so this trims it to ~5% of that.
// Recipes never reach the browser — the export endpoint builds plates
// server-side from the same file.

export const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];
// Designs that follow their group's runs aren't scheduled in round 1.
const FOLLOWS = "follows its group's runs";

// model id → promise of the parsed export, so switching version never serves
// the one before it.
let cache = new Map();

async function readAll(modelId) {
  const file = await loadClusterFile('clusters_designs.json', modelId);
  if (!file) throw new Error('cluster designs file missing');
  // PocketBase holds these gzipped (the HTTP endpoint hands the bytes straight
  // to the browser, which inflates them); server-side we have to do it here.
  const gz = file.body.length > 2 && file.body[0] === 0x1f && file.body[1] === 0x8b;
  return JSON.parse((gz ? zlib.gunzipSync(file.body) : file.body).toString('utf8'));
}

/** Drop the memoised plans so the next request rebuilds from new bytes. */
export function clearPlanCache() {
  cache = new Map();
}

/** Full export for the active version, memoised. Failures are not cached. */
export async function clusterSource() {
  const id = await activeModelId();
  if (cache.has(id)) return cache.get(id);
  const p = readAll(id).catch((e) => { cache.delete(id); throw e; });
  cache.set(id, p);
  return p;
}

// The exporter writes a group's name three different ways — "A ↑ + B ↑",
// "tested reagents: A added, B added", and the odd "tested reagents only" —
// optionally followed by " · with C added" and/or " · N designs, mean r 0.74".
// The planner shows designs and tightness in their own columns, so drop the
// stats tail and render every row as "A + B" with one optional "plus C" clause.
const STATS_TAIL = /^\d+ designs, mean r [\d.]+$/;

export function nameParts(raw) {
  const [head, ...tails] = String(raw ?? '').split(' · ');
  const extra = tails.find((t) => !STATS_TAIL.test(t));
  const label = head
    .replace(/^tested reagents:\s*/, '')
    // Held together by recipe similarity alone — nothing new in common.
    .replace(/^tested reagents only$/, 'similar recipes only')
    .split(', ')
    .join(' + ');
  return { label, also: extra ? extra.replace(/^with\s+/, '') : null };
}

// Several people independently submitted byte-identical recipes — `sameRecipeAs`
// links them. Running one twice would spend four wells to learn nothing, and
// dropping the twin would drop its author's name off the plate, so instead each
// class collapses to one entry that carries every co-submitter. All 83 classes
// in the current export are internally identical and none spans two groups, so
// collapsing never disturbs the hypothesis structure.
export function recipeClasses(designs) {
  const present = new Set(designs.map((d) => d.id));
  const parent = new Map(designs.map((d) => [d.id, d.id]));
  const find = (a) => {
    while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); }
    return a;
  };
  for (const d of designs) {
    if (present.has(d.sameRecipeAs)) parent.set(find(d.id), find(d.sameRecipeAs));
  }
  const classes = new Map();
  for (const d of designs) {
    const root = find(d.id);
    if (!classes.has(root)) classes.set(root, []);
    classes.get(root).push(d);
  }
  // The representative is the one the model actually scheduled (earliest
  // submission breaks ties), so the plate keeps the role the model assigned.
  const repOf = new Map();
  for (const members of classes.values()) {
    const ordered = [...members].sort((a, b) =>
      (a.round1Role === FOLLOWS) - (b.round1Role === FOLLOWS) ||
      String(a.created).localeCompare(String(b.created)));
    for (const m of members) repOf.set(m.id, ordered[0].id);
    classes.set(ordered[0].id, ordered);
  }
  return { repOf, membersOf: (id) => classes.get(id) ?? [] };
}

// Range checks name components by contract field (magnesium_glutamate); the
// Arena export is full of {reagent, name} pairs, so it supplies the display
// names without a PocketBase round-trip. Nine components never appear there
// (templates, buffer, lysate, water and three unused reagents) — title-case
// those rather than printing the raw field.
function labelsFrom(src) {
  const names = new Map();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.reagent === 'string' && typeof o.name === 'string') names.set(o.reagent, o.name);
    for (const v of Object.values(o)) walk(v);
  };
  walk(src);
  return (field) =>
    names.get(field) ?? String(field).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Every alert the plate would carry, using the same relaxed 'site' policy as
// /cfps — a flag here means "highly concerning", not "slightly off reference".
// A contract error is harder: the export endpoint refuses to place those.
// Severity order, worst first — a well is coloured by the worst alert it has.
export const ALERT_CATEGORIES = [
  { id: 'error', label: 'Contract error' },
  { id: 'energy', label: 'No energy substrate' },
  { id: 'high', label: 'Far above the reference' },
  { id: 'missing', label: 'Reference reagent not dosed' },
  { id: 'low', label: 'Far below the reference' }
];
const categoryOf = (f) =>
  f.check === 'energy_presence' ? 'energy'
    : f.direction === 'high' ? 'high'
      : f.ratio === 0 ? 'missing'
        : 'low';

function alertsFor(recipeNl, labelFor) {
  const out = [];
  const { valid, errors } = validateReagentList(recipeNl);
  if (!valid) for (const e of errors) out.push({ kind: 'error', cat: 'error', component: null, text: e });
  const { flags } = evaluateRangeChecks(recipeNl);
  for (const f of flags) {
    if (f.kind !== 'warn') continue;
    out.push({ kind: 'warn', cat: categoryOf(f), component: f.component, text: describeRangeFlag(f, labelFor) });
  }
  return out;
}

// One design, trimmed to what a planner row needs. `coAuthors` is everyone else
// who submitted this exact recipe — they are credited on the exported plate.
const slimDesign = (d, members = [], alerts = []) => ({
  id: d.id,
  name: d.sampleId,
  author: d.author ?? null,
  role: d.round1Role,
  coAuthors: [...new Set(members.map((m) => m.author).filter((a) => a && a !== d.author))],
  // The model's odds this beats Ginkgo's best; drives the default ordering.
  pBeat: d.forecast?.pBeat ?? null,
  // "Never on a Ginkgo plate" is the shared unknown that holds a group together.
  untested: (d.vsGinkgoPlates?.neverOnAPlate ?? []).length,
  tries: d.whatItTries ?? '',
  // Only present when the recipe trips something; most designs carry none.
  ...(alerts.length ? { alerts } : {})
});

export async function clusterPlan() {
  const src = await clusterSource();
  const labelFor = labelsFrom(src);
  const out = { built: src.built, targets: {} };

  for (const target of TARGETS) {
    const p = src.proteins?.[target];
    if (!p) continue;
    const byId = new Map(p.designs.map((d) => [d.id, d]));
    const scheduled = p.designs.filter((d) => d.role !== FOLLOWS && d.round1Role !== FOLLOWS);
    const { repOf, membersOf } = recipeClasses(p.designs);
    // Keep only one of each identical recipe, in place, carrying its twins.
    const dedupe = (list) => {
      const seen = new Set();
      return list
        .filter((d) => repOf.get(d.id) === d.id && !seen.has(d.id) && seen.add(d.id))
        .map((d) => slimDesign(d, membersOf(d.id), alertsFor(d.recipeNl, labelFor)));
    };

    const groups = p.groups.map((g) => {
      const members = g.designs.map((id) => byId.get(id)).filter(Boolean);
      const checkIds = (g.checkRuns ?? []).map((c) => c.id);
      // Ordered so "depth" is a simple prefix: first run, then checks, then the rest.
      const ordered = [
        ...members.filter((m) => m.id === g.firstRun),
        ...members.filter((m) => checkIds.includes(m.id) && m.id !== g.firstRun),
        ...members.filter((m) => m.id !== g.firstRun && !checkIds.includes(m.id))
      ];
      const { label, also } = nameParts(g.name);
      return {
        letter: g.letter,
        name: label,
        // A second change the group also shares, shown as "plus …" on the row.
        also,
        size: members.length,
        checks: checkIds.length,
        averageLink: g.averageLink,
        // Which of the two reasons holds this group together — a shared untested
        // ingredient (a real bet) or merely similar recipes.
        fromUntested: g.linkFromSharedUntested,
        // What the model says matters inside the group, for the row's subtitle.
        matters: (g.whatMatters?.ingredients ?? []).slice(0, 2).map((i) => i.name),
        // ── the science, for the row hover ───────────────────────────────
        // How tightly it holds: the weakest pair bounds the claim.
        weakestLink: g.weakestLink,
        fromSimilar: g.linkFromSimilarRecipes,
        // Share of the group's behaviour single ingredients account for; low
        // means interactions, so one-at-a-time checks would mislead.
        explains: g.whatMatters?.singleIngredientsExplain ?? null,
        virtualRecipes: g.whatMatters?.virtualRecipes ?? null,
        drivers: (g.whatMatters?.ingredients ?? []).slice(0, 3).map((i) => ({
          name: i.name, strength: i.strength, rangeNl: i.rangeNl
        })),
        // Each check swaps one ingredient against the first run; newInformation
        // is how much it would tell you that the first run would not.
        checkRunsInfo: (g.checkRuns ?? []).map((c) => ({
          ingredient: c.ingredient, nL: c.nL, from: c.nLInFirstRun, gain: c.newInformation
        })),
        designs: dedupe(ordered)
      };
    });
    // size/checks above count the model's arms; the depth control walks the
    // deduped list, so keep them in step.
    for (const g of groups) {
      g.size = g.designs.length;
      g.checks = Math.min(g.checks, Math.max(0, g.size - 1));
    }

    const inGroup = new Set(groups.flatMap((g) => g.designs.map((d) => d.id)));
    const loose = (role) =>
      dedupe(p.designs.filter((d) => d.round1Role === role)).filter((d) => !inGroup.has(d.id));

    out.targets[target] = {
      totals: p.totals,
      groups,
      independents: loose('independent run'),
      sweepRuns: loose('sweep run'),
      sweeps: (p.sweeps ?? []).map((s) => ({
        ingredient: s.ingredient,
        reagent: s.reagent,
        recommended: !!s.recommended,
        leadsGroups: s.leadsGroups,
        submitted: s.sweepsSubmitted
      })),
      authors: [...new Set(p.designs.map((d) => d.author).filter(Boolean))].length,
      scheduled: scheduled.length
    };
  }
  return out;
}

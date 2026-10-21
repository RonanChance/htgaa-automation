// Community-submission analysis for /cfps/analysis.
//
// Every submitted composition is diffed against the closest Ginkgo reference
// formulation for its target (PEP or Ribose), turning a raw reagent_list into a
// short list of "moves" — DsbC ↓, Maltodextrin +, PEP − … Moves are grouped into
// lever branches (energy, salts, folding & redox, …) for the mind map, tagged with
// cross-cutting strategies (one-knob tweak, sweep, cost trim, energy swap, …).
// "Novel" is reserved for wishlist reagents Ginkgo doesn't stock yet: every reagent
// in a submitted design is, by construction, an in-stock catalog option.
//
// Pure ESM, no I/O: the server loader feeds it designs, the reagent catalog and the
// benchmark formulations, and ships the result to the page. Everything here is
// derived from the data, so new submissions are categorised with no curation.

import { REAGENT_ALIASES, BASE_BUFFER_1X_CONTRIBUTION_MM, BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID } from './cfps-benchmarks.js';
import { PYDANTIC_TO_REAGENT_ID } from './cfpsReagentIdMap.js';

const TOTAL_NL = 20000;
const STEP_NL = 25;
const FIXED_IDS = new Set(['cell_lysate', 'dna_template', 'base_buffer', 'nuclease_free_water']);
const TEMPLATE_FIELDS = /^template_/;
export const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];

// ── Lever branches (mind-map limbs) ────────────────────────────────────────────
// Ordered; a reagent not listed falls into "other".
export const BRANCHES = [
  { key: 'energy', label: 'Energy source',
    blurb: 'How ATP is regenerated: PEP, ribose, sugars, polyphosphate.',
    ids: ['pep_mono', 'ribose', 'maltodextrin_17', 'maltose', 'glucose', 'sodium_pyruvate', 'three_pga',
      'dilithium_acetyl_phosphate', 'sodium_hexametaphosphate', 'potassium_formate'] },
  { key: 'nucleotides', label: 'Nucleotides',
    blurb: 'NTPs vs cheaper NMPs, nucleosides and bases.',
    ids: ['atp', 'ctp', 'gtp', 'utp', 'amp', 'cmp', 'gmp', 'ump', 'adenosine', 'guanosine', 'cytidine',
      'uridine', 'thymidine', 'adenine', 'guanine', 'cytosine', 'uracil', 'thymine'] },
  { key: 'salts', label: 'Salts',
    blurb: 'Mg²⁺ / K⁺ / NH₄⁺ balance for the ribosome.',
    ids: ['magnesium_glutamate', 'potassium_glutamate', 'ammonium_glutamate'] },
  { key: 'folding', label: 'Folding & redox',
    blurb: 'Disulfide formation: DsbC, glutathione, catalase.',
    ids: ['dsbc_ecoli', 'oxidized_glutathione', 'reduced_glutathione', 'catalase', 'dithiothreitol',
      'pyruvate_oxidase'] },
  { key: 'cofactors', label: 'Cofactors',
    blurb: 'CoA, NAD, folinic acid, cAMP, nicotinamide.',
    ids: ['coa', 'nad', 'folinic_acid', 'camp', 'nicotinamide', 'trna'] },
  { key: 'crowding', label: 'Polyamines & crowding',
    blurb: 'Spermidine, putrescine, PEG and other additives.',
    ids: ['spermidine', 'putrescine_dihydrochloride', 'peg_8000', 'brij_35', 'dmso'] },
  { key: 'buffer', label: 'Buffer & phosphate',
    blurb: 'pH buffering and inorganic phosphate.',
    ids: ['hepes_koh', 'bis_tris_ph_6_5', 'potassium_phosphate_dibasic', 'potassium_phosphate_monobasic',
      'potassium_phosphate_ratio_dibasic_monobasic', 'potassium_phosphate_ratio_monobasic_dibasic'] },
  { key: 'aminoacids', label: 'Amino acids',
    blurb: 'Building-block supply.',
    ids: ['aa_mix_17', 'tyrosine', 'cysteine'] },
  { key: 'metabolic', label: 'Metabolic modulators',
    blurb: 'TCA intermediates and pathway tweaks.',
    ids: ['oxaloacetic_acid', 'succinic_acid', 'potassium_oxalate'] }
];
const BRANCH_OF = Object.fromEntries(BRANCHES.flatMap((b) => b.ids.map((id) => [id, b.key])));
// A reagent added to the PocketBase catalog after this list was written is placed
// by its catalog group name instead of falling into "Other" — so new stock shows up
// on the right limb of the mind map with no code change. First match wins.
const GROUP_RULES = [
  { re: /energy|atp|regenerat|carbon/i, key: 'energy' },
  { re: /nucleotide|nucleoside|transcription/i, key: 'nucleotides' },
  { re: /salt/i, key: 'salts' },
  { re: /redox|fold|chaperone|enzyme/i, key: 'folding' },
  { re: /cofactor/i, key: 'cofactors' },
  { re: /detergent|solvent|crowd|polyamine|surfactant/i, key: 'crowding' },
  { re: /buffer|phosphate/i, key: 'buffer' },
  { re: /amino|translation/i, key: 'aminoacids' },
  { re: /metabolic|pathway/i, key: 'metabolic' }
];
const groupBranch = (group) => GROUP_RULES.find((r) => r.re.test(String(group || '')))?.key ?? null;
const NMP_LIKE = new Set(['amp', 'cmp', 'gmp', 'ump', 'adenosine', 'guanosine', 'cytidine', 'uridine',
  'thymidine', 'adenine', 'guanine', 'cytosine', 'uracil', 'thymine']);

// ── Strategies (cross-cutting approach styles) ─────────────────────────────────
export const STRATEGIES = [
  { key: 'single', label: 'One-knob tweak', glyph: '◉',
    blurb: 'Change exactly one reagent from a reference — clean, attributable tests.' },
  { key: 'sweep', label: 'Sweeps & factorials', glyph: '▦',
    blurb: 'Batches that grid or titrate one or more factors.' },
  { key: 'trim', label: 'Trim the expensive', glyph: '✂',
    blurb: 'Cut or drop the priciest reagents (DsbC, CoA, NTPs…) to win on $/g.' },
  { key: 'swap', label: 'Energy swap', glyph: '⇄',
    blurb: 'Replace the reference energy system with a different substrate.' },
  { key: 'cheapnt', label: 'Cheaper nucleotides', glyph: '◇',
    blurb: 'Move from NTPs to NMPs, nucleosides or bases.' },
  { key: 'literature', label: 'Literature recipes', glyph: '❡',
    blurb: 'Built on a named published system (PANOx, Cytomim, …).' },
  { key: 'scratch', label: 'Built from scratch', glyph: '✦',
    blurb: 'Large rewrites — far from any reference formulation.' }
];

const SWEEP_RE = /\b(sweep|factorial|grid|gradient|titrat\w*|dose[- ]response|doe|ofat|series|ladder|matrix)\b/i;
const LIT_RE = /\b(panox|cytomim|jewett|swartz|calhoun|zawada|kwon|garenne|borkowski|warfel|literature|published|et al)\b/i;
const SCRATCH_MOVES = 7;
const MIN_MAG_DESIGNS = 3; // a fold from one or two designs is an anecdote, not a pattern

// ── Unit helpers ───────────────────────────────────────────────────────────────
// reagent_list (pydantic field → nL) → { appId: nL } over the tunable reagents.
function designVolumes(reagentList) {
  const out = {};
  for (const [field, nl] of Object.entries(reagentList || {})) {
    if (TEMPLATE_FIELDS.test(field)) continue;
    const id = PYDANTIC_TO_REAGENT_ID[field] ?? field;
    if (FIXED_IDS.has(id)) continue;
    const v = Number(nl) || 0;
    if (v > 0) out[id] = v;
  }
  return out;
}

// A benchmark's { paperName: concentration } → the supplement nL that delivers it,
// using the alias stock (stored in the paper's own unit) and crediting the base
// buffer's 1× contribution. Composite aliases (Amino acids) map onto their first id.
function formulationVolumes(components) {
  const out = {};
  for (const [paper, conc] of Object.entries(components || {})) {
    const alias = REAGENT_ALIASES[paper];
    const id = alias?.ids?.[0];
    if (!id || !alias.stockMm) continue;
    const supplement = (Number(conc) || 0) - (BASE_BUFFER_1X_CONTRIBUTION_MM[paper] || 0);
    if (supplement <= 0) continue;
    out[id] = (supplement / alias.stockMm) * TOTAL_NL;
  }
  return out;
}

// Reagents the fixed base buffer already supplies (K-/Mg-glutamate, HEPES, amino acids,
// Tyr, Cys) can never reach zero — a design that adds no extra is back at the base
// level, not "removed". These are compared on final concentration (base + extra), so
// they only ever go up or down, and their fold is a real concentration change.
const STOCK_MM_BY_ID = Object.fromEntries(
  Object.values(REAGENT_ALIASES)
    .filter((a) => a?.ids?.length === 1 && a.stockMm && a.unit === 'mM')
    .map((a) => [a.ids[0], a.stockMm])
);
STOCK_MM_BY_ID.aa_mix_17 ??= REAGENT_ALIASES['Amino acids']?.stockMm;
const baseMm = (id) => (STOCK_MM_BY_ID[id] ? BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID[id] || 0 : 0);
const finalMm = (id, nl) => baseMm(id) + (STOCK_MM_BY_ID[id] * (nl || 0)) / TOTAL_NL;

function classify(id, designNl, refNl) {
  const d = designNl || 0;
  const r = refNl || 0;
  if (baseMm(id)) {
    const fd = finalMm(id, d), fr = finalMm(id, r);
    const step = (STOCK_MM_BY_ID[id] * STEP_NL) / TOTAL_NL;
    if (Math.abs(fd - fr) <= Math.max(step, fr * 0.12)) return null;
    return fd > fr ? 'up' : 'down';
  }
  if (r < STEP_NL / 2 && d >= STEP_NL / 2) return 'add';
  if (r >= STEP_NL / 2 && d < STEP_NL / 2) return 'drop';
  if (r < STEP_NL / 2) return null;
  // Tolerate Echo snapping (25 nL) and ~12% so a preset reloaded as-is reads as "no change".
  if (Math.abs(d - r) <= Math.max(STEP_NL, r * 0.12)) return null;
  return d > r ? 'up' : 'down';
}

function diff(vols, refVols) {
  const ids = new Set([...Object.keys(vols), ...Object.keys(refVols)]);
  const moves = [];
  for (const id of ids) {
    const dir = classify(id, vols[id], refVols[id]);
    if (!dir) continue;
    const from = refVols[id] || 0, to = vols[id] || 0;
    // Fold change on the quantity that matters: final concentration for base-buffer
    // reagents, the added volume (∝ concentration) for everything else.
    const ratio = baseMm(id) ? finalMm(id, to) / finalMm(id, from) : from > 0 && to > 0 ? to / from : null;
    moves.push({ id, dir, from, to, ratio });
  }
  return moves;
}

// ── Text helpers ───────────────────────────────────────────────────────────────
const GENERIC = new Set(['acid', 'mix', 'stock', 'salt', 'mono', 'coli', 'kda', 'ratio', 'molar', 'potassium',
  'sodium', 'dibasic', 'monobasic', 'oxidized', 'reduced', 'amino', 'dihydrochloride', 'the', 'and']);

// Words that identify a reagent in free text: its parenthetical abbreviation plus the
// distinctive words of its catalog name ("Oxidized Glutathione (GSSG)" → gssg, glutathione).
function keywordsFor(id, name) {
  const words = new Set();
  const abbr = String(name).match(/\(([^)]+)\)/g) || [];
  for (const a of abbr) {
    const w = a.slice(1, -1).trim().toLowerCase();
    if (/^[a-z0-9-]{2,8}$/.test(w)) words.add(w);
  }
  for (const w of String(name).replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^a-z0-9-]+/)) {
    if (w.length >= 3 && !GENERIC.has(w) && !/^\d/.test(w)) words.add(w);
  }
  const extra = { pep_mono: ['pep', 'phosphoenolpyruvate'], dsbc_ecoli: ['dsbc'], aa_mix_17: ['amino acid'],
    magnesium_glutamate: ['mg', 'magnesium'], potassium_glutamate: ['k-glu', 'kglu', 'potassium glutamate'],
    maltodextrin_17: ['maltodextrin'], hepes_koh: ['hepes'], three_pga: ['3-pga', 'pga'],
    sodium_hexametaphosphate: ['polyphosphate', 'hexametaphosphate', 'polyp'], peg_8000: ['peg'] };
  for (const w of extra[id] || []) words.add(w);
  return [...words];
}

function sentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(isProse);
}

// A sentence worth quoting: real words, not a "field: 250 nL" volume dump.
function isProse(s) {
  if (s.length < 30 || /^[a-z0-9_]+\s*:/i.test(s)) return false;
  const words = s.split(/\s+/);
  const wordy = words.filter((w) => /^[A-Za-z][a-z'’-]{2,}[.,;:]?$/.test(w)).length;
  return words.length >= 7 && wordy / words.length >= 0.5;
}

function clip(s, n = 220) {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function findQuote(text, keywords) {
  for (const s of sentences(text)) {
    const low = s.toLowerCase();
    if (keywords.some((k) => (k.length <= 3 ? new RegExp(`\\b${k}\\b`).test(low) : low.includes(k)))) return clip(s);
  }
  return null;
}

function firstQuote(text) {
  const s = sentences(text)[0];
  return s ? clip(s, 200) : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
/**
 * @param {object} p
 * @param {Array} p.designs       normalized community designs ({ id, author, contributorKey, proteinTarget,
 *                                comments, experimentHypothesis, batchId, batchSize, submittedVia, aiModel,
 *                                created, reagentList })
 * @param {Array} p.reagents      flat reagent catalog ({ id, name, costPerMl })
 * @param {Array} p.formulations  benchmark formulations ({ key, name, short, category, components })
 * @param {Array} [p.suggestions] community reagent suggestions (normalized)
 */
export function analyzeSubmissions({ designs = [], reagents = [], formulations = [], suggestions = [] }) {
  const reagentById = Object.fromEntries(reagents.map((r) => [r.id, r]));
  const branchOf = (id) => BRANCH_OF[id] ?? groupBranch(reagentById[id]?.group) ?? 'other';
  // Tunable, in-stock catalog reagents — the denominator for "never touched".
  const catalog = reagents.filter((r) => !FIXED_IDS.has(r.id) && r.in_stock !== false);
  const nameOf = (id) => shortName(reagentById[id]?.name || id);
  const kw = {};
  const keywordsOf = (id) => (kw[id] ??= keywordsFor(id, reagentById[id]?.name || id));

  // Every reference / literature / Ginkgo-autonomous formulation is a candidate
  // starting point (many people build on a published recipe, not the target
  // presets). A target preset only competes for designs of its own target.
  const refs = formulations
    .filter((f) => f.components && Object.keys(f.components).length)
    .map((f) => ({
      ...f,
      target: f.category === 'ginkgo-target' ? TARGETS.find((t) => f.key.includes(t.toLowerCase())) : null,
      vols: formulationVolumes(f.components)
    }));

  // Expensive reagents = the top of the catalog by $ per mL actually dosed (a 20 µL
  // reaction uses µL-scale volumes, so cost/mL is a fair ranking).
  const pricey = new Set(
    [...reagents].filter((r) => !FIXED_IDS.has(r.id) && Number(r.costPerMl) >= 4).map((r) => r.id)
  );

  // ── per-design diff + tags ──
  const rows = [];
  for (const d of designs) {
    const target = TARGETS.includes(d.proteinTarget) ? d.proteinTarget : null;
    const vols = designVolumes(d.reagentList);
    let best = null;
    for (const ref of refs) {
      if (ref.target && target && ref.target !== target) continue;
      const moves = diff(vols, ref.vols);
      const l1 = moves.reduce((s, m) => s + Math.abs(m.to - m.from), 0);
      // Fewest moves wins; ties go to the design's own target preset, then smallest L1.
      const score = moves.length - (ref.target ? 0.5 : 0);
      if (!best || score < best.score || (score === best.score && l1 < best.l1)) {
        best = { ref, moves, l1, score };
      }
    }
    const moves = best?.moves ?? [];
    const text = [d.comments, d.experimentHypothesis].filter(Boolean).join(' ');
    const strategies = new Set();
    if (moves.length === 1) strategies.add('single');
    if ((d.batchSize || 0) >= 4 || SWEEP_RE.test(text)) strategies.add('sweep');
    if (moves.some((m) => pricey.has(m.id) && (m.dir === 'down' || m.dir === 'drop'))) strategies.add('trim');
    const refEnergy = Object.keys(best?.ref?.vols || {}).filter((id) => branchOf(id) === 'energy');
    if (moves.some((m) => branchOf(m.id) === 'energy' && (m.dir === 'add' || (m.dir === 'drop' && refEnergy.includes(m.id))))) {
      strategies.add('swap');
    }
    if (moves.some((m) => NMP_LIKE.has(m.id) && (m.dir === 'add' || m.dir === 'up'))) strategies.add('cheapnt');
    const litBase = best && !best.ref.target && !/ginkgo|oxidizing/.test(best.ref.category || '');
    if (LIT_RE.test(text) || (litBase && moves.length < SCRATCH_MOVES)) strategies.add('literature');
    if (moves.length >= SCRATCH_MOVES) strategies.add('scratch');
    rows.push({
      d,
      target,
      person: d.author || 'Anonymous',
      personKey: d.contributorKey || `name:${(d.author || 'anon').toLowerCase()}`,
      ref: best?.ref,
      moves,
      text,
      strategies: [...strategies]
    });
  }

  const wishAll = summarizeSuggestions(suggestions, Infinity);
  // Wishlist reagents we don't stock yet — the genuinely new proposals for round 2.
  const catalogNames = reagents.map((r) => String(r.name).toLowerCase());
  const proposals = wishAll
    .filter((w) => {
      const n = shortWish(w.name).toLowerCase();
      return n.length >= 3 && !catalogNames.some((c) => c.includes(n) || n.includes(c.replace(/\s*\(.*$/, '')));
    })
    .slice(0, 8)
    .map((w) => ({
      ...w,
      short: shortWish(w.name),
      theme: wishTheme(w) ?? (w.category !== 'Other' ? w.category : 'Other')
    }));
  const build = (subset) => {
    const view = buildView(subset, { nameOf, keywordsOf, branchOf, catalog });
    return { ...view, summary: summarizeView(view, wishAll, pricey, proposals) };
  };
  const byTarget = Object.fromEntries(TARGETS.map((t) => [t, build(rows.filter((r) => r.target === t))]));
  return {
    generatedAt: new Date().toISOString(),
    views: { all: build(rows), ...byTarget },
    suggestions: wishAll.slice(0, 10),
    proposals
  };
}

function shortName(name) {
  return String(name)
    .replace(/\s*\((?:[^)]*kDa[^)]*|[^)]*stock[^)]*|molar ratio|[^)]*U\/mg)\)/gi, '')
    .replace(/^Potassium phosphate 1\.6:1 /i, 'KPi ')
    .replace(/ pH \d+(\.\d+)?/i, '')
    .replace(/^Oxidized Glutathione \(GSSG\)$/i, 'GSSG')
    .replace(/^Reduced Glutathione \(GSH\)$/i, 'GSH')
    .replace(/^Dithiothreitol \(DTT\)$/i, 'DTT')
    .replace(/^3-Phosphoglycerate \(3-PGA\)$/i, '3-PGA')
    .replace(/^Dimethyl Sulfoxide \(DMSO\)$/i, 'DMSO')
    .replace(/^PEP mono.*$/i, 'PEP')
    .replace(/^17 Amino Acid Mix$/i, 'Amino acids')
    .replace(/^Coenzyme A$/i, 'CoA')
    .replace(/ Dihydrochloride$/i, '')
    .replace(/^Maltodextrin 17$/i, 'Maltodextrin')
    .replace(/^HEPES-KOH$/i, 'HEPES')
    .replace(/^Potassium Glutamate$/i, 'K-glutamate')
    .replace(/^Magnesium Glutamate$/i, 'Mg-glutamate')
    .replace(/^Ammonium Glutamate$/i, 'NH₄-glutamate')
    .replace(/^Potassium Oxalate$/i, 'K-oxalate')
    .replace(/^Potassium formate$/i, 'K-formate')
    .replace(/^Potassium phosphate dibasic$/i, 'K₂HPO₄')
    .replace(/^Potassium phosphate monobasic$/i, 'KH₂PO₄')
    .replace(/^KPi monobasic:dibasic$/i, 'KPi mono:di')
    .replace(/^KPi dibasic:monobasic$/i, 'KPi di:mono')
    .replace(/^Sodium Pyruvate$/i, 'Pyruvate')
    .replace(/^Sodium Hexametaphosphate$/i, 'Polyphosphate')
    .replace(/^Dilithium Acetyl Phosphate$/i, 'Acetyl phosphate')
    .replace(/^Folinic Acid$/i, 'Folinic acid')
    .trim();
}

const DIR_GLYPH = { up: '↑', down: '↓', add: '+', drop: '−' };
const DIR_WORD = { up: 'raised', down: 'lowered', add: 'added', drop: 'removed' };

function buildView(rows, { nameOf, keywordsOf, branchOf, catalog }) {
  const people = new Map(); // personKey → summary
  for (const r of rows) {
    const p = people.get(r.personKey) ?? {
      key: r.personKey, name: r.person, designs: 0, targets: {}, branches: new Set(), strategies: new Set(),
      moves: new Set(), models: new Set(), agent: 0, quote: null, first: r.d.created, last: r.d.created
    };
    p.designs++;
    if (r.target) p.targets[r.target] = (p.targets[r.target] || 0) + 1;
    for (const m of r.moves) {
      p.branches.add(branchOf(m.id));
      p.moves.add(`${m.id}:${m.dir}`);
    }
    for (const s of r.strategies) p.strategies.add(s);
    for (const m of canonicalModels(r.d.aiModel)) p.models.add(m.label);
    if (r.d.submittedVia === 'agent') p.agent++;
    p.quote ??= firstQuote(r.d.experimentHypothesis) || firstQuote(r.d.comments);
    if (r.d.created && r.d.created < p.first) p.first = r.d.created;
    if (r.d.created && r.d.created > p.last) p.last = r.d.created;
    people.set(r.personKey, p);
  }

  // ── moves, grouped into branches ──
  const moveMap = new Map();
  for (const r of rows) {
    for (const m of r.moves) {
      const k = `${m.id}:${m.dir}`;
      const mv = moveMap.get(k) ?? {
        key: k, id: m.id, dir: m.dir, label: `${nameOf(m.id)} ${DIR_GLYPH[m.dir]}`, name: nameOf(m.id),
        verb: DIR_WORD[m.dir], branch: branchOf(m.id), people: new Map(), designs: 0,
        targets: {}, quotes: [], fold: []
      };
      mv.designs++;
      if (r.target) mv.targets[r.target] = (mv.targets[r.target] || 0) + 1;
      mv.people.set(r.personKey, r.person);
      if (m.ratio) mv.fold.push(m.ratio);
      if (mv.quotes.length < 3 && !mv.quotes.some((q) => q.key === r.personKey)) {
        const q = findQuote(r.text, keywordsOf(m.id));
        if (q) mv.quotes.push({ key: r.personKey, author: r.person, text: q });
      }
      moveMap.set(k, mv);
    }
  }
  const moves = [...moveMap.values()].map((mv) => {
    const fold = mv.fold.length ? median(mv.fold) : null;
    return {
      key: mv.key, id: mv.id, dir: mv.dir, label: mv.label, name: mv.name, verb: mv.verb, branch: mv.branch,
      people: [...mv.people.entries()].map(([key, name]) => ({ key, name })),
      peopleCount: mv.people.size, designs: mv.designs, targets: mv.targets,
      fold: fold ? Math.round(fold * 100) / 100 : null,
      quotes: mv.quotes.map(({ author, text }) => ({ author, text }))
    };
  });

  // One mind-map node per reagent: its moves (↑ ↓ + −) folded together, labelled by
  // the direction most people took.
  // Size of each raise / lower as a fold (always ≥ 1: ×3 up and ÷3 down both = 3),
  // per reagent — the "how much" view. Adds/removes have no fold and are left out.
  const magById = {}; // id → { up: [folds], down: [folds] }
  for (const mv of moveMap.values()) {
    if (mv.dir !== 'up' && mv.dir !== 'down') continue;
    const bucket = (magById[mv.id] ??= { up: [], down: [] })[mv.dir];
    for (const f of mv.fold) bucket.push(mv.dir === 'up' ? f : 1 / f);
  }
  // Unrounded median fold (≥ 1); the page formats it as a % change.
  const typical = (xs) => (xs.length >= MIN_MAG_DESIGNS ? Math.round(median(xs) * 1000) / 1000 : null);

  const reagentNodes = (bm) => {
    const byId = new Map();
    for (const m of bm) {
      const n = byId.get(m.id) ?? { key: m.id, id: m.id, name: m.name, branch: m.branch, people: new Map(), designs: 0,
        dirs: {}, dirDesigns: {}, targets: {}, quotes: [], moveKeys: [] };
      for (const p of m.people) n.people.set(p.key, p.name);
      n.designs += m.designs;
      n.dirs[m.dir] = m.peopleCount;
      n.dirDesigns[m.dir] = m.designs;
      n.moveKeys.push(m.key);
      for (const [t, c] of Object.entries(m.targets)) n.targets[t] = (n.targets[t] || 0) + c;
      for (const q of m.quotes) if (n.quotes.length < 2 && !n.quotes.some((x) => x.author === q.author)) n.quotes.push(q);
      byId.set(m.id, n);
    }
    return [...byId.values()]
      .map((n) => {
        const top = Object.entries(n.dirs).sort((a, z) => z[1] - a[1])[0][0];
        const mags = magById[n.id] ?? { up: [], down: [] };
        const magUp = typical(mags.up), magDown = typical(mags.down);
        return { ...n, people: [...n.people.entries()].map(([key, name]) => ({ key, name })), peopleCount: n.people.size,
          dir: top, label: `${n.name} ${DIR_GLYPH[top]}`,
          magUp, magDown, mag: Math.max(magUp || 0, magDown || 0) || null };
      })
      .sort((a, z) => z.peopleCount - a.peopleCount || z.designs - a.designs);
  };

  const branchDefs = [...BRANCHES, { key: 'other', label: 'Other', blurb: 'Everything else.', ids: [] }];
  const branches = branchDefs
    .map((b) => {
      const bm = moves.filter((m) => m.branch === b.key).sort((a, z) => z.peopleCount - a.peopleCount || z.designs - a.designs);
      const ppl = new Set(bm.flatMap((m) => m.people.map((p) => p.key)));
      return {
        key: b.key, label: b.label, blurb: b.blurb,
        peopleCount: ppl.size, designs: rows.filter((r) => r.moves.some((m) => branchOf(m.id) === b.key)).length,
        moves: bm,
        reagents: reagentNodes(bm)
      };
    })
    .filter((b) => b.moves.length)
    .sort((a, z) => z.peopleCount - a.peopleCount);

  // ── strategies ──
  const strategies = STRATEGIES.map((s) => {
    const sr = rows.filter((r) => r.strategies.includes(s.key));
    const ppl = new Map(sr.map((r) => [r.personKey, r.person]));
    const quotes = [];
    for (const r of sr) {
      if (quotes.length >= 2 || quotes.some((q) => q.author === r.person)) continue;
      const q = firstQuote(r.d.experimentHypothesis) || firstQuote(r.d.comments);
      if (q) quotes.push({ author: r.person, text: q });
    }
    return {
      ...s,
      designs: sr.length,
      peopleCount: ppl.size,
      people: [...ppl.entries()].map(([key, name]) => ({ key, name })),
      quotes
    };
  }).filter((s) => s.designs > 0);

  // ── starting points: the formulation each design sits closest to ──
  const startMap = new Map();
  for (const r of rows) {
    const scratch = !r.ref || r.moves.length >= SCRATCH_MOVES;
    const key = scratch ? 'scratch' : r.ref.key;
    const st = startMap.get(key) ?? {
      key, label: scratch ? 'Far from any recipe' : (r.ref.short || r.ref.name),
      kind: scratch ? 'scratch' : r.ref.category === 'ginkgo-target' ? 'reference'
        : r.ref.category === 'gpt5-autonomous' ? 'ginkgo-ai' : 'literature',
      citation: scratch ? null : r.ref.citation || null, designs: 0, people: new Set()
    };
    st.designs++;
    st.people.add(r.personKey);
    startMap.set(key, st);
  }
  const starts = [...startMap.values()]
    .map((s) => ({ ...s, people: s.people.size }))
    .sort((a, z) => z.designs - a.designs);

  // ── edit hotspots: most → least edited reagents, and biggest typical changes ──
  const allNodes = branches.flatMap((b) => b.reagents);
  const edited = new Set(allNodes.map((n) => n.id));
  // Ranked by students, not designs, so one prolific sweep can't dominate.
  const byStudents = [...allNodes].sort((a, z) => z.peopleCount - a.peopleCount || z.designs - a.designs);
  const hotspots = {
    often: byStudents.slice(0, 12),
    much: allNodes.filter((n) => n.mag).sort((a, z) => z.mag - a.mag).slice(0, 12),
    least: byStudents.slice(12).reverse().slice(0, 6).map((n) => ({ name: n.name, students: n.peopleCount })),
    untouched: catalog.filter((r) => !edited.has(r.id)).map((r) => nameOf(r.id))
  };

  const peopleList = [...people.values()]
    .map((p) => ({
      key: p.key, name: p.name, designs: p.designs, targets: p.targets,
      branches: [...p.branches], strategies: [...p.strategies], moves: [...p.moves],
      models: [...p.models].slice(0, 3), agent: p.agent, quote: p.quote
    }))
    .sort((a, z) => z.designs - a.designs || a.name.localeCompare(z.name));

  // ── AI models used ──
  // One entry per distinct model named in metadata.ai_model, most-credited first.
  // A design naming two models counts once for each, so `designs` sums above the
  // design count; `credited` is the number of designs that named any model at all.
  const modelMap = new Map();
  let credited = 0;
  for (const r of rows) {
    const named = canonicalModels(r.d.aiModel);
    if (named.length) credited++;
    for (const { label, family } of named) {
      const e = modelMap.get(label) ?? { label, family, designs: 0, people: new Map(), targets: {} };
      e.designs++;
      // Per-student tally, so the hover can name who used this model and how much.
      const who = e.people.get(r.personKey) ?? { key: r.personKey, name: r.person, designs: 0 };
      who.designs++;
      e.people.set(r.personKey, who);
      if (r.target) e.targets[r.target] = (e.targets[r.target] || 0) + 1;
      modelMap.set(label, e);
    }
  }
  const models = [...modelMap.values()]
    .map((e) => ({
      ...e,
      peopleCount: e.people.size,
      // Busiest user of this model first; ties alphabetical so the order is stable.
      people: [...e.people.values()].sort((a, z) => z.designs - a.designs || a.name.localeCompare(z.name))
    }))
    .sort((a, z) => z.designs - a.designs || z.peopleCount - a.peopleCount || a.label.localeCompare(z.label));
  const modelFamilies = {};
  for (const m of models) modelFamilies[m.family] = (modelFamilies[m.family] || 0) + m.designs;

  const targets = {};
  for (const r of rows) if (r.target) targets[r.target] = (targets[r.target] || 0) + 1;
  const assisted = rows.filter((r) => r.d.submittedVia === 'agent' || (r.d.aiModel && !/^(n\/?a|none|-)?$/i.test(r.d.aiModel.trim()))).length;
  const batches = new Set(rows.map((r) => r.d.batchId || r.d.id)).size;
  const avgMoves = rows.length ? rows.reduce((s, r) => s + r.moves.length, 0) / rows.length : 0;

  return {
    totals: {
      designs: rows.length, people: people.size, batches, targets, assisted,
      credited, modelCount: models.length, modelFamilies,
      avgMoves: Math.round(avgMoves * 10) / 10
    },
    models,
    starts,
    branches,
    strategies,
    hotspots,
    people: peopleList
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Big-picture statements ─────────────────────────────────────────────────────
// Short, data-derived headlines for the "At a glance" summary: how round-1 designs
// are approaching the problem, and which reagents the community wants for round 2.
// Each is { head, body } — a 2–4 word lead and one terse line.
const WISH_THEMES = [
  { label: 'Stabilisers', re: /stabili[sz]|trehalose|betaine|osmolyte|chemical chaperone|protective sugar/i },
  { label: 'Folding & disulfide helpers', re: /chaperon|fold|disulfide|isomerase|oxidoreduct|\bdsb|groel|holdase|erv1|trx|glutaredox|thioredox/i },
  { label: 'Energy regeneration', re: /\batp\b|energy|phosphate|pyrophosph|polyphosph|maltodextrin|kinase/i },
  { label: 'Cofactors', re: /cofactor|coa\b|pantethine|nad\b|vitamin/i },
  { label: 'Membrane mimics', re: /liposome|nanodisc|lipid|membrane/i }
];
// The reagent's own name is the strongest signal (a kinase that "helps folding" is
// still an energy enzyme); fall back to its description.
const wishTheme = (w) =>
  (WISH_THEMES.find((t) => t.re.test(w.name)) ?? WISH_THEMES.find((t) => t.re.test(`${w.name} ${w.description}`)))?.label;
function modelFamily(m) {
  if (/claude/i.test(m)) return 'Claude';
  if (/gpt|chatgpt|openai|codex/i.test(m)) return 'GPT';
  if (/gemini/i.test(m)) return 'Gemini';
  if (/grok/i.test(m)) return 'Grok';
  if (/copilot/i.test(m)) return 'Copilot';
  if (/deepseek/i.test(m)) return 'DeepSeek';
  return null;
}
// ── Per-target scientific approach ───────────────────────────────────────────
// A hand-checked read of what the submitted rationales are actually testing for
// each protein, written from the full set of hypothesis + comment text (766
// designs, 20 Oct 2026). Student counts are approximate — they come from reading
// the rationales, not from the reagent diff — so they're shown as "~N". Unlike
// everything else on the page this is prose, not a live aggregate: it needs a
// re-read when the submissions change materially.
export const TARGET_APPROACHES = {
  sfGFP: {
    note: 'A robust, fast-folding reporter with no disulfides — so the work is almost all about energy, nucleotides and salts rather than folding.',
    bullets: [
      { head: 'Cheaper energy regeneration', body: 'Replace the NTP/PEP system with low-cost regeneration — ribose, glucose or NMPs recycled by lysate kinases — to cut cost per gram while holding titer.', n: 40 },
      { head: 'Nucleotide pool trimming', body: 'Lower or rebalance AMP/CMP/GMP/UMP, testing whether transcription saturates well below the full, expensive nucleotide load.', n: 30 },
      { head: 'Monovalent & phosphate balance', body: 'Tune K-glutamate (~200–360 mM), ammonium glutamate and mono/dibasic phosphate for ionic strength, pH buffering and glucose–phosphate synergy.', n: 25 },
      { head: 'Magnesium titration', body: 'Step Mg-glutamate up and down around 7–10 mM to find the narrow optimum between supporting ribosome assembly and divalent inhibition.', n: 23 },
      { head: 'Cheap additives, and omissions', body: 'Add spermidine/putrescine, catalase or PEG-8000 crowding, and drop DsbC and glutathione entirely since sfGFP needs no disulfides.', n: 16 }
    ],
    niche: 'One 80-well factorial sweep (maltodextrin × hexametaphosphate × PEG/spermidine × NMP level); single entries test a pyruvate-oxidase/catalase oxygen arm and guanine + ribose in place of GMP.'
  },
  PETase: {
    note: 'One disulfide and an activity readout after a 60 °C heat step — so folding help is dialled back rather than piled on, and cost is the main lever.',
    bullets: [
      { head: 'DsbC dose reduction', body: 'Titrate down or delete the 5 µM DsbC isomerase: a single disulfide has no mispairing to proofread, so cost should fall faster than activity.', n: 25 },
      { head: 'Cheap energy backbone', body: 'Swap PEP for ribose/NMP, maltodextrin, or glucose plus phosphate, testing whether slower ATP regeneration still sustains comparable active enzyme.', n: 20 },
      { head: 'Glutathione redox poising', body: 'Add a mildly oxidizing GSSG/GSH couple (~0.25–2 mM, GSSG-biased), with or without DsbC, to let the single disulfide close in reducing lysate.', n: 17 },
      { head: 'Magnesium and salt tuning', body: 'Ladders of Mg-glutamate (3.85–19.5 mM), K-glutamate and phosphate, since Mg governs ribosome function and is re-set by the chosen energy source.', n: 13 },
      { head: 'Trimming the consumables', body: 'Stepwise cuts to NMPs/NTPs, CoA, NAD, folinic acid, HEPES, cysteine and tyrosine, asking which supplements the lysate already covers.', n: 10 }
    ],
    niche: 'Single entries test PEG-8000/DMSO crowding, Brij-35 to limit cutinase adsorption, acetyl phosphate as extra energy, and an in-situ oxidation scheme using pyruvate oxidase with catalase deliberately omitted.'
  },
  Reteplase: {
    note: 'Nine disulfides and a kinetic protease readout — the hardest fold of the three, so oxidative folding chemistry dominates and DsbC drives the cost.',
    bullets: [
      { head: 'GSSG/GSH redox tuning', body: 'Vary the oxidizing glutathione couple around the 4:1 GSSG:GSH literature point — ratio and total-pool grids — to drive correct pairing of nine disulfides.', n: 25 },
      { head: 'DsbC dose vs. cost', body: 'DsbC ladders from a no-helper control through 0.25–1.25 µM up to 5–7.5 µM, seeking the knee in cost per unit activity — the isomerase is most of the reaction cost.', n: 24 },
      { head: 'Energy system swap', body: 'PEP vs ribose/NMP vs glucose, pyruvate or acetyl phosphate, testing whether cheaper substrates sustain the phosphorylation potential oxidative folding appears to need.', n: 15 },
      { head: 'Buffering against acidification', body: 'HEPES-KOH from the 57.5 mM reference up to 120 mM, plus added potassium phosphate, to hold pH above ~7 as PEP-derived phosphate and glutathione acidify the reaction.', n: 10 },
      { head: 'Salts and slower translation', body: 'Mg- and K-glutamate sweeps with added cysteine, lowering Mg to slow elongation so folding keeps pace and off-pathway aggregation falls.', n: 9 }
    ],
    niche: 'A 4 °C cold-refold hypothesis using the post-incubation hold; a pyruvate-oxidase/catalase "Ero1 mimic" generating GSSG in situ; PEG-8000 or DMSO crowding; and polyamine add/remove arms.'
  }
};

// ── AI model credits ──────────────────────────────────────────────────────────
// metadata.ai_model is free text ("claude=sonnet- 5.5", "OpenAI Codex (GPT-6);
// Claude (research and review)"), so it's split into the models it names and each
// is mapped onto one canonical label. Rules are tried in order — more specific
// versions first, so "GPT-5.6 Sol" isn't read as "GPT-6 Sol".
const MODEL_RULES = [
  ['Claude Opus 5', 'Claude', /opus\W*5(?![.\d])/],
  ['Claude Opus 4.8', 'Claude', /opus\W*4\W*8/],
  ['Claude Sonnet 5.5', 'Claude', /sonnet\W*5\W*5/],
  ['Claude Sonnet 5', 'Claude', /sonnet\W*5(?![.,\d])/],
  ['Claude (version not given)', 'Claude', /claude|anthropic/],
  ['GPT-6.1 Sol Light', 'GPT', /6\.1\W*sol\W*light/],
  ['GPT-6.1 Sol', 'GPT', /6\.1\W*sol/],
  ['GPT-5.6 Luna', 'GPT', /5\.6\W*luna/],
  ['GPT-5.6 Sol', 'GPT', /5\.6\W*sol/],
  ['GPT-5.6', 'GPT', /gpt\W*5\.6/],
  ['GPT-5.5', 'GPT', /gpt\W*5\.5/],
  ['GPT-6 Astra Medium', 'GPT', /astra/],
  ['GPT-6 Sol', 'GPT', /\b6\W*sol/],
  ['GPT-6', 'GPT', /gpt\W*6/],
  ['GPT-5', 'GPT', /gpt\W*5/],
  ['GPT-4', 'GPT', /gpt\W*4/],
  ['Codex (version not given)', 'GPT', /codex/],
  ['ChatGPT (version not given)', 'GPT', /chat\s*gpt|openai|gpt/],
  ['Gemini 3.8 Flash', 'Gemini', /gemini\W*3\.8/],
  ['Gemini 3.6', 'Gemini', /gemini\W*3\.6/],
  ['Gemini 3.1 Pro', 'Gemini', /gemini\W*3\.1/],
  ['Gemini 3', 'Gemini', /gemini\W*3\b/],
  ['Gemini (version not given)', 'Gemini', /gemini|google/],
  ['Grok 4.7', 'Grok', /grok\W*4\.7/],
  ['Grok (version not given)', 'Grok', /grok/],
  ['Kimi 3', 'Other', /kimi\W*3/],
  ['Copilot', 'Other', /copilot/],
  ['Edison Scientific', 'Other', /edison/]
];
const NO_MODEL_RE = /^(n\/?a|none|no|-|sfgfp|petase|reteplase)?$/i;
// Split on ";", "+" and " and " — but not inside parentheses, where people explain
// ("Codex (OpenAI desktop app; exact model version not recorded)").
function splitModels(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    const sep = depth === 0 && (ch === ';' || ch === '+' ? 1 : /^ and /i.test(s.slice(i, i + 5)) ? 5 : 0);
    if (sep) { parts.push(cur); cur = ''; i += sep - 1; continue; }
    cur += ch;
  }
  return [...parts, cur].map((p) => p.trim()).filter(Boolean);
}
// Free-text ai_model → [{ label, family }], deduped. Parts that name no known model
// are dropped when another part does ("…; exact version not recorded"); a string
// that matches nothing at all is kept as written.
export function canonicalModels(raw) {
  const s = String(raw ?? '').trim();
  if (NO_MODEL_RE.test(s)) return [];
  const out = new Map();
  for (const part of splitModels(s)) {
    const norm = part.toLowerCase().replace(/[_=]/g, ' ');
    const hit = MODEL_RULES.find(([, , re]) => re.test(norm));
    if (hit) out.set(hit[0], { label: hit[0], family: hit[1] });
  }
  if (!out.size) out.set(s, { label: s, family: 'Other' });
  return [...out.values()];
}

const shortWish = (name) => String(name).replace(/\s*\(.*$/, '').replace(/[.…]+$/, '').trim();
const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`);

function summarizeView(v, wish, pricey, proposals) {
  const approaches = [];
  const reagents = [];
  const n = v.totals.designs;
  if (!n) return { approaches, reagents };
  const pct = (x) => Math.round((100 * x) / n);
  const moves = v.branches.flatMap((b) => b.moves);
  const byPeople = (a, z) => z.peopleCount - a.peopleCount || z.designs - a.designs;
  const uniqNames = (ms, k = 3) => [...new Set(ms.map((m) => m.name))].slice(0, k);

  // ── round 1: approaches ──
  const scratch = v.starts.find((s) => s.kind === 'scratch');
  const recipes = v.starts.filter((s) => s.kind !== 'scratch').slice(0, 2).map((s) => s.label);
  approaches.push({
    head: 'Where students start',
    body: `${pct(scratch?.designs || 0)}% are bold rewrites${recipes.length ? `; the rest build mostly on ${listOf(recipes)}` : ''}.`
  });
  const levers = v.branches.slice(0, 3);
  if (levers.length) {
    approaches.push({ head: 'Most-pulled levers', body: `${levers.map((b) => `${b.label} ${b.peopleCount}`).join(' · ')} students` });
  }
  const consensus = [...moves].sort(byPeople).slice(0, 3);
  if (consensus.length) {
    approaches.push({ head: 'Consensus moves', body: consensus.map((m) => `${m.label} ${m.peopleCount}`).join(' · ') });
  }
  const trim = v.strategies.find((s) => s.key === 'trim');
  const trimmed = moves.filter((m) => pricey.has(m.id) && (m.dir === 'down' || m.dir === 'drop')).sort(byPeople);
  if (trim && trimmed.length) {
    approaches.push({ head: 'Cost cutting', body: `${trim.peopleCount} students trim pricey reagents — mostly ${listOf(uniqNames(trimmed))}.` });
  }
  const swap = v.strategies.find((s) => s.key === 'swap');
  const energyAdds = moves.filter((m) => m.branch === 'energy' && m.dir === 'add').sort(byPeople);
  if (swap && energyAdds.length) {
    approaches.push({ head: 'Energy swaps', body: `${swap.peopleCount} students change the energy system — mostly to ${listOf(uniqNames(energyAdds))}.` });
  }
  const fam = {};
  for (const p of v.people) for (const f of new Set(p.models.map(modelFamily).filter(Boolean))) fam[f] = (fam[f] || 0) + 1;
  const topFam = Object.entries(fam).sort((a, z) => z[1] - a[1]).slice(0, 2).map(([f]) => f);
  approaches.push({
    head: 'AI in the loop',
    body: `${pct(v.totals.assisted)}% of designs AI-assisted${topFam.length ? `, led by ${listOf(topFam)}` : ''}.`
  });

  // ── round 2: reagents of interest ──
  const top = wish.filter((w) => w.votes > 0).slice(0, 3);
  if (top.length) reagents.push({ head: 'Most requested', body: top.map((w) => `${shortWish(w.name)} (${w.votes})`).join(' · ') });
  const themes = {};
  for (const w of wish) {
    const t = wishTheme(w);
    if (!t) continue;
    const th = (themes[t] ??= { label: t, count: 0, votes: 0, names: [] });
    th.count++;
    th.votes += w.votes;
    if (th.names.length < 3 && !th.names.includes(shortWish(w.name))) th.names.push(shortWish(w.name));
  }
  const lead = Object.values(themes).sort((a, z) => z.votes - a.votes || z.count - a.count)[0];
  if (lead) {
    reagents.push({ head: 'Dominant theme', body: `${lead.label} — ${lead.count} proposals, ${lead.votes} votes (${listOf(lead.names)}).` });
  }
  if (proposals.length) {
    reagents.push({ head: 'Not stocked yet', body: `${listOf(proposals.slice(0, 4).map((w) => w.short))} — requested but not yet available.` });
  }
  const adds = moves.filter((m) => m.dir === 'add').sort(byPeople).slice(0, 3);
  if (adds.length) reagents.push({ head: 'Additions gaining traction', body: adds.map((m) => `${m.name} +${m.peopleCount}`).join(' · ') });
  return { approaches, reagents };
}

// Community wishlist — reagents people asked Ginkgo to stock, by votes.
function summarizeSuggestions(list, limit = 10) {
  return (list || [])
    .map((s) => {
      const dict = s.suggestion && typeof s.suggestion === 'object' ? s.suggestion : s;
      const name = String(dict.name || s.name || '').trim();
      if (!name) return null;
      return {
        id: s.id,
        name: clip(name, 40),
        category: dict.category || s.category || 'Other',
        votes: Number(s.votes) || 0,
        by: dict.proposed_by || s.proposedBy || s.proposed_by || null,
        description: clip(dict.description || s.description || '', 260),
        link: dict.link || s.link || null,
        comments: Array.isArray(s.comments) ? s.comments.length : 0
      };
    })
    .filter(Boolean)
    .sort((a, z) => z.votes - a.votes || z.comments - a.comments)
    .slice(0, limit);
}

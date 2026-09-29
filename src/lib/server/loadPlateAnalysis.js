import { readFileSync } from 'fs';

// Reagent-range analysis is sourced from the autonomous-cfps repo's reference
// control runs — the only sfGFP/PETase/Reteplase results published in that repo.
// Each *_results.json is an array with a single 384-well plate; experimental
// wells carry a reagent_list (nL per reagent) + metadata. These are the OFAT
// "rev3" Round-2 positive-control plates: one-factor-at-a-time titrations of
// K-glutamate, Mg-glutamate, K-phosphate, glucose and the nucleotide source
// (native / NMP / NTP), run from three baselines (PANOx-SP, Ginkgo3, RFopt).
// One run per protein (the latest control run for each target).
const REF_DIR = '/Users/rdonovan/Desktop/autonomous-cfps/reference_results';
const RUNS = {
  sfgfp:     'sfGFP_control_20260722-39-L',
  cutinase:  'PETase_control_20260722-39-L',
  reteplase: 'reteplase_control_20260730-DSB',
};
const refPath = (dir) => `${REF_DIR}/${dir}/${dir}_results.json`;

// Stock concentration + base-buffer contribution for converting nL → final conc.
//  - `stock` is the source-well concentration expressed in the reagent's own
//    display `unit` (mM unless noted). `base` is the mM already contributed by
//    the base buffer before any Echo transfer (only salts/buffer/AAs have one).
//  - final = stock × (nL / 20000) + base, in `unit`.
const RXN_NL = 20_000;
const STOCK = {
  potassium_glutamate:   { stock: 875,    base: 200  },
  magnesium_glutamate:   { stock: 500,    base: 2.6  },
  hepes_koh:             { stock: 1000,   base: 30   },
  amino_acid_mix_17:     { stock: 50,     base: 1    },
  tyrosine:              { stock: 50,     base: 1    },
  cysteine:              { stock: 200,    base: 1    },
  kpo_monobasic_mix:     { stock: 500,    base: 0    },
  kpo_dibasic_mix:       { stock: 500,    base: 0    },
  pep_mono:              { stock: 100,    base: 0    },
  glucose:               { stock: 1110,   base: 0    },
  nicotinamide:          { stock: 100,    base: 0    },
  ribose:                { stock: 666,    base: 0    },
  amp:                   { stock: 100,    base: 0    },
  cmp:                   { stock: 100,    base: 0    },
  gmp:                   { stock: 100,    base: 0    },
  ump:                   { stock: 100,    base: 0    },
  atp:                   { stock: 100,    base: 0    },
  ctp:                   { stock: 100,    base: 0    },
  gtp:                   { stock: 100,    base: 0    },
  utp:                   { stock: 100,    base: 0    },
  spermidine:            { stock: 250,    base: 0    },
  sodium_pyruvate:       { stock: 909,    base: 0    },
  oxidized_glutathione:  { stock: 170,    base: 0    },
  reduced_glutathione:   { stock: 100,    base: 0    },
  putrescine:            { stock: 500,    base: 0    },
  ammonium_glutamate:    { stock: 1000,   base: 0    },
  coa:                   { stock: 50,     base: 0    }, // ~50 mM stock
  nad:                   { stock: 100,    base: 0    },
  potassium_oxalate:     { stock: 500,    base: 0    },
  // Folinic acid stock is a mass concentration (10 g/L), so the conversion
  // yields mg/mL — NOT mM. Displayed in its own unit so it isn't crushed to 0
  // against the mM salts.
  folinic_acid:          { stock: 10,     base: 0, unit: 'mg/mL' },
  // DsbC is dosed at µM scale (100 µM stock). Displayed in µM for the same reason.
  dsbc_ecoli:            { stock: 100,    base: 0, unit: 'µM' },
  adenosine:             { stock: 25,     base: 0    },
  cytidine:              { stock: 25,     base: 0    },
  guanosine:             { stock: 25,     base: 0    },
  uridine:               { stock: 25,     base: 0    },
  calcium_chloride:      { stock: 500,    base: 0    },
  // --- R1D-43 (Round 3) additions: molar stocks from reagent_yaml.yaml / specific_yaml.yaml ---
  adenine:               { stock: 25,     base: 0    },
  guanine:               { stock: 25,     base: 0    },
  cytosine:              { stock: 25,     base: 0    },
  uracil:                { stock: 25,     base: 0    },
  thymine:               { stock: 25,     base: 0    },
  thymidine:             { stock: 25,     base: 0    },
  camp:                  { stock: 200,    base: 0    },
  dilithium_acetyl_phosphate: { stock: 50,  base: 0 },
  potassium_formate:     { stock: 500,    base: 0    },
  oxaloacetic_acid:      { stock: 500,    base: 0    },
  succinic_acid:         { stock: 500,    base: 0    },
  sodium_hexametaphosphate: { stock: 150, base: 0   },
  hepes_ph_7_2:          { stock: 1000,   base: 0    },
  hepes_ph_7_8:          { stock: 1000,   base: 0    },
  potassium_phosphate_monobasic: { stock: 500, base: 0 },
  potassium_phosphate_dibasic:   { stock: 500, base: 0 },
  pantothenic_acid_calcium: { stock: 100, base: 0   },
  potassium_nitrate:     { stock: 1000,   base: 0    },
};

const unitFor = (id) => STOCK[id]?.unit ?? 'mM';

// Concentration in the reagent's display unit for a single source id.
function nlToConc(id, nl) {
  const s = STOCK[id];
  if (!s || !s.stock) return null;
  return (s.stock * nl / RXN_NL) + (s.base ?? 0);
}

function quantiles(arr) {
  if (!arr.length) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, n: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    min: sorted[0],
    q1: sorted[Math.floor(n * 0.25)],
    median: sorted[Math.floor(n * 0.5)],
    q3: sorted[Math.floor(n * 0.75)],
    max: sorted[n - 1],
    n,
  };
}

// Reagents to display (ordered by category). `ids` (optional) sums several
// source components per well into one row — K-phosphate is dosed as a
// monobasic + dibasic pair, so both are summed into the total phosphate.
const DISPLAY_REAGENTS = [
  { id: 'potassium_glutamate',  label: 'K(Glu)',       cat: 'Salts' },
  { id: 'magnesium_glutamate',  label: 'Mg(Glu)₂',    cat: 'Salts' },
  { id: 'ammonium_glutamate',   label: 'NH₄(Glu)',     cat: 'Salts' },
  { id: 'hepes_koh',            label: 'HEPES pH 7.5', cat: 'Buffers' },
  { id: 'k_phosphate',          label: 'K-Phosphate',  cat: 'Buffers', ids: ['kpo_monobasic_mix', 'kpo_dibasic_mix'] },
  { id: 'amino_acid_mix_17',    label: 'AA mix (17)',  cat: 'Amino acids' },
  { id: 'tyrosine',             label: 'Tyrosine',     cat: 'Amino acids' },
  { id: 'cysteine',             label: 'Cysteine',     cat: 'Amino acids' },
  { id: 'pep_mono',             label: 'PEP',          cat: 'Energy' },
  { id: 'glucose',              label: 'Glucose',      cat: 'Energy' },
  { id: 'ribose',               label: 'Ribose',       cat: 'Energy' },
  { id: 'sodium_pyruvate',      label: 'Pyruvate',     cat: 'Energy' },
  { id: 'atp',                  label: 'ATP',          cat: 'Nucleotides' },
  { id: 'amp',                  label: 'AMP',          cat: 'Nucleotides' },
  { id: 'cmp',                  label: 'CMP',          cat: 'Nucleotides' },
  { id: 'gmp',                  label: 'GMP',          cat: 'Nucleotides' },
  { id: 'ump',                  label: 'UMP',          cat: 'Nucleotides' },
  { id: 'nicotinamide',         label: 'Nicotinamide', cat: 'Cofactors' },
  { id: 'spermidine',           label: 'Spermidine',   cat: 'Cofactors' },
  { id: 'putrescine',           label: 'Putrescine',   cat: 'Cofactors' },
  { id: 'coa',                  label: 'CoA',          cat: 'Cofactors' },
  { id: 'nad',                  label: 'NAD',          cat: 'Cofactors' },
  { id: 'folinic_acid',         label: 'Folinic acid', cat: 'Cofactors' },
  { id: 'potassium_oxalate',    label: 'Oxalate',      cat: 'Cofactors' },
  { id: 'oxidized_glutathione', label: 'GSSG',         cat: 'Redox' },
  { id: 'reduced_glutathione',  label: 'GSH',          cat: 'Redox' },
  { id: 'dsbc_ecoli',           label: 'DsbC',         cat: 'Chaperones' },
];

// Some reference runs are written by Python's json.dumps(allow_nan=True), which
// emits bare NaN/Infinity value tokens that JSON.parse rejects. Fall back to a
// sanitized parse that coerces those value-position tokens to null.
function parseResults(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/([:[,]\s*)-Infinity\b/g, '$1null')
      .replace(/([:[,]\s*)Infinity\b/g, '$1null')
      .replace(/([:[,]\s*)NaN\b/g, '$1null');
    return JSON.parse(cleaned);
  }
}

function analyzeFile(path) {
  let data;
  try {
    data = parseResults(readFileSync(path, 'utf8'));
  } catch { return null; }

  // Reference results are an array with one plate; older designs were a bare object.
  const plate = Array.isArray(data) ? data[0] : data;
  if (!plate) return null;
  const samples = (plate.samples ?? []).filter((s) => s.sample_type === 'experimental');

  // Track every reagent id actually dosed (nL > 0) so the "new reagent stock
  // usage" note works for ids that aren't in the display list.
  const usedIds = new Set();

  const stats = {};
  for (const r of DISPLAY_REAGENTS) {
    const ids = r.ids ?? [r.id];
    const unit = r.unit ?? unitFor(ids[0]);
    const concVals = [];
    const nlVals = [];
    for (const sample of samples) {
      const rl = sample.reagent_list;
      if (!rl) continue;
      let present = false;
      let nlSum = 0;
      let concSum = 0;
      for (const id of ids) {
        const nl = rl[id];
        if (nl == null) continue;
        present = true;
        nlSum += nl;
        if (nl > 0) usedIds.add(id);
        const c = nlToConc(id, nl);
        if (c != null) concSum += c;
      }
      if (!present) continue; // reagent not part of this well's recipe at all
      nlVals.push(nlSum);
      concVals.push(concSum);
    }
    stats[r.id] = {
      nl: quantiles(nlVals),
      // Kept as `disp` (display unit) — mM for most rows, but mg/mL for folinic
      // acid and µM for DsbC. The component scales each row to its own max.
      disp: quantiles(concVals),
      unit,
      pctNonzero: nlVals.length ? nlVals.filter((v) => v > 0).length / nlVals.length : 0,
    };
  }

  // Also record any dosed id (nL > 0) even outside the display set.
  for (const sample of samples) {
    const rl = sample.reagent_list;
    if (!rl) continue;
    for (const [id, nl] of Object.entries(rl)) {
      if ((nl ?? 0) > 0) usedIds.add(id);
    }
  }

  // Summary metadata (formulation baselines, titrated variables, nucleotide variant).
  const metaFields = ['formulation', 'nucleotide_variant', 'titrated_variable', 'block'];
  const metaSummary = {};
  for (const f of metaFields) {
    const vals = new Set(samples.map((s) => s.metadata?.[f]).filter(Boolean));
    metaSummary[f] = [...vals];
  }

  return { n: samples.length, stats, meta: metaSummary, usedIds };
}

const CHECK_REAGENTS = [
  { id: 'ammonium_glutamate',     label: 'Ammonium Glutamate (1M)',             lims: 'e2706'  },
  { id: 'dtt',                    label: 'DTT (1M)',                            lims: 'e11995', aliases: ['dithiothreitol'] },
  { id: 'bis_tris',               label: 'Bis-Tris pH 6.5 (0.2M)',             lims: 'e9341'  },
  { id: 'peg_8000',               label: 'PEG-8000 (100 g/L)',                 lims: 'e11990' },
  { id: 'putrescine',             label: 'Putrescine Dihydrochloride (500 mM)', lims: 'e970'  },
  { id: 'three_phosphoglycerate', label: '3-PGA (75 mM)',                       lims: 'e1218', aliases: ['3_pga', 'three_pga'] },
  { id: 'coa',                    label: 'CoA (50 mM)',                         lims: null    },
  { id: 'trna',                   label: 'tRNA',                               lims: null,    aliases: ['t_rna', 'tRNA', 'trna'] },
];

// Disk-compute step. Reads the local autonomous-cfps reference control runs
// (absolute paths above) and produces the finished reagent-range payload. This
// runs ONLY during `scripts/pb-publish-plate-data.mjs`, which publishes the
// result into PocketBase; at runtime the app reads the published blob via
// $lib/server/plateStore.js (so it works on any host, with no local files).
export function buildPlateAnalysisData() {
  const plates = {
    sfgfp:     analyzeFile(refPath(RUNS.sfgfp)),
    cutinase:  analyzeFile(refPath(RUNS.cutinase)),
    reteplase: analyzeFile(refPath(RUNS.reteplase)),
  };

  // If none of the reference files resolved, skip the section entirely.
  if (!plates.sfgfp && !plates.cutinase && !plates.reteplase) return null;

  // Union of every dosed reagent id across the three runs.
  const allUsed = new Set();
  for (const plate of Object.values(plates)) {
    if (!plate) continue;
    for (const id of plate.usedIds) allUsed.add(id);
  }

  const reagentUsage = CHECK_REAGENTS.map((r) => {
    const ids = [r.id, ...(r.aliases ?? [])];
    const used = ids.some((id) => allUsed.has(id));
    return { ...r, used };
  });

  // Drop the internal usedIds sets before returning (not needed client-side).
  const strip = (p) => (p ? { n: p.n, stats: p.stats, meta: p.meta } : null);

  return {
    sfgfp:     strip(plates.sfgfp),
    cutinase:  strip(plates.cutinase),
    reteplase: strip(plates.reteplase),
    displayReagents: DISPLAY_REAGENTS,
    reagentUsage,
    label1: 'Control runs — autonomous-cfps reference_results · sfGFP · PETase · Reteplase (OFAT rev3, Round 2)',
  };
}

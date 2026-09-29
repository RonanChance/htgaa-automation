// Supporting data + logic for the /cfps benchmark comparison table: reagent →
// inventory aliases, reagent groups, feasibility helpers, and the category →
// paperUrl / echoNative derivation (augmentFormulations).
//
// The benchmark COMPOSITIONS themselves no longer live here — they're stored in
// the PocketBase static_values collection (record cfpsbenchmk0001) so they can be
// edited without a redeploy, and loaded via
// src/lib/server/loadBenchmarkFormulations.js. Edit the compositions in PocketBase.
//
// When a new benchmark introduces a reagent, add its inventory mapping to
// REAGENT_ALIASES below.

// ─── Source paper links ─────────────────────────────────────────────────────
// Clicking a composition name opens its source paper. Olsen et al. formulations
// (Table 1) and the oxidizing controls (Fig. 5) link to the Nature article; the
// GPT-5 autonomous-lab compositions (Table 2) link to the bioRxiv preprint.
// Ginkgo internal targets / experimental compositions have no public paper.
export const NATURE_URL = 'https://www.nature.com/articles/s41467-026-69605-8/tables/1';
export const BIORXIV_URL = 'https://www.biorxiv.org/content/10.64898/2026.02.05.703998v1.full.pdf';

// Attach the source-paper link + Echo-native flag to each formulation by category.
//  - paperUrl: Olsen Table 1 + oxidizing controls → Nature; GPT-5 → bioRxiv;
//    Ginkgo internal targets → none.
//  - echoNative: true for compositions that were DESIGNED or MEASURED at 25 nL Echo
//    resolution on our exact stocks (GPT-5 autonomous-lab designs + Ginkgo
//    reference-set target controls). Their listed concentrations are the nearest 25 nL-
//    achievable values, rounded for display — so snapping recovers the true recipe
//    and there is NO real rounding error (the apparent Δ% is just paper display
//    rounding, e.g. AMP 125 nL = 0.625 mM printed as "0.6"). Literature targets
//    (Olsen Table 1 + oxidizing controls) are NOT Echo-native: their published
//    concentrations weren't designed around our Echo, so 25 nL rounding is real.
// Exported so the server-side loader can apply the same category → paperUrl /
// echoNative derivation to formulations pulled from PocketBase (static_values)
// before they reach the page — keeping DB-edited and file-default rows identical.
// Mutates + returns `list`.
export function augmentFormulations(list) {
    for (const bm of list) {
        if (bm.category === 'gpt5-autonomous') { bm.paperUrl = BIORXIV_URL; bm.echoNative = true; }
        else if (bm.category === 'ginkgo-target') { bm.paperUrl = null; bm.echoNative = true; }
        else { bm.paperUrl = NATURE_URL; bm.echoNative = false; }
    }
    return list;
}

// ─── Paper reagent name → our reagent inventory ─────────────────────────────
// Each entry describes how to realize a paper reagent using our stocks.
//
//   ids:      one or more reagent_id values from the CFPS PocketBase inventory.
//             For multi-reagent groups (e.g. "Amino acids" = aa mix + tyr + cys)
//             we list all of them; the loader splits target evenly or by hint.
//   stockMm:  effective stock concentration in mM (used to compute headroom)
//   unit:     'mM' | 'mg/mL' | '% w/v' — how the paper reports it
//   notes:    free-text caveats

export const REAGENT_ALIASES = {
    'Mg(Glu)2':        { ids: ['magnesium_glutamate'],           stockMm: 500,  unit: 'mM' },
    'K(Glu)':          { ids: ['potassium_glutamate'],           stockMm: 875,  unit: 'mM' },
    'NH4(Glu)':        { ids: ['ammonium_glutamate'], stockMm: 1000, unit: 'mM',
                         notes: 'Ammonium glutamate not in stock. Could substitute NH4Cl or omit.' },
    'Ammonium acetate':{ ids: null, unit: 'mM', maxSolubleMm: 1000,
                         notes: 'Ammonium acetate not in stock. Could substitute for NH4(Glu).' },
    'Glucose':         { ids: ['glucose'],                       stockMm: 1110.15, unit: 'mM' },
    'Amino acids':     { ids: ['aa_mix_17', 'tyrosine', 'cysteine'], stockMm: 50, unit: 'mM',
                         notes: 'Composite: 17 aa mix + tyrosine + cysteine. Each contributes the same mM target.' },
    'Tyrosine':        { ids: ['tyrosine'],                       stockMm: 50,  unit: 'mM' },
    'Cysteine':        { ids: ['cysteine'],                       stockMm: 200, unit: 'mM' },
    'Phosphate':       { ids: ['potassium_phosphate_ratio_dibasic_monobasic'], stockMm: 500, unit: 'mM' },
    'Phosphate (di:mono)': { ids: ['potassium_phosphate_ratio_dibasic_monobasic'], stockMm: 500, unit: 'mM',
                             notes: '1.6:1 dibasic:monobasic molar ratio.' },
    'Phosphate (mono:di)': { ids: ['potassium_phosphate_ratio_monobasic_dibasic'], stockMm: 500, unit: 'mM',
                             notes: '1.6:1 monobasic:dibasic molar ratio.' },
    'Dilithium acetyl phosphate': { ids: ['dilithium_acetyl_phosphate'], stockMm: 50, unit: 'mM' },
    'Oxaloacetic acid': { ids: ['oxaloacetic_acid'],              stockMm: 500, unit: 'mM' },
    'Adenosine':       { ids: ['adenosine'],                      stockMm: 25,  unit: 'mM' },
    'Cytidine':        { ids: ['cytidine'],                       stockMm: 25,  unit: 'mM' },
    'Guanosine':       { ids: ['guanosine'],                      stockMm: 25,  unit: 'mM' },
    'Uridine':         { ids: ['uridine'],                        stockMm: 25,  unit: 'mM' },
    'Guanine':         { ids: ['guanine'],                        stockMm: 25,  unit: 'mM' },
    'Catalase':        { ids: ['catalase'],                       stockMm: 50000, unit: 'U/mL',
                         notes: 'Stock 50,000 U/mL — targets in the GPT-5 paper are U/mL.' },
    'DsbC':            { ids: ['dsbc_ecoli'],                    stockMm: 100, unit: 'µM',
                         notes: 'Disulfide bond isomerase for reteplase folding. Stock 100 µM (0.1 mM); paper targets in µM.' },
    'Maltose':         { ids: ['maltose'],                        stockMm: 146.07, unit: 'mM',
                         notes: 'Maltose stock 50 g/L (MW 342 → 146 mM).' },
    'Succinic acid':   { ids: ['succinic_acid'],                  stockMm: 500, unit: 'mM' },
    'Nicotinamide':    { ids: ['nicotinamide'],                  stockMm: 100,  unit: 'mM' },
    'Ribose':          { ids: ['ribose'],                        stockMm: 666.09,  unit: 'mM' },
    'HEPES pH 7.5':           { ids: ['hepes_koh'],                     stockMm: 1000, unit: 'mM' },
    'Bis-Tris':        { ids: ['bis_tris_ph_6_5'], stockMm: 200, unit: 'mM',
                         notes: 'Bis-Tris buffer not in stock. HEPES-KOH pH 7.5 is closest substitute.' },
    'Sodium pyruvate':        { ids: ['sodium_pyruvate'],               stockMm: 908.76,  unit: 'mM' },
    'Putrescine':      { ids: ['putrescine_dihydrochloride'], stockMm: 500, unit: 'mM',
                         notes: 'Putrescine not in stock. Spermidine partially compensates.' },
    'Spermidine':      { ids: ['spermidine'],                    stockMm: 250,  unit: 'mM' },
    'Dithiothreitol':  { ids: ['dithiothreitol'], stockMm: 1000, unit: 'mM',
                         notes: 'DTT not in stock. Cell lysate contains endogenous reducing power.' },
    'Folinic acid':    { ids: ['folinic_acid'],                  stockMm: 10,   unit: 'mg/mL',
                         notes: 'Stock is 10 mg/mL; target values in paper are mg/mL.' },
    'tRNA':            { ids: null, unit: 'mg/mL', maxSolubleMm: 5,
                         notes: 'Purified tRNA not in stock. Cell lysate provides basal levels. Practical stock ≤5 mg/mL.' },
    'CoA':             { ids: ['coa'],                            stockMm: 50,   unit: 'mM',
                         notes: 'Coenzyme A (0.05 M stock). Standard model reagent (autonomous-cfps coa).' },
    'NAD':             { ids: ['nad'],                           stockMm: 100,  unit: 'mM' },
    'cAMP':            { ids: ['camp'],                          stockMm: 200,  unit: 'mM' },
    'PEP':             { ids: ['pep_mono'],                       stockMm: 100, unit: 'mM',
                         notes: 'Uses the in-stock pep_mono variant (100 mM).' },
    '3-PGA':           { ids: ['three_pga'], stockMm: 75, unit: 'mM',
                         notes: '3-Phosphoglycerate not in stock. Related to central carbon metabolism.' },
    'Oxalic acid':     { ids: ['potassium_oxalate'],             stockMm: 500,  unit: 'mM',
                         notes: 'Supplied as potassium oxalate (0.5 M stock).' },
    'GSSG':            { ids: ['oxidized_glutathione'],          stockMm: 170,  unit: 'mM' },
    'GSH':             { ids: ['reduced_glutathione'],           stockMm: 100,  unit: 'mM' },
    'Maltodextrin':    { ids: ['maltodextrin_17'],               stockMm: 300,  unit: 'mg/mL',
                         notes: 'Stock is 300 mg/mL; target values are mg/mL.' },
    'PEG-8000':        { ids: ['peg_8000'], stockMm: 10, unit: '% w/v',
                         notes: 'PEG-8000 (crowding agent) not in stock.' },
    'ATP':             { ids: ['atp'],                           stockMm: 100,  unit: 'mM' },
    'CTP':             { ids: ['ctp'],                           stockMm: 100,  unit: 'mM' },
    'GTP':             { ids: ['gtp'],                           stockMm: 100,  unit: 'mM' },
    'UTP':             { ids: ['utp'],                           stockMm: 100,  unit: 'mM' },
    'AMP':             { ids: ['amp'],                           stockMm: 100,  unit: 'mM' },
    'CMP':             { ids: ['cmp'],                           stockMm: 100,  unit: 'mM' },
    'GMP':             { ids: ['gmp'],                           stockMm: 100,  unit: 'mM' },
    'UMP':             { ids: ['ump'],                           stockMm: 100,  unit: 'mM' }
};

// ─── LIMS object links ──────────────────────────────────────────────────────
// Maps a site reagent id → its first LIMS object id from reagent_info.txt.
// The prefix routes the URL: "m…" → /molecules/{n}, "e…" → /reagents/{n}.
// (First id per reagent, per spec — note some differ from the picking-list
// entity, e.g. hepes_koh's first object is the molecule m2433311.)
// A few site ids use different names in reagent_info.txt; those are mapped to
// the reagent_info name's first object id here (aa_mix_17 → amino_acid_mix_17,
// potassium_phosphate_ratio_* → kpo_*_mix).
export const LIMS_OBJECT_ID_BY_ID = {
    magnesium_glutamate: 'm8827570',
    potassium_glutamate: 'm9063889',
    glucose: 'e11006',
    aa_mix_17: 'e12030',                 // amino_acid_mix_17
    tyrosine: 'm29868',
    cysteine: 'm29857',
    potassium_phosphate_ratio_dibasic_monobasic: 'e12144', // kpo_dibasic_mix
    potassium_phosphate_ratio_monobasic_dibasic: 'e12145', // kpo_monobasic_mix
    dilithium_acetyl_phosphate: 'm9113077',
    oxaloacetic_acid: 'e8229',
    adenosine: 'm9113099',
    cytidine: 'm9113101',
    guanosine: 'm9113100',
    uridine: 'm9113102',
    guanine: 'm9113105',
    catalase: 'e12099',
    dsbc_ecoli: 'e12499',
    dsbc_ecoli_jewettprep: 'e12487',
    maltose: 'e11994',
    maltodextrin_17: 'e12044',
    succinic_acid: 'e5198',
    pantothenic_acid_calcium: 'e12436',
    hepes_ph_7_2: 'e12489',
    hepes_ph_7_8: 'e12490',
    calcium_chloride: 'e10814',
    potassium_nitrate: 'e12500',
    dsbc_pdam_let: 'm9378859',
    nicotinamide: 'e877',
    ribose: 'e1310',
    hepes_koh: 'm2433311',
    sodium_pyruvate: 'e1276',
    spermidine: 'm3327247',
    folinic_acid: 'm9063890',
    nad: 'e2583',
    camp: 'e3269',
    pep_mono: 'm30809',
    potassium_oxalate: 'e2757',
    oxidized_glutathione: 'e12352',
    reduced_glutathione: 'e12351',
    atp: 'm29357',
    ctp: 'm3327215',
    gtp: 'm3327209',
    utp: 'm3327246',
    amp: 'm9113078',
    cmp: 'm9113079',
    gmp: 'm9113097',
    ump: 'm9113098'
};

const LIMS_BASE = 'https://lims.ginkgobioworks.com';

// Build a LIMS URL for one of our reagent ids, or null if there's no mapping
// (or the object id is a placeholder). "m…" → molecule page, "e…" → reagent page.
export function limsUrlForReagentId(id) {
    const obj = LIMS_OBJECT_ID_BY_ID[id];
    if (!obj || obj === 'PLACEHOLDER') return null;
    const kind = obj[0] === 'm' ? 'molecules' : 'reagents';
    const num = obj.slice(1);
    if (!/^\d+$/.test(num)) return null;
    return `${LIMS_BASE}/${kind}/${num}`;
}

// ─── Custom Ginkgo reagents ─────────────────────────────────────────────────
// Special-order stocks that aren't recognized keys in the standard CFPS reagent
// set (the CFPSReagentList model in autonomous-cfps) would be marked with a ◆ in
// the table. As of 2026-09-26 the benchmark set carries no such reagents: GSSG,
// GSH, potassium_oxalate, and DsbC (dsbc_ecoli) were promoted into the standard
// model (autonomous-cfps 0a08abb3), and the remaining special-order stocks
// (calcium_chloride, pantothenic_acid_calcium, hepes_ph_7_2, hepes_ph_7_8,
// dsbc_pdam_let, potassium_nitrate, dsbc_ecoli_jewettprep, dsbc_ecoli_re) were
// dropped from the reagent catalog along with the Jewett experimental recipes.
export const CUSTOM_REAGENTS = [];

// All ids treated as custom (empty — nothing in the current benchmark set is off-model).
export const CUSTOM_REAGENT_IDS = new Set(CUSTOM_REAGENTS.map((r) => r.id));

// ─── Reagent display groups (row order in the table) ────────────────────────
export const REAGENT_GROUPS = [
    { name: 'Salts', reagents: ['K(Glu)', 'Mg(Glu)2', 'NH4(Glu)', 'Ammonium acetate'] },
    { name: 'Amino acids', reagents: ['Amino acids', 'Tyrosine', 'Cysteine'] },
    { name: 'Buffers', reagents: ['HEPES pH 7.5', 'Bis-Tris', 'Phosphate', 'Phosphate (di:mono)', 'Phosphate (mono:di)'] },
    { name: 'Energy substrates', reagents: ['Glucose', 'Sodium pyruvate', 'Maltose', 'Maltodextrin', 'Ribose', 'PEP', '3-PGA', 'Dilithium acetyl phosphate'] },
    { name: 'Cofactors', reagents: ['Folinic acid', 'tRNA', 'CoA', 'NAD', 'cAMP', 'Nicotinamide'] },
    { name: 'Polyamines / redox', reagents: ['Putrescine', 'Spermidine', 'Dithiothreitol', 'GSSG', 'GSH', 'Oxalic acid'] },
    { name: 'Crowd', reagents: ['PEG-8000'] },
    { name: 'TCA', reagents: ['Oxaloacetic acid', 'Succinic acid'] },
    { name: 'Nucleosides / bases', reagents: ['Adenosine', 'Cytidine', 'Guanosine', 'Uridine', 'Guanine'] },
    { name: 'Enzymes', reagents: ['Catalase', 'DsbC'] },
    { name: 'NTPs', reagents: ['ATP', 'CTP', 'GTP', 'UTP'] },
    { name: 'NMPs', reagents: ['AMP', 'CMP', 'GMP', 'UMP'] }
];

// ─── Base buffer contribution ──────────────────────────────────────────────
// The 10× base buffer (2 µL in a 20 µL reaction = 10% volume = 1× final)
// pre-loads the reaction with these concentrations BEFORE any supplemental
// reagent addition. Source: reagent_yaml.yaml `base_buffer` entry —
// "2.0M KGlu, 0.026M MgGlu, 0.3M HEPES, 0.01M 17AA mix, 0.01M Cys, 0.01M Tyr".
// At 10% volume, each is diluted 10× → these are the effective final mM values.
export const BASE_BUFFER_1X_CONTRIBUTION_MM = {
    'K(Glu)':     200,
    'Mg(Glu)2':   2.6,
    'HEPES pH 7.5':      30,
    'Amino acids': 1,   // 17aa mix baseline
    'Tyrosine':   1,    // tyrosine baseline (base buffer pre-loads 0.01 M at 10×)
    'Cysteine':   1     // cysteine baseline
};

// Same recipe keyed by our reagent inventory IDs (the shape the CFPS designer
// needs). Consumed by +page.svelte to credit the base buffer's contribution
// against per-reagent supplement volumes.
export const BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID = {
    potassium_glutamate:  200,
    magnesium_glutamate:  2.6,
    hepes_koh:            30,
    // NOTE: the runtime reagent id in the CFPS designer is `aa_mix_17`,
    // not `amino_acid_mix_17` (which is the LIMS-side name in
    // reagent_info.txt). Keying by the wrong name silently skips the
    // base-buffer credit for the AA mix and doubles the supplement.
    aa_mix_17:            1,
    tyrosine:             1,
    cysteine:             1
};

// Standard 10× base buffer volume that delivers 1× baseline: 2 µL in a 20 µL
// reaction (10% v/v). The CFPS designer's fixed base_buffer volume defaults to
// this; scaling this ratio linearly gives the actual contribution.
export const STANDARD_BASE_BUFFER_NL = 2000;

// ─── Echo transfer resolution ───────────────────────────────────────────────
// Every acoustic (Echo) transfer must be a whole multiple of 25 nL. Supplement
// volumes are snapped to the nearest increment; the resulting concentration
// error is surfaced as deviationPct in feasibilityFor / formulationFidelity.
export const ECHO_INCREMENT_NL = 25;
export function snapNl(nl) {
    return Math.round(nl / ECHO_INCREMENT_NL) * ECHO_INCREMENT_NL;
}

// ─── Compute feasibility of a given reagent value against a reaction volume ──
// Returns { status, pctHeadroom, baseContribution, neededSupplementMm, reason }
// where:
//   status:            'ok' | 'tight' | 'very-tight' | 'over-baseline' | 'missing'
//   pctHeadroom:       % of the reagent-add budget the SUPPLEMENT consumes
//                      (0 when base buffer alone meets/exceeds target)
//   baseContribution:  mM (or paper-unit) already supplied by the base buffer
//   neededSupplementMm: mM the operator would still add above the base buffer
//
// Default reaction geometry: 20 µL total reaction, 9 µL of headroom for reagent
// additions (rest: 2 µL DNA + 5 µL lysate + 2 µL base buffer + 2 µL water).
export function feasibilityFor(paperName, targetValue, opts = {}) {
    const rxnVol = opts.rxnVolUl ?? 20;
    const addBudget = opts.addBudgetUl ?? 9;
    const alias = REAGENT_ALIASES[paperName];
    if (!alias) return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: 'unknown reagent' };
    if (!alias.ids) return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: alias.notes || 'not in stock' };
    if (alias.unit === '% w/v' && !alias.stockMm) return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: '% w/v stock concentration unknown' };

    // Base buffer already supplies some of the target for a handful of reagents.
    const baseContribution = BASE_BUFFER_1X_CONTRIBUTION_MM[paperName] ?? 0;
    const remainingTarget = targetValue - baseContribution;

    if (remainingTarget <= 0) {
        // Base buffer alone equals or exceeds the target — no supplement needed.
        return {
            status: 'over-baseline',
            pctHeadroom: 0,
            baseContribution,
            neededSupplementMm: 0,
            neededNl: 0,
            snappedNl: 0,
            deviationPct: 0,
            reason: `Base buffer alone contributes ${baseContribution} ${alias.unit} — meets or exceeds target of ${targetValue}. No supplement needed (or reduce base buffer to hit target exactly).`
        };
    }

    const stock = alias.stockMm;
    const neededUl = (remainingTarget * rxnVol) / stock;
    const neededNl = Math.round(neededUl * 1000);
    // Echo resolution: the real transfer is snapped to the nearest 25 nL. Report
    // the concentration this delivers vs the intended target, as a % of the
    // final target (units cancel, so this works for mM/µM/mg·mL/U·mL/ng·µL).
    const snappedNl = snapNl(neededNl);
    const achievedSupplement = (snappedNl / 1000) * stock / rxnVol;
    const deviationPct = targetValue
        ? ((achievedSupplement - remainingTarget) / targetValue) * 100
        : 0;
    const pctHeadroom = (neededUl / addBudget) * 100;
    const base = { pctHeadroom, baseContribution, neededSupplementMm: remainingTarget, neededNl, snappedNl, deviationPct };
    if (pctHeadroom < 30) return { status: 'ok', ...base };
    if (pctHeadroom < 60) return { status: 'tight', ...base };
    return { status: 'very-tight', ...base };
}

// ─── Water headroom per formulation ────────────────────────────────────────
// Sum every reagent's supplement volume (from feasibilityFor) and compute how
// much fill water is left in the reaction. Fixed volumes (2 µL DNA + 5 µL
// lysate + 2 µL base buffer = 9 µL) come off the top; the rest of the 20 µL
// is either supplements or water. If supplements > 11 µL the water goes to
// zero — the formulation is over the add-budget.
export function totalSupplementNlForFormulation(formulation, opts = {}) {
    let total = 0;
    for (const [paperName, val] of Object.entries(formulation.components)) {
        const feas = feasibilityFor(paperName, val, opts);
        // Sum the SNAPPED volumes — that's what actually gets transferred, so
        // the water-fill row reflects the real delivered composition.
        if (Number.isFinite(feas.snappedNl)) total += feas.snappedNl;
    }
    return total;
}

// ─── Per-formulation 25 nL fidelity ─────────────────────────────────────────
// Splits a formulation into (a) reagents we can make whose delivered mM drifts
// from target because their volume snapped to a 25 nL increment, each with its
// own deviationPct, and (b) reagents we can't make at all (additional needed).
export function formulationFidelity(formulation, opts = {}) {
    const offReagents = [];
    const additional = [];
    for (const [paperName, val] of Object.entries(formulation.components)) {
        const alias = REAGENT_ALIASES[paperName];
        const feas = feasibilityFor(paperName, val, opts);
        if (feas.status === 'missing') {
            additional.push({ paperName, value: val, unit: alias?.unit ?? '', reason: feas.reason });
            continue;
        }
        // over-baseline reagents transfer no supplement → no rounding error.
        if (feas.status === 'over-baseline') continue;
        // Echo-native compositions are exact by construction (their listed values
        // are 25 nL-achievable, just display-rounded), so skip rounding deviations.
        // Only surface reagents off by ≥1% in either direction; sub-1% drift
        // from 25 nL rounding is noise for this summary.
        if (!formulation.echoNative && Math.abs(feas.deviationPct) >= 1) {
            offReagents.push({
                paperName,
                targetValue: val,
                unit: alias?.unit ?? 'mM',
                neededNl: feas.neededNl,
                snappedNl: feas.snappedNl,
                deviationPct: feas.deviationPct
            });
        }
    }
    // Sort farthest-from-intended first (largest |deviation| → smallest) so the
    // biggest concentration misses lead each composition's summary.
    offReagents.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
    return { offReagents, additional };
}

export function waterFillNlForFormulation(formulation, opts = {}) {
    const rxnVol = opts.rxnVolUl ?? 20;
    const fixedVolUl = opts.fixedVolUl ?? 9;
    const rxnNl = rxnVol * 1000;
    const fixedNl = fixedVolUl * 1000;
    return rxnNl - fixedNl - totalSupplementNlForFormulation(formulation, opts);
}

// ─── Map a benchmark formulation into targetMm entries for the CFPS designer ──
// Returns { targetMm: {reagent_id: mM}, targetGramsPerLiter: {reagent_id: g/L},
//           skipped: [{paperName, reason}] }
export function mapFormulationToTargets(formulation) {
    const targetMm = {};
    const targetGramsPerLiter = {};
    const targetUnitsPerMl = {};
    const targetNgPerUl = {};
    const skipped = [];
    for (const [paperName, value] of Object.entries(formulation.components)) {
        const alias = REAGENT_ALIASES[paperName];
        if (!alias || !alias.ids) {
            skipped.push({ paperName, value, reason: alias?.notes || 'not in stock' });
            continue;
        }
        if (alias.unit === 'mM') {
            // Amino acids gets special handling: split across 3 stocks so each
            // contributes 1/3 of the target concentration.
            if (paperName === 'Amino acids') {
                for (const id of alias.ids) targetMm[id] = value;
            } else {
                for (const id of alias.ids) targetMm[id] = value;
            }
        } else if (alias.unit === 'µM') {
            // Sub-mM enzymes (e.g. DsbC) — spec'd in µM for readability, but
            // the designer stores everything as mM. Convert here.
            for (const id of alias.ids) targetMm[id] = value / 1000;
        } else if (alias.unit === 'mg/mL') {
            // g/L == mg/mL, so pass through
            for (const id of alias.ids) targetGramsPerLiter[id] = value;
        } else if (alias.unit === 'U/mL') {
            // Enzymes (catalase, pyruvate oxidase) — designer parses "U/ml" stock
            // and computes volume as (target / stock) × rxnVol.
            for (const id of alias.ids) targetUnitsPerMl[id] = value;
        } else if (alias.unit === 'ng/µL' || alias.unit === 'ng/uL') {
            // DNA templates (helper plasmids like dsbc_pdam_let) — same
            // volume-ratio math as U/mL; unit cancels.
            for (const id of alias.ids) targetNgPerUl[id] = value;
        } else if (alias.unit === '% w/v') {
            // Crowding agents (PEG-8000) — stored as % w/v; the designer uses
            // targetVolumePercent and parseVolumePercent to compute Echo volumes.
            for (const id of alias.ids) targetVolumePercent[id] = value;
        } else {
            skipped.push({ paperName, value, reason: `unit ${alias.unit} not supported by designer` });
        }
    }
    return { targetMm, targetGramsPerLiter, targetUnitsPerMl, targetNgPerUl, skipped };
}

export const CITATION = {
    title: 'Design-driven optimization of low-cost reagent formulations for reproducible and high-yielding cell-free gene expression',
    authors: 'Olsen ML, Copeland CE, Sundberg CA, Aw R, Shaver ZM, Rao G, Swartz JR, Karim AS, Jewett MC',
    journal: 'Nature Communications',
    year: 2026,
    doi: '10.1038/s41467-026-69605-8',
    tableSource: 'Table 1 (p.3) plus supplementary yield/cost measurements'
};

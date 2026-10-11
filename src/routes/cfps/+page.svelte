<script>
  import { onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import BenchmarksTable from './BenchmarksTable.svelte';
  import ProteinViewer from './ProteinViewer.svelte';
  import FoldingSimulation from './FoldingSimulation.svelte';
  import PlateAnalysis from './PlateAnalysis.svelte';
  import PlateReaderModal from './PlateReaderModal.svelte';
  import PlateReaderCard from './PlateReaderCard.svelte';
  import ReagentSuggestions from './ReagentSuggestions.svelte';
  import ReactionFlow from './ReactionFlow.svelte';
  import AsciiProteins from '$lib/components/AsciiProteins.svelte';
  import DecodeText from './DecodeText.svelte';
  import './blueprint.css';
  import {
    mapFormulationToTargets,
    REAGENT_ALIASES,
    BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID,
    STANDARD_BASE_BUFFER_NL
  } from '$lib/cfps-benchmarks.js';
  import {
    SFGFP_CODING_REGION,
    PETASE_CODING_REGION,
    RETEPLASE_CODING_REGION
  } from '$lib/dna.js';
  import {
    PYDANTIC_REAGENT_FIELDS,
    TEMPLATE_FIELDS,
    templateFieldForTarget,
    validateReagentList
  } from '$lib/cfpsReagentContract.js';
  import { REAGENT_ID_TO_PYDANTIC, PYDANTIC_TO_REAGENT_ID } from '$lib/cfpsReagentIdMap.js';

  // ---- target-protein sequences ------------------------------------------
  // Amino-acid sequences are translated directly from the coding regions in
  // dna.js (ATG → stop) so what a user copies is exactly what these
  // constructs fold into — tags and all.
  const CODON_TABLE = {
    TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
    ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
    TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
    ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
    TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
    AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
    TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
    AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G'
  };
  function translateOrf(dna) {
    const s = dna.toUpperCase();
    let aa = '';
    for (let i = 0; i + 3 <= s.length; i += 3) {
      const res = CODON_TABLE[s.slice(i, i + 3)] ?? 'X';
      if (res === '*') break;
      aa += res;
    }
    return aa;
  }
  const PROTEIN_SEQ = {
    sfgfp:     { aa: translateOrf(SFGFP_CODING_REGION),     dna: SFGFP_CODING_REGION.toUpperCase() },
    petase:    { aa: translateOrf(PETASE_CODING_REGION),    dna: PETASE_CODING_REGION.toUpperCase() },
    reteplase: { aa: translateOrf(RETEPLASE_CODING_REGION), dna: RETEPLASE_CODING_REGION.toUpperCase() }
  };
  let seqMode = $state({ sfgfp: 'aa', petase: 'aa', reteplase: 'aa' });
  let seqCopied = $state('');
  let seqCopyTimer;
  function seqText(key) {
    return seqMode[key] === 'aa' ? PROTEIN_SEQ[key].aa : PROTEIN_SEQ[key].dna;
  }
  async function copySeq(key) {
    try {
      await navigator.clipboard.writeText(seqText(key));
      seqCopied = key + ':' + seqMode[key];
    } catch {
      seqCopied = key + ':err';
    }
    clearTimeout(seqCopyTimer);
    seqCopyTimer = setTimeout(() => { seqCopied = ''; }, 1400);
  }

  // Look up the unit (mM / g/L / U/mL) for a paper reagent name so the
  // theoretical-reagents banner can render "12 mM" instead of just "12".
  function unitForPaperName(name) {
    return REAGENT_ALIASES[name]?.unit ?? '';
  }

  // High-level automation flow per target protein. All three share the same
  // prep backbone (Echo hitpick → Bravo stamp → incubate); the readout tail
  // diverges (kind:'sig' = protein-specific step, highlighted in its accent).
  // Per-protein automation flow, matched to the most recent 384-well runs
  // (openai_cfps R1 controls, 2026-08-25). Each step's `detail` powers a
  // click-to-open specs panel: the useful "what/how much/when" data points a
  // person would need to follow the run (volumes, timings, reads) — not machine
  // minutiae like aspiration heights.
  const HITPICK_DETAIL = [
    { k: 'transfer', v: '11.00 µL/well — custom per-well supplement design' },
    { k: 'resolution', v: '25 nL acoustic steps (Echo 525)' },
    { k: 'source', v: '2 reagent plates (384-well Echo PP)' },
    { k: 'destination', v: 'reaction plate pre-filled with 2 µL base buffer' },
    { k: 'scale', v: '336 wells dispensed' }
  ];
  const PROCESS_FLOWS = [
    {
      name: 'sfGFP', accent: 'var(--sfgfp)', wash: 'var(--sfgfp-wash)',
      steps: [
        { tag: 'Echo', title: 'Hitpick', note: '11 µL custom design', kind: 'shared',
          detailNote: 'openai_cfps_hitpicks · Echo 525 acoustic dispense',
          detail: HITPICK_DETAIL },
        { tag: 'Bravo', title: 'Stamp', note: 'DNA + lysate → 20 µL', kind: 'shared',
          detailNote: 'openai_cfps_bravo_stamps · starts the reaction',
          detail: [
            { k: 'lysate', v: '5 µL — 25% v/v, E. coli BL21 Star (DE3), reducing (DTT)' },
            { k: 'DNA', v: '2 µL sfGFP template (50 nM on DNA plate)' },
            { k: 'reaction', v: '20 µL = 2 base buffer + 11 hitpick + 5 lysate + 2 DNA' },
            { k: 'tips', v: 'fluotics-50-bravo-384' }
          ] },
        { tag: '30 °C', title: 'Incubate', note: '~20 h @ 30 °C', kind: 'shared',
          detail: [
            { k: 'temperature', v: '30 °C, sealed in-plate expression' },
            { k: 'duration', v: '≈20 h (overnight) — stamp → read' },
            { k: 'storage', v: 'steristore-30C' }
          ] },
        { tag: 'Spark', title: 'Read', note: 'endpoint fluorescence', kind: 'sig',
          detailNote: 'generic_spark_read · protocol openai_gfp_top',
          detail: [
            { k: 'mode', v: 'endpoint fluorescence, top read (485→510 nm)' },
            { k: 'signal', v: 'direct GFP (Thr65 chromophore) — no substrate' },
            { k: 'plate prep', v: 'heat-seal (alu-1) + spin 1000 g / 60 s' },
            { k: 'standard', v: 'purified-sfGFP curve, 118.9 µM top' }
          ] }
      ]
    },
    {
      name: 'PETase', accent: 'var(--petase)', wash: 'var(--petase-wash)',
      steps: [
        { tag: 'Echo', title: 'Hitpick', note: '11 µL custom design', kind: 'shared',
          detailNote: 'openai_cfps_hitpicks · Echo 525 acoustic dispense',
          detail: HITPICK_DETAIL },
        { tag: 'Bravo', title: 'Stamp', note: 'DNA + lysate → 20 µL', kind: 'shared',
          detailNote: 'openai_cfps_bravo_stamps · starts the reaction',
          detail: [
            { k: 'lysate', v: '5 µL — 25% v/v, E. coli BL21 Star (DE3), reducing (DTT)' },
            { k: 'DNA', v: '2 µL PETase template' },
            { k: 'reaction', v: '20 µL = 2 base buffer + 11 hitpick + 5 lysate + 2 DNA' },
            { k: 'tips', v: 'fluotics-50-bravo-384' }
          ] },
        { tag: '30 °C', title: 'Incubate', note: '~22 h @ 30 °C', kind: 'shared',
          detail: [
            { k: 'temperature', v: '30 °C, sealed in-plate expression' },
            { k: 'duration', v: '≈22 h (overnight) — stamp → assay' },
            { k: 'storage', v: 'steristore-30C' }
          ] },
        { tag: 'Inheco', title: 'Heat-inactivate', note: '60 °C · 10 min', kind: 'sig',
          detailNote: 'Inheco heat block · opens the assay — denatures host esterase background',
          detail: [
            { k: 'temperature', v: '60 °C on the CFPS reaction plate (Inheco block)' },
            { k: 'duration', v: '10 min' },
            { k: 'why', v: 'denatures host E. coli esterases; thermostable PETase survives → clean pNP-ester read' }
          ] },
        { tag: 'Bravo', title: 'Assay stamp', note: 'dilute 600× + pNPH', kind: 'sig',
          detailNote: 'p1082_man_vs_machine_petase_assay · into the linear OD range',
          detail: [
            { k: 'dilution 1', v: '20 µL CFPS + 80 µL PBS → 100 µL (5×)' },
            { k: 'dilution 2', v: '5 µL + 95 µL → 100 µL (cumulative 100×)' },
            { k: 'dilution 3', v: '10 µL + 46 µL PBS → 56 µL (cumulative 560×)' },
            { k: 'substrate', v: '+4 µL PNPH → 60 µL read (cumulative 600×)' },
            { k: 'final PNPH', v: '400 µM in the 60 µL read' }
          ] },
        { tag: 'Spark', title: 'Read', note: 'OD 405 nm · kinetic', kind: 'sig',
          detailNote: 'petase_abs_405nm',
          detail: [
            { k: 'mode', v: 'OD 405 nm kinetic, 1800 s (30 min)' },
            { k: 'signal', v: 'PNP release (yellow) from PNPH hydrolysis' },
            { k: 'spin', v: '2000 g / 300 s before read' },
            { k: 'standard', v: 'reverse PNP/PNPH curve, cols 1-3' }
          ] }
      ]
    },
    {
      name: 'Reteplase', accent: 'var(--reteplase)', wash: 'var(--reteplase-wash)',
      steps: [
        { tag: 'Echo', title: 'Hitpick', note: '11 µL custom design — oxidizing', kind: 'shared',
          detailNote: 'openai_cfps_hitpicks · DSB / oxidizing route',
          detail: [
            { k: 'transfer', v: '11.00 µL/well — custom per-well supplement design' },
            { k: 'resolution', v: '25 nL acoustic steps (Echo 525)' },
            { k: 'lysate route', v: 'DSB / oxidizing — DTT-free' },
            { k: 'IAM prep', v: 'lysate alkylated 500 µM IAM, 30 min RT, quenched 500 µM cysteine' },
            { k: 'destination', v: 'reaction plate pre-filled with 2 µL base buffer' }
          ] },
        { tag: 'Bravo', title: 'Stamp', note: 'DNA + lysate → 20 µL · one-protocol run', kind: 'shared',
          detailNote: 'openai_cfps_bravo_stamps_reteplase · stamp, incubations, substrate & the looping read all run in this single protocol',
          detail: [
            { k: 'lysate', v: '5 µL DSB (25% v/v, DTT-free, IAM-treated)' },
            { k: 'DNA', v: '2 µL reteplase template' },
            { k: 'reaction', v: '20 µL = 2 base buffer + 11 hitpick + 5 lysate + 2 DNA' },
            { k: 'note', v: 'continues automatically through the read loop below' }
          ] },
        { tag: 'Stage', title: 'Incubate', note: '30 °C 10 h → 4 °C 2 h → 8 h', kind: 'shared',
          detailNote: 'staged folding for disulfide-bonded reteplase',
          detail: [
            { k: 'stage 1', v: '10 h @ 30 °C (36000 s, steristore-30C)' },
            { k: 'stage 2', v: '2 h @ 4 °C (7200 s, steristore-4C)' },
            { k: 'stage 3', v: '8 h @ ambient (28800 s, ambistore)' }
          ] },
        { tag: 'Bravo', title: 'In-situ assay', note: '+ buffer + IPR-AMC', kind: 'sig',
          detailNote: 'in-situ 2× on the CFPS plate — no separate assay plate',
          detail: [
            { k: 'buffer', v: '+18 µL assay buffer (Tris-HCl pH 8.0 50 mM, NaCl 150 mM, 0.1% Tween-20)' },
            { k: 'substrate', v: '+2 µL of 500 µM IPR-AMC → 40 µL read' },
            { k: 'final IPR-AMC', v: '25 µM (in-situ 2× dilution)' },
            { k: 'spin', v: '2000 g / 30 s' }
          ] },
        { tag: 'Spark ×15', title: 'Looping read', note: '345→445 nm · 15× loop', kind: 'sig',
          detailNote: 'reteplase_amc_345ex_445em_bottom · loop built into the stamp protocol',
          detail: [
            { k: 'loop', v: '15 iterations (read → incubate → read)' },
            { k: 'cadence', v: '300 s read + 900 s (15 min) incubation each cycle' },
            { k: 'signal', v: 'AMC release from IPR-AMC (tPA activity)' },
            { k: 'read', v: 'fluorescence 345 ex / 445 em, bottom read' },
            { k: 'standard', v: 'reverse AMC/IPR-AMC curve, cols 1-3' }
          ] }
      ]
    }
  ];

  // Which process step (if any) is expanded, keyed by flow name → step index.
  // Clicking a step card toggles a detail panel with its transfer specs.
  let openStep = $state({});
  function toggleStep(flowName, i) {
    openStep = { ...openStep, [flowName]: openStep[flowName] === i ? null : i };
  }

  // Smooth-scroll from the welcome hero down to the comparison table.
  function scrollToComparison() {
    document.getElementById('comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let { data = {} } = $props();

  // Benchmark compositions come from PocketBase (static_values) via the server
  // loader so they're editable without a redeploy. Empty list if the server
  // couldn't supply them (e.g. PB read failed) — the table degrades gracefully.
  let benchmarkFormulations = $derived(data?.benchmarkFormulations ?? []);

  // Sign-in status feedback. The auth routes bounce back to /cfps?kc=<reason> on
  // failure instead of erroring; without this the redirect looked like nothing
  // happened ("the login options disappear"). `unconfigured` means the Keycloak
  // env vars aren't present in the server's runtime environment; `error` means the
  // OAuth round-trip failed (commonly a redirect_uri / ORIGIN mismatch).
  const kcNotice = $derived.by(() => {
    const kc = page?.url?.searchParams?.get('kc');
    if (kc === 'unconfigured') return 'Sign-in isn’t configured on this server yet.';
    if (kc === 'error') return 'Sign-in didn’t complete — please try again.';
    return null;
  });

  const STEP_NL = 25;
  const MAX_TOTAL_NL = 20_000;
  const WATER_ID = 'nuclease_free_water';
  const BASE_BUFFER_ID = 'base_buffer';
  // Real protocol: 2 µL DNA + 5 µL lysate + 2 µL base buffer + ~9 µL supplements
  // + water fill = 20 µL. Base buffer is the 10× recipe from reagent_yaml
  // (2M K(Glu), 0.026M Mg(Glu)2, 0.3M HEPES, 10 mM each of 17-AA mix / Tyr / Cys)
  // — at 2 µL in 20 µL rxn it delivers a 1× baseline of those salts.

  // Recipe details for reagents whose composition is worth spelling out.
  // Keyed by reagent id. Rendered in a click-to-open modal so the operator can
  // read at their own pace (native title tooltips require holding the cursor
  // still, which is a poor fit for a busy comparison table).
  const REAGENT_RECIPES = {
    aa_mix_17: {
      title: '17-Amino-Acid Mix — Ginkgo recipe',
      subtitle: 'Per 600 mL nuclease-free water (Excludes Tyrosine, Cysteine, Glutamate — add Tyr/Cys separately)',
      ingredients: [
        { name: 'Arginine',       supplier: 'Sigma A8094',                   mass_g: 8.71 },
        { name: 'Isoleucine',     supplier: 'Sigma I2752',                   mass_g: 6.56 },
        { name: 'Aspartic acid',  supplier: 'Sigma A7219',                   mass_g: 6.66 },
        { name: 'Alanine',        supplier: 'Sigma A7627',                   mass_g: 4.45 },
        { name: 'Asparagine',     supplier: 'Sigma A4159',                   mass_g: 6.61 },
        { name: 'Histidine',      supplier: 'Sigma H8000',                   mass_g: 7.76 },
        { name: 'Proline',        supplier: 'Sigma P0380',                   mass_g: 5.76 },
        { name: 'Serine',         supplier: 'Sigma S4500',                   mass_g: 5.30 },
        { name: 'Threonine',      supplier: 'Sigma T8625',                   mass_g: 5.96 },
        { name: 'Valine',         supplier: 'Sigma V0513',                   mass_g: 5.86 },
        { name: 'Leucine',        supplier: 'Sigma L8000',                   mass_g: 6.56 },
        { name: 'Phenylalanine',  supplier: 'Sigma P5482',                   mass_g: 8.26 },
        { name: 'Tryptophan',     supplier: 'Sigma T0254',                   mass_g: 10.21 },
        { name: 'Methionine',     supplier: 'Sigma M9625',                   mass_g: 7.46 },
        { name: 'Lysine',         supplier: 'Santa Cruz sc-207804',          mass_g: 7.31 },
        { name: 'Glycine',        supplier: 'Sigma G7126',                   mass_g: 3.75 },
        { name: 'Glutamine',      supplier: 'Sigma G3126',                   mass_g: 7.31 }
      ]
    }
  };
  function hasRecipe(reagentId) {
    return REAGENT_RECIPES[reagentId] != null;
  }
  let activeRecipe = $state(null); // { title, subtitle, ingredients } | null
  function openRecipe(reagentId) {
    activeRecipe = REAGENT_RECIPES[reagentId] ?? null;
  }
  function closeRecipe() {
    activeRecipe = null;
  }

  // Assay standard curves (from delivery plan PDF)
  const ASSAY_SVG_W = 240, ASSAY_SVG_H = 52, ASSAY_PAD = 6;
  const sfgfpStds    = [118.9,90,59.45,45,29.73,22.5,14.86,11.25,7.43,5.63,3.72,2.81,1.86,1.41,0.93,0];
  const petaseStds   = [400,400,200,200,100,100,50,50,25,25,12.5,12.5,6.25,6.25,0,0];
  const reteplaseStds= [25,25,12.5,12.5,6.25,6.25,3.13,3.13,1.56,1.56,0.78,0.78,0.39,0.39,0,0];
  function assayX(i, n) { return ASSAY_PAD + (i / (n - 1)) * (ASSAY_SVG_W - ASSAY_PAD * 2); }
  function assayY(v, max) {
    if (v <= 0) return ASSAY_SVG_H - ASSAY_PAD;
    return ASSAY_SVG_H - ASSAY_PAD - ((Math.log(v + 0.05) - Math.log(0.05)) / (Math.log(max + 0.05) - Math.log(0.05))) * (ASSAY_SVG_H - ASSAY_PAD * 2);
  }
  function assayPoints(stds, max) { return stds.map((v,i) => `${assayX(i,stds.length)},${assayY(v,max)}`).join(' '); }
  const reagentGroups = (Array.isArray(data?.reagentGroups) ? data.reagentGroups : [])
    .map((group) => ({
      ...group,
      reagents: (Array.isArray(group?.reagents) ? group.reagents : []).filter(
        (reagent) => reagent?.in_stock !== false
      )
    }))
    .filter((group) => group.reagents.length > 0);

  function withGroup(reagent, groupName) {
    return groupName ? { ...reagent, group: groupName } : reagent;
  }

  const allReagents = reagentGroups.flatMap((group) =>
    group.reagents.map((reagent) => withGroup(reagent, group.name))
  );
  const visibleReagentGroups = reagentGroups
    .map((group) => ({
      ...group,
      reagents: group.reagents
        .map((reagent) => withGroup(reagent, group.name))
        .filter((reagent) => !reagent.hidden)
    }))
    .filter((group) => group.reagents.length > 0);
  const visibleReagents = allReagents.filter((reagent) => !reagent.hidden);

  const baselineTargetMm_1777863 = {
    potassium_glutamate: 312.5625,
    magnesium_glutamate: 6.975,
    hepes_koh: 45.0,
    amp: 0.625,
    ump: 0.375,
    cmp: 0.375,
    guanine: 0.15625,
    aa_mix_17: 4.0625,
    tyrosine: 4.0625,
    cysteine: 4.0,
    potassium_phosphate_monobasic: 5.625,
    potassium_phosphate_dibasic: 5.625,
    nicotinamide: 3.125
  };
  const baselineTargetGramsPerLiter_1777863 = {
    ribose: 11.625,
    glucose: 1.25
  };

  const defaultTargetProfiles = {
    '1777863_77': {
      label: '1777863',
      targetMm: { ...baselineTargetMm_1777863 },
      targetUnitsPerMl: {},
      targetNgPerUl: {},
      targetGramsPerLiter: { ...baselineTargetGramsPerLiter_1777863 },
      targetVolumePercent: {}
    }
  };
  const DEFAULT_PROFILE_KEY = '1777863_77';
  // Track the last-loaded benchmark's theoretical (not-in-stock) components
  // so the UI can show a persistent banner listing what would need to be
  // purchased. Cleared on the next successful load or by the "dismiss" button.
  let theoreticalBanner = $state(null);  // { formulationName, items: [{name, value, reason}] }

  // Load a benchmark formulation (from Olsen et al. 2026 Table 1) into the
  // active design profile. Maps paper reagent names → our reagent IDs via
  // mapFormulationToTargets, then recomputes volumes via the existing
  // profile→volume machinery. Missing reagents are surfaced via
  // theoreticalBanner so the user knows what would need to be purchased.
  function loadBenchmarkFormulation(benchmark) {
    const { targetMm, targetGramsPerLiter, targetUnitsPerMl, targetNgPerUl, skipped } = mapFormulationToTargets(benchmark);
    const profile = defaultTargetProfiles[selectedProfileKey];
    if (!profile) return;
    profile.targetMm = targetMm;
    profile.targetGramsPerLiter = targetGramsPerLiter;
    profile.targetUnitsPerMl = targetUnitsPerMl || {};
    profile.targetNgPerUl = targetNgPerUl || {};
    profile.targetVolumePercent = {};
    profile.label = benchmark.year ? `${benchmark.name} (${benchmark.year})` : benchmark.name;
    // computeDefaultVolumes credits base buffer + water-fills to MAX_TOTAL_NL,
    // so the total pipetted volume lands at 20 µL regardless of formulation.
    volumesNl = { ...computeDefaultVolumes(selectedProfileKey) };
    theoreticalBanner = skipped.length
      ? { formulationName: `${benchmark.name} (${benchmark.year})`, items: skipped }
      : null;
    // Keep the preset dropdown in sync when loaded from the benchmarks table.
    const presetIdx = benchmarkFormulations.findIndex((b) => b.key === benchmark.key);
    if (presetIdx >= 0) presetCycleIndex = presetIdx + 1;
  }

  // Pure: the per-reagent volume map a benchmark formulation would produce if
  // loaded — computed WITHOUT mutating the live design or shared profile. Used to
  // baseline the Custom Mix "starting composition" so edits away from it read as
  // "Custom" and reverting reads as the composition name again. Returns null if
  // the formulation can't be mapped (unsupported unit).
  function volumesForFormulation(bm) {
    if (!bm?.components) return null;
    try {
      const { targetMm, targetGramsPerLiter, targetUnitsPerMl, targetNgPerUl } =
        mapFormulationToTargets(bm);
      return computeVolumesForProfile({
        label: bm.name,
        targetMm,
        targetGramsPerLiter,
        targetUnitsPerMl: targetUnitsPerMl || {},
        targetNgPerUl: targetNgPerUl || {},
        targetVolumePercent: {}
      });
    } catch {
      return null;
    }
  }

  // Custom Mix "starting composition": the recipe the live design was seeded
  // from (default = the sfGFP PEP reference plate). Selecting one from
  // the Custom Mix dropdown loads it AND re-baselines; any later edit flips the
  // column label to "Custom" until the design matches the starting recipe again.
  let customStartKey = $state('ginkgo-target-sfgfp-pep');
  // Resolve a starting-composition key against the static benchmarks first, then
  // the community submissions (so a picked community design loads like any other).
  function findFormulation(key) {
    return (
      benchmarkFormulations.find((b) => b.key === key) ??
      (communityFormulations ?? []).find((b) => b.key === key) ??
      null
    );
  }
  function setCustomStart(key) {
    const bm = findFormulation(key);
    if (!bm) return;
    customStartKey = key;
    loadBenchmarkFormulation(bm);
  }


  const HTGAA_NODE_OPTIONS = [
    'MIT / Harvard (Cambridge, USA)',
    'BioClub Tokyo (Tokyo, Japan)',
    'Biopunk Lab (San Francisco, USA)',
    'Designer Cells at Yonsei University (Incheon, South Korea)',
    'Genspace (New York, USA):',
    'Lifefabs Institute (London, UK)',
    'Ottawa Bio Science (ON, Canada)',
    'USFQ (Quito, Ecuador)',
    'Victoria Makerspace (BC, Canada)',
    'Baltimore Underground Science Space (Baltimore, MD, USA)',
    'Duke (Durham, NC, USA)',
    'Iowa State (Ames, IA, USA)',
    'William & Mary (Williamsburg, VA, USA)',
    'Chitown Bio (Chicago, IL, USA)',
    'Hartnell College (Salinas, CA, USA)'
  ];

  const fixedVolumeSummaryIds = new Set(['cell_lysate', 'dna_template']);
  const excludedFromExportIds = new Set(['cell_lysate', 'base_buffer', 'dna_template']);

  // The recognized `CFPSReagentList` field names (PYDANTIC_REAGENT_FIELDS) live in
  // $lib/cfpsReagentContract.js; the app-id ↔ pydantic-field maps
  // (REAGENT_ID_TO_PYDANTIC / PYDANTIC_TO_REAGENT_ID) live in $lib/cfpsReagentIdMap.js —
  // both shared with the server submit gate and the model sync tool.

  // Load a plate-reader well's exact reagent combination into the design panel.
  // The well's `recipe` is { pydantic_field: nL } for the tunable reagents only
  // (backbone base_buffer/lysate/template/water are excluded server-side). We
  // zero every adjustable reagent, apply the well's doses (mapping field → app
  // id), keep the fixed backbone reagents, and re-balance water to 20 µL.
  function loadWellRecipe(well) {
    const recipe = well?.recipe;
    if (!recipe) return;
    const next = {};
    for (const reagent of allReagents) {
      next[reagent.id] = reagent.fixedNl ?? 0; // fixed backbone kept; others zeroed
    }
    for (const [field, nl] of Object.entries(recipe)) {
      const appId = PYDANTIC_TO_REAGENT_ID[field] ?? field;
      const reagent = allReagents.find((r) => r.id === appId);
      if (!reagent || reagent.fixedNl != null || reagent.id === WATER_ID) continue;
      next[appId] = floorToStepNl(Number(nl) || 0);
    }
    const nonWater = allReagents
      .filter((reagent) => reagent.id !== WATER_ID)
      .reduce((sum, reagent) => sum + (Number(next[reagent.id]) || 0), 0);
    next[WATER_ID] = Math.max(0, MAX_TOTAL_NL - nonWater);
    volumesNl = next;
    theoreticalBanner = null;
    presetCycleIndex = 0;
    plateReaderOpen = false;
    wellLoadMessage = `Loaded well ${well.well}${well.label ? ` · ${well.label}` : ''} into the design.`;
  }

  const initialVolumes = computeInitialVolumes();

  // Preset cycling: option 0 = Ginkgo default, options 1..N = benchmark formulations
  const DEFAULT_PROFILE_SNAPSHOT = {
    label: '1777863',
    targetMm: { ...baselineTargetMm_1777863 },
    targetUnitsPerMl: {},
    targetNgPerUl: {},
    targetGramsPerLiter: { ...baselineTargetGramsPerLiter_1777863 },
    targetVolumePercent: {}
  };

  let presetCycleIndex = $state(0);

  // Preset dropdown: index 0 = Ginkgo default profile, 1..N = benchmark
  // formulations (in BENCHMARK_FORMULATIONS order). Selecting an option loads
  // that full composition into the active design.
  function applyPreset(index) {
    presetCycleIndex = index;
    if (index === 0) {
      const profile = defaultTargetProfiles[selectedProfileKey];
      Object.assign(profile, {
        label: DEFAULT_PROFILE_SNAPSHOT.label,
        targetMm: { ...DEFAULT_PROFILE_SNAPSHOT.targetMm },
        targetUnitsPerMl: {},
        targetNgPerUl: {},
        targetGramsPerLiter: { ...DEFAULT_PROFILE_SNAPSHOT.targetGramsPerLiter },
        targetVolumePercent: {}
      });
      volumesNl = { ...computeDefaultVolumes(selectedProfileKey) };
      theoreticalBanner = null;
    } else {
      loadBenchmarkFormulation(benchmarkFormulations[index - 1]);
    }
  }

  let designTitle = $state('');
  let author = $state('');
  let rationale = $state('');
  let selectedNodeDisplay = $state('');
  let publishFormError = $state('');
  let selectedProfileKey = $state(DEFAULT_PROFILE_KEY);
  let uploadModal;
  let draggingReagent = null;
  let dragLeft = 0;
  let dragWidth = 1;
  let copyMessage = $state('');
  let copyError = $state('');
  let plateReaderOpen = $state(false);
  let plateReaderTarget = $state(0); // which target the modal opens focused on
  let plateReaderBatch = $state(0); // which lysate batch the modal opens on
  let wellLoadMessage = $state('');
  let showStandardCurves = $state(false); // std-curve reference tables, collapsed by default

  // Disable the horizontal overscroll "swipe back" gesture while this page is
  // mounted — there's no reason to swipe left back to the homepage from here, and
  // the wide benchmarks table needs horizontal drags for its own scrolling.
  // Runs client-only ($effect never fires during SSR); restores on navigate-away.
  $effect(() => {
    const root = document.documentElement;
    const prevRoot = root.style.overscrollBehaviorX;
    const prevBody = document.body.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = 'none';
    document.body.style.overscrollBehaviorX = 'none';
    return () => {
      root.style.overscrollBehaviorX = prevRoot;
      document.body.style.overscrollBehaviorX = prevBody;
    };
  });

  function openPlateReader(index = 0, batch = 0) {
    plateReaderTarget = index;
    plateReaderBatch = batch;
    plateReaderOpen = true;
  }
  let volumesNl = $state({ ...initialVolumes });
  // Which target protein this composition is designed for — recorded in the
  // metadata (protein_target) and chosen per-column via the Mix header dropdown.
  let proteinTarget = $state('sfGFP');

  // ── mix columns (batch designing) ──────────────────────────────────────────
  // Every candidate composition is a numbered "Mix N" column — all equal peers in
  // the experiment batch, fixed in creation order (columns never reorder). Exactly
  // one is SELECTED (editable): its live data lives in volumesNl / proteinTarget /
  // customStartKey. Every mix (including the selected one) has an entry in `mixes`
  // ({ id, n, volumes (nL map), proteinTarget, startKey }); the selected entry's
  // snapshot is stale while editing (the live buffer is the truth — see
  // resolvedMixes / commitSelectedMix). Selecting a mix commits the live buffer
  // back into its slot then loads the newly-selected mix into the buffer IN PLACE
  // — nothing moves. Submitting writes every mix in one pass. Mix numbers are
  // always positional (1..N in column order) — renumberMixes keeps them gapless
  // after every add/remove, so you never see Mix 1, 3, 4.
  let mixes = $state([
    { id: `mix-${randomToken()}`, n: 1, volumes: null, proteinTarget: 'sfGFP', startKey: 'ginkgo-target-sfgfp-pep' }
  ]);
  let selectedMixId = $state(mixes[0].id);
  // Columns never reorder (addMix appends), so array order == display order; just
  // stamp n = index + 1 to guarantee a contiguous Mix 1, 2, 3, … sequence.
  const renumberMixes = (list) => list.map((m, i) => ({ ...m, n: i + 1 }));
  const mixLabel = (n) => `Mix ${n}`;
  // Total mixes a submit would write; >1 ⇒ batch territory (no single/batch toggle).
  let batchMixCount = $derived(mixes.length);
  // Mixes in column order (Mix 1..N) — used by the submit modal to render one comment
  // field per experiment.
  let submitMixList = $derived([...mixes].sort((a, b) => a.n - b.n));
  // Each protein has its own DNA template plasmid (all dosed at 2000 nL). The
  // reagent_list must carry EXACTLY the template matching protein_target — the
  // mapping + helper (TEMPLATE_FIELDS / templateFieldForTarget) are imported from
  // $lib/cfpsReagentContract.js, shared with the server.
  let isPublishing = $state(false);
  let publishMessage = $state('');
  let publishError = $state('');

  let totalVolumeNl = $derived(
    allReagents.reduce((sum, reagent) => sum + (Number(volumesNl[reagent.id]) || 0), 0)
  );

  let remainingNl = $derived(Math.max(0, MAX_TOTAL_NL - totalVolumeNl));

  let totalCostUsd = $derived(
    visibleReagents.reduce((sum, reagent) => sum + effectiveCostUsdForReagent(reagent), 0)
  );

  let costPerMlReaction = $derived(
    totalVolumeNl > 0 ? totalCostUsd / (totalVolumeNl / 1_000_000) : 0
  );

  let presetVolumesNl = $derived(computeDefaultVolumes(selectedProfileKey));
  // Per-paper-reagent Custom Mix state for the comparison-table customizer:
  // the live design (volumesNl) expressed in each reagent's paper unit, plus
  // the +/- affordance flags. Keyed by paper reagent name so BenchmarksTable
  // (which iterates paper names) can align it against a Comparison Mix column.
  let customMixByPaper = $derived.by(() => {
    volumesNl; // establish reactive dependency on the live design
    const out = {};
    for (const [paperName, alias] of Object.entries(REAGENT_ALIASES)) {
      const id = alias?.ids?.[0];
      if (!id) continue;
      const reagent = allReagents.find((r) => r.id === id);
      if (!reagent) continue;
      const unit = alias.unit || 'mM';
      const value = customConcInUnit(reagent, unit);
      const adjustable = reagent.fixedNl == null && reagent.id !== WATER_ID;
      out[paperName] = {
        reagentId: id,
        unit,
        value,
        label: value == null ? '—' : `${fmtConc(value)} ${unit}`,
        adjustable,
        canInc: adjustable && canIncrease(reagent),
        canDec: adjustable && canDecrease(reagent)
      };
    }
    return out;
  });
  let customWaterUl = $derived((Number(volumesNl[WATER_ID]) || 0) / 1000);

  // The volume map of the current starting composition, and whether the live
  // design has diverged from it (water absorbs snap-rounding, so it's excluded
  // from the comparison). Drives the Custom Mix column's "Custom" vs recipe-name label.
  let customStartVolumes = $derived(
    volumesForFormulation(findFormulation(customStartKey))
  );
  let customIsCustomized = $derived.by(() => {
    if (!customStartVolumes) return false;
    for (const reagent of allReagents) {
      if (reagent.id === WATER_ID) continue;
      if ((Number(customStartVolumes[reagent.id]) || 0) !== (Number(volumesNl[reagent.id]) || 0)) {
        return true;
      }
    }
    return false;
  });
  let exportedSample = $derived(buildExportedSample());
  let exportedCompositionJson = $derived(JSON.stringify(exportedSample, null, 2));
  // Concentration-rank panel: a tab per mix lets you read any formulation's rank.
  // `rankTabMixId` is the tab the user picked (null → follow the selected mix); it
  // falls back to the selected mix when its tab is removed. The viewed volume map is
  // the live buffer for the selected mix, else that mix's stored snapshot.
  let rankTabMixId = $state(null);
  let rankViewMixId = $derived(mixes.some((m) => m.id === rankTabMixId) ? rankTabMixId : selectedMixId);
  let rankViewVolumes = $derived(
    rankViewMixId === selectedMixId
      ? volumesNl
      : (mixes.find((m) => m.id === rankViewMixId)?.volumes || volumesNl)
  );
  let concentrationRankEntries = $derived(buildConcentrationRankEntriesForVolumes(rankViewVolumes));
  let costRankEntries = $derived(buildCostRankEntries());

  function toStepNl(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric / STEP_NL) * STEP_NL;
  }

  function formatUl(nl) {
    return `${(nl / 1000).toFixed(3)} uL`;
  }

  function formatUsd(value) {
    return `$${value.toFixed(4)}`;
  }

  function costUsdForReagent(reagent) {
    const volumeNl = Number(volumesNl[reagent.id]) || 0;
    return (volumeNl / 1_000_000) * Number(reagent.costPerMl || 0);
  }

  function activeProfile(profileKey = selectedProfileKey) {
    return defaultTargetProfiles[profileKey] || defaultTargetProfiles[DEFAULT_PROFILE_KEY];
  }

  // Scale factor for the 10× base buffer at its actual volume in the reaction.
  // 1.0 at STANDARD_BASE_BUFFER_NL (2 µL → 10% v/v → 1× baseline concentrations).
  // Larger if the operator loads more base buffer, zero if it's removed entirely.
  function baseBufferScaleFromVolumes(volumes) {
    const baseBufferNl = Number(volumes?.[BASE_BUFFER_ID]) || 0;
    if (STANDARD_BASE_BUFFER_NL <= 0) return 0;
    return baseBufferNl / STANDARD_BASE_BUFFER_NL;
  }

  // How much of the given reagent's target concentration the current base
  // buffer volume ALREADY delivers, before any supplement is added.
  // Uses the hardcoded 10× recipe (K(Glu), Mg(Glu)2, HEPES, 17-AA/Tyr/Cys) —
  // reagents not in the recipe get 0. Used by equivalentSourceVolume to shrink
  // supplement volumes and by finalNm* to add baseline to displayed finals.
  function baseBufferBaselineMm(reagentId, volumes = volumesNl) {
    const contribution1x = BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID[reagentId] || 0;
    return contribution1x * baseBufferScaleFromVolumes(volumes);
  }

  function equivalentSourceVolumeNlForReagentFromProfile(reagent, profile = activeProfile(), volumes = volumesNl) {
    if (!reagent || reagent.id === BASE_BUFFER_ID) return 0;

    const targetMm = profile?.targetMm || {};
    const targetUnitsPerMl = profile?.targetUnitsPerMl || {};
    const targetGramsPerLiter = profile?.targetGramsPerLiter || {};
    const targetVolumePercent = profile?.targetVolumePercent || {};
    const targetNgPerUl = profile?.targetNgPerUl || {};

    if (targetMm[reagent.id] != null) {
      const stockM = stockMolarityForReagent(reagent);
      if (stockM && stockM > 0) {
        // Base buffer already delivers a portion of this target — only pipette
        // enough supplement to make up the difference. Never negative.
        const baseline = baseBufferBaselineMm(reagent.id, volumes);
        const supplementMm = Math.max(0, targetMm[reagent.id] - baseline);
        return ((supplementMm * 1e-3) / stockM) * MAX_TOTAL_NL;
      }
    }

    if (targetUnitsPerMl[reagent.id] != null) {
      const stockUnitsPerMl = parseUnitsPerMl(reagent.concentration);
      if (stockUnitsPerMl && stockUnitsPerMl > 0) {
        return (targetUnitsPerMl[reagent.id] / stockUnitsPerMl) * MAX_TOTAL_NL;
      }
    }

    if (targetNgPerUl[reagent.id] != null) {
      const stockNgPerUl = parseNgPerMicroliter(reagent.concentration);
      if (stockNgPerUl && stockNgPerUl > 0) {
        return (targetNgPerUl[reagent.id] / stockNgPerUl) * MAX_TOTAL_NL;
      }
    }

    if (targetGramsPerLiter[reagent.id] != null) {
      const stockGL = parseGramsPerLiter(reagent.concentration);
      if (stockGL && stockGL > 0) {
        return (targetGramsPerLiter[reagent.id] / stockGL) * MAX_TOTAL_NL;
      }
    }

    if (targetVolumePercent[reagent.id] != null) {
      const stockPercent = stockVolumePercentForReagent(reagent);
      if (stockPercent && stockPercent > 0) {
        return (targetVolumePercent[reagent.id] / stockPercent) * MAX_TOTAL_NL;
      }
    }

    return 0;
  }

  function baseBufferAllocationEntries() {
    const profile = activeProfile();
    return visibleReagents
      .map((reagent) => [reagent.id, equivalentSourceVolumeNlForReagentFromProfile(reagent, profile)])
      .filter(([, equivalentNl]) => equivalentNl > 0);
  }

  function apportionedBaseBufferVolumeMap(volumes) {
    const baseBufferNl = Number(volumes?.[BASE_BUFFER_ID]) || 0;
    if (baseBufferNl <= 0) return new Map();

    const entries = baseBufferAllocationEntries();
    const totalEquivalentNl = entries.reduce((sum, [, equivalentNl]) => sum + equivalentNl, 0);
    if (totalEquivalentNl <= 0) return new Map();

    return new Map(
      entries.map(([reagentId, equivalentNl]) => [reagentId, (baseBufferNl * equivalentNl) / totalEquivalentNl])
    );
  }

  function effectiveVolumeNlForReagentFromVolumes(reagentId, volumes) {
    if (reagentId === BASE_BUFFER_ID) return 0;
    const directNl = Number(volumes?.[reagentId]) || 0;
    const apportionedNl = apportionedBaseBufferVolumeMap(volumes).get(reagentId) || 0;
    return directNl + apportionedNl;
  }

  function effectiveVolumeNlForReagent(reagentId) {
    return effectiveVolumeNlForReagentFromVolumes(reagentId, volumesNl);
  }

  function effectiveCostUsdForReagent(reagent) {
    const directCostUsd = costUsdForReagent(reagent);
    const apportionedNl = apportionedBaseBufferVolumeMap(volumesNl).get(reagent.id) || 0;
    return directCostUsd + ((apportionedNl / 1_000_000) * Number(reagent.costPerMl || 0));
  }

  function reagentMetaLabel(reagent) {
    const parts = [];
    if (Number(reagent.costPerMl) > 0) {
      parts.push(reagent.concentration);
      parts.push(`$${Number(reagent.costPerMl).toFixed(2)}/mL`);
    }

    parts.push(formatUl(effectiveVolumeNlForReagent(reagent.id)));

    const targetGramsPerLiter = activeProfile()?.targetGramsPerLiter || {};
    const targetVolumePercent = activeProfile()?.targetVolumePercent || {};

    if (targetGramsPerLiter[reagent.id] != null) {
      const finalGL = finalGramsPerLiterForReagent(reagent);
      if (finalGL != null) {
        parts.push(`final ${finalGL.toFixed(3)} g/L`);
      }
    } else if (targetVolumePercent[reagent.id] != null) {
      const finalPercent = finalVolumePercentForReagent(reagent);
      if (finalPercent != null) {
        parts.push(`final ${finalPercent.toFixed(2)}% v/v`);
      }
    } else {
      const finalNm = finalNmForReagent(reagent);
      if (finalNm != null) {
        parts.push(`final ${formatConcentration(finalNm)}`);
      } else {
        const finalGL = finalGramsPerLiterForReagent(reagent);
        if (finalGL != null) {
          parts.push(`final ${finalGL.toFixed(3)} g/L`);
        } else {
          const finalPercent = finalVolumePercentForReagent(reagent);
          if (finalPercent != null) {
            parts.push(`final ${finalPercent.toFixed(2)}% v/v`);
          }
        }
      }
    }

    return parts.join(' | ');
  }

  function floorToStepNl(valueNl) {
    const numeric = Number(valueNl);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric / STEP_NL) * STEP_NL);
  }

  function computeInitialVolumes() {
    const loaded = volumesFromLoadedDesign(data?.initialDesign);
    if (loaded) return loaded;
    return computeDefaultVolumes(DEFAULT_PROFILE_KEY);
  }

  function volumesFromLoadedDesign(design) {
    if (!design || typeof design !== 'object') return null;
    if (!Array.isArray(design.reagents)) return null;

    const byId = Object.fromEntries(
      design.reagents
        .map((item) => [String(item?.id || ''), floorToStepNl(Number(item?.volumeNl) || 0)])
        .filter(([id]) => id.length > 0)
    );

    const volumes = Object.fromEntries(
      allReagents.map((reagent) => [reagent.id, reagent.fixedNl ?? byId[reagent.id] ?? 0])
    );

    const nonWaterTotal = allReagents
      .filter((reagent) => reagent.id !== WATER_ID)
      .reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
    volumes[WATER_ID] = Math.max(0, MAX_TOTAL_NL - nonWaterTotal);

    return volumes;
  }

  function parseMolarityM(concentration) {
    const match = String(concentration || '')
      .trim()
      .match(/^([0-9]*\.?[0-9]+)\s*(nM|uM|µM|mM|M)$/i);
    if (!match) return null;

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) return null;

    if (unit === 'm') return value;
    if (unit === 'mm') return value * 1e-3;
    if (unit === 'um' || unit === 'µm') return value * 1e-6;
    if (unit === 'nm') return value * 1e-9;
    return null;
  }

  function parseUnitsPerMl(concentration) {
    const match = String(concentration || '')
      .trim()
      .match(/^>?([0-9]*\.?[0-9]+)\s*U\/ml$/i);
    if (!match) return null;
    return Number(match[1]);
  }

  // DNA templates (helper plasmids, dsbc_pdam_let, etc.) are stocked in ng/µL.
  // Volume math is a pure ratio so unit cancels; only parsing differs from
  // parseGramsPerLiter (which requires strict "Xg/L" format).
  function parseNgPerMicroliter(concentration) {
    const match = String(concentration || '')
      .trim()
      .match(/^([0-9]*\.?[0-9]+)\s*ng\/(?:u|µ)L$/i);
    if (!match) return null;
    return Number(match[1]);
  }

  function parseGramsPerLiter(concentration) {
    const match = String(concentration || '')
      .trim()
      .match(/^([0-9]*\.?[0-9]+)\s*g\/L$/i);
    if (!match) return null;
    return Number(match[1]);
  }

  function parseVolumePercent(concentration) {
    const match = String(concentration || '')
      .trim()
      .match(/^([0-9]*\.?[0-9]+)\s*%\s*(v\/v|w\/v)?$/i);
    if (!match) return null;
    return Number(match[1]);
  }

  function stockMolarityForReagent(reagent) {
    const directM = parseMolarityM(reagent?.concentration);
    if (directM != null) return directM;

    const gramsPerLiter = parseGramsPerLiter(reagent?.concentration);
    const molecularWeight = Number(reagent?.molecular_weight_g_mol);
    if (gramsPerLiter == null || !Number.isFinite(molecularWeight) || molecularWeight <= 0) return null;

    // M = (g/L) / (g/mol)
    return gramsPerLiter / molecularWeight;
  }

  function stockVolumePercentForReagent(reagent) {
    const direct = parseVolumePercent(reagent?.concentration);
    if (direct != null) return direct;
    // g/L → % w/v (1% w/v = 10 g/L)
    const gL = parseGramsPerLiter(reagent?.concentration);
    if (gL != null) return gL / 10;
    return null;
  }

  function totalVolumeFor(volumes) {
    return allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
  }

  // Physical mM the 10× base buffer contributes at its current volume. Only
  // reagents in the base buffer recipe get a non-zero baseline; everything else
  // must come entirely from its own supplement.
  function baseBufferContributionMmFromVolumes(reagentId, volumes) {
    return baseBufferBaselineMm(reagentId, volumes);
  }

  // Base buffer is an aqueous salt/AA mix — nothing in it contributes measurable
  // g/L or v/v to other reagent categories.
  function baseBufferContributionGramsPerLiterFromVolumes(_reagentId, _volumes) {
    return 0;
  }

  function baseBufferContributionVolumePercentFromVolumes(_reagentId, _volumes) {
    return 0;
  }

  // Build the default per-reagent volume map for a profile:
  //   fixed reagents (lysate, DNA, base buffer) use their fixedNl from the DB
  //   every other reagent gets the supplement volume needed to hit its target
  //     concentration on top of the base buffer's baseline
  //   water fills whatever is left up to MAX_TOTAL_NL
  function computeDefaultVolumes(profileKey = DEFAULT_PROFILE_KEY) {
    return computeVolumesForProfile(defaultTargetProfiles[profileKey]);
  }

  // Pure volume-map builder for an arbitrary profile object (no shared state
  // mutation). computeDefaultVolumes wraps this with a looked-up default profile;
  // volumesForFormulation feeds it a benchmark-derived profile so the Custom Mix
  // "starting composition" can be computed without touching the live design.
  function computeVolumesForProfile(profile) {
    const volumes = {};
    // Two passes: first stamp in every fixed volume (lysate, DNA, base_buffer)
    // and zero the rest, so that base_buffer is guaranteed to be populated
    // BEFORE any supplement volume is computed. Otherwise the baseline lookup
    // in equivalentSourceVolumeNlForReagentFromProfile sees volumes[base_buffer]
    // == undefined → scale 0 → no base credit → double-supplementing.
    for (const reagent of allReagents) {
      if (reagent.fixedNl != null) {
        volumes[reagent.id] = reagent.fixedNl;
      } else {
        volumes[reagent.id] = 0;
      }
    }
    // Second pass: compute supplement volumes now that base_buffer is set.
    for (const reagent of allReagents) {
      if (reagent.fixedNl != null) continue;
      if (reagent.id === WATER_ID) continue;
      // Snap every supplement to the Echo's 25 nL pipetting resolution — the
      // benchmark compositions were experimentally identified on this grid,
      // so exporting sub-step floats would be dishonest to what can actually
      // be pipetted. Water absorbs the cumulative rounding error at the end.
      const raw = profile
        ? equivalentSourceVolumeNlForReagentFromProfile(reagent, profile, volumes)
        : 0;
      volumes[reagent.id] = toStepNl(raw);
    }
    const nonWaterTotal = allReagents
      .filter((reagent) => reagent.id !== WATER_ID)
      .reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
    volumes[WATER_ID] = Math.max(0, MAX_TOTAL_NL - nonWaterTotal);
    return volumes;
  }

  function applyDefaultProfile(profileKey) {
    if (!defaultTargetProfiles[profileKey]) return;
    selectedProfileKey = profileKey;
    volumesNl = { ...computeDefaultVolumes(profileKey) };
  }

  function finalNmForReagentFromVolumes(reagent, volumes) {
    const stockM = stockMolarityForReagent(reagent);
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const totalNl = totalVolumeFor(volumes);
    const directNm = stockM == null || totalNl <= 0 ? 0 : stockM * (volumeNl / totalNl) * 1_000_000_000;
    const baseNm = baseBufferContributionMmFromVolumes(reagent.id, volumes) * 1_000_000;
    const totalNm = directNm + baseNm;
    if (totalNm <= 0 && stockM == null && baseNm <= 0) return null;
    return totalNm;
  }

  function finalNmForReagent(reagent) {
    return finalNmForReagentFromVolumes(reagent, volumesNl);
  }

  function finalMmForReagent(reagent) {
    const nm = finalNmForReagent(reagent);
    return nm == null ? null : nm / 1_000_000;
  }

  function finalGramsPerLiterForReagentFromVolumes(reagent, volumes) {
    const stockGL = parseGramsPerLiter(reagent.concentration);
    const totalNl = totalVolumeFor(volumes);
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const directGL = stockGL == null || totalNl <= 0 ? 0 : stockGL * (volumeNl / totalNl);
    const baseGL = baseBufferContributionGramsPerLiterFromVolumes(reagent.id, volumes);
    const totalGL = directGL + baseGL;
    if (totalGL <= 0 && stockGL == null && baseGL <= 0) return null;
    return totalGL;
  }

  function finalGramsPerLiterForReagent(reagent) {
    return finalGramsPerLiterForReagentFromVolumes(reagent, volumesNl);
  }

  function finalVolumePercentForReagentFromVolumes(reagent, volumes) {
    const stockPercent = stockVolumePercentForReagent(reagent);
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const totalNl = totalVolumeFor(volumes);
    const directPercent = stockPercent == null || totalNl <= 0 ? 0 : stockPercent * (volumeNl / totalNl);
    const basePercent = baseBufferContributionVolumePercentFromVolumes(reagent.id, volumes);
    const totalPercent = directPercent + basePercent;
    if (totalPercent <= 0 && stockPercent == null && basePercent <= 0) return null;
    return totalPercent;
  }

  function finalVolumePercentForReagent(reagent) {
    return finalVolumePercentForReagentFromVolumes(reagent, volumesNl);
  }

  // Enzymes measured in activity units (e.g. catalase 50,000 U/mL stock →
  // 187.5 U/mL final at a 75 nL add). Base buffer contributes nothing here.
  function finalUnitsPerMlForReagentFromVolumes(reagent, volumes) {
    const stockUnitsPerMl = parseUnitsPerMl(reagent.concentration);
    if (stockUnitsPerMl == null) return null;
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const totalNl = totalVolumeFor(volumes);
    if (totalNl <= 0) return 0;
    return stockUnitsPerMl * (volumeNl / totalNl);
  }

  function finalUnitsPerMlForReagent(reagent) {
    return finalUnitsPerMlForReagentFromVolumes(reagent, volumesNl);
  }

  // DNA templates measured in ng/µL (e.g. dsbc_pdam_let 100 ng/µL stock →
  // 2.375 ng/µL final at a 475 nL add). Base buffer contributes nothing.
  function finalNgPerUlForReagentFromVolumes(reagent, volumes) {
    const stockNgPerUl = parseNgPerMicroliter(reagent.concentration);
    if (stockNgPerUl == null) return null;
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const totalNl = totalVolumeFor(volumes);
    if (totalNl <= 0) return 0;
    return stockNgPerUl * (volumeNl / totalNl);
  }

  function finalNgPerUlForReagent(reagent) {
    return finalNgPerUlForReagentFromVolumes(reagent, volumesNl);
  }

  function baselineVolumePercentForReagent(reagent) {
    return finalVolumePercentForReagentFromVolumes(reagent, presetVolumesNl);
  }

  function baselineGramsPerLiterForReagent(reagent) {
    const targetGramsPerLiter = activeProfile()?.targetGramsPerLiter || {};
    if (targetGramsPerLiter[reagent.id] == null) return null;
    return finalGramsPerLiterForReagentFromVolumes(reagent, presetVolumesNl);
  }

  function baselineMmForReagent(reagent) {
    const isMolar = stockMolarityForReagent(reagent) != null;
    if (!isMolar) return null;
    const nm = finalNmForReagentFromVolumes(reagent, presetVolumesNl);
    return nm == null ? null : nm / 1_000_000;
  }

  function formatMm(value) {
    if (value == null) return 'n/a';
    if (isZeroValue(value)) return '-';
    return `${value.toFixed(3)} mM`;
  }

  function formatVolumePercent(value) {
    if (value == null) return 'n/a';
    if (isZeroValue(value)) return '-';
    return `${value.toFixed(2)}% v/v`;
  }

  function formatPercentDelta(baseMm, deltaMm) {
    if (baseMm == null || deltaMm == null) return 'n/a';
    if (isZeroValue(deltaMm)) return '-';
    if (baseMm === 0) {
      return 'new';
    }
    return `${((deltaMm / baseMm) * 100).toFixed(1)}%`;
  }

  function formatUlValue(value) {
    if (value == null) return 'n/a';
    if (isZeroValue(value)) return '-';
    return `${value.toFixed(3)} uL`;
  }

  function formatDeltaLabel(value, unit) {
    if (value == null) return 'n/a';
    if (isZeroValue(value)) return '-';
    return `${value >= 0 ? '+' : ''}${value.toFixed(3)} ${unit}`;
  }

  function isZeroValue(value) {
    if (value == null) return false;
    return Math.abs(Number(value)) < 1e-9;
  }

  // Final in-reaction concentration of a reagent expressed in a specific paper
  // unit, so the customizer's Custom Mix column reads in the same unit as the
  // Comparison Mix column it's diffed against. Returns null for units we can't
  // derive from the volume model (e.g. U/mL stocks with no activity mapping).
  function customConcInUnit(reagent, unit) {
    if (!reagent) return null;
    switch (unit) {
      case 'mM':
        return finalMmForReagent(reagent);
      case 'µM':
      case 'uM': {
        const mm = finalMmForReagent(reagent);
        return mm == null ? null : mm * 1000;
      }
      case 'mg/mL':
      case 'g/L':
        return finalGramsPerLiterForReagent(reagent);
      case 'U/mL':
        return finalUnitsPerMlForReagent(reagent);
      case '% w/v':
      case '% v/v':
      case '%':
        return finalVolumePercentForReagent(reagent);
      default:
        return null;
    }
  }

  // Compact concentration formatter for the customizer cells: precision by
  // magnitude, trailing zeros stripped ("2.00"→"2", "0.100"→"0.1").
  function fmtConc(v) {
    if (v == null) return '—';
    if (Math.abs(v) < 1e-9) return '0';
    const a = Math.abs(v);
    let s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s;
  }

  // ── community compositions → comparison-table columns ─────────────────────
  // A submitted design stores a reagent_list ({ pydantic_field: nL }); the
  // comparison table needs the same { paperName: concentration } shape as the
  // static BENCHMARK_FORMULATIONS. These three helpers mirror loadWellRecipe +
  // customMixByPaper but take an explicit volume map so any design (not just the
  // live one) can be rendered as a column.

  // reagent_list (pydantic field → nL) → a volumesNl-style map, snapped to the
  // Echo grid and balanced to 20 µL with water — same treatment loadWellRecipe
  // applies to a clicked plate-reader well.
  function volumesFromReagentList(reagentList) {
    const next = {};
    for (const reagent of allReagents) next[reagent.id] = reagent.fixedNl ?? 0;
    for (const [field, nl] of Object.entries(reagentList || {})) {
      const appId = PYDANTIC_TO_REAGENT_ID[field] ?? field;
      const reagent = allReagents.find((r) => r.id === appId);
      if (!reagent || reagent.fixedNl != null || reagent.id === WATER_ID) continue;
      next[appId] = floorToStepNl(Number(nl) || 0);
    }
    const nonWater = allReagents
      .filter((reagent) => reagent.id !== WATER_ID)
      .reduce((sum, reagent) => sum + (Number(next[reagent.id]) || 0), 0);
    next[WATER_ID] = Math.max(0, MAX_TOTAL_NL - nonWater);
    return next;
  }

  // Final in-reaction concentration in a paper unit, for an arbitrary volume map
  // — the volumes-parameterized twin of customConcInUnit.
  function concInUnitFromVolumes(reagent, unit, volumes) {
    if (!reagent) return null;
    switch (unit) {
      case 'mM': {
        const nm = finalNmForReagentFromVolumes(reagent, volumes);
        return nm == null ? null : nm / 1_000_000;
      }
      case 'µM':
      case 'uM': {
        const nm = finalNmForReagentFromVolumes(reagent, volumes);
        return nm == null ? null : nm / 1000;
      }
      case 'mg/mL':
      case 'g/L':
        return finalGramsPerLiterForReagentFromVolumes(reagent, volumes);
      case 'U/mL':
        return finalUnitsPerMlForReagentFromVolumes(reagent, volumes);
      case '% w/v':
      case '% v/v':
      case '%':
        return finalVolumePercentForReagentFromVolumes(reagent, volumes);
      default:
        return null;
    }
  }

  // { paperName: concentration } over every reagent the design actually doses —
  // the same components shape the static BENCHMARK_FORMULATIONS use.
  function componentsForVolumes(volumes) {
    const out = {};
    for (const [paperName, alias] of Object.entries(REAGENT_ALIASES)) {
      const id = alias?.ids?.[0];
      if (!id) continue;
      const reagent = allReagents.find((r) => r.id === id);
      if (!reagent) continue;
      const value = concInUnitFromVolumes(reagent, alias.unit || 'mM', volumes);
      if (value != null && value > 0) out[paperName] = value;
    }
    return out;
  }

  // Per-paper-reagent stepper state for an ARBITRARY volume map — the same shape as
  // customMixByPaper (value/label/adjustable/canInc/canDec) but computed from a given
  // mix's stored volumes rather than the live editing buffer. Lets every mix column
  // render live steppers; interacting with a non-selected one promotes it to selected
  // (see BenchmarksTable), after which edits flow through the live buffer as usual.
  function stepperMapForVolumes(volumes) {
    const out = {};
    const vols = volumes || {};
    const waterNl = Number(vols[WATER_ID]) || 0;
    for (const [paperName, alias] of Object.entries(REAGENT_ALIASES)) {
      const id = alias?.ids?.[0];
      if (!id) continue;
      const reagent = allReagents.find((r) => r.id === id);
      if (!reagent) continue;
      const unit = alias.unit || 'mM';
      const value = concInUnitFromVolumes(reagent, unit, vols);
      const adjustable = reagent.fixedNl == null && reagent.id !== WATER_ID;
      out[paperName] = {
        reagentId: id,
        unit,
        value,
        label: value == null ? '—' : `${fmtConc(value)} ${unit}`,
        adjustable,
        canInc: adjustable && waterNl >= STEP_NL,
        canDec: adjustable && (Number(vols[id]) || 0) >= STEP_NL
      };
    }
    return out;
  }

  // A benchmark formulation expressed as { paperName: concentration } after the
  // same concentration → grid-snapped nL volumes → concentration round-trip the
  // live Custom Mix goes through. BenchmarksTable's closest-match scores the live
  // design against these (not the pristine paper numbers) so a freshly loaded
  // formulation matches itself at 100% instead of losing points to grid snapping.
  function formulationFingerprint(bm) {
    const volumes = volumesForFormulation(bm);
    return volumes ? componentsForVolumes(volumes) : (bm?.components ?? {});
  }

  // Community submissions from the DB, shaped like BENCHMARK_FORMULATIONS entries
  // so BenchmarksTable can drop them into a comparison column. Yield/cost are
  // unknown for a user submission, so those cells read "—".
  let communityFormulations = $derived.by(() => {
    const designs = data?.communityDesigns ?? [];
    return designs.map((d) => ({
      key: `community-${d.id}`,
      id: d.id,
      name: d.name,
      year: d.created ? new Date(d.created).getFullYear() : null,
      category: 'community',
      citation: d.author || 'community submission',
      components: componentsForVolumes(volumesFromReagentList(d.reagentList)),
      yield_g_l: null,
      cost_per_l: null,
      cost_per_g: null,
      // Author's rationale + credits, carried through so BenchmarksTable can show
      // the same details as "My Compositions" when this column is loaded.
      author: d.author || null,
      proteinTarget: d.proteinTarget || null,
      created: d.created || null,
      rationale: d.comments || '',
      acknowledgements: d.acknowledgements || '',
      aiModel: d.aiModel || '',
      // Group-level hypothesis (batch submissions only); carried so loading a batch
      // can repopulate the overall-hypothesis field and the JSON box.
      experimentHypothesis: d.experimentHypothesis || '',
      // Batch grouping — set when this submission was part of a batch (see
      // confirmSubmitDesign). The community rail collapses same-batch columns into
      // one card and loads them all together.
      batchId: d.batchId || null,
      batchSize: d.batchSize || null,
      batchIndex: d.batchIndex || null
    }));
  });

  // Has a non-selected mix's stored volume map diverged from its starting recipe?
  // (Water absorbs snap-rounding, so it's excluded — mirrors customIsCustomized.)
  function isMixCustomized(m) {
    const start = volumesForFormulation(findFormulation(m.startKey));
    if (!start || !m.volumes) return false;
    for (const reagent of allReagents) {
      if (reagent.id === WATER_ID) continue;
      if ((Number(start[reagent.id]) || 0) !== (Number(m.volumes[reagent.id]) || 0)) return true;
    }
    return false;
  }

  // Every mix resolved to its current truth: the SELECTED mix reads from the live
  // editing buffer (volumesNl / proteinTarget / customStartKey); the others read
  // their stored snapshots. Order matches `mixes` (creation order) so columns stay
  // put. `selected`/`isCustomized` are convenience flags for the render.
  let resolvedMixes = $derived(
    mixes.map((m) =>
      m.id === selectedMixId
        ? { ...m, volumes: volumesNl, proteinTarget, startKey: customStartKey, selected: true, isCustomized: customIsCustomized }
        : { ...m, selected: false, isCustomized: isMixCustomized(m) }
    )
  );

  // ── mix columns → comparison-table columns ────────────────────────────────
  // Each mix rendered as a BENCHMARK_FORMULATIONS-shaped column (plus a `selected`
  // flag) so BenchmarksTable can render them all as one frozen experimental group.
  // The selected column is editable in place (steppers); the rest are read-only.
  // Concentrations come from the same volumes→components pipeline the community
  // columns use; cost is derived from the volume map so the $/mL · $/20µL rows read live.
  let mixColumns = $derived(
    resolvedMixes.map((m) => {
      const vols = m.volumes || {};
      const costUsd = costUsdForVolumes(vols);
      return {
        id: m.id,
        key: m.id,
        n: m.n,
        name: mixLabel(m.n),
        label: mixLabel(m.n),
        selected: m.selected,
        startKey: m.startKey,
        isCustomized: m.isCustomized,
        year: null,
        category: 'mix',
        citation: 'mix',
        components: componentsForVolumes(vols),
        // Live stepper state for THIS mix's own volumes (selected or not) so every
        // column's +/- is clickable; the selected column still reads customMixByPaper.
        stepper: stepperMapForVolumes(vols),
        yield_g_l: null,
        // cost_per_l back-solved so the table's /1000 ($/mL) and /50000 ($/20µL)
        // divisions land on the live reaction cost (20 µL reaction ⇒ ×50,000).
        cost_per_l: costUsd > 0 ? costUsd * 50000 : null,
        cost_per_g: null,
        proteinTarget: m.proteinTarget || null
      };
    })
  );

  // Raw direct-reagent cost ($) of a 20 µL reaction for an arbitrary volume map,
  // mirroring totalCostUsd (direct + apportioned base-buffer share) so a saved
  // column's cost matches what the live editor would show for the same mix.
  function costUsdForVolumes(volumes) {
    return visibleReagents.reduce(
      (sum, r) =>
        sum +
        (effectiveVolumeNlForReagentFromVolumes(r.id, volumes) / 1_000_000) *
          Number(r.costPerMl || 0),
      0
    );
  }

  // reagent_list ({ pydantic_field: nL }) for an arbitrary volume map + target —
  // the export contract generalized off buildReagentListForExport so saved mixes
  // serialize (clipboard copy) and submit (batch) exactly like the live mix.
  function buildReagentListFromVolumes(volumes, target) {
    const list = {};
    const add = (key, nl) => { if (key) list[key] = (list[key] || 0) + nl; };
    for (const reagent of allReagents) {
      if (reagent.id === WATER_ID) continue;
      const vol = toStepNl(Number(volumes?.[reagent.id]) || 0);
      if (vol <= 0) continue;
      const key = REAGENT_ID_TO_PYDANTIC[reagent.id] || reagent.id;
      if (!PYDANTIC_REAGENT_FIELDS.has(key)) continue;
      add(key, vol);
    }
    list.base_buffer = 2000;
    list.lysate = 5000;
    for (const t of TEMPLATE_FIELDS) delete list[t];
    list[templateFieldForTarget(PROTEIN_TARGETS.includes(target) ? target : proteinTarget)] = 2000;
    const subtotal = Object.values(list).reduce((sum, v) => sum + v, 0);
    const water = toStepNl(Math.max(0, MAX_TOTAL_NL - subtotal));
    if (water > 0) list.nuclease_free_water = water;
    return Object.fromEntries(Object.keys(list).sort().map((k) => [k, list[k]]));
  }

  let mixActionMessage = $state('');
  let mixActionError = $state('');

  // Normalize an incoming id: '__live__' (legacy sentinel) or null → the selected mix.
  function resolveMixId(id) {
    return id == null || id === '__live__' ? selectedMixId : id;
  }

  // Flush the live editing buffer into the selected mix's slot so `mixes` is the
  // source of truth before we read or mutate it (select / add / submit).
  function commitSelectedMix() {
    mixes = mixes.map((m) =>
      m.id === selectedMixId
        ? { ...m, volumes: { ...volumesNl }, proteinTarget, startKey: customStartKey }
        : m
    );
  }

  // ＋: append a new Mix column that starts as a copy of a source mix (the mix whose
  // ＋ was pressed, or the selected mix from the rail). Columns never reorder and the
  // selection doesn't change — the new peer simply lands at the right of the batch.
  function addMix(sourceId) {
    commitSelectedMix();
    const src = mixes.find((m) => m.id === resolveMixId(sourceId)) ?? mixes.find((m) => m.id === selectedMixId);
    if (!src) return;
    const next = renumberMixes([
      ...mixes,
      { id: `mix-${randomToken()}`, n: 0, volumes: { ...(src.volumes || volumesNl) }, proteinTarget: src.proteinTarget, startKey: src.startKey }
    ]);
    mixes = next;
    mixActionError = '';
    mixActionMessage = `Added ${mixLabel(next[next.length - 1].n)}.`;
  }

  // Select (= make editable) a mix IN PLACE. The current live buffer is committed
  // back into its slot first so no edits are lost, then the newly-selected mix is
  // loaded into the buffer. No column moves — selection is purely which one is editable.
  function selectMix(id) {
    const realId = resolveMixId(id);
    if (realId === selectedMixId) return;
    const m = mixes.find((x) => x.id === realId);
    if (!m) return;
    commitSelectedMix();
    selectedMixId = realId;
    volumesNl = { ...(m.volumes || {}) };
    if (PROTEIN_TARGETS.includes(m.proteinTarget)) proteinTarget = m.proteinTarget;
    if (m.startKey) customStartKey = m.startKey;
    mixActionError = '';
    // No "Editing Mix N" status line — selecting a mix is now a quiet in-place action
    // (the accent ring already marks which column is editable).
    mixActionMessage = '';
  }

  // Remove a mix. The last remaining mix can't be removed (there's always one).
  // Removing a non-selected mix just drops it, in place; removing the selected mix
  // drops it and loads the lowest-numbered survivor into the editor.
  function removeMix(id) {
    const realId = resolveMixId(id);
    if (mixes.length <= 1) return; // never remove the last mix
    const remaining = renumberMixes(mixes.filter((m) => m.id !== realId));
    if (!remaining.length) return;
    if (realId === selectedMixId) {
      const next = remaining[0]; // lowest-numbered survivor (= first column)
      mixes = remaining;
      selectedMixId = next.id;
      volumesNl = { ...(next.volumes || {}) };
      if (PROTEIN_TARGETS.includes(next.proteinTarget)) proteinTarget = next.proteinTarget;
      if (next.startKey) customStartKey = next.startKey;
    } else {
      mixes = remaining;
    }
  }

  // ↺: reset a mix to its starting composition. For the selected mix this clears the
  // live +/- tweaks (resetCustomMix); for a non-selected mix it re-seeds its stored
  // volume map from its recipe, in place.
  function resetMix(id) {
    const realId = resolveMixId(id);
    if (realId === selectedMixId) { resetCustomMix(); return; }
    const m = mixes.find((x) => x.id === realId);
    if (!m) return;
    const vols = volumesForFormulation(findFormulation(m.startKey));
    if (vols) mixes = mixes.map((x) => (x.id === realId ? { ...x, volumes: { ...vols } } : x));
  }

  // Set a mix's protein target from its header dropdown (selected or a peer).
  function setMixTarget(id, target) {
    if (!PROTEIN_TARGETS.includes(target)) return;
    const realId = resolveMixId(id);
    if (realId === selectedMixId) { proteinTarget = target; return; }
    mixes = mixes.map((m) => (m.id === realId ? { ...m, proteinTarget: target } : m));
  }

  // +/- handler passed to BenchmarksTable's Custom Mix column. `dir` is +1/-1;
  // one Echo step (STEP_NL) per press, resolving the reagent by id.
  function comparisonAdjust(reagentId, dir) {
    const reagent = allReagents.find((r) => r.id === reagentId);
    if (reagent) adjustVolumeNl(reagent, dir * STEP_NL);
  }

  // Reset button on the Custom Mix column — clears +/- tweaks and any edits,
  // restoring the currently-selected starting composition (the recipe named in
  // the Custom Mix dropdown).
  function resetCustomMix() {
    setCustomStart(customStartKey);
  }

  // ── plate-reader ranked sample → Comparison column ────────────────────────
  // A composition picked in the plate-reader modal's ranked-titers chart is
  // rendered as the Comparison Mix column (view-only reference the live Custom
  // Mix is diffed against). Its recipe (pydantic field → nL) is run through the
  // same volumes→components pipeline the community columns use, so it reads in
  // the table's paper units. Null = no plate sample loaded (dropdown-driven).
  let platedComparison = $state(null);
  function loadCompositionIntoComparison(comp) {
    if (!comp?.recipe) {
      platedComparison = null;
      return;
    }
    const volumes = volumesFromReagentList(comp.recipe);
    const wellNote = comp.wellNames?.length ? ` · wells ${comp.wellNames.join(', ')}` : '';
    platedComparison = {
      key: `plate-${comp.label}`,
      name: comp.label,
      year: null,
      category: 'plate-sample',
      citation: `plate sample${wellNote}`,
      components: componentsForVolumes(volumes),
      yield_g_l: null,
      cost_per_l: null,
      cost_per_g: null
    };
  }

  function formatConcentration(nmValue) {
    if (nmValue == null) return 'n/a';
    if (nmValue >= 1_000_000) return `${(nmValue / 1_000_000).toFixed(2)} mM`;
    if (nmValue >= 1_000) return `${(nmValue / 1_000).toFixed(2)} uM`;
    return `${nmValue.toFixed(1)} nM`;
  }

  function concentrationLabelAndRankForReagent(reagent) {
    if (reagent.id === WATER_ID) {
      const volumeNl = Number(volumesNl[reagent.id]) || 0;
      return {
        label: `${formatUl(volumeNl)}`,
        rankValue: -1
      };
    }

    const targetGramsPerLiter = activeProfile()?.targetGramsPerLiter || {};
    if (targetGramsPerLiter[reagent.id] != null) {
      const finalGL = finalGramsPerLiterForReagent(reagent);
      if (finalGL != null) {
        return {
          label: `${finalGL.toFixed(3)} g/L`,
          rankValue: finalGL
        };
      }
    }

    const targetUnitsPerMl = activeProfile()?.targetUnitsPerMl || {};
    if (targetUnitsPerMl[reagent.id] != null) {
      const finalUml = finalUnitsPerMlForReagent(reagent);
      if (finalUml != null) {
        return {
          label: `${finalUml.toFixed(2)} U/mL`,
          rankValue: finalUml
        };
      }
    }

    const targetNgPerUl = activeProfile()?.targetNgPerUl || {};
    if (targetNgPerUl[reagent.id] != null) {
      const finalNgUl = finalNgPerUlForReagent(reagent);
      if (finalNgUl != null) {
        return {
          label: `${finalNgUl.toFixed(3)} ng/µL`,
          rankValue: finalNgUl
        };
      }
    }

    const finalNm = finalNmForReagent(reagent);
    if (finalNm != null) {
      return {
        label: formatConcentration(finalNm),
        rankValue: finalNm
      };
    }

    const finalGL = finalGramsPerLiterForReagent(reagent);
    if (finalGL != null) {
      return {
        label: `${finalGL.toFixed(3)} g/L`,
        rankValue: finalGL
      };
    }

    const finalPercent = finalVolumePercentForReagent(reagent);
    if (finalPercent != null) {
      return {
        label: `${finalPercent.toFixed(2)}% v/v`,
        rankValue: finalPercent
      };
    }

    return {
      label: 'n/a',
      rankValue: -1
    };
  }

  function displayName(reagent) {
    return reagent?.id === WATER_ID ? 'Water' : (reagent?.name ?? reagent?.id ?? '');
  }

  function waterVolumeNl() {
    return Number(volumesNl[WATER_ID]) || 0;
  }

  function maxReachableForReagent(reagentId) {
    if (reagentId === WATER_ID) return waterVolumeNl();
    const current = Number(volumesNl[reagentId]) || 0;
    return Math.min(MAX_TOTAL_NL, current + waterVolumeNl());
  }

  function blockedPercentForReagent(reagentId) {
    const availableMax = maxReachableForReagent(reagentId);
    const blocked = Math.max(0, MAX_TOTAL_NL - availableMax);
    return (blocked / MAX_TOTAL_NL) * 100;
  }

  function availablePercentForReagent(reagentId) {
    return 100 - blockedPercentForReagent(reagentId);
  }

  function isLockedAtCap(reagent) {
    if (reagent.fixedNl != null) return true;
    if (reagent.id === WATER_ID) return true;
    return false;
  }

  function canIncrease(reagent) {
    return reagent.fixedNl == null && reagent.id !== WATER_ID && waterVolumeNl() >= STEP_NL;
  }

  function canDecrease(reagent) {
    return reagent.fixedNl == null && reagent.id !== WATER_ID && (Number(volumesNl[reagent.id]) || 0) >= STEP_NL;
  }

  function setVolumeNl(reagent, rawValue) {
    if (reagent.fixedNl != null) return;
    if (reagent.id === WATER_ID) return;

    const candidate = Math.max(0, toStepNl(rawValue));
    const current = Number(volumesNl[reagent.id]) || 0;
    const clamped = Math.max(0, Math.min(candidate, current + waterVolumeNl()));
    const delta = clamped - current;

    volumesNl[reagent.id] = clamped;
    volumesNl[WATER_ID] = Math.max(0, (Number(volumesNl[WATER_ID]) || 0) - delta);
  }

  function adjustVolumeNl(reagent, deltaNl) {
    if (reagent.fixedNl != null) return;
    if (reagent.id === WATER_ID) return;
    const current = Number(volumesNl[reagent.id]) || 0;
    setVolumeNl(reagent, current + deltaNl);
  }

  function fillPercentForReagent(reagentId) {
    return Math.max(0, Math.min(100, ((Number(volumesNl[reagentId]) || 0) / MAX_TOTAL_NL) * 100));
  }

  function reagentCardStyle(reagentId) {
    const fill = fillPercentForReagent(reagentId);
    return `background: linear-gradient(90deg, oklch(var(--p) / 0.28) 0%, oklch(var(--p) / 0.28) ${fill}%, oklch(var(--s) / 0.34) ${fill}%, oklch(var(--s) / 0.34) 100%);`;
  }

  function beginReagentDrag(reagent, event) {
    if (isLockedAtCap(reagent)) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if (event.button !== 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    dragLeft = rect.left;
    dragWidth = Math.max(1, rect.width);
    draggingReagent = reagent;
    event.preventDefault();
    updateReagentDrag(event.clientX);
  }

  function updateReagentDrag(clientX) {
    if (!draggingReagent) return;
    const ratio = Math.max(0, Math.min(1, (clientX - dragLeft) / dragWidth));
    setVolumeNl(draggingReagent, ratio * MAX_TOTAL_NL);
  }

  function handlePointerMove(event) {
    if (!draggingReagent) return;
    updateReagentDrag(event.clientX);
  }

  function endReagentDrag() {
    draggingReagent = null;
  }

  async function copyCompositionJson() {
    copyMessage = '';
    copyError = '';
    try {
      await navigator.clipboard.writeText(supplementText);
      copyMessage = 'Copied JSON to clipboard.';
    } catch {
      copyError = 'Failed to copy JSON.';
    }
  }

  function concentrationRankText() {
    if (concentrationRankEntries.length === 0) {
      return 'No non-zero reagents in composition.';
    }
    return concentrationRankEntries
      .map((entry) => `${entry.rank}. ${entry.name} ${entry.label}`)
      .join('\n');
  }

  async function copyConcentrationRank() {
    copyMessage = '';
    copyError = '';
    try {
      await navigator.clipboard.writeText(concentrationRankText());
      copyMessage = 'Copied concentration rank to clipboard.';
    } catch {
      copyError = 'Failed to copy concentration rank.';
    }
  }

  function costRankText() {
    if (costRankEntries.length === 0) {
      return 'No non-zero reagents in composition.';
    }
    return costRankEntries
      .map((entry) => `${entry.rank}. ${entry.name} ${entry.costLabel} (${entry.volumeLabel})`)
      .join('\n');
  }

  async function copyCostRank() {
    copyMessage = '';
    copyError = '';
    try {
      await navigator.clipboard.writeText(costRankText());
      copyMessage = 'Copied cost rank to clipboard.';
    } catch {
      copyError = 'Failed to copy cost rank.';
    }
  }

  // Concentration label + rank for a reagent in an ARBITRARY volume map — the
  // volumes-parametrized twin of concentrationLabelAndRankForReagent, so the rank
  // panel can show any mix's formulation (not just the live/selected one).
  function concentrationLabelAndRankForReagentFromVolumes(reagent, volumes) {
    if (reagent.id === WATER_ID) {
      const volumeNl = Number(volumes?.[reagent.id]) || 0;
      return { label: `${formatUl(volumeNl)}`, rankValue: -1 };
    }
    const targetGramsPerLiter = activeProfile()?.targetGramsPerLiter || {};
    if (targetGramsPerLiter[reagent.id] != null) {
      const finalGL = finalGramsPerLiterForReagentFromVolumes(reagent, volumes);
      if (finalGL != null) return { label: `${finalGL.toFixed(3)} g/L`, rankValue: finalGL };
    }
    const targetUnitsPerMl = activeProfile()?.targetUnitsPerMl || {};
    if (targetUnitsPerMl[reagent.id] != null) {
      const finalUml = finalUnitsPerMlForReagentFromVolumes(reagent, volumes);
      if (finalUml != null) return { label: `${finalUml.toFixed(2)} U/mL`, rankValue: finalUml };
    }
    const targetNgPerUl = activeProfile()?.targetNgPerUl || {};
    if (targetNgPerUl[reagent.id] != null) {
      const finalNgUl = finalNgPerUlForReagentFromVolumes(reagent, volumes);
      if (finalNgUl != null) return { label: `${finalNgUl.toFixed(3)} ng/µL`, rankValue: finalNgUl };
    }
    const finalNm = finalNmForReagentFromVolumes(reagent, volumes);
    if (finalNm != null) return { label: formatConcentration(finalNm), rankValue: finalNm };
    const finalGL = finalGramsPerLiterForReagentFromVolumes(reagent, volumes);
    if (finalGL != null) return { label: `${finalGL.toFixed(3)} g/L`, rankValue: finalGL };
    const finalPercent = finalVolumePercentForReagentFromVolumes(reagent, volumes);
    if (finalPercent != null) return { label: `${finalPercent.toFixed(2)}% v/v`, rankValue: finalPercent };
    return { label: 'n/a', rankValue: -1 };
  }

  function buildConcentrationRankEntriesForVolumes(volumes) {
    return visibleReagents
      .filter((reagent) => {
        const volumeNl = effectiveVolumeNlForReagentFromVolumes(reagent.id, volumes);
        return volumeNl > 0 && !excludedFromExportIds.has(reagent.id);
      })
      .map((reagent) => {
        const { label, rankValue } = concentrationLabelAndRankForReagentFromVolumes(reagent, volumes);
        return {
          name: reagent.id === WATER_ID ? 'Water' : reagent.name,
          label,
          rankValue
        };
      })
      .sort((a, b) => b.rankValue - a.rankValue)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  // sample_id must be a plain token; benchmark labels ("Kwon (2015)") are
  // sanitized to snake_case, defaulting to the Ginkgo design id.
  function sanitizeSampleId(label) {
    const base = String(label || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return base || 'cfps_design';
  }

  // Build a reagent_list validating against autonomous-cfps CFPSReagentList:
  // { reagent_field: volume_nl } using only recognized keys, all snapped to
  // 25 nL, base_buffer=2000, lysate=5000, exactly one template=2000, balanced
  // to 20 µL with nuclease-free water. Keys are alphabetized like the reference
  // recipes in autonomous-cfps/data/reference_set.
  function buildReagentListForExport() {
    const list = {};
    const add = (key, nl) => { if (key) list[key] = (list[key] || 0) + nl; };
    for (const reagent of allReagents) {
      if (reagent.id === WATER_ID) continue; // water is the balance, added last
      const vol = toStepNl(Number(volumesNl[reagent.id]) || 0);
      if (vol <= 0) continue;
      const key = REAGENT_ID_TO_PYDANTIC[reagent.id] || reagent.id;
      if (!PYDANTIC_REAGENT_FIELDS.has(key)) continue; // drop unrecognized reagents
      add(key, vol);
    }
    // Fixed volumes locked by the model's non-zero defaults / template rule.
    list.base_buffer = 2000;
    list.lysate = 5000;
    // Exactly one DNA template at 2000 nL — the one matching protein_target.
    for (const t of TEMPLATE_FIELDS) delete list[t];
    list[templateFieldForTarget(proteinTarget)] = 2000;
    // Balance to exactly 20 µL with nuclease-free water.
    const subtotal = Object.values(list).reduce((sum, v) => sum + v, 0);
    const water = toStepNl(Math.max(0, MAX_TOTAL_NL - subtotal));
    if (water > 0) list.nuclease_free_water = water;
    return Object.fromEntries(Object.keys(list).sort().map((k) => [k, list[k]]));
  }

  // A short random suffix that makes every submission's sample_id unique, so two
  // designs from the same author on the same day never collide (the server also
  // rejects duplicate sample_ids). Regenerated after each successful submission so
  // the next one mints a fresh id.
  function randomToken() {
    const buf =
      typeof crypto !== 'undefined' && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0]
        : Math.floor(Math.random() * 0xffffffff);
    return (buf >>> 0).toString(36).padStart(6, '0').slice(-6);
  }
  let sampleIdToken = $state(randomToken());

  // sample_id is an empty string by default; once the user is signed in via
  // Keycloak it's named after them, today's date, and a unique token so every
  // submission is attributable AND unique (e.g. "ada_lovelace_2026-09-26_k3f9zq").
  function computeSampleId() {
    const name = data?.kcUser?.name;
    if (!name) return '';
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${sanitizeSampleId(name)}_${date}_${sampleIdToken}`;
  }

  // ── composition metadata (Sample.metadata in autonomous-cfps) ────────────
  // Sample.metadata is an open `dict[str, Any] | None` on the pydantic side. We mirror
  // the designer's persistent metadata state here so the JSON box always shows the
  // complete, submittable payload — ai_model / acknowledgements / the per-mix comment.
  // Editing the box (or the matching modal fields) round-trips back into this state.
  function buildMetadata() {
    return {
      ai_model: designAiModel,                    // e.g. "claude-opus-4-8"
      protein_target: proteinTarget,              // sfGFP | PETase | Reteplase
      acknowledgements: designAcknowledgements,   // collaborators to credit
      comments: mixComments[selectedMixId] || ''  // this composition's rationale
    };
  }

  function buildExportedSample() {
    return {
      sample_id: computeSampleId(),
      sample_type: 'experimental',
      reagent_list: buildReagentListForExport(),
      metadata: buildMetadata()
    };
  }

  // ── batch submission preview ──────────────────────────────────────────────
  // When more than one mix is designed, a submit writes one cfps_designs record per
  // mix. This is the exact array of Sample dicts that goes to the database, with the
  // live per-composition metadata folded in. The group-level `experiment_hypothesis`
  // is NOT repeated here — it belongs to the batch, so it's hoisted to the wrapper
  // document below (batchSubmissionDoc) instead of every composition dict.
  let batchSubmission = $derived(
    [...resolvedMixes]
      .sort((a, b) => a.n - b.n)
      .map((m) => {
        const target = PROTEIN_TARGETS.includes(m.proteinTarget) ? m.proteinTarget : proteinTarget;
        return {
          sample_id: computeSampleId(),
          sample_type: 'experimental',
          reagent_list: buildReagentListFromVolumes(m.volumes || {}, target),
          metadata: {
            ai_model: designAiModel,
            protein_target: target,
            acknowledgements: designAcknowledgements,
            comments: mixComments[m.id] || ''
          }
        };
      })
  );
  // The batch document shown in the reagent supplement JSON panel: one group-level
  // `experiment_hypothesis` for the whole batch, then the per-composition samples. A
  // user can paste this whole thing back and submit it — applySupplementEdits reads
  // the hypothesis from the top level and the compositions from `samples`.
  let batchSubmissionDoc = $derived({ experiment_hypothesis: experimentHypothesis, samples: batchSubmission });
  let batchSubmissionJson = $derived(JSON.stringify(batchSubmissionDoc, null, 2));

  // Validate every sample in a batch against the same CFPSReagentList contract the
  // single composition uses; errors are prefixed with the mix number.
  function validateBatchSubmission(samples) {
    const errors = [];
    samples.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        errors.push(`Mix ${i + 1}: each entry must be a JSON object.`);
        return;
      }
      if (s.sample_type !== 'experimental') errors.push(`Mix ${i + 1}: sample_type must be "experimental".`);
      for (const e of validateReagentList(s.reagent_list).errors) errors.push(`Mix ${i + 1}: ${e}`);
    });
    return { valid: errors.length === 0, errors };
  }

  // Pull the samples array out of whatever the batch box holds: the wrapper document
  // ({ experiment_hypothesis, samples: [...] }) we generate, or — for back-compat and
  // lenient pasting — a bare array of samples. Returns null if neither shape is found.
  function batchSamplesOf(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.samples)) return parsed.samples;
    return null;
  }

  // Parse + validate the batch supplement text. The box holds a batch document with a
  // `samples` array (a bare array is also accepted); it must parse, carry a non-empty
  // samples list, and every sample must satisfy validateBatchSubmission.
  function validateBatchSubmissionJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { valid: false, errors: ['Invalid JSON syntax.'] };
    }
    const samples = batchSamplesOf(parsed);
    if (!samples) {
      return { valid: false, errors: ['Expected a batch object with a "samples" array (or an array of samples).'] };
    }
    if (samples.length === 0) {
      return { valid: false, errors: ['At least one sample is required.'] };
    }
    return validateBatchSubmission(samples);
  }

  // ── editable supplement JSON ────────────────────────────────────────────
  // The JSON box is directly editable. `jsonDraft` holds the user's in-progress
  // text (or null when the box mirrors the auto-generated export). While typing,
  // edits only update the draft — they never touch the model, so the caret and
  // partial text are left undisturbed. On blur (`onchange`) a parseable draft is
  // committed back to the live design via applySupplementEdits(): the edited
  // reagent volumes flow into `volumesNl`, nuclease_free_water re-balances to
  // 20 µL automatically, and the concentration rank (derived from volumesNl)
  // updates in the same tick. Committing changes `exportedCompositionJson`, which
  // trips this effect and resets the draft so the box re-renders as canonical JSON
  // (corrected water and all). The effect also keeps the box in sync whenever a
  // slider/preset alters the model directly.
  let jsonDraft = $state(null);
  $effect(() => {
    exportedCompositionJson;   // dependency: regenerate box whenever the model changes
    batchSubmissionJson;       // …and whenever the batch payload changes
    jsonDraft = null;
  });
  // Single mix → the editable composition JSON (one Sample object). Batch (>1 mix) →
  // the editable array of Sample dicts headed to the database (one per mix, in
  // mix-number order). Both are hand-editable; edits commit on blur via
  // applySupplementEdits() back onto the matching mix.
  let supplementText = $derived(
    jsonDraft ?? (batchMixCount > 1 ? batchSubmissionJson : exportedCompositionJson)
  );
  let supplementValidation = $derived(
    batchMixCount > 1 ? validateBatchSubmissionJson(supplementText) : validateSupplementJson(supplementText)
  );

  // Commit an edited JSON draft back into the live model. Pushing a draft's
  // reagent_list through volumesFromReagentList snaps every supplement to the
  // 25 nL Echo grid and, crucially, recomputes nuclease_free_water so the reaction
  // re-balances to exactly 20 µL — the user never hand-corrects the water backfill.
  // Because concentrationRankEntries derives from volumesNl, the rank refreshes
  // automatically. Called on blur so mid-edit keystrokes are never disrupted; if
  // the draft doesn't parse into the expected shape we leave it as-is so the
  // validation errors stay on screen for the user to fix.
  //
  // Single mix → the draft is one Sample object; its reagent_list flows into the
  // live buffer (volumesNl). Batch (>1 mix) → the draft is the array of Sample
  // dicts (one per mix, in mix-number order); each sample's reagent_list + protein
  // target is written back to the matching mix by position — the selected mix via
  // the live buffer, the rest into their stored slots. Adding/removing array
  // entries doesn't change how many mixes exist (edit the columns for that); extra
  // or missing entries are ignored and the preview re-snaps to the real batch.
  function applySupplementEdits() {
    if (jsonDraft == null) return;
    let parsed;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      return;
    }

    if (batchMixCount > 1) {
      const samples = batchSamplesOf(parsed);
      if (!samples) return;
      // Map each sample position to a mix id using the same mix-number order the
      // preview is generated in, so edits land on the column they're shown under.
      const order = [...mixes].sort((a, b) => a.n - b.n).map((m) => m.id);
      const n = Math.min(samples.length, order.length);
      let nextMixes = mixes;
      const nextComments = { ...mixComments };
      for (let i = 0; i < n; i++) {
        const sample = samples[i];
        const rl = sample?.reagent_list;
        if (!rl || typeof rl !== 'object' || Array.isArray(rl)) continue;
        const vols = volumesFromReagentList(rl);
        const md = sample?.metadata && typeof sample.metadata === 'object' ? sample.metadata : {};
        const tgt = md.protein_target;
        const target = PROTEIN_TARGETS.includes(tgt) ? tgt : null;
        const id = order[i];
        // Per-mix rationale rides in metadata.comments; round-trip it onto the mix.
        if (typeof md.comments === 'string') nextComments[id] = md.comments;
        if (id === selectedMixId) {
          volumesNl = vols;
          if (target) proteinTarget = target;
        } else {
          nextMixes = nextMixes.map((m) =>
            m.id === id ? { ...m, volumes: vols, ...(target ? { proteinTarget: target } : {}) } : m
          );
        }
      }
      if (nextMixes !== mixes) mixes = nextMixes;
      mixComments = nextComments;
      // The group-level hypothesis lives at the top of the wrapper document. For a
      // pasted bare array (no wrapper) fall back to the first sample's metadata so an
      // older-shaped paste still seeds it. ai_model / acknowledgements are shared, so
      // read them from the first sample's metadata either way.
      const topHyp = (!Array.isArray(parsed) && parsed && typeof parsed === 'object')
        ? parsed.experiment_hypothesis
        : samples[0]?.metadata?.experiment_hypothesis;
      if (typeof topHyp === 'string') experimentHypothesis = topHyp;
      const head = samples[0]?.metadata && typeof samples[0].metadata === 'object' ? samples[0].metadata : {};
      if (typeof head.ai_model === 'string') designAiModel = head.ai_model;
      if (typeof head.acknowledgements === 'string') designAcknowledgements = head.acknowledgements;
      return;
    }

    const rl = parsed?.reagent_list;
    if (!rl || typeof rl !== 'object' || Array.isArray(rl)) return;
    volumesNl = volumesFromReagentList(rl);
    // Round-trip single-composition metadata so a pasted Sample seeds its rationale
    // and attribution too (the group hypothesis has no meaning for a lone sample).
    const md = parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {};
    if (typeof md.comments === 'string') mixComments = { ...mixComments, [selectedMixId]: md.comments };
    if (typeof md.ai_model === 'string') designAiModel = md.ai_model;
    if (typeof md.acknowledgements === 'string') designAcknowledgements = md.acknowledgements;
  }

  // Validity mirrors the autonomous-cfps CFPSReagentList contract: parseable JSON,
  // sample_type "experimental", then the shared reagent_list contract (recognized
  // fields, non-negative 25 nL-grid volumes, base_buffer=2000, lysate=5000, exactly
  // one DNA template at 2000 nL, total EXACTLY 20,000 nL). The reagent_list rules
  // live in $lib/cfpsReagentContract.js so the browser and the server-side submit
  // gate validate identically.
  function validateSupplementJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { valid: false, errors: ['Invalid JSON syntax.'] };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, errors: ['Top-level value must be a JSON object.'] };
    }
    const errors = [];
    if (parsed.sample_type !== 'experimental') {
      errors.push('sample_type must be "experimental".');
    }
    errors.push(...validateReagentList(parsed.reagent_list).errors);
    return { valid: errors.length === 0, errors };
  }

  // ── reagent prompt (task hand-off for an LLM) ───────────────────────────
  // A ready-to-paste prompt: the full reagent palette with stock concentrations,
  // the 20 µL / 25 nL rules, and the exact JSON format that must be returned.
  const reagentPromptExampleJson = JSON.stringify(
    {
      sample_id: '',
      sample_type: 'experimental',
      reagent_list: {
        base_buffer: 2000,
        lysate: 5000,
        template_sfgfp: 2000,
        potassium_glutamate: 1200,
        magnesium_glutamate: 300,
        hepes_koh: 1000,
        nuclease_free_water: 8500
      }
    },
    null,
    2
  );

  function reagentPromptText() {
    const lines = [
      'You are designing a cell-free protein synthesis (CFPS) reagent reaction composition for one of three proteins: sfGFP, PETase, or Reteplase',
      '',
      'Constraints:',
      '- The reaction is a single 20 µL (20,000 nL) well.',
      '- Every reagent volume is in nL and MUST be a whole multiple of 25 nL.',
      '- base_buffer must be 2000 nL; lysate must be 5000 nL.',
      '- Include exactly one DNA template at 2000 nL (template_sfgfp, template_petase, or template_reteplase).',
      '- Balance the remaining volume up to 20,000 nL with nuclease_free_water.',
      '- sample_type must be "experimental".',
      '',
      'Available reagents (name — stock concentration):'
    ];
    for (const r of visibleReagents) {
      if (r.id === WATER_ID) continue;
      lines.push(`- ${r.name} — ${r.concentration}`);
    }
    lines.push('');
    lines.push('Return ONLY a JSON object in EXACTLY this format — this is the required response format:');
    lines.push(reagentPromptExampleJson);
    return lines.join('\n');
  }

  // Dedicated feedback for the reagent-prompt panel so the "Copied…" confirmation
  // shows under the prompt itself — not under the supplement-JSON box (which read
  // as if the JSON had been copied).
  let promptCopyMessage = $state('');
  let promptCopyError = $state('');
  async function copyReagentPrompt() {
    promptCopyMessage = '';
    promptCopyError = '';
    try {
      // Always copy the FULL prompt, even if the typewriter reveal is still running.
      await navigator.clipboard.writeText(resolvedReagentPrompt());
      promptCopyMessage = 'Copied reagent prompt to clipboard.';
    } catch {
      promptCopyError = 'Failed to copy reagent prompt.';
    }
  }

  // ── submit composition to PocketBase (cfps_designs) ─────────────────────
  // "Submit composition" opens a confirm modal so the author can review/change the
  // sample_id and metadata (ai_model, acknowledgements, comments) before the write.
  // The reagent_list comes straight from the (validated) supplement JSON box.
  let showSubmitModal = $state(false);
  // The review modal is shared by two flows: 'create' (Submit → new records) and
  // 'update' (Update existing → overwrite the user's own loaded records in place,
  // creating any brand-new columns alongside them). See confirmUpdateDesign.
  let submitMode = $state('create');
  let submitBusy = $state(false);
  let submitError = $state('');
  let submitMessage = $state('');
  let submitSampleId = $state('');
  // ── composition metadata, owned by the DESIGNER (not the submit modal) ───────
  // These back the metadata block shown in the reagent supplement JSON box, so the
  // JSON on screen is the complete, submittable payload. The submit modal's fields
  // bind the SAME state, and the submit/update flow reads straight from here — so a
  // user can paste a full JSON (reagent_list + metadata) into the box and hit submit
  // and it just works, even if the metadata carries extra keys the pydantic model
  // doesn't require (metadata is a free-form dict; validation ignores it).
  let designAiModel = $state('');            // shared across a batch
  let designAcknowledgements = $state('');   // shared across a batch
  // Per-mix rationale: a map of mix id → note (1:1 with the Mix columns). REQUIRED
  // for every mix before submit/update.
  let mixComments = $state({});
  // Batch-only: one overarching hypothesis for the whole GROUP of conditions, stamped
  // identically onto every member's metadata.experiment_hypothesis. A lone composition
  // has no "group", so it's hidden and not required there (and omitted from its JSON).
  let experimentHypothesis = $state('');
  let submitHypothesisMissing = $derived.by(() => {
    if (batchMixCount === 1) return !(mixComments[mixes[0]?.id] || '').trim();
    if (!experimentHypothesis.trim()) return true;
    return submitMixList.some((m) => !(mixComments[m.id] || '').trim());
  });

  const PROTEIN_TARGETS = ['sfGFP', 'PETase', 'Reteplase'];

  // Character limits (~6 chars/word): ~50 words for the short single-line fields,
  // ~250 words for the free-form comments.
  const LIMIT_SHORT = 300;    // sample_id · ai_model · acknowledgements
  const LIMIT_COMMENTS = 1500; // free-form comments

  // One submit flow for any number of mixes: review the shared metadata, then write
  // the active mix + every saved mix in one pass. Each mix carries its own protein
  // target (set on its column), so there's no target picker here. When there's a
  // single mix the sample_id is editable; for a batch, IDs are auto-generated.
  function openSubmitModal() {
    submitError = '';
    submitMessage = '';
    mixActionMessage = '';
    mixActionError = '';
    if (!data?.kcUser) { submitError = 'Sign in to submit a composition.'; return; }
    // Metadata (ai_model / acknowledgements / per-mix comments / experiment_hypothesis)
    // is persistent designer state bound by both the JSON box and the modal fields, so
    // there's nothing to reseed here — whatever's on screen is what submits. Only the
    // editable sample_id is pulled from the current (single-mode) supplement JSON.
    let parsed = null;
    try { parsed = JSON.parse(supplementText); } catch { parsed = null; }
    submitSampleId = String((parsed && !Array.isArray(parsed) && parsed.sample_id) || computeSampleId() || '').trim();
    submitMode = 'create';
    showSubmitModal = true;
  }

  function closeSubmitModal() {
    if (submitBusy) return;
    showSubmitModal = false;
    submitMode = 'create';
  }

  // Escape closes whichever popup modal is open (the submit/update dialog takes
  // priority over the recipe popover when both happen to be up). The submit modal
  // keeps its own guard so Escape can't dismiss it mid-submit.
  function handleGlobalKeydown(e) {
    if (e.key !== 'Escape') return;
    if (showSubmitModal) { closeSubmitModal(); return; }
    if (activeRecipe) { closeRecipe(); return; }
  }

  // Submit every mix (active + saved) to cfps_designs sequentially, reusing the
  // single-submit endpoint. Each mix is its own record with the shared metadata and
  // its own protein target. Sample IDs are auto-generated per mix, except a lone mix
  // uses the editable sample_id from the modal. Reports how many landed.
  async function confirmSubmitDesign() {
    submitError = '';
    submitMessage = '';
    if (!data?.kcUser) { submitError = 'Sign in to submit a composition.'; return; }
    if (!supplementValidation.valid) {
      submitError = 'The composition JSON is invalid — fix it before submitting.';
      return;
    }
    if (submitHypothesisMissing) {
      submitError = 'State the hypothesis being tested for every composition before submitting.';
      return;
    }
    const single = batchMixCount === 1;
    const explicitId = submitSampleId.trim();
    if (single && !explicitId) { submitError = 'sample_id is required.'; return; }

    commitSelectedMix(); // flush the live buffer into the selected mix before reading
    const mixesToSubmit = [...mixes]
      .sort((a, b) => a.n - b.n)
      .map((m) => ({ id: m.id, n: m.n, volumes: m.volumes, target: m.proteinTarget }));
    const ai_model = designAiModel.trim();
    const acknowledgements = designAcknowledgements.trim();
    const experimentHyp = experimentHypothesis.trim();

    // For a batch, every mix shares one freshly-minted token so their sample_ids
    // group together and auto-increment by Mix number (e.g. ada_2026-10-06_b2au5p_1,
    // _2, _3). A lone mix keeps the editable sample_id from the modal. The shared
    // base doubles as the batch_id grouping key stored in each sample's metadata.
    const batchSize = mixesToSubmit.length;
    let batchBase = '';
    let batchId = '';
    if (!single) {
      sampleIdToken = randomToken();
      batchBase = computeSampleId(); // e.g. ada_2026-10-06_b2au5p
      batchId = batchBase;           // stable grouping key for this whole batch
    }

    // Build every sample_id up front so we can guarantee the batch has no duplicate
    // IDs before sending anything (the server also rejects collisions, 409).
    const plannedIds = mixesToSubmit.map((mix) =>
      single ? explicitId : `${batchBase}_${mix.n}`
    );
    const dupes = plannedIds.filter((idv, i) => plannedIds.indexOf(idv) !== i);
    if (dupes.length) {
      submitError = `Duplicate sample IDs in this batch (${[...new Set(dupes)].join(', ')}). Each sample needs a unique ID.`;
      return;
    }

    submitBusy = true;
    let ok = 0;
    const failures = [];
    try {
      for (let i = 0; i < mixesToSubmit.length; i++) {
        const mix = mixesToSubmit[i];
        const target = PROTEIN_TARGETS.includes(mix.target) ? mix.target : proteinTarget;
        const comments = (mixComments[mix.id] || '').trim(); // this experiment's own note
        const sampleId = plannedIds[i];
        const metadata = { ai_model, protein_target: target, acknowledgements, comments };
        if (!single) {
          // Batch grouping: lets My Compositions and the community rail collapse these
          // sibling records into one batch card and load them all together.
          metadata.batch_id = batchId;
          metadata.batch_size = batchSize;
          metadata.batch_index = mix.n;
          // The group-level hypothesis belongs to the batch, not each composition, so
          // store it once — on the batch's first member (batch_index 1). Reads look it
          // up across the group, so any member can surface it.
          if (mix.n === 1) metadata.experiment_hypothesis = experimentHyp;
        }
        const sample = {
          sample_id: sampleId,
          sample_type: 'experimental',
          reagent_list: buildReagentListFromVolumes(mix.volumes, target),
          metadata
        };
        try {
          const res = await fetch('/cfps/submit-design', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sample,
              author: data?.kcUser?.name || '',
              totalCostUsd: costUsdForVolumes(mix.volumes),
              costPerMlReaction: costUsdForVolumes(mix.volumes) * 50
            })
          });
          const result = await res.json();
          if (!res.ok || !result.success) throw new Error(result.error || 'rejected');
          ok += 1;
        } catch (e) {
          failures.push(e?.message || 'failed');
        }
      }
      sampleIdToken = randomToken(); // mint a fresh id for the next design
      if (ok > 0) {
        submitMessage =
          failures.length === 0
            ? `Submitted ${ok} composition${ok === 1 ? '' : 's'}.`
            : `Submitted ${ok} of ${mixesToSubmit.length}; ${failures.length} failed.`;
        // The batch is submitted; collapse back to a single editor seeded with the
        // mix the user was on (renumbered Mix 1) so they can start the next batch.
        const keep = mixes.find((m) => m.id === selectedMixId) ?? mixes[0];
        mixes = [{ id: keep.id, n: 1, volumes: { ...volumesNl }, proteinTarget, startKey: customStartKey }];
        selectedMixId = keep.id;
        rankTabMixId = null;
        // Clear the per-design rationale so the next design starts blank (ai_model and
        // acknowledgements persist — they're usually the same across submissions).
        mixComments = {};
        experimentHypothesis = '';
        showSubmitModal = false;
        // Refresh so the new records appear in My Compositions, then drop the user
        // at that section so their just-submitted designs are in view.
        await invalidateAll();
        await tick();
        if (typeof document !== 'undefined') {
          document.querySelector('.cf-mydesigns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        submitError = single
          ? (failures[0] || 'Submission failed.')
          : `Submit failed — none of the ${mixesToSubmit.length} compositions saved.`;
      }
    } finally {
      submitBusy = false;
    }
  }

  // ── "Update existing" flow ──────────────────────────────────────────────────
  // Lets a user who loaded one of THEIR OWN saved compositions (or batch), then
  // tweaked it, save over the original instead of creating a fresh submission. A
  // mix "belongs to" the user when its startKey is `community-<id>` and <id> is one
  // of their own records (data.myDesigns, server-filtered by Keycloak author_sub).
  let myDesignIdSet = $derived(new Set((data?.myDesigns ?? []).map((d) => String(d.id))));
  let myDesignsById = $derived(
    new Map((data?.myDesigns ?? []).map((d) => [String(d.id), d]))
  );
  function ownedDesignIdFor(startKey) {
    const k = String(startKey || '');
    if (!k.startsWith('community-')) return null;
    const id = k.slice('community-'.length);
    return myDesignIdSet.has(id) ? id : null;
  }

  // The loaded columns resolved into an update plan. Each column either UPDATES one
  // of the user's records (the first column to claim a given record id — so a
  // duplicated column maps to a new record, never a second write to the same one) or
  // is CREATED as a new record. Order follows the columns left→right.
  let updatePlan = $derived.by(() => {
    const seen = new Set();
    const rows = resolvedMixes.map((m) => {
      const oid = ownedDesignIdFor(m.startKey);
      const claim = oid && !seen.has(oid);
      if (claim) seen.add(oid);
      return {
        id: m.id,
        n: m.n,
        volumes: m.volumes || {},
        proteinTarget: PROTEIN_TARGETS.includes(m.proteinTarget) ? m.proteinTarget : proteinTarget,
        recordId: claim ? oid : null,
        isCustomized: m.isCustomized
      };
    });
    return {
      rows,
      updates: rows.filter((r) => r.recordId),
      creates: rows.filter((r) => !r.recordId)
    };
  });

  // Show the "Update existing" button only once there's actually something to save:
  // at least one of the user's own compositions is loaded AND either one of those
  // columns has diverged from what's saved (volumes or protein target) or there are
  // brand-new columns to fold into the batch.
  let canUpdateExisting = $derived.by(() => {
    if (!data?.kcUser) return false;
    const { updates, creates } = updatePlan;
    if (!updates.length) return false;
    const ownedChanged = updates.some((u) => {
      if (u.isCustomized) return true;
      const saved = myDesignsById.get(u.recordId);
      return !!saved && PROTEIN_TARGETS.includes(u.proteinTarget) && saved.proteinTarget !== u.proteinTarget;
    });
    return ownedChanged || creates.length > 0;
  });

  // Button / modal copy for the update flow.
  let updateButtonLabel = $derived.by(() => {
    const u = updatePlan.updates.length;
    const c = updatePlan.creates.length;
    if (c > 0) return `Update · ${u} + ${c} new`;
    if (u > 1) return `Update batch · ${u}`;
    return 'Update composition';
  });

  // Open the shared review modal in update mode: seed shared metadata + per-mix
  // comments from the records being overwritten (new columns start blank).
  function openUpdateModal() {
    submitError = '';
    submitMessage = '';
    mixActionMessage = '';
    mixActionError = '';
    if (!data?.kcUser) { submitError = 'Sign in to update a composition.'; return; }
    commitSelectedMix();
    if (!canUpdateExisting) { submitError = 'Load one of your own compositions and edit it first.'; return; }
    const firstSaved = myDesignsById.get(updatePlan.updates[0]?.recordId);
    designAiModel = firstSaved?.aiModel ?? '';
    designAcknowledgements = firstSaved?.acknowledgements ?? '';
    const commentMap = { ...mixComments };
    for (const r of updatePlan.rows) {
      const saved = r.recordId ? myDesignsById.get(r.recordId) : null;
      commentMap[r.id] = saved?.comments ?? '';
    }
    mixComments = commentMap;
    // The whole batch shares one experiment hypothesis, stored on a single member —
    // seed from whichever owned record actually carries it.
    experimentHypothesis =
      updatePlan.updates
        .map((u) => myDesignsById.get(u.recordId))
        .find((s) => s?.experimentHypothesis)?.experimentHypothesis ?? '';
    submitMode = 'update';
    showSubmitModal = true;
  }

  // Overwrite the user's own loaded records in place and, per their choice, fold any
  // brand-new columns into the same batch. Updates go to /cfps/my-designs (op:update
  // with a full validated sample); new columns reuse /cfps/submit-design. Both are
  // ownership-checked server-side against the Keycloak subject.
  async function confirmUpdateDesign() {
    submitError = '';
    submitMessage = '';
    if (!data?.kcUser) { submitError = 'Sign in to update a composition.'; return; }
    if (!supplementValidation.valid) {
      submitError = 'The composition JSON is invalid — fix it before updating.';
      return;
    }
    if (submitHypothesisMissing) {
      submitError = 'State the hypothesis being tested for every composition before saving.';
      return;
    }
    commitSelectedMix();
    const plan = updatePlan;
    if (!plan.updates.length) { submitError = 'Nothing of yours is loaded to update.'; return; }

    const ai_model = designAiModel.trim();
    const acknowledgements = designAcknowledgements.trim();
    const experimentHyp = experimentHypothesis.trim();
    const total = plan.rows.length;
    const isBatch = total > 1;
    // The group hypothesis is stored once, on the batch's lead (leftmost) composition —
    // whichever row that is (an update or a new column). Every other record omits it,
    // so re-saving clears any stale copies off the non-lead members.
    const leadRowId = plan.rows[0]?.id;

    // Batch grouping key: reuse the records' existing batch when they all share one,
    // otherwise mint a fresh id so a single composition + new columns becomes a batch.
    const ownedBatchIds = [
      ...new Set(plan.updates.map((u) => myDesignsById.get(u.recordId)?.batchId).filter(Boolean))
    ];
    const batchBase = isBatch
      ? (ownedBatchIds.length === 1 ? ownedBatchIds[0] : computeSampleId())
      : null;

    // New sample_ids continue after the highest batch index already in use, deduped
    // against the user's existing titles so a create can never 409 on a collision.
    const existingTitles = new Set((data?.myDesigns ?? []).map((d) => String(d.name)));
    let nextIndex = 0;
    for (const u of plan.updates) {
      const idx = Number(myDesignsById.get(u.recordId)?.batchIndex) || 0;
      if (idx > nextIndex) nextIndex = idx;
    }

    submitBusy = true;
    let okU = 0, okC = 0;
    const failures = [];
    const createdByMix = new Map(); // mix id → new record id, to relink columns after
    try {
      // 1) Update owned records in place.
      let col = 0;
      for (const r of plan.rows) {
        col += 1;
        if (!r.recordId) continue;
        const saved = myDesignsById.get(r.recordId);
        const target = r.proteinTarget;
        const comments = (mixComments[r.id] || '').trim();
        const metadata = { ai_model, protein_target: target, acknowledgements, comments };
        if (isBatch) {
          metadata.batch_id = batchBase;
          metadata.batch_size = total; // only needs to read as >1; exactness isn't used
          metadata.batch_index = Number(saved?.batchIndex) || col;
          if (r.id === leadRowId) metadata.experiment_hypothesis = experimentHyp;
        }
        const sample = {
          sample_id: saved?.name || r.id, // keep the existing title (unique in the collection)
          sample_type: 'experimental',
          reagent_list: buildReagentListFromVolumes(r.volumes, target),
          metadata
        };
        try {
          const res = await fetch('/cfps/my-designs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              op: 'update',
              id: r.recordId,
              sample,
              totalCostUsd: costUsdForVolumes(r.volumes),
              costPerMlReaction: costUsdForVolumes(r.volumes) * 50
            })
          });
          const result = await res.json();
          if (!res.ok || !result.success) throw new Error(result.error || 'rejected');
          okU += 1;
        } catch (e) {
          failures.push(e?.message || 'update failed');
        }
      }

      // 2) Create brand-new columns, folded into the same batch.
      for (const r of plan.creates) {
        nextIndex += 1;
        const target = r.proteinTarget;
        const comments = (mixComments[r.id] || '').trim();
        let sid = isBatch ? `${batchBase}_${nextIndex}` : computeSampleId();
        while (existingTitles.has(sid)) sid = `${batchBase || 'mix'}_${nextIndex}_${randomToken()}`;
        existingTitles.add(sid);
        const metadata = { ai_model, protein_target: target, acknowledgements, comments };
        if (isBatch) {
          metadata.batch_id = batchBase;
          metadata.batch_size = total;
          metadata.batch_index = nextIndex;
          if (r.id === leadRowId) metadata.experiment_hypothesis = experimentHyp;
        }
        const sample = {
          sample_id: sid,
          sample_type: 'experimental',
          reagent_list: buildReagentListFromVolumes(r.volumes, target),
          metadata
        };
        try {
          const res = await fetch('/cfps/submit-design', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sample,
              author: data?.kcUser?.name || '',
              totalCostUsd: costUsdForVolumes(r.volumes),
              costPerMlReaction: costUsdForVolumes(r.volumes) * 50
            })
          });
          const result = await res.json();
          if (!res.ok || !result.success) throw new Error(result.error || 'rejected');
          if (result.id) createdByMix.set(r.id, result.id);
          okC += 1;
        } catch (e) {
          failures.push(e?.message || 'create failed');
        }
      }

      if (okU + okC > 0) {
        // Relink any just-created columns to their new records so they read as saved
        // (and a second Update targets them in place rather than creating again).
        if (createdByMix.size) {
          mixes = mixes.map((m) =>
            createdByMix.has(m.id) ? { ...m, startKey: `community-${createdByMix.get(m.id)}` } : m
          );
          if (createdByMix.has(selectedMixId)) customStartKey = `community-${createdByMix.get(selectedMixId)}`;
        }
        submitMessage =
          `Updated ${okU} composition${okU === 1 ? '' : 's'}` +
          (okC ? `, added ${okC} new` : '') +
          (failures.length ? `; ${failures.length} failed.` : '.');
        showSubmitModal = false;
        submitMode = 'create';
        await invalidateAll();
        await tick();
        if (typeof document !== 'undefined') {
          document.querySelector('.cf-mydesigns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        submitError = failures[0] || 'Update failed.';
      }
    } finally {
      submitBusy = false;
    }
  }

  // ── "My Compositions" manager ───────────────────────────────────────────────
  // The signed-in user's own submissions (data.myDesigns, matched by author name
  // server-side), grouped by target protein so they can be reviewed, renamed /
  // re-tagged, or deleted. Edits/deletes go to /cfps/my-designs (ownership-checked
  // there) and refresh via invalidateAll so the comparison dropdowns update too.
  // A local, drag-reorderable copy of the user's compositions. Sorted by
  // drag-priority rank (1 = highest) then recency; rank 0 = never dragged, treated
  // as lowest priority so newly submitted designs land at the end of their group.
  // Synced from the server load whenever data.myDesigns changes; drag-reorder
  // mutates it optimistically and persists the new ranks to /cfps/my-designs.
  function designSortKey(d) { const r = Number(d?.rank) || 0; return r > 0 ? r : Number.POSITIVE_INFINITY; }
  function sortMyDesigns(list) {
    const arr = Array.isArray(list) ? list : [];
    return [...arr].sort((a, b) => {
      const ka = designSortKey(a), kb = designSortKey(b);
      if (ka !== kb) return ka - kb;
      return String(b.created || '').localeCompare(String(a.created || ''));
    });
  }
  let orderedDesigns = $state(sortMyDesigns(data?.myDesigns));
  $effect(() => { orderedDesigns = sortMyDesigns(data?.myDesigns); });

  // A batch_id → display label. The id IS the shared sample_id base
  // (e.g. "ada_lovelace_2026-10-06_b2au5p"); show the whole thing as the batch name.
  function batchDisplayName(batchId) {
    return String(batchId || 'batch').trim() || 'batch';
  }

  // Partition My Compositions into batches (submitted together, sharing a batch_id)
  // and standalone designs. A batch needs ≥2 members actually present — a lone
  // survivor of a mostly-deleted batch falls back to a standalone card. Batch members
  // are pulled OUT of the per-protein groups so they only appear in the batch section.
  let myDesignsPartition = $derived.by(() => {
    const list = orderedDesigns;
    const byBatch = new Map();
    for (const d of list) {
      const bid = d.batchId && Number(d.batchSize) > 1 ? d.batchId : null;
      if (!bid) continue;
      if (!byBatch.has(bid)) byBatch.set(bid, []);
      byBatch.get(bid).push(d);
    }
    const batches = [];
    const batchMemberIds = new Set();
    for (const [bid, members] of byBatch) {
      if (members.length < 2) continue; // not really a batch anymore
      const sorted = [...members].sort(
        (a, b) => (Number(a.batchIndex) || 0) - (Number(b.batchIndex) || 0)
      );
      sorted.forEach((m) => batchMemberIds.add(m.id));
      // Distinct experimental targets present in the batch, in canonical order, plus
      // an "Other" chip if any member has an unrecognised target.
      const present = PROTEIN_TARGETS.filter((t) => sorted.some((m) => m.proteinTarget === t));
      const hasOther = sorted.some((m) => !PROTEIN_TARGETS.includes(m.proteinTarget));
      batches.push({
        batchId: bid,
        name: batchDisplayName(bid),
        count: sorted.length,
        members: sorted,
        memberIds: sorted.map((m) => m.id),
        targets: hasOther ? [...present, 'Other'] : present,
        created: sorted.map((m) => m.created || '').sort().slice(-1)[0] || null
      });
    }
    batches.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
    const singletons = list.filter((d) => !batchMemberIds.has(d.id));
    return { batches, singletons };
  });
  let myBatches = $derived(myDesignsPartition.batches);

  let myDesignsGroups = $derived.by(() => {
    const list = myDesignsPartition.singletons;
    const groups = PROTEIN_TARGETS.map((t) => ({
      key: t,
      label: t,
      items: list.filter((d) => d.proteinTarget === t)
    }));
    const others = list.filter((d) => !PROTEIN_TARGETS.includes(d.proteinTarget));
    if (others.length) groups.push({ key: 'other', label: 'Other / unspecified', items: others });
    return groups;
  });
  let myDesignsTotal = $derived(Array.isArray(data?.myDesigns) ? data.myDesigns.length : 0);

  let editingDesignId = $state(null);
  let confirmDeleteDesignId = $state(null);
  let confirmDeleteBatchId = $state(null);
  let copiedDesignId = $state(null);
  let copiedBatchId = $state(null);
  let expandedBatchId = $state(null);
  let myDesignBusy = $state(false);
  let myDesignError = $state('');
  let myDesignMessage = $state('');

  // Per-protein colour identity for the My Compositions section: the bright tone
  // reads on the dark page background (group titles + glyph), the ink/wash/line
  // tones read on the light card (badges). Green / orange / red for
  // sfGFP / PETase / Reteplase — matching the 3D structure glows.
  const PROTEIN_PALETTE = {
    sfGFP:     { bright: '#37e27a', ink: '#1f7a3f', wash: '#e6f4ea', line: '#2f8f4e' },
    PETase:    { bright: '#ff9d2e', ink: '#b25e00', wash: '#fbeede', line: '#e07b1a' },
    Reteplase: { bright: '#ff4a3a', ink: '#b5271a', wash: '#fbe4e0', line: '#e0402e' }
  };
  function proteinBright(key) { return PROTEIN_PALETTE[key]?.bright || 'var(--faint)'; }

  // Inline action icons (currentColor stroke so CSS controls the tone).
  const ICON_LINK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>';
  const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICON_LOAD = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 21h16"/></svg>';
  // Inline-edit form fields (mirror the submit modal's metadata).
  let editDesignName = $state('');
  let editDesignTarget = $state('sfGFP');
  let editDesignAiModel = $state('');
  let editDesignAck = $state('');
  let editDesignComments = $state('');

  function startEditDesign(d) {
    editingDesignId = d.id;
    confirmDeleteDesignId = null;
    myDesignError = '';
    myDesignMessage = '';
    editDesignName = d.name || '';
    editDesignTarget = PROTEIN_TARGETS.includes(d.proteinTarget) ? d.proteinTarget : 'sfGFP';
    editDesignAiModel = d.aiModel || '';
    editDesignAck = d.acknowledgements || '';
    editDesignComments = d.comments || '';
  }
  function cancelEditDesign() {
    editingDesignId = null;
  }

  async function saveEditDesign() {
    if (myDesignBusy) return;
    const name = editDesignName.trim();
    if (!name) { myDesignError = 'Name is required.'; return; }
    myDesignBusy = true;
    myDesignError = '';
    myDesignMessage = '';
    try {
      const res = await fetch('/cfps/my-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'update',
          id: editingDesignId,
          name,
          proteinTarget: editDesignTarget,
          aiModel: editDesignAiModel.trim(),
          acknowledgements: editDesignAck.trim(),
          comments: editDesignComments.trim()
        })
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Update failed.');
      myDesignMessage = 'Composition updated.';
      editingDesignId = null;
      await invalidateAll();
    } catch (e) {
      myDesignError = e?.message || 'Update failed.';
    } finally {
      myDesignBusy = false;
    }
  }

  async function deleteDesign(d) {
    if (myDesignBusy) return;
    myDesignBusy = true;
    myDesignError = '';
    myDesignMessage = '';
    try {
      const res = await fetch('/cfps/my-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'delete', id: d.id })
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Delete failed.');
      myDesignMessage = `Deleted “${d.name}”.`;
      confirmDeleteDesignId = null;
      if (editingDesignId === d.id) editingDesignId = null;
      await invalidateAll();
    } catch (e) {
      myDesignError = e?.message || 'Delete failed.';
    } finally {
      myDesignBusy = false;
    }
  }

  // Delete every record in a batch (they're independent cfps_designs rows that merely
  // share a batch_id). Each is deleted via the same ownership-checked endpoint; we
  // report how many landed and refresh once at the end.
  async function deleteBatch(batch) {
    if (myDesignBusy) return;
    const members = batch?.members ?? [];
    if (!members.length) return;
    myDesignBusy = true;
    myDesignError = '';
    myDesignMessage = '';
    let ok = 0;
    try {
      for (const m of members) {
        try {
          const res = await fetch('/cfps/my-designs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'delete', id: m.id })
          });
          const result = await res.json();
          if (res.ok && result.success) ok += 1;
        } catch { /* tallied below */ }
      }
      if (ok === members.length) {
        myDesignMessage = `Deleted batch (${ok} composition${ok === 1 ? '' : 's'}).`;
      } else {
        myDesignError = `Deleted ${ok} of ${members.length}; some compositions could not be removed.`;
      }
      confirmDeleteBatchId = null;
      await invalidateAll();
    } finally {
      myDesignBusy = false;
    }
  }

  // Shareable link → equips the composition into the visitor's Custom Mix on load
  // (handled in onMount via the ?design=<id> param). Uses the PocketBase record id,
  // which also keys the "community-<id>" Custom Mix formulation.
  function shareableDesignUrl(d) {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/cfps?design=${encodeURIComponent(d.id)}`;
  }
  async function copyDesignLink(d) {
    myDesignError = '';
    try {
      await navigator.clipboard.writeText(shareableDesignUrl(d));
      copiedDesignId = d.id;
      setTimeout(() => { if (copiedDesignId === d.id) copiedDesignId = null; }, 1600);
    } catch {
      myDesignError = 'Could not copy the link to your clipboard.';
    }
  }

  // Shareable link for a whole batch → equips every member into its own Custom Mix
  // column on load (handled in onMount via the ?batch=<id,id,…> param, mirroring the
  // single-design ?design=<id> path).
  function shareableBatchUrl(batch) {
    if (typeof window === 'undefined') return '';
    const ids = (batch?.memberIds ?? []).map((id) => encodeURIComponent(id)).join(',');
    return `${window.location.origin}/cfps?batch=${ids}`;
  }
  async function copyBatchLink(batch) {
    myDesignError = '';
    try {
      await navigator.clipboard.writeText(shareableBatchUrl(batch));
      copiedBatchId = batch.batchId;
      setTimeout(() => { if (copiedBatchId === batch.batchId) copiedBatchId = null; }, 1600);
    } catch {
      myDesignError = 'Could not copy the link to your clipboard.';
    }
  }

  // "Edit" on a batch card expands it so each member can be edited inline (a batch is
  // just a set of independent compositions sharing a batch_id, so editing happens per
  // member, reusing the same inline editor the singleton cards use).
  function toggleBatchEdit(batch) {
    const willOpen = expandedBatchId !== batch.batchId;
    expandedBatchId = willOpen ? batch.batchId : null;
    if (!willOpen) editingDesignId = null;
    confirmDeleteBatchId = null;
    myDesignError = '';
    myDesignMessage = '';
  }

  // Load a saved composition back into the working Custom Mix (reusing the same
  // "community-<id>" formulation the shareable link equips), then scroll up to the
  // comparison table so the loaded mix is in view.
  function loadDesignIntoMix(d) {
    const key = `community-${d.id}`;
    const fm = findFormulation(key);
    if (!fm) {
      myDesignError = 'Could not load this composition into the Custom Mix.';
      return;
    }
    myDesignError = '';
    setCustomStart(key); // keeps the current selected mix; writes the recipe into it
    // Bring the composition's metadata back too so the JSON box + modal reflect it (a
    // lone composition has no group hypothesis, so that field stays as-is).
    mixComments = { ...mixComments, [selectedMixId]: fm.rationale || '' };
    designAiModel = fm.aiModel || '';
    designAcknowledgements = fm.acknowledgements || '';
    myDesignMessage = `Loaded “${d.name}” into the Custom Mix.`;
    try { scrollToComparison(); } catch { /* ignore */ }
  }

  // Load an ENTIRE batch into the Custom Mix columns at once: one column per member,
  // ordered by batch index, each seeded from its own "community-<id>" formulation
  // (so the targets/recipes come back exactly as submitted). Used by the batch cards
  // in both My Compositions and the community rail. `memberIds` is the batch members'
  // record ids in display order; `label` is the batch name for the status line.
  function loadBatchIntoMixes(memberIds, label = 'batch') {
    const fms = (Array.isArray(memberIds) ? memberIds : [])
      .map((id) => findFormulation(`community-${id}`))
      .filter(Boolean);
    if (!fms.length) {
      myDesignError = 'Could not load this batch into the Custom Mix.';
      return false;
    }
    const built = renumberMixes(
      fms.map((fm) => ({
        id: `mix-${randomToken()}`,
        n: 0,
        volumes: { ...(volumesForFormulation(fm) || {}) },
        proteinTarget: PROTEIN_TARGETS.includes(fm.proteinTarget) ? fm.proteinTarget : proteinTarget,
        startKey: fm.key
      }))
    );
    mixes = built;
    // Repopulate the metadata that backs the JSON box + submit modal from the loaded
    // batch, so what's on screen round-trips: per-mix rationale per column, and the
    // shared ai_model / acknowledgements / overall hypothesis from the first member.
    const commentMap = {};
    built.forEach((m, i) => { commentMap[m.id] = fms[i]?.rationale || ''; });
    mixComments = commentMap;
    designAiModel = fms[0]?.aiModel || '';
    designAcknowledgements = fms[0]?.acknowledgements || '';
    // The group hypothesis is stored on just one member, so find it across the batch.
    experimentHypothesis = fms.find((f) => f?.experimentHypothesis)?.experimentHypothesis || '';
    const first = built[0];
    selectedMixId = first.id;
    volumesNl = { ...(first.volumes || {}) };
    if (PROTEIN_TARGETS.includes(first.proteinTarget)) proteinTarget = first.proteinTarget;
    customStartKey = first.startKey;
    rankTabMixId = null;
    myDesignError = '';
    myDesignMessage = `Loaded ${fms.length} composition${fms.length === 1 ? '' : 's'} from “${label}” into the Custom Mix.`;
    try { scrollToComparison(); } catch { /* ignore */ }
    return true;
  }

  // The user's own customized mixes, captured as fresh column slots in column order.
  // "Customized" = the volume map has diverged from that mix's starting recipe (the
  // same rule that flips a column's label to "Custom"). The selected mix reads the
  // live editing buffer; the rest read their stored snapshots. Used when focusing a
  // community composition so hand-edited work survives while standard / other-author
  // columns are cleared.
  function keptCustomMixSlots() {
    return mixes
      .map((m) => {
        const isSel = m.id === selectedMixId;
        const customized = isSel ? customIsCustomized : isMixCustomized(m);
        if (!customized) return null;
        return {
          id: m.id,
          n: 0,
          volumes: isSel ? { ...volumesNl } : { ...(m.volumes || {}) },
          proteinTarget: isSel ? proteinTarget : m.proteinTarget,
          startKey: isSel ? customStartKey : m.startKey
        };
      })
      .filter(Boolean);
  }

  // Clicking a community composition in the rail FOCUSES it: standard recipes and
  // other authors' un-edited compositions are cleared, the picked composition becomes
  // the leftmost (selected) column, and any mixes the user has personally customized
  // are kept to its right — so it's always obvious whose composition you're viewing.
  function pickCommunityStart(key) {
    const bm = findFormulation(key);
    if (!bm) return;
    const kept = keptCustomMixSlots(); // capture BEFORE the live buffer is reseeded
    const vols = volumesForFormulation(bm) || {};
    const target = PROTEIN_TARGETS.includes(bm.proteinTarget) ? bm.proteinTarget : proteinTarget;
    const picked = {
      id: `mix-${randomToken()}`,
      n: 0,
      volumes: { ...vols },
      proteinTarget: target,
      startKey: key
    };
    mixes = renumberMixes([picked, ...kept]);
    selectedMixId = picked.id;
    volumesNl = { ...vols };
    proteinTarget = target;
    customStartKey = key;
    rankTabMixId = null;
    // Round-trip this composition's metadata into the JSON box + submit modal: its
    // rationale as the focused column's comment, plus the author's ai_model /
    // acknowledgements / overall hypothesis. Merge comments so kept mixes keep theirs,
    // and only overwrite the shared fields when this composition actually carries a
    // value — so focusing one card never wipes metadata the user has already typed.
    mixComments = { ...mixComments, [picked.id]: bm.rationale || '' };
    if (bm.aiModel) designAiModel = bm.aiModel;
    if (bm.acknowledgements) designAcknowledgements = bm.acknowledgements;
    if (bm.experimentHypothesis) experimentHypothesis = bm.experimentHypothesis;
  }

  // Same focus behavior for a whole community batch clicked in the rail: load every
  // member as its own leftmost column, keep the user's customized mixes to the right.
  // (My Compositions "load all" and the shared ?batch= link use loadBatchIntoMixes,
  // which fully replaces the columns — a deliberate difference per context.)
  function pickCommunityBatch(memberIds, label = 'batch') {
    const fms = (Array.isArray(memberIds) ? memberIds : [])
      .map((id) => findFormulation(`community-${id}`))
      .filter(Boolean);
    if (!fms.length) {
      myDesignError = 'Could not load this batch into the Custom Mix.';
      return false;
    }
    const kept = keptCustomMixSlots(); // capture BEFORE the live buffer is reseeded
    const batchSlots = fms.map((fm) => ({
      id: `mix-${randomToken()}`,
      n: 0,
      volumes: { ...(volumesForFormulation(fm) || {}) },
      proteinTarget: PROTEIN_TARGETS.includes(fm.proteinTarget) ? fm.proteinTarget : proteinTarget,
      startKey: fm.key
    }));
    mixes = renumberMixes([...batchSlots, ...kept]);
    // Repopulate the metadata that backs the JSON box + submit modal from the focused
    // batch, so the overall hypothesis / ai_model / acknowledgements / per-column
    // rationale round-trip. Merge (don't replace) comments so any kept custom mixes
    // keep theirs.
    const nextComments = { ...mixComments };
    batchSlots.forEach((m, i) => { nextComments[m.id] = fms[i]?.rationale || ''; });
    mixComments = nextComments;
    designAiModel = fms[0]?.aiModel || '';
    designAcknowledgements = fms[0]?.acknowledgements || '';
    // The group hypothesis is stored on just one member, so find it across the batch.
    experimentHypothesis = fms.find((f) => f?.experimentHypothesis)?.experimentHypothesis || '';
    const first = batchSlots[0];
    selectedMixId = first.id;
    volumesNl = { ...(first.volumes || {}) };
    if (PROTEIN_TARGETS.includes(first.proteinTarget)) proteinTarget = first.proteinTarget;
    customStartKey = first.startKey;
    rankTabMixId = null;
    return true;
  }

  // ── drag-to-rank within a target-protein group ──────────────────────────────
  // Cards drag left↔right to set priority (1 = highest, leftmost). Reordering is
  // constrained to the same protein group; the new ranks are written to PocketBase.
  let draggingDesignId = $state(null);
  let dragOverDesignId = $state(null);

  function onDesignDragStart(e, d) {
    if (editingDesignId === d.id) { e.preventDefault(); return; }
    draggingDesignId = d.id;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); } catch { /* ignore */ }
  }
  function onDesignDragOver(e, d) {
    if (!draggingDesignId || draggingDesignId === d.id) return;
    const from = orderedDesigns.find((x) => x.id === draggingDesignId);
    if (!from || from.proteinTarget !== d.proteinTarget) return; // same category only
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
    dragOverDesignId = d.id;
  }
  function onDesignDrop(e, target) {
    e.preventDefault();
    const fromId = draggingDesignId;
    draggingDesignId = null;
    dragOverDesignId = null;
    if (!fromId || fromId === target.id) return;
    reorderDesign(fromId, target.id);
  }
  function onDesignDragEnd() { draggingDesignId = null; dragOverDesignId = null; }

  function reorderDesign(fromId, targetId) {
    const list = [...orderedDesigns];
    const from = list.find((x) => x.id === fromId);
    const target = list.find((x) => x.id === targetId);
    if (!from || !target || from.proteinTarget !== target.proteinTarget) return;
    const groupKey = from.proteinTarget;
    list.splice(list.indexOf(from), 1);
    list.splice(list.indexOf(target), 0, from); // drop the dragged card into the target's slot
    orderedDesigns = list;
    persistDesignRanks(groupKey);
  }

  async function persistDesignRanks(groupKey) {
    // Assign 1..N by the current left→right order within the group, update locally,
    // then persist. No invalidateAll on success so the optimistic order isn't
    // clobbered — a reload re-derives the same order from the saved ranks.
    const order = orderedDesigns
      .filter((x) => x.proteinTarget === groupKey)
      .map((x, i) => ({ id: x.id, rank: i + 1 }));
    const rankById = new Map(order.map((o) => [o.id, o.rank]));
    orderedDesigns = orderedDesigns.map((x) => rankById.has(x.id) ? { ...x, rank: rankById.get(x.id) } : x);
    myDesignError = '';
    try {
      const res = await fetch('/cfps/my-designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'reorder', order })
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Could not save the new order.');
    } catch (e) {
      myDesignError = e?.message || 'Could not save the new order.';
      await invalidateAll(); // revert to the server's truth
    }
  }

  // ── persist the in-progress design across refreshes (localStorage) ──────────
  // A URL-loaded design (data.initialDesign) always wins; otherwise the last
  // custom mix + target/preset/sequence toggles are restored so a refresh doesn't
  // lose progress. `stateRestored` gates the save effect so it can't overwrite the
  // saved snapshot with component defaults before the restore has run.
  const DESIGNER_STATE_KEY = 'cfps:designer-state:v1';
  let stateRestored = $state(false);

  onMount(() => {
    try {
      // Shared composition link (?design=<pocketbase-id>): equip it into the Custom
      // Mix and win over both the URL-loaded design and the saved snapshot. Strip
      // the param afterwards so a refresh falls back to normal persistence.
      const designParam = page?.url?.searchParams?.get('design');
      if (designParam && findFormulation(`community-${designParam}`)) {
        setCustomStart(`community-${designParam}`);
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('design');
          history.replaceState(history.state, '', u);
        } catch { /* ignore */ }
        try { document.querySelector('#comparison')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
        stateRestored = true;
        return;
      }
      // Shared batch link (?batch=<id,id,…>): load every member into its own Custom Mix
      // column. Wins like the single-design link and strips the param afterwards.
      const batchParam = page?.url?.searchParams?.get('batch');
      if (batchParam) {
        const ids = batchParam.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length && loadBatchIntoMixes(ids, 'shared batch')) {
          try {
            const u = new URL(window.location.href);
            u.searchParams.delete('batch');
            history.replaceState(history.state, '', u);
          } catch { /* ignore */ }
          stateRestored = true;
          return;
        }
      }
      if (!data?.initialDesign) {
        const raw = localStorage.getItem(DESIGNER_STATE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            if (saved.volumesNl && typeof saved.volumesNl === 'object') {
              // Only restore volumes for reagents that still exist in the app.
              const restored = { ...volumesNl };
              for (const r of allReagents) {
                if (saved.volumesNl[r.id] != null) restored[r.id] = Number(saved.volumesNl[r.id]) || 0;
              }
              volumesNl = restored;
            }
            if (typeof saved.selectedProfileKey === 'string' && defaultTargetProfiles[saved.selectedProfileKey]) {
              selectedProfileKey = saved.selectedProfileKey;
            }
            if (typeof saved.presetCycleIndex === 'number') presetCycleIndex = saved.presetCycleIndex;
            if (typeof saved.customStartKey === 'string' && findFormulation(saved.customStartKey)) {
              customStartKey = saved.customStartKey;
            }
            if (saved.seqMode && typeof saved.seqMode === 'object') seqMode = { ...seqMode, ...saved.seqMode };
            if (PROTEIN_TARGETS.includes(saved.proteinTarget)) proteinTarget = saved.proteinTarget;
          } else {
            // First visit, nothing to restore → seed the design with the starting
            // composition (best sfGFP) so the Custom Mix opens on a real recipe.
            setCustomStart(customStartKey);
          }
        } else {
          // First visit, nothing to restore → seed with the starting composition.
          setCustomStart(customStartKey);
        }
      }
    } catch { /* ignore corrupt or unavailable storage */ }
    stateRestored = true;
  });

  $effect(() => {
    // Read every persisted field so the effect re-runs when any of them change.
    const snapshot = {
      volumesNl: { ...volumesNl },
      selectedProfileKey,
      presetCycleIndex,
      customStartKey,
      seqMode: { ...seqMode },
      proteinTarget
    };
    if (!stateRestored) return; // don't clobber the saved snapshot before restore
    try { localStorage.setItem(DESIGNER_STATE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
  });

  // The reagent prompt is authored in PocketBase (static_values) so it can be edited
  // on the fly without a redeploy; `data.reagentPrompt` is that text. If the DB read
  // failed (null), fall back to the client-generated prompt so the panel is never empty.
  function resolvedReagentPrompt() {
    const fromDb = data?.reagentPrompt;
    return (typeof fromDb === 'string' && fromDb.trim()) ? fromDb : reagentPromptText();
  }

  // Typewriter reveal: the first time the prompt scrolls into view it types itself
  // out over ~1.8 s with a blinking caret (an "AI is writing" beat). Purely visual —
  // `promptShown` is only what's painted; the Copy button uses resolvedReagentPrompt().
  let promptFullText = $derived(resolvedReagentPrompt());
  let promptTypedLen = $state(0);
  let promptTypingDone = $state(false);
  let promptViewEl = $state(null);
  let promptShown = $derived(promptTypingDone ? promptFullText : promptFullText.slice(0, promptTypedLen));

  $effect(() => {
    if (typeof window === 'undefined' || !promptViewEl) return;
    if (promptTypingDone) return; // already revealed — later prompt changes just show in full
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { promptTypingDone = true; return; }
    let raf = 0, startedAt = 0, started = false;
    const DURATION = 1800; // ~1.8 s regardless of length
    const tick = (now) => {
      if (!startedAt) startedAt = now;
      const p = Math.min(1, (now - startedAt) / DURATION);
      promptTypedLen = Math.floor(p * promptFullText.length);
      if (p >= 1) { promptTypingDone = true; return; }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started) { started = true; io.disconnect(); raf = requestAnimationFrame(tick); }
    }, { threshold: 0.25 });
    io.observe(promptViewEl);
    return () => { io.disconnect(); if (raf) cancelAnimationFrame(raf); };
  });

  function buildCostRankEntries() {
    return visibleReagents
      .filter((reagent) => effectiveVolumeNlForReagent(reagent.id) > 0)
      .map((reagent) => {
        const costUsd = effectiveCostUsdForReagent(reagent);
        return {
          name: reagent.name,
          costUsd,
          costLabel: formatUsd(costUsd),
          volumeLabel: formatUl(effectiveVolumeNlForReagent(reagent.id))
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  function buildConcentrationDiscrepancies() {
    const profile = activeProfile();
    const targetMm = profile.targetMm || {};
    const targetGL = profile.targetGramsPerLiter || {};
    const targetUml = profile.targetUnitsPerMl || {};
    const targetNgUl = profile.targetNgPerUl || {};
    // Snap-rounding drift is a property of the LOADED formulation's targets vs the
    // nearest 25 nL Echo volume — NOT of the live design. `baseline` is the volume
    // map a fresh load of the current profile produces (exactly what volumesNl was
    // seeded from), so comparing each target to what the baseline delivers isolates
    // pure 25 nL rounding. A reagent the user has since hand-stepped sits on an exact
    // 25 nL volume they chose, so it can't be "off target" — skip it (otherwise a
    // deliberate edit reads as huge drift, since the target stays frozen at the
    // loaded value). Reading volumesNl also keeps this derived reactive to edits.
    const baseline = computeDefaultVolumes(selectedProfileKey);
    const discrepancies = [];

    for (const reagent of visibleReagents) {
      if (reagent.id === WATER_ID) continue;
      // Hand-edited away from the loaded baseline → user's exact 25 nL choice, no drift.
      if ((Number(volumesNl[reagent.id]) || 0) !== (Number(baseline[reagent.id]) || 0)) continue;

      let intended = null;
      let achievable = null;
      let unit = '';

      if (targetMm[reagent.id] != null) {
        intended = targetMm[reagent.id];
        const nm = finalNmForReagentFromVolumes(reagent, baseline);
        achievable = nm == null ? null : nm / 1_000_000;
        unit = 'mM';
      } else if (targetGL[reagent.id] != null) {
        intended = targetGL[reagent.id];
        achievable = finalGramsPerLiterForReagentFromVolumes(reagent, baseline);
        unit = 'g/L';
      } else if (targetUml[reagent.id] != null) {
        intended = targetUml[reagent.id];
        achievable = finalUnitsPerMlForReagentFromVolumes(reagent, baseline);
        unit = 'U/mL';
      } else if (targetNgUl[reagent.id] != null) {
        intended = targetNgUl[reagent.id];
        achievable = finalNgPerUlForReagentFromVolumes(reagent, baseline);
        unit = 'ng/µL';
      }

      if (intended == null || achievable == null || intended <= 0) continue;
      const pct = Math.abs(intended - achievable) / intended * 100;
      if (pct < 3) continue;

      const digits = unit === 'U/mL' ? 2 : 3;
      discrepancies.push({
        name: displayName(reagent),
        intendedLabel: `${intended.toFixed(digits)} ${unit}`,
        achievableLabel: `${achievable.toFixed(digits)} ${unit}`,
        pct
      });
    }

    return discrepancies.sort((a, b) => b.pct - a.pct);
  }

  let concentrationDiscrepancies = $derived(buildConcentrationDiscrepancies());

  function identityForReagent(reagentId) {
    const reagent = allReagents.find((item) => item.id === reagentId) || {};
    const moleculeId = reagent.molecule_id ?? null;
    const reagentIdValue = reagent.reagent_id ?? null;

    let entityType = reagent.entity_type ?? null;
    let entityId = reagent.entity_id ?? null;
    if (!entityType || entityId == null) {
      if (moleculeId != null) {
        entityType = 'molecule';
        entityId = moleculeId;
      } else if (reagentIdValue != null) {
        entityType = 'reagent';
        entityId = reagentIdValue;
      } else {
        entityType = 'unmapped';
        entityId = null;
      }
    }

    return {
      molecule_id: moleculeId,
      reagent_id: reagentIdValue,
      entity_type: entityType,
      entity_id: entityId
    };
  }

  function identityLinkForReagent(reagentId) {
    const identity = identityForReagent(reagentId);
    if (identity.entity_type === 'molecule' && identity.molecule_id != null) {
      return {
        value: String(identity.molecule_id),
        href: `https://lims.ginkgobioworks.com/molecules/${identity.molecule_id}`
      };
    }
    if (identity.entity_type === 'reagent' && identity.reagent_id != null) {
      return {
        value: String(identity.reagent_id),
        href: `https://lims.ginkgobioworks.com/reagents/${identity.reagent_id}`
      };
    }
    return null;
  }

  function nodeShortName(displayLabel) {
    return String(displayLabel || '')
      .split('(')[0]
      .replace(/:\s*$/, '')
      .trim();
  }

  async function publishDesign() {
    isPublishing = true;
    publishFormError = '';
    publishMessage = '';
    publishError = '';
    const humanAuthor = author?.trim() || '';
    const aiAuthor = 'manual_ui';

    if (!selectedNodeDisplay) {
      publishFormError = 'Please select an HTGAA Node.';
      isPublishing = false;
      return;
    }

    if (!humanAuthor) {
      publishFormError = 'Please enter your HTGAA username.';
      isPublishing = false;
      return;
    }

    if (totalVolumeNl > MAX_TOTAL_NL) {
      publishError = 'Total reaction volume must be <= 20 uL.';
      isPublishing = false;
      return;
    }

    const payload = {
      title: designTitle?.trim() || `CFPS-${new Date().toISOString()}`,
      author: humanAuthor,
      human_author: humanAuthor,
      ai_author: aiAuthor,
      rationale: rationale?.trim() || null,
      htgaaNode: nodeShortName(selectedNodeDisplay),
      design: {
        maxTotalNl: MAX_TOTAL_NL,
        stepNl: STEP_NL,
        totalVolumeNl,
        totalVolumeUl: totalVolumeNl / 1000,
        remainingNl,
        totalCostUsd,
        costPerMlReaction,
        reagents: allReagents.map((reagent) => ({
          ...identityForReagent(reagent.id),
          id: reagent.id,
          group: reagent.group,
          name: reagent.name,
          concentration: reagent.concentration,
          costPerMl: reagent.costPerMl,
          volumeNl: Number(volumesNl[reagent.id]) || 0,
          fixed: reagent.fixedNl != null
        }))
      }
    };

    try {
      const response = await fetch('/save-cfps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to publish CFPS design.');
      }

      if (result.duplicate) {
        publishMessage = 'Duplicate design detected. Not published.';
      } else {
        publishMessage = `Published design ${result.id}.`;
      }
      uploadModal?.close();
    } catch (error) {
      publishError = error?.message || 'Failed to publish CFPS design.';
    } finally {
      isPublishing = false;
    }
  }

  // ── Fun: "decoding" glyph-scramble on section headers ──────────────────────
  // Hovering a monospace `.label` header sometimes plays a brief decode
  // animation — glyphs cycle then resolve left-to-right into the real text.
  // Delegated off .cfps-page so labels inside conditional blocks are covered
  // too; skipped entirely when the user prefers reduced motion.
  $effect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.querySelector('.cfps-page');
    if (!root) return;

    const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&<>/\\|=+*·░▒▓';
    const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

    function isPlainLabel(el) {
      return el?.classList?.contains('label') && el.children.length === 0
        && el.textContent.trim().length > 0;
    }

    function runScramble(el) {
      const text = el._scrambleText ?? el.textContent;
      el._scrambleText = text;
      const chars = Array.from(text);
      // Each char resolves at a staggered "decode time" so it wipes L→R.
      const settle = chars.map((_, i) => 6 + i * 1.6 + Math.random() * 5);
      const done = Math.max(2, ...settle) + 2;
      const start = performance.now();
      const tick = (now) => {
        const t = (now - start) / 30; // ms → decode units (~1s for a short label)
        let out = '';
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          out += (c === ' ' || c === '\n' || t >= settle[i]) ? c : glyph();
        }
        el.textContent = out;
        if (t < done) {
          el._scrambleRAF = requestAnimationFrame(tick);
        } else {
          el.textContent = text; // exact restore (preserves any original spacing)
          el._scrambleRAF = null;
        }
      };
      el._scrambleRAF = requestAnimationFrame(tick);
    }

    // mouseover (not mouseenter) so it bubbles up to the delegated root.
    function onOver(e) {
      const el = e.target;
      if (!isPlainLabel(el) || el._scrambleRAF) return;
      if (Math.random() > 0.4) return; // only "sometimes"
      runScramble(el);
    }
    root.addEventListener('mouseover', onOver);

    return () => {
      root.removeEventListener('mouseover', onOver);
      root.querySelectorAll('.label').forEach((el) => {
        if (el._scrambleRAF) { cancelAnimationFrame(el._scrambleRAF); el._scrambleRAF = null; }
        if (el._scrambleText != null) el.textContent = el._scrambleText;
      });
    };
  });
</script>


<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="cfps-page" data-theme="light">

{#if Array.isArray(data?.reagentGroups)}
{#if reagentGroups.length === 0}
  <div class="page" style="min-height:60vh;display:grid;place-items:center;color:var(--muted);">
    <p>No reagent groups found in PocketBase record.</p>
  </div>
{:else}
<div class="page">

  <!-- ================= header · protein animation + crossover lockup ================= -->
  <!-- NB: class is "brand-hero", not "hero" — daisyUI's .hero is display:grid and would
       stack the proteins + lockup into one overlapping cell. -->
  <!-- full-screen welcome hero: framed black box that fills the viewport -->
  <div class="brand-hero">
    <div class="brand-hero__main">
      <!-- tagline across the top of the header -->
      <p class="brand-tagline">Cell-Free Synthesis Coopetition for Humans &amp; AI</p>

      <!-- white folds; the catalytic/active site glows the relevant colour and breathes:
           sfGFP chromophore (Thr65-Tyr66-Gly67) → green, PETase & Reteplase
           Ser-His-Asp catalytic triads → orange / red -->
      <AsciiProteins
        height="240px"
        radius="0px"
        gap={0.12}
        color="#ffffff"
        structures={[
          { name: 'sfGFP',     pdb: 'https://files.rcsb.org/download/2B3P.pdb', glow: '#37e27a', sites: [65, 66, 67], url: 'https://www.uniprot.org/uniprotkb/P42212/entry' },
          { name: 'PETase',    pdb: 'https://files.rcsb.org/download/4CG1.pdb', glow: '#ff9d2e', sites: [130, 176, 208], url: 'https://www.uniprot.org/uniprotkb/Q6A0I4/entry' },
          { name: 'Reteplase', pdb: 'https://files.rcsb.org/download/1RTF.pdb', glow: '#ff4a3a', sites: [57, 102, 195], url: 'https://www.uniprot.org/uniprotkb/P00750/entry' }
        ]}
      />

      <!-- Ginkgo × HTBAA crossover lockup (logos link out) -->
      <div class="crossover">
        <a class="crossover__link" href="https://www.ginkgo.bio" target="_blank" rel="noreferrer" aria-label="Ginkgo Bioworks">
          <img
            class="crossover__logo crossover__logo--ginkgo"
            src="/company_images/Ginkgo_Logo_White.png"
            alt="Ginkgo Bioworks"
          />
        </a>
        <svg class="crossover__x" viewBox="0 0 48 48" aria-hidden="true">
          <line x1="13" y1="13" x2="35" y2="35" />
          <line x1="35" y1="13" x2="13" y2="35" />
        </svg>
        <a class="crossover__link" href="https://htbaa.org" target="_blank" rel="noreferrer" aria-label="How to Biomanufacture (Almost) Anything 2026">
          <img
            class="crossover__logo crossover__logo--htgaa"
            src="/company_images/HTBAA_2026.png"
            alt="How to Biomanufacture (Almost) Anything 2026"
          />
        </a>
      </div>
    </div>

    <!-- outline CTA, fades in a beat after load and scrolls to the table -->
    <div class="brand-hero__cta">
      <button type="button" class="learn-more" onclick={scrollToComparison}>
        Learn more <span class="learn-more__arrow" aria-hidden="true">↓</span>
      </button>
      <a
        class="hero-doclink"
        href="https://docs.google.com/document/d/1E9RKXezEU5pMO5A10kkUHjHrfL5f8segL0QeNHXAs_E"
        target="_blank"
        rel="noopener noreferrer"
      >Coopetition Details ↗</a>
      <a
        class="hero-doclink"
        href="https://forum.htgaa.org/#narrow/channel/43-cfps-coopetition"
        target="_blank"
        rel="noopener noreferrer"
      >Forum Discussion ↗</a>
    </div>
  </div>

  <!-- ============= cinematic manifesto: decodes into view ============= -->
  <!-- Full-bleed black title card bridging the hero and the designer; the line
       arrives scrambled and resolves left-to-right the first time it's seen. -->
  <section class="cf-manifesto" aria-label="Mission statement">
    <DecodeText
      text={"What if a global community of humans and AI could program an autonomous lab and design the future of cell-free protein synthesis?"}
    />
  </section>

  <!-- ================= benchmarks · comparison table ================= -->
  <div id="comparison" style="margin-top:var(--pad);scroll-margin-top:var(--pad);">
    <!-- Section header lives OUTSIDE the table container (like Protein Details) so it
         reads as a page section rather than a title bar bolted onto the daisyUI card.
         Sign-in control sits far right in the same header row. -->
    <div class="cf-designer-hd">
      <div class="cf-block-hd" style="margin:0;">Cell-Free Reaction Designer</div>
      <div class="cf-designer-hd__auth">
        {#if data?.kcUser}
          <span class="cf-auth-status">signed in · {data.kcUser.name}</span>
          <form method="POST" action="?/kcLogout" use:enhance style="display:inline;">
            <button type="submit" class="btn-bp" title="Sign out">Sign out ⎋</button>
          </form>
        {:else if data?.kcConfigured || data?.devMode}
          <a class="btn-bp" href="/cfps/auth/login" style="text-decoration:none;">Sign in</a>
        {/if}
        {#if kcNotice}
          <span class="kc-notice" role="status">{kcNotice}</span>
        {/if}
      </div>
    </div>
    <div class="cf-block-sub">Reagent concentrations in <b style="color:#fff;">mM</b> (proteins in mg/mL, enzymes in U/mL, DNA in ng/µL).</div>
    <BenchmarksTable
      benchmarkFormulations={benchmarkFormulations}
      fingerprintFor={formulationFingerprint}
      onLoad={loadBenchmarkFormulation}
      onShowRecipe={openRecipe}
      customMix={customMixByPaper}
      customWaterUl={customWaterUl}
      onAdjust={comparisonAdjust}
      customStartKey={customStartKey}
      customIsCustomized={customIsCustomized}
      onSetCustomStart={setCustomStart}
      onPickCommunity={pickCommunityStart}
      onLoadBatch={pickCommunityBatch}
      discrepancies={concentrationDiscrepancies}
      theoretical={theoreticalBanner}
      customCostPerMl={costPerMlReaction}
      customCostUsd={totalCostUsd}
      communityFormulations={communityFormulations}
      externalComparison={platedComparison}
      onClearExternalComparison={() => (platedComparison = null)}
      mixColumns={mixColumns}
      proteinTarget={proteinTarget}
      proteinTargets={PROTEIN_TARGETS}
      onAddMix={addMix}
      onSelectMix={selectMix}
      onRemoveMix={removeMix}
      onResetMix={resetMix}
      onSetMixTarget={setMixTarget}
    >
      <!-- Supplement export panels rendered INSIDE the designer section so they
           read as part of the same cell-free reaction designer. -->
      {#snippet exportPanels()}
        <div class="cfps-2col">
          <div class="panel">
            <div class="panel__hd"><span class="label">concentration rank</span><span class="spacer"></span><button class="icon" onclick={copyConcentrationRank} title="Copy rank">⧉</button></div>
            {#if mixColumns.length > 1}
              <!-- One tab per mix — swap the rank view between the batch's formulations
                   without changing which mix is being edited. -->
              <div class="cfps-rank-tabs" role="tablist" aria-label="Mix formulations">
                {#each mixColumns as col (col.id)}
                  <button
                    type="button"
                    role="tab"
                    class="cfps-rank-tab"
                    class:is-active={rankViewMixId === col.id}
                    aria-selected={rankViewMixId === col.id}
                    onclick={() => (rankTabMixId = col.id)}
                    title={`Show ${col.label}'s concentration rank`}
                  >{col.label}</button>
                {/each}
              </div>
            {/if}
            <div class="panel__bd">
              <div class="cfps-rank">
                {#if concentrationRankEntries.length === 0}
                  <p class="muted" style="margin:0;">No non-zero reagents in composition.</p>
                {:else}
                  {#each concentrationRankEntries as entry}
                    <p style="margin:0;">{entry.rank}. {entry.name} <span class="faint">{entry.label}</span></p>
                  {/each}
                {/if}
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel__hd"><span class="label">{batchMixCount > 1 ? `batch submission JSON · ${batchMixCount} mixes` : 'reagent supplement JSON'}</span><span class="spacer"></span><button class="icon" onclick={copyCompositionJson} title="Copy JSON">⧉</button></div>
            <div class="panel__bd">
              <!-- Editable in both modes. Single mix: one Sample object. Batch (>1 mix):
                   the array of Sample dicts (one per mix, in mix-number order) that will be
                   written to the database. Edits commit on blur via applySupplementEdits();
                   volumes re-snap to the 25 nL grid and water re-balances to 20 µL. -->
              <textarea
                class="cfps-json cfps-json--edit"
                class:invalid={!supplementValidation.valid}
                spellcheck="false"
                rows="14"
                value={supplementText}
                oninput={(e) => { jsonDraft = e.currentTarget.value; }}
                onchange={applySupplementEdits}
              ></textarea>
              {#if !supplementValidation.valid}
                <ul class="cfps-json__errs">
                  {#each supplementValidation.errors as err}
                    <li>{err}</li>
                  {/each}
                </ul>
              {/if}
              {#if copyError}
                <p style="margin:6px 0 0;font-size:11px;color:var(--err);">{copyError}</p>
              {:else if copyMessage}
                <p style="margin:6px 0 0;font-size:11px;color:var(--phosphor);">{copyMessage}</p>
              {/if}
            </div>
          </div>
        </div>
      {/snippet}
      <!-- Submit composition: rendered on its own row in the designer toolbar (all
           the option controls sit on the row above it). Writes the current
           (validated) composition to the cfps_designs PocketBase collection after a
           confirm modal to review the sample_id + metadata. -->
      {#snippet submitRow()}
        <div class="cfps-submit">
          <div class="cfps-submit__btns">
            <button
              type="button"
              class="btn-bp cfps-submit__btn"
              class:is-busy={submitBusy}
              onclick={openSubmitModal}
              disabled={!supplementValidation.valid || submitBusy || !data?.kcUser}
              title={!data?.kcUser ? 'Sign in to submit a composition' : (!supplementValidation.valid ? 'Fix the composition JSON before submitting' : (batchMixCount > 1 ? `Submit all ${batchMixCount} mixes to cfps_designs — you can edit or update them later` : 'Submit this composition to cfps_designs — you can edit or update it later'))}
            >
              <svg class="cfps-submit__mol" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M4 15 L9 9 L15 14 L20 8" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="4" cy="15" r="2" fill="#fff" />
                <circle cx="9" cy="9" r="2" fill="#fff" />
                <circle cx="15" cy="14" r="2" fill="#fff" />
                <circle cx="20" cy="8" r="2" fill="#fff" />
              </svg>
              <span class="cfps-submit__label">{submitBusy ? 'Transmitting' : (batchMixCount > 1 ? `Submit batch · ${batchMixCount}` : 'Submit composition')}</span>
              <span class="cfps-submit__arrow" aria-hidden="true">▸</span>
            </button>
            {#if canUpdateExisting}
              <button
                type="button"
                class="btn-bp cfps-submit__btn cfps-submit__btn--update"
                class:is-busy={submitBusy}
                onclick={openUpdateModal}
                disabled={!supplementValidation.valid || submitBusy}
                title={updatePlan.creates.length
                  ? `Save your edits over ${updatePlan.updates.length} of your composition${updatePlan.updates.length === 1 ? '' : 's'} and add ${updatePlan.creates.length} new to the batch`
                  : `Save your edits over your existing composition${updatePlan.updates.length === 1 ? '' : 's'} (no new record)`}
              >
                <svg class="cfps-submit__mol" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                <span class="cfps-submit__label">{submitBusy ? 'Saving' : updateButtonLabel}</span>
              </button>
            {/if}
          </div>
          {#if !data?.kcUser}
            <p class="cfps-submit__msg" style="color:var(--muted);">
              <a href="/cfps/auth/login" style="color:var(--teal);text-decoration:none;">Sign in</a> to submit a composition.
            </p>
          {:else if submitError && !showSubmitModal}
            <p class="cfps-submit__msg" style="color:var(--err);">{submitError}</p>
          {:else if submitMessage}
            <p class="cfps-submit__msg" style="color:var(--phosphor);">{submitMessage}</p>
          {:else if mixActionError}
            <p class="cfps-submit__msg" style="color:var(--err);">{mixActionError}</p>
          {/if}
        </div>
      {/snippet}
    </BenchmarksTable>
  </div>

  <!-- ===== my compositions: the signed-in user's own submissions ===== -->
  {#snippet proteinGlyph(color)}
    <svg class="cf-mydesigns__glyph" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M4 15 L9 9 L15 14 L20 8" stroke={color} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="4" cy="15" r="2.1" fill={color} />
      <circle cx="9" cy="9" r="2.1" fill={color} />
      <circle cx="15" cy="14" r="2.1" fill={color} />
      <circle cx="20" cy="8" r="2.1" fill={color} />
    </svg>
  {/snippet}
  <!-- Inline composition editor (name + metadata). Parameterless: it binds the shared
       editDesign* state, so it's reused by both singleton cards and batch members. -->
  {#snippet editDesignForm()}
    <label class="cf-mydesign__field">
      <span>name</span>
      <input class="cf-mydesign__input" type="text" bind:value={editDesignName} maxlength="300" placeholder="composition name" />
    </label>
    <label class="cf-mydesign__field">
      <span>target protein</span>
      <select class="cf-mydesign__input" bind:value={editDesignTarget}>
        {#each PROTEIN_TARGETS as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
    </label>
    <label class="cf-mydesign__field">
      <span>AI model</span>
      <input class="cf-mydesign__input" type="text" bind:value={editDesignAiModel} maxlength="300" placeholder="e.g. claude-opus-4-8" />
    </label>
    <label class="cf-mydesign__field">
      <span>acknowledgements</span>
      <input class="cf-mydesign__input" type="text" bind:value={editDesignAck} maxlength="300" placeholder="collaborators to credit" />
    </label>
    <label class="cf-mydesign__field">
      <span>hypothesis being tested</span>
      <textarea class="cf-mydesign__input" rows="3" bind:value={editDesignComments} maxlength="1500" placeholder="the hypothesis this composition tests"></textarea>
    </label>
    <div class="cf-mydesign__actions">
      <button type="button" class="btn-bp" onclick={saveEditDesign} disabled={myDesignBusy}>Save</button>
      <button type="button" class="btn-bp" onclick={cancelEditDesign} disabled={myDesignBusy}>Cancel</button>
    </div>
  {/snippet}
  {#if data?.kcUser}
    <div class="cf-mydesigns">
      <div class="cf-block-hd">My Compositions</div>
      <div class="cf-block-sub">
        Compositions you’ve submitted as <b style="color:#fff;">{data.kcUser.name}</b>.
      </div>

      {#if myDesignError}
        <p class="cf-mydesigns__note" style="color:var(--err);">{myDesignError}</p>
      {:else if myDesignMessage}
        <p class="cf-mydesigns__note" style="color:var(--phosphor);">{myDesignMessage}</p>
      {/if}

      {#if myDesignsTotal === 0}
        <div class="panel"><div class="panel__bd">
          <p class="muted" style="margin:0;">You haven’t submitted any compositions yet. Design a mix above and hit <b>Submit composition</b> to see it here.</p>
        </div></div>
      {:else}
        {#if myBatches.length}
          <div class="cf-mydesigns__group">
            <div class="cf-mydesigns__grouphd" style="--grp:var(--teal);">
              <svg class="cf-mydesigns__glyph" viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="12" height="12" rx="2" stroke="var(--teal)" stroke-width="1.6" />
                <path d="M8 8 h12 v12" stroke="var(--teal)" stroke-width="1.6" stroke-linecap="round" fill="none" opacity="0.55" />
              </svg>
              <span class="label cf-mydesigns__grouptitle" style="color:var(--teal);">Batches</span>
              <span class="faint">{myBatches.length} batch{myBatches.length === 1 ? '' : 'es'}</span>
            </div>
            <div class="cf-mydesigns__grid" role="list">
              {#each myBatches as batch (batch.batchId)}
                {@const batchOpen = expandedBatchId === batch.batchId}
                <div
                  class="cf-batchcard panel"
                  class:cf-batchcard--editing={batchOpen}
                  role="listitem"
                >
                  <div class="panel__bd">
                    <div class="cf-batchcard__open">
                      <div class="cf-batchcard__hd">
                        <span class="cf-batchcard__count" title="{batch.count} compositions in this batch">{batch.count}×</span>
                        <span class="cf-batchcard__name" title={batch.name}>{batch.name}</span>
                      </div>
                      {#if batch.targets.length}
                        <div class="cf-batchcard__tags">
                          {#each batch.targets as t}
                            {@const pal = PROTEIN_PALETTE[t] || null}
                            <span class="cf-mydesign__badge" style={pal ? `color:${pal.ink};background:${pal.wash};border-color:${pal.line};` : ''}>{t}</span>
                          {/each}
                        </div>
                      {/if}
                      {#if batchOpen}
                        <ul class="cf-batchcard__editlist">
                          {#each batch.members as m (m.id)}
                            <li class="cf-batchcard__editmember" class:cf-batchcard__editmember--editing={editingDesignId === m.id}>
                              {#if editingDesignId === m.id}
                                {@render editDesignForm()}
                              {:else}
                                <div class="cf-batchcard__memberrow">
                                  <span class="cf-batchcard__mix">Mix {m.batchIndex}</span>
                                  <span class="cf-batchcard__mname" title={m.name}>{m.name}</span>
                                  {#if m.proteinTarget}
                                    <span class="cf-batchcard__mtarget">{m.proteinTarget}</span>
                                  {/if}
                                  <div class="cf-mydesign__tools">
                                    <button type="button" class="cf-mydesign__tool cf-mydesign__tool--load" title="Load this composition into the Custom Mix" aria-label="Load composition into Custom Mix" onclick={() => loadDesignIntoMix(m)} disabled={myDesignBusy}>{@html ICON_LOAD}</button>
                                    <button type="button" class="cf-mydesign__tool" class:cf-mydesign__tool--ok={copiedDesignId === m.id} title={copiedDesignId === m.id ? 'Link copied' : 'Copy shareable link'} aria-label="Copy shareable link" onclick={() => copyDesignLink(m)} disabled={myDesignBusy}>{@html copiedDesignId === m.id ? ICON_CHECK : ICON_LINK}</button>
                                    <button type="button" class="cf-mydesign__tool" title="Edit this composition" aria-label="Edit composition" onclick={() => startEditDesign(m)} disabled={myDesignBusy}>{@html ICON_PENCIL}</button>
                                  </div>
                                </div>
                              {/if}
                            </li>
                          {/each}
                        </ul>
                      {:else}
                        <ul class="cf-batchcard__members">
                          {#each batch.members as m (m.id)}
                            <li class="cf-batchcard__member">
                              <span class="cf-batchcard__mix">Mix {m.batchIndex}</span>
                              <span class="cf-batchcard__mname" title={m.name}>{m.name}</span>
                              {#if m.proteinTarget}
                                <span class="cf-batchcard__mtarget">{m.proteinTarget}</span>
                              {/if}
                            </li>
                          {/each}
                        </ul>
                        {#if batch.members.some((m) => m.comments)}
                          <div class="cf-batchcard__comments">
                            <span class="cf-batchcard__commentshd">comments</span>
                            <ul class="cf-batchcard__commentlist">
                              {#each batch.members as m (m.id)}
                                <li><span class="cf-batchcard__commentn">{m.batchIndex}.</span> {m.comments || '—'}</li>
                              {/each}
                            </ul>
                          </div>
                        {/if}
                      {/if}
                    </div>
                    <div class="cf-batchcard__foot">
                      <div class="cf-mydesign__tools">
                        <button type="button" class="cf-mydesign__tool cf-mydesign__tool--load" title="Load all {batch.count} compositions into the Custom Mix" aria-label="Load whole batch into Custom Mix" onclick={() => loadBatchIntoMixes(batch.memberIds, batch.name)} disabled={myDesignBusy}>{@html ICON_LOAD}</button>
                        <button type="button" class="cf-mydesign__tool" class:cf-mydesign__tool--ok={copiedBatchId === batch.batchId} title={copiedBatchId === batch.batchId ? 'Link copied' : 'Copy shareable link for the whole batch'} aria-label="Copy shareable batch link" onclick={() => copyBatchLink(batch)} disabled={myDesignBusy}>{@html copiedBatchId === batch.batchId ? ICON_CHECK : ICON_LINK}</button>
                        <button type="button" class="cf-mydesign__tool" class:cf-mydesign__tool--on={batchOpen} title={batchOpen ? 'Done editing' : 'Edit the compositions in this batch'} aria-label="Edit batch compositions" onclick={() => toggleBatchEdit(batch)} disabled={myDesignBusy}>{@html ICON_PENCIL}</button>
                        {#if confirmDeleteBatchId === batch.batchId}
                          <button type="button" class="cf-mydesign__tool cf-mydesign__tool--danger" title="Confirm delete whole batch" aria-label="Confirm delete batch" onclick={() => deleteBatch(batch)} disabled={myDesignBusy}>{@html ICON_TRASH}</button>
                          <button type="button" class="cf-mydesign__tool" title="Cancel" aria-label="Cancel delete batch" onclick={() => (confirmDeleteBatchId = null)} disabled={myDesignBusy}>{@html ICON_X}</button>
                        {:else}
                          <button type="button" class="cf-mydesign__tool cf-mydesign__tool--del" title="Delete whole batch" aria-label="Delete whole batch" onclick={() => { confirmDeleteBatchId = batch.batchId; myDesignError = ''; myDesignMessage = ''; }} disabled={myDesignBusy}>{@html ICON_TRASH}</button>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        {#each myDesignsGroups as grp (grp.key)}
          {#if grp.items.length}
            <div class="cf-mydesigns__group">
              <div class="cf-mydesigns__grouphd" style="--grp:{proteinBright(grp.key)};">
                {@render proteinGlyph(proteinBright(grp.key))}
                <span class="label cf-mydesigns__grouptitle">{grp.label}</span>
                <span class="faint">{grp.items.length} composition{grp.items.length === 1 ? '' : 's'}</span>
              </div>
              <div class="cf-mydesigns__grid" role="list">
                {#each grp.items as d, i (d.id)}
                  {@const pal = PROTEIN_PALETTE[d.proteinTarget] || null}
                  <div
                    class="cf-mydesign panel"
                    class:cf-mydesign--editing={editingDesignId === d.id}
                    class:cf-mydesign--dragging={draggingDesignId === d.id}
                    class:cf-mydesign--dragover={dragOverDesignId === d.id}
                    role="listitem"
                    aria-roledescription="Draggable composition — rank {i + 1}"
                    draggable={editingDesignId !== d.id}
                    ondragstart={(e) => onDesignDragStart(e, d)}
                    ondragover={(e) => onDesignDragOver(e, d)}
                    ondrop={(e) => onDesignDrop(e, d)}
                    ondragend={onDesignDragEnd}
                  >
                    {#if editingDesignId !== d.id}
                      <span class="cf-mydesign__rank" title="Priority rank — drag to reorder">{i + 1}</span>
                    {/if}
                    <div class="panel__bd">
                      {#if editingDesignId === d.id}
                        {@render editDesignForm()}
                      {:else}
                        <div class="cf-mydesign__hd">
                          <span class="cf-mydesign__name" title={d.name}>{d.name}</span>
                          {#if d.proteinTarget}
                            <span class="cf-mydesign__badge" style={pal ? `color:${pal.ink};background:${pal.wash};border-color:${pal.line};` : ''}>{d.proteinTarget}</span>
                          {/if}
                        </div>
                        <div class="cf-mydesign__desc" class:cf-mydesign__desc--empty={!d.comments} title={d.comments || ''}>
                          {d.comments ? d.comments : 'No description yet.'}
                        </div>
                        <div class="cf-mydesign__foot">
                          {#if d.acknowledgements}
                            <span class="cf-mydesign__collab" title={`Collaborators: ${d.acknowledgements}`}>with {d.acknowledgements}</span>
                          {/if}
                          <div class="cf-mydesign__tools">
                            <button type="button" class="cf-mydesign__tool cf-mydesign__tool--load" title="Load into Custom Mix (scrolls up to the table)" aria-label="Load into Custom Mix" onclick={() => loadDesignIntoMix(d)} disabled={myDesignBusy}>{@html ICON_LOAD}</button>
                            <button type="button" class="cf-mydesign__tool" class:cf-mydesign__tool--ok={copiedDesignId === d.id} title={copiedDesignId === d.id ? 'Link copied' : 'Copy shareable link'} aria-label="Copy shareable link" onclick={() => copyDesignLink(d)} disabled={myDesignBusy}>{@html copiedDesignId === d.id ? ICON_CHECK : ICON_LINK}</button>
                            <button type="button" class="cf-mydesign__tool" title="Edit" aria-label="Edit composition" onclick={() => startEditDesign(d)} disabled={myDesignBusy}>{@html ICON_PENCIL}</button>
                            {#if confirmDeleteDesignId === d.id}
                              <button type="button" class="cf-mydesign__tool cf-mydesign__tool--danger" title="Confirm delete" aria-label="Confirm delete" onclick={() => deleteDesign(d)} disabled={myDesignBusy}>{@html ICON_TRASH}</button>
                              <button type="button" class="cf-mydesign__tool" title="Cancel" aria-label="Cancel delete" onclick={() => (confirmDeleteDesignId = null)} disabled={myDesignBusy}>{@html ICON_X}</button>
                            {:else}
                              <button type="button" class="cf-mydesign__tool cf-mydesign__tool--del" title="Delete" aria-label="Delete composition" onclick={() => { confirmDeleteDesignId = d.id; myDesignError = ''; myDesignMessage = ''; }} disabled={myDesignBusy}>{@html ICON_TRASH}</button>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}

  <!-- ===== community reagents (full width) over the reagent prompt (LLM hand-off) ===== -->
  <div class="cf-reagent-stack">
    <!-- community reagents span the full width -->
    <ReagentSuggestions
      suggestions={data.suggestions ?? []}
      votedSuggestionIds={data.votedSuggestionIds ?? []}
      kcUser={data.kcUser ?? null}
      kcConfigured={data.kcConfigured ?? false}
      devMode={data.devMode ?? false}
    />
    <!-- terminal-styled prompt underneath -->
    <div class="panel panel--term cf-fill" style="position:relative;">
      <div class="panel__hd"><span class="label">reagent prompt</span><span class="spacer"></span><button class="icon" onclick={copyReagentPrompt} title="Copy prompt">⧉</button></div>
      <div class="panel__bd">
        <pre class="cfps-json cfps-prompt" bind:this={promptViewEl}>{promptShown}<span class="cfps-caret" class:cfps-caret--done={promptTypingDone}></span></pre>
        {#if promptCopyError}
          <p style="margin:6px 0 0;font-size:11px;color:var(--err);">{promptCopyError}</p>
        {:else if promptCopyMessage}
          <p style="margin:6px 0 0;font-size:11px;color:#fff;">{promptCopyMessage}</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- ===== throughput funnel: 384-well → 96-well → 2 mL tubes, ideas flowing ===== -->
  <ReactionFlow />

  <!-- ================= PROTEIN DETAILS ================= -->
  <div class="cf-block-hd">Protein Details</div>
  <div class="cf-block-sub">What we're expressing — structure, sequence, and how each target is measured.</div>
  <div class="panel"><div class="panel__bd">

    <!-- Reusable sequence viewer: amino-acid ⇄ DNA toggle + copy, one per card -->
    {#snippet seqPanel(key)}
      <div class="cf-seq">
        <div class="cf-seq-hd">
          <div class="cf-seq-tabs" role="group" aria-label="sequence type">
            <button type="button" class="cf-seq-tab" class:on={seqMode[key] === 'aa'} onclick={() => (seqMode[key] = 'aa')}>amino acid</button>
            <button type="button" class="cf-seq-tab" class:on={seqMode[key] === 'dna'} onclick={() => (seqMode[key] = 'dna')}>DNA</button>
          </div>
          <span class="cf-seq-meta">{seqMode[key] === 'aa' ? PROTEIN_SEQ[key].aa.length + ' aa' : PROTEIN_SEQ[key].dna.length + ' nt'}</span>
          <button type="button" class="icon" onclick={() => copySeq(key)} title="Copy {seqMode[key] === 'aa' ? 'amino-acid' : 'DNA'} sequence" aria-label="Copy sequence">{seqCopied === key + ':' + seqMode[key] ? '✓' : seqCopied === key + ':err' ? '✕' : '⧉'}</button>
        </div>
        <pre class="cf-seq-body">{seqText(key)}</pre>
      </div>
    {/snippet}

    <!-- 1 · target proteins (structure + info) -->
    <div class="label" style="margin-bottom:8px;">target proteins</div>
    <div class="cf-3col">
      <div class="cf-card" style="display:flex;flex-direction:column;gap:8px;">
        <div class="cf-ct"><a class="cf-ct-link" href="https://www.uniprot.org/uniprotkb/P42212/entry" target="_blank" rel="noreferrer" title="View sfGFP on UniProt">sfGFP</a> <small>superfolder GFP</small></div>
        <div class="cf-viewer"><ProteinViewer pdbUrl="https://files.rcsb.org/download/2B3P.pdb" color="#2f8f4e" /></div>
        <p class="cf-blurb">Field-standard fluorescent reporter — folds fast and glows green on its own, so expression reads directly in-plate with no purification. An industry-standard benchmark.</p>
        <div class="cf-dl">
          <span class="cf-dk">Length</span><span class="cf-dv">240 AA</span>
          <span class="cf-dk">MW</span><span class="cf-dv">27,015 Da</span>
          <span class="cf-dk">Disulfide bonds</span><span class="cf-dv">0 (2 free Cys) — standard CFPS conditions</span>
          <span class="cf-dk">Chromophore</span><span class="cf-dv">Thr65-Tyr66-Gly67 (S65T), autocatalytic (requires O₂)</span>
          <span class="cf-dk">Quantification</span><span class="cf-dv">Direct fluorescence</span>
        </div>
        {@render seqPanel('sfgfp')}
      </div>
      <div class="cf-card" style="display:flex;flex-direction:column;gap:8px;">
        <div class="cf-ct"><a class="cf-ct-link" href="https://www.uniprot.org/uniprotkb/Q6A0I4/entry" target="_blank" rel="noreferrer" title="View PETase (TfCut2) on UniProt">PETase</a> <small>TfCut2 cutinase</small></div>
        <div class="cf-viewer"><ProteinViewer pdbUrl="https://files.rcsb.org/download/4CG1.pdb" color="#e08a1e" /></div>
        <p class="cf-blurb">A cutinase that hydrolyzes the ester bonds of PET plastic into its monomers — terephthalic acid and ethylene glycol — which can be re-polymerised into new plastic, closing the recycling loop. A model biocatalyst for enzymatic plastic recycling and a test of expressing a disulfide-bonded enzyme.</p>
        <div class="cf-dl">
          <span class="cf-dk">Length</span><span class="cf-dv">309 AA</span>
          <span class="cf-dk">MW</span><span class="cf-dv">33,157 Da</span>
          <span class="cf-dk">Disulfide bonds</span><span class="cf-dv">1 (Cys274–Cys292) — standard CFPS conditions</span>
          <span class="cf-dk">Active site</span><span class="cf-dv">Ser-His-Asp catalytic triad (α/β hydrolase)</span>
          <span class="cf-dk">Quantification</span><span class="cf-dv">p-nitrophenol release at OD 405 nm</span>
        </div>
        {@render seqPanel('petase')}
      </div>
      <div class="cf-card" style="display:flex;flex-direction:column;gap:8px;">
        <div class="cf-ct"><a class="cf-ct-link" href="https://www.uniprot.org/uniprotkb/P00750/entry" target="_blank" rel="noreferrer" title="View Reteplase (t-PA) on UniProt">Reteplase</a> <small>vtPA serine protease</small></div>
        <div class="cf-viewer"><ProteinViewer pdbUrl="https://files.rcsb.org/download/1RTF.pdb" color="#cc3b2e" /></div>
        <p class="cf-blurb">A clot-busting thrombolytic — it activates plasminogen into plasmin, which dissolves the fibrin holding a clot together, so it's used to treat ischemic stroke, myocardial infarction, and other acute thrombotic conditions. The hardest target here (9 disulfide bonds), proving CFPS can make complex therapeutics.</p>
        <div class="cf-dl">
          <span class="cf-dk">Length</span><span class="cf-dv">399 AA</span>
          <span class="cf-dk">MW</span><span class="cf-dv">44,136 Da</span>
          <span class="cf-dk">Disulfide bonds</span><span class="cf-dv">9 (3 kringle-2 + 5 protease + 1 inter-domain) — requires oxidizing CFPS (DSB lysate + IAM)</span>
          <span class="cf-dk">Active site</span><span class="cf-dv">Ser-His-Asp catalytic triad (serine protease)</span>
          <span class="cf-dk">Quantification</span><span class="cf-dv">AMC release from IPR-AMC peptide</span>
        </div>
        {@render seqPanel('reteplase')}
      </div>
    </div>

    <!-- 2 · assay setup -->
    <div class="label" style="margin:16px 0 8px;">assay setup</div>
    <!-- Key-metric clarification. Grounded in the autonomous-cfps control results
         (reference_results/*_results.json → concentration_results.concentration_g_L)
         and validation_report.py, whose unit_qualification reads "observed
         measurement; does not imply verified physical yield". sfGFP carries a real
         MW (27,015 Da), so its fluorescence maps to a true g/L titer. PETase and
         reteplase have MW=None, so the pipeline's concentration_g_L field is
         dimensionally µM of released product (PNP / AMC) read off each assay's
         product standard curve — an apparent activity, not a titer. Verified: the
         stored value is reproduced (R²≈0.98) from endpoint fluorescence via that
         curve, and equals the initial release rate × read time. -->
    <p class="assay-metric-note">
      <strong>Key metric.</strong> sfGFP reports a true expression <em>titer</em> — g/L of folded
      protein, read directly by fluorescence against a purified-sfGFP curve. PETase and reteplase
      report enzyme <em>activity</em> — the amount of product released (pNP for PETase, AMC for
      reteplase), read as an endpoint concentration in <em>µM</em> against each assay's product
      standard curve (equivalently, the initial release rate × read time). That is an observed
      activity measurement, not a verified physical yield, and the numbers are never comparable
      across the three targets.
    </p>
    <div class="cf-3col">
      <div class="cf-card">
        <div class="cf-ct">sfGFP <small>endpoint fluorescence</small></div>
        <div class="assay-anim" aria-hidden="true">
          <div class="assay-stage">
            <span class="assay-lbl assay-lbl--l">485 nm ex</span>
            <span class="assay-lbl assay-lbl--r">510 nm em</span>
            <span class="assay-photon assay-photon--ex"></span>
            <span class="assay-node assay-node--gfp">GFP</span>
            <span class="assay-photon assay-photon--em"></span>
          </div>
          <p class="assay-cap">Blue excitation light (485 nm) drives the chromophore to emit green (510 nm) — read directly in-plate.</p>
        </div>
        <div class="cf-dl">
          <span class="cf-dk">Key metric</span><span class="cf-dv"><strong>Titer</strong> — g/L folded protein (real yield)</span>
          <span class="cf-dk">Plate</span><span class="cf-dv">CFPS reaction plate (direct)</span>
          <span class="cf-dk">Dilution</span><span class="cf-dv">None — read in-plate</span>
          <span class="cf-dk">Volume</span><span class="cf-dv">20 µL</span>
        </div>
      </div>
      <div class="cf-card">
        <div class="cf-ct">PETase <small>OD 405 nm, kinetic</small></div>
        <div class="assay-anim" aria-hidden="true">
          <div class="assay-stage">
            <span class="assay-lbl assay-lbl--l">pNP-ester</span>
            <span class="assay-lbl assay-lbl--r">OD 405</span>
            <span class="assay-well"><span class="assay-well__fill"></span></span>
          </div>
          <p class="assay-cap">The esterase attacks the ester bond of p-nitrophenyl hexanoate (pNPH): a water molecule splits the substrate into hexanoic acid and para-nitrophenol. In the alkaline buffer (pH 8) the para-nitrophenol loses a proton — it deprotonates to the para-nitrophenolate anion, whose extended, delocalised electron system now absorbs violet and blue light. With those wavelengths removed, the solution transmits the rest and reads yellow to the eye — tracked as absorbance at OD 405 nm.</p>
        </div>
        <div class="cf-dl">
          <span class="cf-dk">Key metric</span><span class="cf-dv"><strong>Activity</strong> — pNP released (µM endpoint vs standard curve), not a yield</span>
          <span class="cf-dk">Dilution</span><span class="cf-dv">600× (final read)</span>
          <span class="cf-dk">Buffer</span><span class="cf-dv">PBS pH 8</span>
          <span class="cf-dk">Reads</span><span class="cf-dv">15 cycles, 0–28 min (~2 min apart)</span>
          <span class="cf-dk">Rate window</span><span class="cf-dv">First 6 cycles (0–10 min), linear phase</span>
        </div>
      </div>
      <div class="cf-card">
        <div class="cf-ct">Reteplase <small>345 ex / 445 em, kinetic</small></div>
        <div class="assay-anim" aria-hidden="true">
          <div class="assay-stage">
            <span class="assay-lbl assay-lbl--l">IPR–AMC</span>
            <span class="assay-lbl assay-lbl--r">445 nm em</span>
            <!-- One substrate = IPR peptide + attached AMC; the protease snips the
                 bond, the AMC fragment detaches and lights up (fluorescent). -->
            <span class="assay-sub">
              <span class="assay-pep">IPR</span>
              <span class="assay-bond"></span>
              <span class="assay-amc">AMC</span>
            </span>
            <span class="assay-scissor">✂</span>
          </div>
          <p class="assay-cap">Reteplase is a serine protease: it hydrolyses the amide bond just after the arginine of the D-Ile-Pro-Arg peptide, releasing free 7-amino-4-methylcoumarin (AMC). Tethered to the peptide the coumarin is held dark, but once its amino group is freed it donates electrons into the ring's conjugated system. Ultraviolet excitation at 345 nm now lifts those electrons; as they relax they emit blue light at 445 nm — and the rate at which that fluorescence climbs scales with protease activity.</p>
        </div>
        <div class="cf-dl">
          <span class="cf-dk">Key metric</span><span class="cf-dv"><strong>Activity</strong> — AMC released (µM endpoint vs standard curve), not a yield</span>
          <span class="cf-dk">Dilution</span><span class="cf-dv">2× (direct in CFPS plate)</span>
          <span class="cf-dk">Buffer</span><span class="cf-dv">Assay buffer e12461 — 50 mM Tris-HCl pH 8.0, 150 mM NaCl, 0.1% Tween-20</span>
          <span class="cf-dk">Reads</span><span class="cf-dv">15 reads over ~8 h — ambient between reads (kinetic loop)</span>
          <span class="cf-dk">Rate window</span><span class="cf-dv">Early linear reads, OLS slope</span>
        </div>
      </div>
    </div>

  </div></div>

  <!-- ================= ASSAY DETAILS ================= -->
  <div class="cf-block-hd">Assay Details &amp; Starting Data</div>
  <div class="cf-block-sub">How the signal is captured — kinetic plate reads and the calibration curves behind each unit — plus the reagent ranges across the plates we actually ran.</div>
  <div class="panel"><div class="panel__bd">

    <!-- 2b · plate reads (control kinetic reads, one plate per lysate batch) -->
    {#if data.plateReader?.targets?.length}
      <div class="cf-sechd" style="margin:16px 0 8px;">
        <span class="label">plate reads</span>
        <span class="cf-sechd__note">{data.plateReader.label ?? 'kinetic control reads'}</span>
      </div>
      {#if wellLoadMessage}
        <p class="cf-wellmsg">{wellLoadMessage}</p>
      {/if}
      <div class="cf-3col">
        {#each data.plateReader.targets as t, i}
          <PlateReaderCard target={t} onExpand={(batch) => openPlateReader(i, batch)} />
        {/each}
      </div>
    {/if}

    <!-- 2c · standard curves (assay calibration references — collapsed by default) -->
    <div class="cf-sechd" style="margin:16px 0 8px;">
      <span class="label">standard curves</span>
      <span class="cf-sechd__note">assay calibration references</span>
      <button
        type="button"
        class="cf-toggle"
        aria-expanded={showStandardCurves}
        onclick={() => (showStandardCurves = !showStandardCurves)}
      >{showStandardCurves ? 'Hide' : 'Show'}</button>
    </div>
    {#if showStandardCurves}
      <div class="inset" style="padding:10px 12px;">
        <div class="cf-3col cf-std-grid">
          <div class="cf-std-col">
            <div class="cf-ct cf-std-ct">sfGFP <small>— 2 µL/well, purified sfGFP</small></div>
            <table class="cf-std">
              <thead><tr><th>Row</th><th>µM</th><th>g/L</th></tr></thead>
              <tbody>
                <!-- g/L = µM × MW / 1e6, sfGFP MW 27,015 Da -->
                {#each [['A',118.9],['B',90],['C',59.45],['D',45],['E',29.725],['F',22.5],['G',14.8625],['H',11.25],['I',7.43125],['J',5.625],['K',3.715625],['L',2.8125],['M',1.8578125],['N',1.40625],['O',0.92890625],['P',0]] as [row,conc]}
                  <tr><td class="faint">{row}</td><td>{conc.toFixed(2)}</td><td>{(conc * 27015 / 1e6).toFixed(2)}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="cf-std-col">
            <div class="cf-ct cf-std-ct">PETase <small>— 4 µL/well (stocks mM → µM in plate)</small></div>
            <table class="cf-std">
              <thead><tr><th>PNP (µM)</th><th>PNPH (µM)</th></tr></thead>
              <tbody>
                {#each [[400,0],[400,0],[200,200],[200,200],[100,300],[100,300],[50,350],[50,350],[25,375],[25,375],[12.5,387.5],[12.5,387.5],[6.25,393.75],[6.25,393.75],[0,400],[0,400]] as [pnp,pnph]}
                  <tr><td>{pnp.toFixed(2)}</td><td>{pnph.toFixed(2)}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="cf-std-col">
            <div class="cf-ct cf-std-ct">Reteplase <small>— 2 µL in 38 µL total</small></div>
            <table class="cf-std">
              <thead><tr><th>AMC (µM)</th><th>IPR-AMC (µM)</th></tr></thead>
              <tbody>
                {#each [[25,0],[25,0],[12.5,12.5],[12.5,12.5],[6.25,18.75],[6.25,18.75],[3.125,21.875],[3.125,21.875],[1.5625,23.4375],[1.5625,23.4375],[0.78125,24.21875],[0.78125,24.21875],[0.390625,24.609375],[0.390625,24.609375],[0,25],[0,25]] as [amc,ipr]}
                  <tr><td>{amc.toFixed(2)}</td><td>{ipr.toFixed(2)}</td></tr>
                {/each}
              </tbody>
            </table>
            <div class="cf-std-foot">AMC standard: 7-amino-4-methylcoumarin in DMSO · IPR-AMC substrate: D-Ile-Pro-Arg-AMC in DMSO</div>
          </div>
        </div>
      </div>
    {/if}

    <!-- 2d · starting data (reagent ranges across the plates we actually ran) -->
    {#if data.plateAnalysis}
      <div class="cf-sechd" style="margin:16px 0 8px;">
        <span class="label">starting data</span>
        <span class="cf-sechd__note">reagent ranges across the plates we ran</span>
      </div>
      <PlateAnalysis analysis={data.plateAnalysis} />
    {/if}

  </div></div>

  <!-- ================= FOLDING SIMULATION ================= -->
  <div class="cf-block-hd">Folding Simulation</div>
  <div class="cf-block-sub">From a flat chain of amino acids to the working shape each assay measures — scrub the timeline to watch secondary structure, hydrophobic collapse, and the disulfide bonds snap into place.</div>
  <div class="panel"><div class="panel__bd">
    <FoldingSimulation
      structures={[
        { key: 'sfgfp',     name: 'sfGFP',     pdb: 'https://files.rcsb.org/download/2B3P.pdb', accent: '#2f8f4e', glow: '#37e27a', sites: [65, 66, 67] },
        { key: 'petase',    name: 'PETase',    pdb: 'https://files.rcsb.org/download/4CG1.pdb', accent: '#e08a1e', glow: '#ff9d2e', sites: [130, 176, 208] },
        { key: 'reteplase', name: 'Reteplase', pdb: 'https://files.rcsb.org/download/1RTF.pdb', accent: '#cc3b2e', glow: '#ff4a3a', sites: [57, 102, 195] }
      ]}
    />
  </div></div>

  <!-- ================= PROCESS DETAILS ================= -->
  <div class="cf-block-hd">Process Details</div>
  <div class="cf-block-sub">How the reactions are built and run — the shared automation backbone and the floor it runs on.</div>
  <div class="panel"><div class="panel__bd">

    <!-- 3 · process -->
    <div class="label" style="margin:4px 0 4px;">process</div>
    <div class="pdesc">Shared prep backbone — Echo hitpick → Bravo stamp → incubate — then a protein-specific readout tail (highlighted). Click any step for its transfer specs.</div>
    <div class="proc-scroll">
      {#each PROCESS_FLOWS as flow}
        {@const openIdx = openStep[flow.name]}
        <div class="proc-row">
          <div class="proc-name" style="--accent:{flow.accent};">
            <span class="proc-name__txt">{flow.name}</span>
          </div>
          <div class="proc-col">
            <div class="proc-track">
              {#each flow.steps as step, i}
                {#if i > 0}<span class="proc-conn" aria-hidden="true">›</span>{/if}
                <button
                  type="button"
                  class="proc-step"
                  class:sig={step.kind === 'sig'}
                  class:open={openIdx === i}
                  aria-expanded={openIdx === i}
                  onclick={() => toggleStep(flow.name, i)}
                  style="--accent:{flow.accent};--wash:{flow.wash};"
                >
                  <span class="proc-tag">{step.tag}</span>
                  <span class="proc-title">{step.title}</span>
                  <span class="proc-note">{step.note}</span>
                  {#if step.detail}<span class="proc-more" aria-hidden="true">{openIdx === i ? '−' : '+'}</span>{/if}
                </button>
              {/each}
            </div>
            {#if openIdx != null && flow.steps[openIdx]?.detail}
              {@const step = flow.steps[openIdx]}
              <div class="proc-detail" style="--accent:{flow.accent};">
                <div class="proc-detail__hd">
                  <span class="proc-detail__step">{step.tag} · {step.title}</span>
                  {#if step.detailNote}<span class="proc-detail__note">{step.detailNote}</span>{/if}
                </div>
                <dl class="proc-specs">
                  {#each step.detail as d}
                    <div class="proc-spec">
                      <dt>{d.k}</dt>
                      <dd>{d.v}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- automation: autoplaying clips of plates moving on Nebula / MagneMotion.
         Temporarily hidden at the user's request ("remove the videos for now") —
         uncomment this block to bring the Nebula-floor clips back.
    <div class="label" style="margin:20px 0 4px;">automation</div>
    <div class="pdesc">Live from the Nebula floor — plates in motion: storage retrieval, MagneMotion transport, and loading into the Echo 525 acoustic dispenser.</div>
    <div class="proc-clips">
      <figure class="proc-clip">
        <video autoplay loop muted playsinline>
          <source src="/clips/output_1.mp4" type="video/mp4" />
        </video>
        <figcaption>Retrieval from storage</figcaption>
      </figure>
      <figure class="proc-clip">
        <video autoplay loop muted playsinline>
          <source src="/clips/output_2.mp4" type="video/mp4" />
        </video>
        <figcaption>Travel on MagneMotion</figcaption>
      </figure>
      <figure class="proc-clip">
        <video autoplay loop muted playsinline>
          <source src="/clips/output_3.mp4" type="video/mp4" />
        </video>
        <figcaption>Culture plate → Echo 525</figcaption>
      </figure>
      <figure class="proc-clip">
        <video autoplay loop muted playsinline>
          <source src="/clips/output_4.mp4" type="video/mp4" />
        </video>
        <figcaption>Agar plate → Echo 525</figcaption>
      </figure>
    </div>
    -->

  </div></div>

  <!-- ================= page footer · repository link ================= -->
  <footer class="cf-footer">
    <a
      class="btn-bp cf-footer__gh"
      href="https://github.com/RonanChance/htgaa-automation"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View this project on GitHub"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      View on GitHub
    </a>
    <nav class="cf-footer__legal" aria-label="Legal and data-use policies">
      <a href="/cfps/legal#privacy">Privacy</a>
      <span aria-hidden="true">·</span>
      <a href="/cfps/legal#cookies">Cookies</a>
      <span aria-hidden="true">·</span>
      <a href="/cfps/legal#terms">Terms</a>
    </nav>
  </footer>

</div>
{/if}
{:else}
  <div class="page" style="min-height:60vh;display:grid;place-items:center;color:var(--muted);">
    <p>Loading CFPS reagents…</p>
  </div>
{/if}

<!-- Reagent recipe popover — opened by the ⓘ next to a reagent name in the
     composition table or benchmarks table. Click backdrop or ✕ to close. -->
{#if activeRecipe}
  <div class="ck-modal-ov" onclick={closeRecipe} role="presentation">
    <div class="ck-modal__panel" style="width:min(680px,96vw);" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Reagent recipe">
      <div class="ck-modal__hd">
        <div class="ck-modal__ttl">
          <b>{activeRecipe.title}</b>
          <span class="ck-modal__sub">{activeRecipe.subtitle}</span>
        </div>
        <button type="button" class="icon ck-modal__x" onclick={closeRecipe} aria-label="Close">✕</button>
      </div>
      <div class="ck-modal__bd">
        <table class="cfps-table">
          <thead><tr><th>Ingredient</th><th>Supplier</th><th style="text-align:right;">Mass</th></tr></thead>
          <tbody>
            {#each activeRecipe.ingredients as row}
              <tr>
                <td>{row.name}</td>
                <td class="muted">{row.supplier}</td>
                <td style="text-align:right;">{row.mass_g.toFixed(2)} g</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}

<!-- Submit composition confirm modal — review/edit sample_id + metadata before the
     write to cfps_designs. Backdrop or ✕ closes (unless a submit is in flight). -->
{#if showSubmitModal}
  <div class="ck-modal-ov" onclick={closeSubmitModal} role="presentation">
    <div class="ck-modal__panel" style="width:min(520px,96vw);" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={submitMode === 'update' ? 'Update composition' : 'Submit composition'}>
      <div class="ck-modal__hd">
        <div class="ck-modal__ttl">
          {#if submitMode === 'update'}
            <b>{updatePlan.creates.length
              ? `Update ${updatePlan.updates.length} + add ${updatePlan.creates.length} new`
              : (updatePlan.updates.length > 1 ? `Update batch · ${updatePlan.updates.length} compositions` : 'Update composition')}</b>
            <span class="ck-modal__sub">{updatePlan.creates.length
              ? `Overwrites your ${updatePlan.updates.length} loaded composition${updatePlan.updates.length === 1 ? '' : 's'} in place and adds ${updatePlan.creates.length} new column${updatePlan.creates.length === 1 ? '' : 's'} to the same batch. Sample IDs of your existing compositions are kept.`
              : `Overwrites your loaded composition${updatePlan.updates.length === 1 ? '' : 's'} in place — the sample ID${updatePlan.updates.length === 1 ? '' : 's'} and submission${updatePlan.updates.length === 1 ? '' : 's'} stay, only the recipe and notes change.`}</span>
          {:else}
            <b>{batchMixCount > 1 ? `Submit batch · ${batchMixCount} compositions` : 'Submit composition'}</b>
            <span class="ck-modal__sub">{batchMixCount > 1
              ? 'Writes every Mix column to cfps_designs. Sample IDs are generated per composition; each mix keeps its own protein target and per-mix rationale. The overall experiment hypothesis, AI model, and acknowledgements apply to the whole group.'
              : 'Review the sample ID and metadata, then save to cfps_designs.'}</span>
          {/if}
        </div>
        <button type="button" class="icon ck-modal__x" onclick={closeSubmitModal} aria-label="Close">✕</button>
      </div>
      <div class="ck-modal__bd">
        <div class="cf-form">
          {#if batchMixCount === 1 && submitMode === 'create'}
            <label>
              <span class="cf-lbl">Sample ID <span class="cf-charcount">{submitSampleId.length}/{LIMIT_SHORT}</span></span>
              <input type="text" class="cf-in no-autofill" placeholder="e.g. ada_lovelace_2026-09-27" autocomplete="off" maxlength={LIMIT_SHORT} bind:value={submitSampleId} />
            </label>
          {/if}
          <label>
            <span class="cf-lbl">AI model <span class="cf-charcount">{designAiModel.length}/{LIMIT_SHORT}</span></span>
            <input type="text" class="cf-in no-autofill" placeholder="e.g. claude-opus-4-8" autocomplete="off" maxlength={LIMIT_SHORT} bind:value={designAiModel} />
          </label>
          <label>
            <span class="cf-lbl">Acknowledgements <span class="cf-charcount">{designAcknowledgements.length}/{LIMIT_SHORT}</span></span>
            <input type="text" class="cf-in no-autofill" placeholder="collaborators to credit" autocomplete="off" maxlength={LIMIT_SHORT} bind:value={designAcknowledgements} />
          </label>
          {#if batchMixCount === 1}
            <label>
              <span class="cf-lbl"><span>Hypothesis being tested <span class="cf-req" title="Required">*</span></span> <span class="cf-charcount">{(mixComments[mixes[0].id] || '').length}/{LIMIT_COMMENTS}</span></span>
              <textarea class="cf-in" placeholder="e.g. Increasing X by 100 nL will increase sfGFP yield" maxlength={LIMIT_COMMENTS} bind:value={mixComments[mixes[0].id]}></textarea>
            </label>
          {:else}
            <label>
              <span class="cf-lbl"><span>Overall Experiment Hypothesis <span class="cf-req" title="Required">*</span></span> <span class="cf-charcount">{experimentHypothesis.length}/{LIMIT_COMMENTS}</span></span>
              <textarea class="cf-in" placeholder={`e.g. the question this group of ${batchMixCount} conditions is designed to answer`} maxlength={LIMIT_COMMENTS} bind:value={experimentHypothesis}></textarea>
            </label>
            <div class="cf-batch-comments">
              <span class="cf-batch-comments__hd">Per-mix rationale <span class="cf-req" title="Required, one per composition">*</span></span>
              {#each submitMixList as m (m.id)}
                <label class="cf-batch-comment">
                  <span class="cf-lbl">
                    <span>{mixLabel(m.n)} <span class="cf-batch-comment__tgt">· {m.proteinTarget}</span></span>
                    <span class="cf-charcount">{(mixComments[m.id] || '').length}/{LIMIT_COMMENTS}</span>
                  </span>
                  <textarea class="cf-in" rows="2" placeholder={`rationale for ${mixLabel(m.n)}`} maxlength={LIMIT_COMMENTS} bind:value={mixComments[m.id]}></textarea>
                </label>
              {/each}
            </div>
          {/if}
          {#if submitError}
            <p style="margin:0;font-size:11px;color:var(--err);">{submitError}</p>
          {/if}
        </div>
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px;">
          <button type="button" class="btn-bp" onclick={closeSubmitModal} disabled={submitBusy}>Cancel</button>
          {#if submitMode === 'update'}
            <button type="button" class="btn-bp" style="color:#fff;background:var(--teal);border-color:var(--teal-ink);" onclick={confirmUpdateDesign} disabled={submitBusy || submitHypothesisMissing} title={submitHypothesisMissing ? 'Add the hypothesis being tested before saving' : ''}>
              {#if submitBusy}Saving…{:else}{updateButtonLabel} ▸{/if}
            </button>
          {:else}
            <button type="button" class="btn-bp" style="color:#fff;background:var(--teal);border-color:var(--teal-ink);" onclick={confirmSubmitDesign} disabled={submitBusy || submitHypothesisMissing} title={submitHypothesisMissing ? 'Add the hypothesis being tested before submitting' : ''}>
              {#if submitBusy}Submitting…{:else if batchMixCount > 1}Submit {batchMixCount} ▸{:else}Submit ▸{/if}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<dialog id="upload_modal" class="cfps-dialog" bind:this={uploadModal} onclick={(e) => { if (e.target === uploadModal) uploadModal.close(); }}>
  <div style="padding:16px;">
    <div style="font:500 16px/1.15 var(--sans);color:var(--ink);">Ready to publish?</div>
    <p style="margin:8px 0 0;font-size:12px;color:var(--muted);">Select HTGAA Node and add your HTGAA username / rationale for this CFPS design.</p>

    <div class="cf-form" style="margin-top:14px;">
      <label>HTGAA Node (required)
        <select class="cf-in" bind:value={selectedNodeDisplay}>
          <option value="" disabled>Select a node</option>
          {#each HTGAA_NODE_OPTIONS as nodeOption}
            <option value={nodeOption}>{nodeOption}</option>
          {/each}
        </select>
      </label>
      <label>HTGAA Username
        <input type="text" class="cf-in no-autofill" placeholder="username" autocomplete="off" maxlength="100" bind:value={author} />
      </label>
      <label>Rationale
        <textarea class="cf-in" placeholder="Why this formulation?" maxlength="1000" bind:value={rationale}></textarea>
      </label>
      {#if publishFormError}
        <p style="margin:0;font-size:11px;color:var(--err);">{publishFormError}</p>
      {/if}
    </div>

    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px;">
      <form method="dialog" style="margin:0;"><button type="submit" class="btn-bp">Cancel</button></form>
      <button type="button" class="btn-bp" style="color:#fff;background:var(--teal);border-color:var(--teal-ink);" onclick={publishDesign} disabled={isPublishing}>
        {#if !isPublishing}Publish ▸{:else}Publishing…{/if}
      </button>
    </div>
  </div>
</dialog>

{#if plateReaderOpen && data.plateReader?.targets?.length}
  <PlateReaderModal
    data={data.plateReader}
    initialIndex={plateReaderTarget}
    initialBatch={plateReaderBatch}
    onLoadWell={loadWellRecipe}
    onSelectComposition={loadCompositionIntoComparison}
    onClose={() => (plateReaderOpen = false)}
  />
{/if}

</div>

<svelte:window onpointermove={handlePointerMove} onpointerup={endReagentDrag} onkeydown={handleGlobalKeydown} />

<style>
  /* thinner outer frame: halve the standard page padding (drives .page padding,
     the hero full-screen calc, and the comparison gap all at once). */
  .cfps-page {
    --pad: clamp(6px, 1.1vw, 13px);
    position: relative;
    z-index: 0;
    /* contain the full-bleed hero's 100vw so it can't add a horizontal scrollbar */
    overflow-x: clip;
  }
  /* Blinking terminal caret trailing the reagent-prompt typewriter reveal. */
  .cfps-caret {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    vertical-align: text-bottom;
    margin-left: 1px;
    background: var(--phosphor, #4be08f);
    animation: cfps-caret-blink 1s steps(1, end) infinite;
  }
  .cfps-caret--done { opacity: 0.55; } /* keep a gentle idle cursor after typing */
  @keyframes cfps-caret-blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .cfps-caret { animation: none; opacity: 0.55; }
  }
  /* full-screen welcome hero: a framed black box that fills the viewport, with
     the same grey --pad frame on all four sides (page padding top/sides, the
     collapsing section gap below). Named .brand-hero to avoid daisyUI's .hero
     (display:grid) which would overlap the children instead of stacking them. */
  .brand-hero {
    background: #000;
    overflow: hidden;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    /* centre the whole stack (content + CTA) so whitespace is symmetric top/bottom
       and the CTA sits a balanced distance below the logos rather than pinned far away */
    justify-content: center;
    /* Full-bleed: break out of the .page max-width + --pad frame so the intro is
       edge-to-edge solid black (no rounded "container" remnant, no grid gutters). */
    position: relative;
    width: 100vw;
    left: 50%;
    margin-left: -50vw;
    margin-top: calc(-1 * var(--pad));
  }
  /* cinematic manifesto band: full-bleed card between the hero and the designer.
     Solid black at the top continues the intro, then the ground fades to
     transparent at the bottom so the body's dark-grey + blueprint-grid texture
     bleeds through — a soft transition into the designer rather than a hard cut. */
  .cf-manifesto {
    background: linear-gradient(180deg, #000 0%, #000 38%, rgba(0, 0, 0, 0) 100%);
    /* full-bleed: break out of the .page max-width + --pad frame like the hero */
    position: relative;
    width: 100vw;
    left: 50%;
    margin-left: -50vw;
    margin-top: calc(-1 * var(--pad));  /* collapse the section gap above */
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    /* less space above the line, more below it — balanced, and the extra bottom
       room lets the black fade fully into the grid before the designer begins */
    padding: clamp(40px, 8vh, 90px) clamp(20px, 7vw, 120px) clamp(104px, 21vh, 230px);
  }
  .cf-manifesto :global(.decode-text) {
    max-width: 52ch;
    font-size: clamp(12px, 1.5vw, 18px);  /* a touch smaller than the component default */
  }

  /* community reagents (full width) stacked over the reagent prompt. The prompt
     keeps a definite height so its <pre> scrolls internally. */
  .cf-reagent-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 28px auto 0;
  }
  .cf-reagent-stack .cf-fill { height: clamp(360px, 46vh, 520px); }
  /* the prompt card fills its height; the prompt <pre> scrolls inside it */
  .cf-fill { display: flex; flex-direction: column; min-height: 0; margin: 0; }
  .cf-fill .panel__bd {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cf-fill .cfps-prompt { flex: 1 1 auto; min-height: 0; max-height: none; margin: 0; }

  /* terminal aesthetic for the reagent prompt — dark ground, white text + outline,
     to match the rest of the page rather than the light data cards.
     Written as `.panel.panel--term` (not just `.panel--term`) on purpose: the global
     `.cfps-page .panel` rule sets a light background at the SAME specificity (0,2,0),
     so a bare `.panel--term` only wins by source order — which flips between the dev
     (inline <style>) and production (bundled CSS) builds, and dropped the dark ground
     in production. The extra class makes this rule (0,3,0) so the dark ground always
     wins. (The descendant rules below already compute higher and are unaffected.) */
  .panel.panel--term {
    background: rgba(8, 9, 11, 0.92);
    border-color: rgba(255, 255, 255, 0.28);
  }
  .panel--term .panel__hd { border-bottom-color: rgba(255, 255, 255, 0.2); }
  .panel--term .panel__hd .label { color: #ffffff; }
  .panel--term .panel__hd .icon {
    color: rgba(255, 255, 255, 0.75);
    border-color: rgba(255, 255, 255, 0.25);
    background: transparent;
  }
  .panel--term .panel__hd .icon:hover { color: #ffffff; background: rgba(255, 255, 255, 0.12); }
  .panel--term .cfps-prompt {
    background: rgba(0, 0, 0, 0.34);
    border-color: rgba(255, 255, 255, 0.22);
    color: #ffffff;
  }
  .panel--term .cfps-prompt::selection { background: rgba(255, 255, 255, 0.28); }
  .panel--term .cfps-caret { background: #ffffff; }
  /* core content (tagline · proteins · logos) — sized to content so it doesn't
     grow and shove the CTA to the bottom of the viewport */
  .brand-hero__main {
    flex: 0 1 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  /* CTA row, a balanced gap below the logos */
  .brand-hero__cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: clamp(28px, 4.5vh, 56px) 16px 0;
  }
  /* quieter text link to the coopetition doc, sitting under the Learn more CTA */
  .hero-doclink {
    color: rgba(255, 255, 255, 0.62);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    text-decoration: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.28);
    padding-bottom: 2px;
    opacity: 0;
    animation: learn-more-in 0.7s ease 1.9s forwards;
    transition: color 0.2s ease, border-color 0.2s ease;
  }
  .hero-doclink:hover,
  .hero-doclink:focus-visible {
    color: #fff;
    border-bottom-color: #fff;
    outline: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-doclink { opacity: 1; animation: none; }
  }
  /* white outline "skeleton" button; fades in a beat after the page settles */
  .learn-more {
    cursor: pointer;
    background: transparent;
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 999px;
    padding: 11px 24px;
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    display: inline-flex;
    align-items: center;
    gap: 0.6em;
    opacity: 0;
    transform: translateY(10px);
    animation: learn-more-in 0.7s ease 1.6s forwards;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  }
  .learn-more:hover,
  .learn-more:focus-visible {
    background: #fff;
    color: #000;
    border-color: #fff;
    outline: none;
  }
  .learn-more__arrow {
    font-size: 1.05em;
    line-height: 1;
    animation: learn-more-bob 1.8s ease-in-out 2.3s infinite;
  }
  @keyframes learn-more-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes learn-more-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(3px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .learn-more { opacity: 1; transform: none; animation: none; }
    .learn-more__arrow { animation: none; }
  }
  /* tagline across the top of the header, above the proteins */
  .brand-tagline {
    margin: 0;
    background: #000;
    text-align: center;
    color: #fff;
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    font-size: clamp(11px, 1.45vw, 15px);
    letter-spacing: 0.26em;
    text-indent: 0.26em;   /* balance trailing letter-spacing so it optically centres */
    text-transform: uppercase;
    padding: 22px 16px 10px;
  }
  /* Ginkgo × HTBAA crossover lockup */
  .crossover {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(12px, 2.6vw, 30px);
    /* more breathing room between the proteins and the logos (was 12px) */
    padding: clamp(30px, 5vh, 60px) 16px 0;
    background: #000;
  }
  .crossover__link {
    display: inline-flex;
    align-items: center;
    line-height: 0;
    transition: opacity 0.15s ease;
  }
  .crossover__link:hover { opacity: 0.82; }
  .crossover__logo {
    display: block;
    width: auto;
    object-fit: contain;
  }
  .crossover__logo--ginkgo { height: clamp(32px, 4.6vw, 54px); }
  .crossover__logo--htgaa {
    height: clamp(66px, 9vw, 104px);
    border-radius: 8px;
  }
  /* the "cool X" — a crisp emblem with a soft glow and a slow pulse */
  .crossover__x {
    flex: none;
    width: clamp(20px, 2.4vw, 28px);
    height: clamp(20px, 2.4vw, 28px);
    overflow: visible;
    color: #fff;
  }
  .crossover__x line {
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.55));
    animation: crossover-pulse 3.4s ease-in-out infinite;
  }
  @keyframes crossover-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .crossover__x line { animation: none; opacity: 0.9; }
  }

  /* ── assay mechanism micro-animations ──────────────────────────────────── */
  .assay-anim { margin: 2px 0 10px; }
  .assay-stage {
    position: relative;
    height: 48px;
    border-radius: var(--r-sm);
    background: var(--recess);
    border: 1px solid var(--hair);
    overflow: hidden;
  }
  .assay-cap {
    margin: 6px 0 0;
    font: 9.5px/1.45 var(--mono);
    color: var(--muted);
  }
  /* Key-metric clarification banner above the three assay cards. */
  .assay-metric-note {
    margin: 0 0 12px;
    padding: 8px 11px;
    border: 1px solid var(--hair);
    border-left: 2px solid var(--muted);
    border-radius: var(--r-sm, 4px);
    background: var(--surface-2);
    font: 10.5px/1.5 var(--mono);
    color: var(--ink-2);
    max-width: 100%;
  }
  .assay-metric-note strong { color: var(--ink); }
  .assay-metric-note em { font-style: normal; color: var(--ink); font-weight: 600; }
  .assay-lbl {
    position: absolute;
    top: 4px;
    font: 7.5px/1 var(--mono);
    letter-spacing: 0.04em;
    color: var(--faint);
    text-transform: uppercase;
  }
  .assay-lbl--l { left: 7px; }
  .assay-lbl--r { right: 7px; }

  /* sfGFP — excitation photon → chromophore → emission photon */
  .assay-photon {
    position: absolute;
    top: 55%;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    transform: translateY(-50%);
  }
  .assay-photon--ex {
    background: #3b82f6;
    box-shadow: 0 0 6px 1px rgba(59, 130, 246, 0.7);
    animation: assay-ex 2.8s ease-in infinite;
  }
  .assay-photon--em {
    background: #22c55e;
    box-shadow: 0 0 6px 1px rgba(34, 197, 94, 0.7);
    animation: assay-em 2.8s ease-out infinite;
  }
  .assay-node--gfp {
    position: absolute;
    left: 50%;
    top: 55%;
    transform: translate(-50%, -50%);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #22c55e;
    color: #06210f;
    font: 600 8px/1 var(--mono);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: assay-gfp-glow 2.8s ease-in-out infinite;
  }
  @keyframes assay-ex {
    0%   { left: 8%;  opacity: 0; }
    12%  { opacity: 1; }
    40%  { left: 40%; opacity: 1; }
    48%  { left: 44%; opacity: 0; }
    100% { left: 44%; opacity: 0; }
  }
  @keyframes assay-em {
    0%, 48% { left: 56%; opacity: 0; }
    56%     { opacity: 1; }
    88%     { left: 90%; opacity: 1; }
    100%    { left: 92%; opacity: 0; }
  }
  @keyframes assay-gfp-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); filter: brightness(0.92); }
    50%      { box-shadow: 0 0 10px 2px rgba(34, 197, 94, 0.6); filter: brightness(1.18); }
  }

  /* PETase — colourless ester → yellow p-nitrophenol, read at OD 405 */
  .assay-well {
    position: absolute;
    left: 50%;
    top: 56%;
    transform: translate(-50%, -50%);
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--groove);
    background: var(--surface);
    overflow: hidden;
  }
  .assay-well__fill {
    position: absolute;
    inset: 0;
    animation: assay-colour 3s ease-in-out infinite;
  }
  @keyframes assay-colour {
    0%   { background: rgba(232, 181, 58, 0.06); }
    55%  { background: #e8b53a; }
    100% { background: rgba(232, 181, 58, 0.06); }
  }

  /* Reteplase — the protease snips the single IPR–AMC substrate; the released
     AMC fragment detaches and lights up (fluorescent), while the IPR peptide
     stays dark. One molecule, one cut, one part turns on — easy to follow. */
  .assay-sub {
    position: absolute;
    left: 46%;
    top: 55%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
  }
  .assay-pep {
    width: 30px;
    height: 11px;
    border-radius: 5px 2px 2px 5px;
    background: linear-gradient(90deg, #9aa4b2, #c3ccd4);
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 6px/1 var(--mono);
    letter-spacing: 0.06em;
    color: #1b2129;
  }
  .assay-bond {
    width: 4px;
    height: 3px;
    background: var(--ink-2);
    animation: assay-bond-break 2.8s ease-in-out infinite;
  }
  .assay-amc {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: #6b7686;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 5px/1 var(--mono);
    color: #0b1220;
    animation: assay-amc-release 2.8s ease-in-out infinite;
  }
  .assay-scissor {
    position: absolute;
    left: 53%;
    top: 30%;
    font-size: 12px;
    line-height: 1;
    color: var(--ink-2);
    transform: translate(-50%, -50%);
    transform-origin: center;
    animation: assay-snip 2.8s ease-in-out infinite;
  }
  @keyframes assay-bond-break {
    0%, 42%   { opacity: 1; }
    52%, 100% { opacity: 0; }
  }
  @keyframes assay-snip {
    0%, 100% { transform: translate(-50%, -50%) rotate(0deg) scale(1); opacity: 0.6; }
    42%      { transform: translate(-50%, -50%) translateY(4px) rotate(-13deg) scale(1.18); opacity: 1; }
    52%      { transform: translate(-50%, -50%) translateY(4px) rotate(9deg) scale(1.12); opacity: 1; }
  }
  @keyframes assay-amc-release {
    0%, 42%  { transform: translateX(0) scale(1); background: #6b7686; box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
    58%      { transform: translateX(8px) scale(1.05); background: #60a5fa; }
    74%, 90% { transform: translateX(15px) scale(1); background: #60a5fa; box-shadow: 0 0 12px 3px rgba(96, 165, 250, 0.8); }
    100%     { transform: translateX(0) scale(1); background: #6b7686; box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    /* Honour the OS "reduce motion" setting: drop the translational/spinning/scaling
       motion (photons flying, scissor rotating, dots scaling) that can trigger
       vestibular discomfort, but keep a calm opacity/colour/glow-only loop so every
       mechanism still animates and reads. (Desktop Chrome mirrors macOS System
       Settings → Accessibility → Display → Reduce motion; turn that off for the full
       lively version.) */
    .assay-photon--ex { left: 24%; animation: assay-soft 3.2s ease-in-out infinite; }
    .assay-photon--em { left: 74%; animation: assay-soft 3.2s ease-in-out infinite reverse; }
    .assay-node--gfp  { animation: assay-gfp-glow 3.2s ease-in-out infinite; }   /* glow only */
    .assay-well__fill { animation: assay-colour 4s ease-in-out infinite; }       /* colour only */
    .assay-pep        { animation: assay-soft 3.2s ease-in-out infinite; }
    .assay-bond       { animation: none; opacity: 0.6; }                         /* no flicker */
    .assay-scissor    { animation: none; opacity: 0.7; }                         /* no rotation */
    .assay-amc        { animation: assay-amc-soft 3.2s ease-in-out infinite; }   /* colour/glow only, no travel */
  }
  @keyframes assay-soft {
    0%, 100% { opacity: 0.25; }
    50%      { opacity: 1; }
  }
  @keyframes assay-amc-soft {
    0%, 100% { background: #6b7686; box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
    55%      { background: #60a5fa; box-shadow: 0 0 12px 3px rgba(96, 165, 250, 0.8); }
  }

  /* Short "why it matters" blurb under each target-protein card title. */
  .cf-blurb {
    margin: -2px 0 2px;
    font: 10.5px/1.5 var(--sans);
    color: var(--muted);
  }

  /* Target-protein name links out to its UniProt entry. */
  .cf-ct-link {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px dotted var(--muted);
    transition: color .12s var(--ease), border-color .12s var(--ease);
  }
  .cf-ct-link:hover {
    color: var(--teal);
    border-bottom-color: var(--teal);
  }

  /* "Submit composition" button — alone on its own row in the designer toolbar,
     centered under the row of option controls. */
  .cfps-submit {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin-top: 0;
  }
  .cfps-submit__btns {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    /* shrink to the widest button so Submit + Update share one width and stay
       centered under the toolbar (see .cfps-submit { align-items: center }). */
    width: max-content;
    max-width: 100%;
  }
  /* Tech-forward "transmit" button: gradient teal panel, a folding protein glyph
     that comes alive on hover, a sheen that sweeps on hover, and a nudging arrow. */
  .cfps-submit__btn {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    color: #fff;
    background: linear-gradient(180deg, color-mix(in srgb, var(--teal) 88%, #fff 12%) 0%, var(--teal) 52%, var(--teal-ink) 100%);
    border-color: var(--teal-ink);
    padding: 8px 20px;
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    gap: 9px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.18);
    transition: box-shadow .22s var(--ease), transform .12s var(--ease), filter .18s var(--ease);
  }
  /* sweeping sheen (kept — it fires on hover) */
  .cfps-submit__btn::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.32) 48%, transparent 72%);
    transform: translateX(-120%);
    transition: transform .6s var(--ease);
  }
  .cfps-submit__btn:hover:not([disabled]) {
    color: #fff;
    filter: brightness(1.04);
    box-shadow: 0 2px 6px rgba(0,0,0,0.2), 0 0 7px 0 rgba(15,124,132,0.3);
  }
  .cfps-submit__btn:hover:not([disabled])::before { transform: translateX(120%); }
  .cfps-submit__btn:active:not([disabled]) { transform: translateY(1px); }
  /* "Update existing" — a secondary, outline variant that sits directly beneath the
     primary Submit button and stretches to match its width (column flex above). */
  .cfps-submit__btn--update {
    color: var(--teal-ink);
    background: var(--surface);
    border-color: var(--teal);
    box-shadow: none;
    font-size: 11px;
    padding: 7px 18px;
  }
  .cfps-submit__btn--update:hover:not([disabled]) {
    color: var(--teal-ink);
    background: var(--teal-wash);
    filter: none;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
  /* protein glyph — static at rest; its beads pulse in a wave (a signal running
     down the chain) only while hovering, and it tumbles while transmitting. */
  .cfps-submit__mol { display: block; overflow: visible; }
  .cfps-submit__mol circle { transform-box: fill-box; transform-origin: center; }
  .cfps-submit__btn:hover:not([disabled]) .cfps-submit__mol circle {
    animation: cfps-mol-bead 0.95s ease-in-out infinite;
  }
  .cfps-submit__mol circle:nth-of-type(1) { animation-delay: 0s; }
  .cfps-submit__mol circle:nth-of-type(2) { animation-delay: 0.11s; }
  .cfps-submit__mol circle:nth-of-type(3) { animation-delay: 0.22s; }
  .cfps-submit__mol circle:nth-of-type(4) { animation-delay: 0.33s; }
  .cfps-submit__arrow {
    font-size: 1.05em; line-height: 1;
    transition: transform .16s var(--ease);
  }
  .cfps-submit__btn:hover:not([disabled]) .cfps-submit__arrow { transform: translateX(3px); }
  /* busy: molecule tumbles + beads keep pulsing, arrow hides */
  .cfps-submit__btn.is-busy .cfps-submit__mol { animation: cfps-mol-spin 1.1s linear infinite; }
  .cfps-submit__btn.is-busy .cfps-submit__mol circle { animation: cfps-mol-bead 0.95s ease-in-out infinite; }
  .cfps-submit__btn.is-busy .cfps-submit__arrow { display: none; }
  @keyframes cfps-mol-bead {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.55); }
  }
  @keyframes cfps-mol-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .cfps-submit__mol, .cfps-submit__mol circle, .cfps-submit__btn::before { animation: none; }
  }
  .cfps-submit__msg { margin: 0; font-size: 11px; }

  /* ── My Compositions manager ─────────────────────────────────────────────── */
  .cf-mydesigns { margin-top: 40px; }
  .cf-mydesigns__note { margin: 0 0 12px; font: 11px var(--mono); }
  .cf-mydesigns__group { margin-top: 16px; }
  .cf-mydesigns__grouphd {
    display: flex; align-items: center; gap: 7px;
    margin-bottom: 8px; padding-bottom: 5px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    border-bottom-color: color-mix(in srgb, var(--grp, #ffffff) 34%, rgba(255,255,255,0.12));
  }
  .cf-mydesigns__glyph { flex-shrink: 0; display: block; }
  .cf-mydesigns__grouptitle { color: var(--grp, var(--faint)); }
  .cf-mydesigns__grouphd .faint { font: 10px/1 var(--mono); margin-left: 2px; }
  .cf-mydesigns__grid {
    display: grid; gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }
  .cf-mydesign {
    position: relative;
    display: flex; flex-direction: column;
    cursor: grab;
    transition: border-color .12s var(--ease), box-shadow .12s var(--ease), opacity .12s var(--ease);
  }
  .cf-mydesign--editing { border-color: var(--teal); cursor: default; }
  .cf-mydesign--dragging { opacity: .45; cursor: grabbing; }
  .cf-mydesign--dragover {
    border-color: var(--teal);
    box-shadow: inset 3px 0 0 0 var(--teal), var(--shadow-1);
  }
  .cf-mydesign .panel__bd { flex: 1 1 auto; display: flex; flex-direction: column; gap: 7px; }

  /* Priority rank chip — nested flush into the card's top-left corner: monochrome,
     matches the card's outer radius, separated from the content by a hairline. */
  .cf-mydesign__rank {
    position: absolute; top: 0; left: 0; z-index: 2;
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 20px; height: 19px; padding: 0 5px;
    font: 700 10px/1 var(--mono);
    color: var(--ink-2); background: var(--surface-2);
    border-right: 1px solid var(--hair);
    border-bottom: 1px solid var(--hair);
    border-top-left-radius: var(--r);
    border-bottom-right-radius: var(--r-sm);
    pointer-events: none;
  }

  /* padding-left clears the corner rank chip so the title never tucks under it. */
  .cf-mydesign__hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-left: 12px; }
  .cf-mydesign__name {
    font: 600 12.5px/1.25 var(--sans); color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cf-mydesign__badge {
    flex-shrink: 0;
    font: 500 9.5px/1 var(--mono); letter-spacing: .04em;
    color: var(--teal-ink); background: var(--teal-wash);
    border: 1px solid var(--teal); border-radius: var(--r-sm); padding: 3px 6px;
  }
  /* Description takes the slot the date used to; grows so the footer pins to the
     bottom and cards in a row line up their collaborators + tools. */
  .cf-mydesign__desc {
    flex: 1 1 auto;
    font: 10.5px/1.45 var(--mono); color: var(--ink-2);
    white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 96px; overflow: auto;
  }
  .cf-mydesign__desc--empty { color: var(--faint); font-style: italic; }
  .cf-mydesign__foot {
    display: flex; align-items: center; gap: 8px; margin-top: 2px;
    padding-top: 6px; border-top: 1px solid var(--hair);
  }
  .cf-mydesign__collab {
    flex: 1 1 auto; min-width: 0;
    font: 9.5px/1.3 var(--mono); color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cf-mydesign__tools { flex-shrink: 0; margin-left: auto; display: flex; gap: 4px; }
  .cf-mydesign__tool {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 22px; padding: 0;
    color: var(--muted); background: var(--surface-2);
    border: 1px solid var(--groove); border-radius: var(--r-sm);
    cursor: pointer; transition: color .12s var(--ease), border-color .12s var(--ease), background .12s var(--ease);
  }
  .cf-mydesign__tool:hover:not([disabled]) { color: var(--ink); border-color: var(--teal); }
  .cf-mydesign__tool[disabled] { opacity: .5; cursor: default; }
  .cf-mydesign__tool--del:hover:not([disabled]) { color: var(--err); border-color: var(--err); }
  .cf-mydesign__tool--danger { color: #fff; background: var(--err); border-color: var(--err); }
  .cf-mydesign__tool--danger:hover:not([disabled]) { color: #fff; }
  .cf-mydesign__tool--ok { color: var(--phosphor); border-color: var(--phosphor); }
  .cf-mydesign__tool--load { color: var(--teal-ink); }
  .cf-mydesign__tool--load:hover:not([disabled]) { color: var(--teal-ink); background: var(--teal-wash); border-color: var(--teal); }

  .cf-mydesign__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }

  .cf-mydesign__field { display: flex; flex-direction: column; gap: 3px; }
  .cf-mydesign__field > span {
    font: 500 9.5px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  }
  .cf-mydesign__input {
    font: 11px/1.35 var(--mono); color: var(--ink);
    background: var(--surface-2); border: 1px solid var(--groove); border-radius: var(--r-sm);
    padding: 5px 7px; width: 100%; box-sizing: border-box;
  }
  .cf-mydesign__input:focus { outline: none; border-color: var(--teal); }
  textarea.cf-mydesign__input { resize: vertical; }

  /* Batch card in My Compositions: a group of compositions submitted together. The
     header/members are display-only; a footer toolbar carries load-all, copy-link,
     edit (expands the members for inline editing) and delete-batch controls. */
  .cf-batchcard { position: relative; }
  .cf-batchcard .panel__bd { display: flex; flex-direction: column; gap: 8px; }
  .cf-batchcard--editing { border-color: var(--teal); }
  .cf-batchcard__open {
    display: flex; flex-direction: column; gap: 8px; width: 100%;
  }
  .cf-batchcard__hd { display: flex; align-items: center; gap: 8px; }
  .cf-batchcard__count {
    flex-shrink: 0; font: 700 12px/1 var(--mono); letter-spacing: .04em;
    color: var(--teal-ink); background: var(--teal-wash); border: 1px solid var(--teal);
    border-radius: var(--r-sm); padding: 3px 6px;
  }
  .cf-batchcard__name {
    font: 600 12px/1.3 var(--mono); color: var(--ink); word-break: break-all;
    overflow: hidden; text-overflow: ellipsis;
  }
  .cf-batchcard__tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .cf-batchcard__members {
    list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px;
  }
  .cf-batchcard__member {
    display: flex; align-items: center; gap: 6px; font: 10px/1.3 var(--mono); color: var(--muted);
  }
  .cf-batchcard__mix {
    flex-shrink: 0; color: var(--faint); min-width: 34px;
  }
  .cf-batchcard__mname {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto;
  }
  .cf-batchcard__mtarget { flex-shrink: 0; color: var(--faint); }
  /* Per-member comments, enumerated by mix number in a bounded scroll box so a chatty
     batch never balloons the card's height. */
  .cf-batchcard__comments { display: flex; flex-direction: column; gap: 3px; }
  .cf-batchcard__commentshd {
    font: 500 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--faint);
  }
  .cf-batchcard__commentlist {
    list-style: none; margin: 0; padding: 6px 7px; display: flex; flex-direction: column; gap: 4px;
    max-height: 84px; overflow-y: auto;
    border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--surface-2);
    font: 10px/1.35 var(--mono); color: var(--muted);
  }
  .cf-batchcard__commentlist li { display: flex; gap: 5px; overflow-wrap: anywhere; }
  .cf-batchcard__commentn { flex: 0 0 auto; color: var(--teal-ink); }
  /* Expanded (editing) member list — each row carries its own load/link/edit tools,
     and swaps to the shared inline editor while that member is being edited. */
  .cf-batchcard__editlist {
    list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px;
  }
  .cf-batchcard__editmember {
    border: 1px solid var(--hair); border-radius: var(--r-sm); padding: 6px 7px;
    background: var(--surface-2); display: flex; flex-direction: column; gap: 6px;
  }
  .cf-batchcard__editmember--editing { border-color: var(--teal); }
  .cf-batchcard__memberrow {
    display: flex; align-items: center; gap: 6px; font: 10px/1.3 var(--mono); color: var(--muted);
  }
  .cf-batchcard__foot {
    display: flex; align-items: center; gap: 8px;
    border-top: 1px solid var(--hair); padding-top: 8px;
  }
  .cf-mydesign__tool--on { color: var(--teal-ink); border-color: var(--teal); background: var(--teal-wash); }

  /* Sequence viewer inside each target-protein card: amino-acid ⇄ DNA toggle,
     length readout, copy button, and a scrollable monospace sequence box. */
  .cf-seq {
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--hair);
  }
  .cf-seq-hd {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .cf-seq-tabs {
    display: inline-flex;
    border: 1px solid var(--hair);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .cf-seq-tab {
    font: 500 9.5px/1 var(--mono);
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--muted);
    background: transparent;
    border: 0;
    padding: 4px 7px;
    cursor: pointer;
    transition: color .12s var(--ease), background .12s var(--ease);
  }
  .cf-seq-tab + .cf-seq-tab { border-left: 1px solid var(--hair); }
  .cf-seq-tab:hover { color: var(--ink); }
  .cf-seq-tab.on { color: var(--ink); background: var(--surface); }
  .cf-seq-meta {
    margin-right: auto;
    font: 500 9.5px/1 var(--mono);
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .cf-seq-body {
    margin: 0;
    /* Fixed (not max-) height so a short sequence (e.g. sfGFP) fills the same box as
       the longer ones — that keeps every .cf-seq the same height, so with
       margin-top:auto pushing it to the card bottom the separators line up across
       all three equal-height cards. */
    height: 108px;
    overflow: auto;
    padding: 8px;
    background: var(--surface);
    border: 1px solid var(--hair);
    border-radius: var(--r-sm);
    font: 500 10px/1.5 var(--mono);
    letter-spacing: .04em;
    color: var(--ink-2);
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Inline show/hide toggle used in section headers (e.g. standard curves). */
  .cf-toggle {
    margin-left: auto;
    font: 10px var(--mono);
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--hair);
    border-radius: var(--r-sm);
    padding: 2px 9px;
    cursor: pointer;
    transition: color 0.14s ease, border-color 0.14s ease;
  }
  .cf-toggle:hover { color: var(--ink); border-color: var(--phosphor); }
  .cf-toggle[aria-expanded='true'] { color: var(--ink-2); border-color: var(--phosphor); }

  /* ── process timeline (per-protein automation flow) ───────────────── */
  .pdesc {
    margin: 0 0 10px;
    font: 10px/1.5 var(--mono);
    color: var(--muted);
    max-width: 720px;
  }
  .proc-scroll { overflow-x: auto; padding-bottom: 2px; }
  .proc-row { display: flex; align-items: stretch; gap: 12px; min-width: min-content; }
  .proc-row + .proc-row { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hair); }
  .proc-name {
    flex: 0 0 92px;
    position: relative;
    display: flex;
    align-items: center;
    padding-left: 11px;
  }
  .proc-name::before {
    content: "";
    position: absolute;
    left: 0; top: 8px; bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .proc-name__txt { font: 600 12px var(--sans); color: var(--ink); letter-spacing: 0.01em; }
  .proc-col { display: flex; flex-direction: column; gap: 10px; min-width: min-content; flex: 1; }
  .proc-track { display: flex; align-items: stretch; }
  .proc-step {
    position: relative;
    flex: 0 0 124px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-top: 2px solid var(--groove);
    border-radius: var(--r-sm);
    padding: 7px 9px 8px;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
  }
  .proc-step:hover { border-color: var(--accent); }
  .proc-step.open {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .proc-step.sig { border-top-color: var(--accent); background: var(--wash); }
  .proc-more {
    position: absolute;
    top: 5px; right: 7px;
    font: 11px var(--mono);
    color: var(--faint);
    line-height: 1;
  }
  .proc-step:hover .proc-more,
  .proc-step.open .proc-more { color: var(--accent); }
  /* expandable per-step transfer specs */
  .proc-detail {
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-left: 3px solid var(--accent);
    border-radius: var(--r-sm);
    padding: 10px 12px 11px;
    max-width: 640px;
  }
  .proc-detail__hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .proc-detail__step {
    font: 600 11px var(--sans);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .proc-detail__note { font: 9.5px/1.4 var(--mono); color: var(--muted); }
  .proc-specs { display: flex; flex-direction: column; gap: 5px; margin: 0; }
  .proc-spec { display: grid; grid-template-columns: 116px 1fr; gap: 10px; align-items: baseline; }
  .proc-spec dt {
    font: 8.5px var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .proc-spec dd { margin: 0; font: 10.5px/1.4 var(--mono); color: var(--ink-2); }
  .proc-tag {
    font: 8.5px var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .proc-step.sig .proc-tag { color: var(--accent); }
  .proc-title { font: 600 12px var(--sans); color: var(--ink); line-height: 1.1; }
  .proc-note { font: 9px/1.35 var(--mono); color: var(--muted); }
  .proc-conn {
    flex: 0 0 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faint);
    font: 15px var(--mono);
  }
  /* automation clips — compact autoplaying loops, no controls */
  .proc-clips {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 190px));
    justify-content: center;
    gap: 14px;
    margin-top: 4px;
  }
  .proc-clip { margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .proc-clip video {
    display: block;
    width: 100%;
    height: auto;
    background: #000;
    border: 1px solid var(--hair);
    border-radius: 14px;
  }
  .proc-clip figcaption {
    font: 8.5px/1.3 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    text-align: center;
  }

  /* page footer — repository link + legal links, centered under the last section */
  .cf-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: calc(var(--pad) * 2);
    padding-top: var(--pad);
    border-top: 1px solid var(--hair);
  }
  .cf-footer__gh {
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-decoration: none;
  }
  .cf-footer__legal {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 10px/1 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .cf-footer__legal a { color: var(--muted); text-decoration: none; }
  .cf-footer__legal a:hover { color: var(--teal); text-decoration: underline; }
</style>

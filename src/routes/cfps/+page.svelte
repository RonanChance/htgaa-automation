<script>
  import BenchmarksTable from './BenchmarksTable.svelte';
  import ProteinViewer from './ProteinViewer.svelte';
  import {
    mapFormulationToTargets,
    BENCHMARK_FORMULATIONS,
    REAGENT_ALIASES,
    BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID,
    STANDARD_BASE_BUFFER_NL
  } from '$lib/cfps-benchmarks.js';

  // Look up the unit (mM / g/L / U/mL) for a paper reagent name so the
  // theoretical-reagents banner can render "12 mM" instead of just "12".
  function unitForPaperName(name) {
    return REAGENT_ALIASES[name]?.unit ?? '';
  }

  let { data = {}, form } = $props();

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
    profile.label = `${benchmark.name} (${benchmark.year})`;
    // computeDefaultVolumes credits base buffer + water-fills to MAX_TOTAL_NL,
    // so the total pipetted volume lands at 20 µL regardless of formulation.
    volumesNl = { ...computeDefaultVolumes(selectedProfileKey) };
    theoreticalBanner = skipped.length
      ? { formulationName: `${benchmark.name} (${benchmark.year})`, items: skipped }
      : null;
  }

  function dismissTheoreticalBanner() {
    theoreticalBanner = null;
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

  function cyclePreset() {
    const total = BENCHMARK_FORMULATIONS.length + 1;
    const next = (presetCycleIndex + 1) % total;
    presetCycleIndex = next;
    if (next === 0) {
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
      loadBenchmarkFormulation(BENCHMARK_FORMULATIONS[next - 1]);
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
  let volumesNl = $state({ ...initialVolumes });
  let isPublishing = $state(false);
  let publishMessage = $state('');
  let publishError = $state('');

  let totalVolumeNl = $derived(
    allReagents.reduce((sum, reagent) => sum + (Number(volumesNl[reagent.id]) || 0), 0)
  );

  let uniqueReagentCount = $derived(
    new Set(
      visibleReagents
        .filter((reagent) => effectiveVolumeNlForReagent(reagent.id) > 0)
        .map((reagent) => reagent.id)
    ).size
  );

  let remainingNl = $derived(Math.max(0, MAX_TOTAL_NL - totalVolumeNl));

  let totalCostUsd = $derived(
    visibleReagents.reduce((sum, reagent) => sum + effectiveCostUsdForReagent(reagent), 0)
  );

  let costPerMlReaction = $derived(
    totalVolumeNl > 0 ? totalCostUsd / (totalVolumeNl / 1_000_000) : 0
  );

  let presetVolumesNl = $derived(computeDefaultVolumes(selectedProfileKey));
  let pieSlices = $derived(buildPieSlices());
  let summaryRows = $derived(buildSummaryRows());
  let exportedComposition = $derived(
    visibleReagents
      .filter((reagent) => !excludedFromExportIds.has(reagent.id))
      .map((reagent) => {
        const supplementalVolumeNl = Number(volumesNl[reagent.id]) || 0;
        return {
          id: reagent.id,
          supplemental_volume_nl: supplementalVolumeNl
        };
      })
      .filter((item) => item.supplemental_volume_nl > 0)
  );
  let exportedCompositionJson = $derived(JSON.stringify(exportedComposition, null, 2));
  let concentrationRankEntries = $derived(buildConcentrationRankEntries());
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
      .match(/^([0-9]*\.?[0-9]+)\s*%\s*v\/v$/i);
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
    return parseVolumePercent(reagent?.concentration);
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
    const profile = defaultTargetProfiles[profileKey];
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

  function buildSummaryRows() {
    return visibleReagents.map((reagent) => {
      if (fixedVolumeSummaryIds.has(reagent.id) || reagent.id === WATER_ID) {
        const baselineUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000;
        const currentUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, volumesNl) / 1000;
        const delta = currentUl - baselineUl;
        return {
          id: reagent.id,
          name: reagent.name,
          reagent,
          adjustable: false,
          unit: 'uL',
          baselineValue: baselineUl,
          currentValue: currentUl,
          delta,
          baselineLabel: formatUlValue(baselineUl),
          currentLabel: formatUlValue(currentUl),
          deltaLabel: formatDeltaLabel(delta, 'uL'),
          deltaPctLabel: formatPercentDelta(baselineUl, delta)
        };
      }

      const baselineMm = baselineMmForReagent(reagent);
      const currentMm = finalMmForReagent(reagent);
      const baselineGL = baselineGramsPerLiterForReagent(reagent);
      const currentGL = finalGramsPerLiterForReagent(reagent);
      const baselinePercent = baselineVolumePercentForReagent(reagent);
      const currentPercent = finalVolumePercentForReagent(reagent);

      if (baselineGL != null && currentGL != null) {
        const delta = currentGL - baselineGL;
        return {
          id: reagent.id,
          name: reagent.name,
          reagent,
          adjustable: reagent.fixedNl == null && reagent.id !== WATER_ID,
          unit: 'g/L',
          baselineValue: baselineGL,
          currentValue: currentGL,
          delta,
          baselineLabel: `${baselineGL.toFixed(3)} g/L`,
          currentLabel: `${currentGL.toFixed(3)} g/L`,
          deltaLabel: formatDeltaLabel(delta, 'g/L'),
          deltaPctLabel: formatPercentDelta(baselineGL, delta)
        };
      }

      if (baselineMm != null && currentMm != null) {
        const delta = currentMm - baselineMm;
        return {
          id: reagent.id,
          name: reagent.name,
          reagent,
          adjustable: reagent.fixedNl == null && reagent.id !== WATER_ID,
          unit: 'mM',
          baselineValue: baselineMm,
          currentValue: currentMm,
          delta,
          baselineLabel: formatMm(baselineMm),
          currentLabel: formatMm(currentMm),
          deltaLabel: formatDeltaLabel(delta, 'mM'),
          deltaPctLabel: formatPercentDelta(baselineMm, delta)
        };
      }

      if (baselinePercent != null && currentPercent != null) {
        const delta = currentPercent - baselinePercent;
        return {
          id: reagent.id,
          name: reagent.name,
          reagent,
          adjustable: reagent.fixedNl == null && reagent.id !== WATER_ID,
          unit: '% v/v',
          baselineValue: baselinePercent,
          currentValue: currentPercent,
          delta,
          baselineLabel: formatVolumePercent(baselinePercent),
          currentLabel: formatVolumePercent(currentPercent),
          deltaLabel: formatDeltaLabel(delta, '% v/v'),
          deltaPctLabel: formatPercentDelta(baselinePercent, delta)
        };
      }

      {
        const baselineUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000;
        const currentUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, volumesNl) / 1000;
        const delta = currentUl - baselineUl;
        return {
          id: reagent.id,
          name: reagent.name,
          reagent,
          adjustable: reagent.fixedNl == null && reagent.id !== WATER_ID,
          unit: 'uL',
          baselineValue: baselineUl,
          currentValue: currentUl,
          delta,
          baselineLabel: formatUlValue(baselineUl),
          currentLabel: formatUlValue(currentUl),
          deltaLabel: formatDeltaLabel(delta, 'uL'),
          deltaPctLabel: formatPercentDelta(baselineUl, delta)
        };
      }
    });
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
      await navigator.clipboard.writeText(exportedCompositionJson);
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

  function buildConcentrationRankEntries() {
    return visibleReagents
      .filter((reagent) => {
        const volumeNl = effectiveVolumeNlForReagent(reagent.id);
        return volumeNl > 0 && !excludedFromExportIds.has(reagent.id);
      })
      .map((reagent) => {
        const { label, rankValue } = concentrationLabelAndRankForReagent(reagent);
        return {
          name: reagent.id === WATER_ID ? 'Water' : reagent.name,
          label,
          rankValue
        };
      })
      .sort((a, b) => b.rankValue - a.rankValue)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

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
    const discrepancies = [];

    for (const reagent of visibleReagents) {
      if (reagent.id === WATER_ID) continue;

      let intended = null;
      let achievable = null;
      let unit = '';

      if (targetMm[reagent.id] != null) {
        intended = targetMm[reagent.id];
        const nm = finalNmForReagentFromVolumes(reagent, volumesNl);
        achievable = nm == null ? null : nm / 1_000_000;
        unit = 'mM';
      } else if (targetGL[reagent.id] != null) {
        intended = targetGL[reagent.id];
        achievable = finalGramsPerLiterForReagentFromVolumes(reagent, volumesNl);
        unit = 'g/L';
      } else if (targetUml[reagent.id] != null) {
        intended = targetUml[reagent.id];
        achievable = finalUnitsPerMlForReagentFromVolumes(reagent, volumesNl);
        unit = 'U/mL';
      } else if (targetNgUl[reagent.id] != null) {
        intended = targetNgUl[reagent.id];
        achievable = finalNgPerUlForReagentFromVolumes(reagent, volumesNl);
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

  function buildPieSlices() {
    if (totalVolumeNl <= 0) return [];

    const reagentById = new Map(allReagents.map((reagent) => [reagent.id, reagent]));
    const sliceVolumeById = new Map();

    for (const reagent of allReagents) {
      if (reagent.id === BASE_BUFFER_ID) continue;
      const volumeNl = effectiveVolumeNlForReagent(reagent.id);
      if (volumeNl <= 0) continue;
      sliceVolumeById.set(reagent.id, volumeNl);
    }

    const includedSlices = Array.from(sliceVolumeById.entries())
      .map(([id, volumeNl]) => {
        const reagent = reagentById.get(id);
        return {
          ...(reagent || { id, name: id }),
          volumeNl
        };
      })
      .filter((slice) => slice.volumeNl > 0)
      .sort((a, b) => b.volumeNl - a.volumeNl);

    const includedTotalNl = includedSlices.reduce((sum, slice) => sum + slice.volumeNl, 0);
    if (includedTotalNl <= 0) return [];

    let start = -Math.PI / 2;
    return includedSlices.map((slice, idx) => {
      const percent = (slice.volumeNl / includedTotalNl) * 100;
      const angle = (slice.volumeNl / includedTotalNl) * Math.PI * 2;
      const end = start + angle;
      const mid = start + angle / 2;
      const color = `hsl(${(idx * 47) % 360} 70% 60%)`;
      const result = { ...slice, percent, start, end, mid, color };
      start = end;
      return result;
    });
  }

  function arcPath(cx, cy, r, start, end) {
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }

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
</script>

{#if !data.authenticated}
<div data-theme="light" class="min-h-screen flex items-center justify-center bg-base-100 px-4">
  <form method="POST" action="?/login" class="w-full max-w-xs flex flex-col gap-3">
    <p class="text-sm font-semibold text-base-content/70 text-center">Cell-Free Comparison</p>
    {#if form?.error}
      <p class="text-xs text-red-500 text-center">{form.error}</p>
    {/if}
    <input
      type="password"
      name="password"
      placeholder="Password"
      class="input input-bordered input-sm w-full"
    />
    <button type="submit" class="btn btn-sm w-full">Enter</button>
  </form>
</div>
{:else if Array.isArray(data?.reagentGroups)}
{#if reagentGroups.length === 0}
<div class="min-h-screen flex items-center justify-center text-base-content/70">
  <p class="text-sm">No reagent groups found in PocketBase record.</p>
</div>
{:else}
<div data-theme="light" class="bg-base-100 pt-4">
<article class="prose w-full mx-auto">
    <h2 class="flex justify-center items-center gap-2 text-base-content !mb-2">
        <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor" >
            <path id="Layer" class="" d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
        </svg>
        Cell-Free Reaction Compositions
    </h2>
</article>

<div class="min-h-screen text-base-content px-4 pt-1 pb-20">

  <!-- Industry-benchmark formulations comparison. Lives outside the max-w-7xl
       wrapper because the 17-column table is naturally ~1600 px wide — inside
       the constrained parent it overflowed to the right and looked off-center. -->
  <div class="mx-auto max-w-[1700px] w-full">
    <BenchmarksTable onLoad={loadBenchmarkFormulation} onShowRecipe={openRecipe} />
  </div>

  <div class="mx-auto max-w-7xl">
    <div class="mt-4 mb-2 mx-auto flex flex-wrap items-center justify-between gap-2 rounded-md bg-base-200 border border-base-300 px-3 py-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold text-base-content/80">Cell-Free Reaction Composition</span>
        <span class="text-base-content/30">·</span>
        <span class="text-base-content/50">Preset</span>
        <button
          class="rounded bg-base-300 hover:bg-base-300/70 px-2 py-0.5 text-xs text-base-content/80 transition cursor-pointer"
          onclick={cyclePreset}
          title="Click to cycle through benchmark presets"
        >
          {defaultTargetProfiles[selectedProfileKey]?.label ?? selectedProfileKey}
          <span class="text-base-content/30 ml-1">↻</span>
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/70">
        <span><span class="text-base-content/50">Total</span> {formatUl(totalVolumeNl)}</span>
        <span><span class="text-base-content/50">Reagents</span> {uniqueReagentCount}</span>
      </div>
    </div>

    {#if theoreticalBanner}
      <div class="mb-2 rounded-lg border p-2 flex items-start gap-3 text-xs" style="background: rgba(168,85,247,0.06); border-color: rgba(168,85,247,0.25);">
        <span style="color: #a855f7;">○</span>
        <div class="flex-1">
          <span class="font-semibold" style="color: #7e22ce;">{theoreticalBanner.formulationName}</span>
          <span class="opacity-60"> — {theoreticalBanner.items.length} reagent{theoreticalBanner.items.length === 1 ? '' : 's'} needed: </span>
          <span style="color: #6b21a8;">{theoreticalBanner.items.map(i => i.paperName).join(', ')}</span>
        </div>
        <button type="button" class="opacity-40 hover:opacity-80 text-xs" onclick={dismissTheoreticalBanner} aria-label="Dismiss">✕</button>
      </div>
    {/if}

    <section class="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
      <!-- Left: pie chart -->
      <div class="rounded-lg border border-base-300 bg-base-200 p-3 flex flex-col" style="min-height: 19rem;">
        <h3 class="pb-2 text-sm font-semibold text-base-content/70 text-center">Composition</h3>
        <svg viewBox="0 0 1000 440" class="block w-full flex-1 min-h-0">
          {#if pieSlices.length === 0}
            <text x="500" y="220" text-anchor="middle" class="fill-base-content/30 text-xs">No volume selected</text>
          {:else}
            {#each pieSlices as slice}
              <path d={arcPath(500, 220, 155, slice.start, slice.end)} fill={slice.color} stroke="oklch(var(--b1))" stroke-width="1" />
              {@const x0 = 500 + 155 * Math.cos(slice.mid)}
              {@const y0 = 220 + 155 * Math.sin(slice.mid)}
              {@const x1 = 500 + 181 * Math.cos(slice.mid)}
              {@const y1 = 220 + 181 * Math.sin(slice.mid)}
              {@const rightSide = Math.cos(slice.mid) >= 0}
              {@const x2 = x1 + (rightSide ? 44 : -44)}
              {#if slice.percent >= 3}
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="oklch(var(--bc)/0.4)" stroke-width="1" />
                <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="oklch(var(--bc)/0.4)" stroke-width="1" />
                <text x={x2 + (rightSide ? 4 : -4)} y={y1} text-anchor={rightSide ? 'start' : 'end'} dominant-baseline="middle" font-size="18" fill="oklch(var(--bc))">
                  {slice.name} ({slice.percent.toFixed(1)}%)
                </text>
              {/if}
            {/each}
          {/if}
        </svg>
      </div>

      <!-- Right: summary table with +/− -->
      <div class="rounded-lg border border-base-300 bg-base-200 p-2">
        <div class="h-72 overflow-x-auto overflow-y-scroll rounded bg-base-300/50">
          <table class="table table-xs tabular-nums table-fixed">
            <thead>
              <tr>
                <th class="w-[34%]">Reagent</th>
                <th class="w-[16%]">Preset</th>
                <th class="w-[16%]">Current</th>
                <th class="w-[14%]">Delta</th>
                <th class="w-[10%]">Δ%</th>
                <th class="w-[10%] text-right">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {#each summaryRows as row}
                <tr>
                  <td class="whitespace-normal break-words leading-tight">
                    <div class="flex items-center gap-2 min-w-0">
                      <span>{row.id === WATER_ID ? 'Water' : row.name}</span>
                      {#if hasRecipe(row.id)}
                        <button
                          type="button"
                          class="shrink-0 text-[10px] leading-none px-1 py-0.5 rounded text-base-content/40 hover:text-base-content hover:bg-base-content/10"
                          onclick={() => openRecipe(row.id)}
                          aria-label={`View recipe for ${row.name}`}
                        >&#9432;</button>
                      {/if}
                      {#if identityLinkForReagent(row.id)}
                        <a
                          class="shrink-0 text-[10px] text-base-content/40 hover:text-base-content"
                          href={identityLinkForReagent(row.id)?.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {identityLinkForReagent(row.id)?.value}
                        </a>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <span class={isZeroValue(row.baselineValue) ? 'text-base-content/40' : ''}>
                      {row.baselineLabel}
                    </span>
                  </td>
                  <td>
                    <span class={isZeroValue(row.currentValue) ? 'text-base-content/40' : ''}>
                      {row.currentLabel}
                    </span>
                  </td>
                  <td>
                    {#if row.delta == null}
                      <span class="text-base-content/40">—</span>
                    {:else if row.delta > 0}
                      <span class="inline-flex items-center gap-1 text-emerald-400">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 4l7 10h-4v6H9v-6H5z" /></svg>
                        {row.deltaLabel}
                      </span>
                    {:else if row.delta < 0}
                      <span class="inline-flex items-center gap-1 text-red-400">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 20l-7-10h4V4h6v6h4z" /></svg>
                        {row.deltaLabel}
                      </span>
                    {:else}
                      <span class="text-base-content/70">{row.deltaLabel}</span>
                    {/if}
                  </td>
                  <td>
                    {#if row.delta == null}
                      <span class="text-base-content/50">n/a</span>
                    {:else if row.delta > 0}
                      <span class="text-emerald-400">{row.deltaPctLabel}</span>
                    {:else if row.delta < 0}
                      <span class="text-red-400">{row.deltaPctLabel}</span>
                    {:else}
                      <span class="text-base-content/70">{row.deltaPctLabel}</span>
                    {/if}
                  </td>
                  <td class="text-right">
                    {#if row.adjustable}
                      <div class="inline-flex items-center gap-1">
                        <button
                          class="btn btn-xs min-h-0 h-5 w-5 rounded bg-base-content/10 hover:bg-base-content/20 px-0 border-none"
                          onclick={() => adjustVolumeNl(row.reagent, -STEP_NL)}
                          disabled={!canDecrease(row.reagent)}
                          aria-label={`Decrease ${row.name}`}
                        >
                          -
                        </button>
                        <button
                          class="btn btn-xs min-h-0 h-5 w-5 rounded bg-base-content/10 hover:bg-base-content/20 px-0 border-none"
                          onclick={() => adjustVolumeNl(row.reagent, STEP_NL)}
                          disabled={!canIncrease(row.reagent)}
                          aria-label={`Increase ${row.name}`}
                        >
                          +
                        </button>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if concentrationDiscrepancies.length > 0}
          <div class="mt-2 rounded-md border p-2 text-xs" style="background: rgba(245,158,11,0.07); border-color: rgba(245,158,11,0.30);">
            <p class="font-semibold mb-1" style="color: #d97706; font-size: 11px;">Snap rounding ≥3% off target ({concentrationDiscrepancies.length} reagent{concentrationDiscrepancies.length === 1 ? '' : 's'})</p>
            <table class="w-full tabular-nums">
              <thead>
                <tr class="opacity-50">
                  <th class="text-left font-normal pb-0.5 w-[40%]">Reagent</th>
                  <th class="text-right font-normal pb-0.5 w-[25%]">Intended</th>
                  <th class="text-right font-normal pb-0.5 w-[25%]">Achievable</th>
                  <th class="text-right font-normal pb-0.5 w-[10%]">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {#each concentrationDiscrepancies as d}
                  <tr>
                    <td class="py-0.5">{d.name}</td>
                    <td class="text-right opacity-60">{d.intendedLabel}</td>
                    <td class="text-right">{d.achievableLabel}</td>
                    <td class="text-right" style="color: #f59e0b;">{d.pct.toFixed(1)}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

    </section>

    <section class="mt-4 rounded-lg border border-base-300 bg-base-200 p-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
        <div class="flex flex-col min-h-0">
          <div class="mb-1 flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold text-base-content/70">Concentration Rank</h4>
            <button class="text-xs px-2 py-0.5 rounded border border-base-content/20 hover:border-base-content/40 text-base-content/60 hover:text-base-content transition" onclick={copyConcentrationRank}>Copy Rank</button>
          </div>
          <div class="rounded bg-base-300/50 p-2 text-xs font-mono">
            {#if concentrationRankEntries.length === 0}
              <p>No non-zero reagents in composition.</p>
            {:else}
              {#each concentrationRankEntries as entry}
                <p>{entry.rank}. {entry.name} <span class="opacity-50">{entry.label}</span></p>
              {/each}
            {/if}
          </div>
        </div>
        <div class="flex flex-col min-h-0">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-base-content/70">Reagent Supplement JSON</h3>
            <button class="text-xs px-2 py-0.5 rounded border border-base-content/20 hover:border-base-content/40 text-base-content/60 hover:text-base-content transition" onclick={copyCompositionJson}>Copy JSON</button>
          </div>
          <pre class="overflow-auto rounded bg-base-300/50 p-2 text-xs">{exportedCompositionJson}</pre>
          {#if copyError}
            <p class="mt-1 text-xs text-red-400">{copyError}</p>
          {:else if copyMessage}
            <p class="mt-1 text-xs text-emerald-400">{copyMessage}</p>
          {/if}
        </div>
      </div>
    </section>

    <!-- Assay Details -->
    <section class="mt-4 rounded-lg border border-base-300 bg-base-200 p-3">
      <h4 class="text-sm font-semibold text-base-content/70 mb-3">Assay Details</h4>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">

        <!-- sfGFP -->
        <div class="rounded bg-base-300/50 p-3 space-y-1.5">
          <div class="font-semibold text-base-content/80">sfGFP <span class="font-normal text-base-content/50">(endpoint fluorescence)</span></div>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base-content/60">
            <span>Plate</span><span class="text-base-content/80">CFPS reaction plate (direct)</span>
            <span>Dilution</span><span class="text-base-content/80">None — read in-plate</span>
            <span>Volume</span><span class="text-base-content/80">20 µL</span>
          </div>
        </div>

        <!-- PETase -->
        <div class="rounded bg-base-300/50 p-3 space-y-1.5">
          <div class="font-semibold text-base-content/80">PETase <span class="font-normal text-base-content/50">(OD 405 nm, kinetic)</span></div>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base-content/60">
            <span>Dilution</span><span class="text-base-content/80">600× total from CFPS reaction</span>
            <span>Step 1</span><span class="text-base-content/80">80 µL PBS → 20 µL CFPS = 100 µL (5×)</span>
            <span>Step 2</span><span class="text-base-content/80">5 µL of above → 95 µL PBS = 100 µL (100×)</span>
            <span>Step 3</span><span class="text-base-content/80">10 µL of above → 46 µL PBS + 4 µL substrate = 60 µL (600×)</span>
            <span>Buffer</span><span class="text-base-content/80">PBS pH 8</span>
            <span>Reads</span><span class="text-base-content/80">15 cycles, 0–28 min (~2 min apart)</span>
            <span>Rate window</span><span class="text-base-content/80">First 6 cycles (0–10 min), linear phase</span>
            <span>Std curve</span><span class="text-base-content/80">Linear, stable ~0.0057 OD/µM, R²≈0.996</span>
          </div>
        </div>

        <!-- Reteplase -->
        <div class="rounded bg-base-300/50 p-3 space-y-1.5">
          <div class="font-semibold text-base-content/80">Reteplase <span class="font-normal text-base-content/50">(345 ex / 445 em, kinetic)</span></div>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base-content/60">
            <span>Dilution</span><span class="text-base-content/80">2× (direct in CFPS plate)</span>
            <span>Buffer</span><span class="text-base-content/80">Assay buffer e12461 — 50 mM Tris-HCl pH 8.0, 150 mM NaCl, 0.1% Tween-20</span>
            <span>Reads</span><span class="text-base-content/80">27 reads, 0.46–35.6 h from substrate addition</span>
            <span>Rate window</span><span class="text-base-content/80">First 4 reads (0.46–3.75 h), OLS slope</span>
            <span>Std curve</span><span class="text-base-content/80">Linear, fit per-read</span>
          </div>
        </div>

      </div>

      <!-- Standard Curves -->
      <div class="mt-3 rounded bg-base-300/50 p-3">
        <div class="text-[11px] font-semibold text-base-content/60 mb-2">Standard Curves</div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3 text-[9px] font-mono">

          <!-- sfGFP -->
          <div>
            <div class="text-[10px] text-base-content/50 mb-1 font-sans">sfGFP — 2 µL/well, purified sfGFP</div>
            <table class="w-full">
              <thead><tr class="text-base-content/40 font-sans"><th class="text-left font-normal pb-0.5">Row</th><th class="text-right font-normal pb-0.5">sfGFP (µM)</th></tr></thead>
              <tbody class="text-base-content/70">
                {#each [['A',118.9],['B',90],['C',59.45],['D',45],['E',29.725],['F',22.5],['G',14.8625],['H',11.25],['I',7.43125],['J',5.625],['K',3.715625],['L',2.8125],['M',1.8578125],['N',1.40625],['O',0.92890625],['P',0]] as [row,conc]}
                  <tr><td class="text-base-content/40">{row}</td><td class="text-right">{conc}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>

          <!-- PETase -->
          <div>
            <div class="text-[10px] text-base-content/50 mb-1 font-sans">PETase — 4 µL/well (stocks mM → µM in plate)</div>
            <table class="w-full">
              <thead><tr class="text-base-content/40 font-sans"><th class="text-left font-normal pb-0.5">PNP (µM)</th><th class="text-right font-normal pb-0.5">PNPH (µM)</th></tr></thead>
              <tbody class="text-base-content/70">
                {#each [[400,0],[400,0],[200,200],[200,200],[100,300],[100,300],[50,350],[50,350],[25,375],[25,375],[12.5,387.5],[12.5,387.5],[6.25,393.75],[6.25,393.75],[0,400],[0,400]] as [pnp,pnph]}
                  <tr><td>{pnp}</td><td class="text-right">{pnph}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>

          <!-- Reteplase -->
          <div>
            <div class="text-[10px] text-base-content/50 mb-1 font-sans">Reteplase — 2 µL → 38 µL total</div>
            <div class="text-[9px] text-base-content/40 mb-1 font-sans leading-snug">AMC standard: 7-amino-4-methylcoumarin in DMSO<br/>IPR-AMC substrate: D-Ile-Pro-Arg-AMC in DMSO</div>
            <table class="w-full">
              <thead><tr class="text-base-content/40 font-sans"><th class="text-left font-normal pb-0.5">AMC (µM)</th><th class="text-right font-normal pb-0.5">IPR-AMC (µM)</th></tr></thead>
              <tbody class="text-base-content/70">
                {#each [[25,0],[25,0],[12.5,12.5],[12.5,12.5],[6.25,18.75],[6.25,18.75],[3.125,21.875],[3.125,21.875],[1.5625,23.4375],[1.5625,23.4375],[0.78125,24.21875],[0.78125,24.21875],[0.390625,24.609375],[0.390625,24.609375],[0,25],[0,25]] as [amc,ipr]}
                  <tr><td>{amc}</td><td class="text-right">{ipr}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </section>

    <!-- Target Proteins -->
    <section class="mt-4 rounded-lg border border-base-300 bg-base-200 p-3">
      <h4 class="text-sm font-semibold text-base-content/70 mb-3">Target Proteins</h4>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">

        <!-- sfGFP -->
        <div class="rounded bg-base-300/50 p-3 flex flex-col gap-2">
          <div class="font-semibold text-base-content/80">sfGFP <span class="font-normal text-base-content/50">superfolder GFP</span></div>
          <div class="rounded overflow-hidden" style="height:180px;">
            <ProteinViewer pdbUrl="https://files.rcsb.org/download/2B3P.pdb" color="chainid" />
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base-content/60">
            <span>Length</span><span class="text-base-content/80">240 AA</span>
            <span>MW</span><span class="text-base-content/80">27,015 Da</span>
            <span>SS bonds</span><span class="text-base-content/80">0 — standard CFPS conditions</span>
            <span>Chromophore</span><span class="text-base-content/80">Ser65-Tyr66-Gly67, autocatalytic (requires O₂)</span>
            <span>Quantification</span><span class="text-base-content/80">Direct fluorescence (no assay needed)</span>
          </div>
        </div>

        <!-- PETase / TfCut2 -->
        <div class="rounded bg-base-300/50 p-3 flex flex-col gap-2">
          <div class="font-semibold text-base-content/80">PETase <span class="font-normal text-base-content/50">TfCut2 cutinase</span></div>
          <div class="rounded overflow-hidden" style="height:180px;">
            <ProteinViewer pdbUrl="https://files.rcsb.org/download/4CG1.pdb" color="chainid" />
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base-content/60">
            <span>Length</span><span class="text-base-content/80">309 AA</span>
            <span>MW</span><span class="text-base-content/80">33,157 Da</span>
            <span>SS bonds</span><span class="text-base-content/80">2 — standard CFPS conditions</span>
            <span>Active site</span><span class="text-base-content/80">Ser-His-Asp catalytic triad (α/β hydrolase)</span>
            <span>Quantification</span><span class="text-base-content/80">p-nitrophenol release at OD 405 nm</span>
          </div>
        </div>

        <!-- Reteplase / vtPA -->
        <div class="rounded bg-base-300/50 p-3 flex flex-col gap-2">
          <div class="font-semibold text-base-content/80">Reteplase <span class="font-normal text-base-content/50">vtPA serine protease</span></div>
          <div class="rounded overflow-hidden" style="height:180px;">
            <ProteinViewer pdbUrl="https://files.rcsb.org/download/1BML.pdb" color="chainid" />
          </div>
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base-content/60">
            <span>Length</span><span class="text-base-content/80">399 AA</span>
            <span>MW</span><span class="text-base-content/80">44,136 Da</span>
            <span>SS bonds</span><span class="text-base-content/80">9 — requires oxidizing CFPS (DSB lysate + IAM)</span>
            <span>Active site</span><span class="text-base-content/80">Ser-His-Asp catalytic triad (serine protease)</span>
            <span>Quantification</span><span class="text-base-content/80">AMC release from IPR-AMC peptide</span>
          </div>
        </div>

      </div>
    </section>

  </div>
</div>
</div>
{/if}
{:else}
<div class="min-h-screen flex items-center justify-center text-base-content/70">
  <p class="text-sm">Loading CFPS reagents...</p>
</div>
{/if}

<!-- Reagent recipe popover — opened by clicking the ⓘ next to a reagent name
     in the composition table or benchmarks table. Click backdrop or ✕ to close.
     Content is a two-column table of ingredients + supplier + mass. -->
{#if activeRecipe}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    onclick={closeRecipe}
    role="presentation"
  >
    <div
      class="max-w-2xl w-full max-h-[85vh] overflow-auto rounded-lg bg-base-100 shadow-xl border border-base-300"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Reagent recipe"
    >
      <div class="flex items-start justify-between gap-4 px-5 py-3 border-b border-base-300 bg-base-200/60">
        <div>
          <h3 class="text-sm font-semibold text-primary">{activeRecipe.title}</h3>
          <p class="text-[11px] opacity-70 mt-0.5">{activeRecipe.subtitle}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick={closeRecipe} aria-label="Close">✕</button>
      </div>
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-base-300 opacity-60">
            <th class="text-left px-4 py-1.5 font-normal">Ingredient</th>
            <th class="text-left px-4 py-1.5 font-normal">Supplier</th>
            <th class="text-right px-4 py-1.5 font-normal">Mass</th>
          </tr>
        </thead>
        <tbody>
          {#each activeRecipe.ingredients as row}
            <tr class="border-b border-base-300/40 hover:bg-base-200/40">
              <td class="px-4 py-1.5">{row.name}</td>
              <td class="px-4 py-1.5 opacity-70 font-mono text-[10px]">{row.supplier}</td>
              <td class="px-4 py-1.5 text-right font-mono">{row.mass_g.toFixed(2)} g</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<dialog id="upload_modal" class="modal modal-middle" bind:this={uploadModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">Ready to publish?</h3>
    <p class="pt-2 text-sm text-base-content/70">Select HTGAA Node and add your HTGAA username/rationale for this CFPS design.</p>

    <div class="flex flex-col w-full gap-2 pt-4">
      <label class="form-control">
        <span class="label-text text-xs opacity-70 pb-1">HTGAA Node (required)</span>
        <select class="select select-bordered text-sm" bind:value={selectedNodeDisplay}>
          <option value="" disabled>Select a node</option>
          {#each HTGAA_NODE_OPTIONS as nodeOption}
            <option value={nodeOption}>{nodeOption}</option>
          {/each}
        </select>
      </label>
      <label class="input input-bordered flex items-center gap-2 text-sm">
        <span class="opacity-70">HTGAA Username</span>
        <input
          type="text"
          class="rounded-sm grow no-autofill px-1 py-0.5"
          placeholder="username"
          autocomplete="off"
          maxlength="100"
          bind:value={author}
        />
      </label>
      <label class="form-control">
        <span class="label-text text-xs opacity-70 pb-1">Rationale</span>
        <textarea
          class="textarea textarea-bordered text-sm min-h-24"
          placeholder="Why this formulation?"
          maxlength="1000"
          bind:value={rationale}
        ></textarea>
      </label>
      {#if publishFormError}
        <p class="text-xs text-error">{publishFormError}</p>
      {/if}
    </div>

    <div class="modal-action">
      <form method="dialog">
        <button type="button" class="btn" onclick={publishDesign} disabled={isPublishing}>
          {#if !isPublishing}
            Publish
          {:else}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
        </button>
      </form>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>

<svelte:window onpointermove={handlePointerMove} onpointerup={endReagentDrag} />

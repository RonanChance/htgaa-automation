<script>
  let { data = {} } = $props();

  const STEP_NL = 25;
  const MAX_TOTAL_NL = 20_000;
  const WATER_ID = 'nuclease_free_water';
  const BASE_BUFFER_ID = 'base_buffer';
  const reagentGroups = (Array.isArray(data?.reagentGroups) ? data.reagentGroups : [])
    .map((group) => ({
      ...group,
      reagents: (Array.isArray(group?.reagents) ? group.reagents : []).filter(
        (reagent) => reagent?.in_stock !== false
      )
    }))
    .filter((group) => group.reagents.length > 0);

  const allReagents = reagentGroups.flatMap((group) =>
    group.reagents.map((reagent) => ({ ...reagent, group: group.name }))
  );

  const baseTargetMm_1777863_77 = {
    hepes_koh: 45,
    potassium_glutamate: 312.6,
    magnesium_glutamate: 7.0,
    glucose: 6.9,
    aa_mix_17: 4.1,
    tyrosine: 4.1,
    cysteine: 4.0,
    potassium_phosphate_ratio_dibasic_monobasic: 5.6,
    potassium_phosphate_ratio_monobasic_dibasic: 5.6,
    nicotinamide: 3.1,
    ribose: 77.4,
    amp: 0.6,
    cmp: 0.4,
    gmp: 0,
    ump: 0.4,
    guanine: 0.2,
  };

  const baseTargetMm_1784943_26 = {
    hepes_koh: 50,
    potassium_glutamate: 299.8,
    magnesium_glutamate: 7,
    aa_mix_17: 3.2,
    tyrosine: 3.2,
    cysteine: 3.2,
    potassium_phosphate_ratio_dibasic_monobasic: 7.5,
    potassium_phosphate_ratio_monobasic_dibasic: 7.5,
    nicotinamide: 4.0,
    ribose: 69.9,
    amp: 0.8,
    cmp: 0.5,
    gmp: 0.5,
    ump: 0.5
  };

  const baseTargetMm_1793122_35 = {
    hepes_koh: 67.5,
    potassium_glutamate: 273.2,
    magnesium_glutamate: 8.8,
    glucose: 8.3,
    sodium_pyruvate: 9.1,
    aa_mix_17: 4.8,
    tyrosine: 1.2,
    cysteine: 5.0,
    potassium_phosphate_ratio_dibasic_monobasic: 7.5,
    potassium_phosphate_ratio_monobasic_dibasic: 7.5,
    nicotinamide: 4.0,
    spermidine: 1.2,
    ribose: 40.0,
    amp: 0.5,
    cmp: 1.0,
    gmp: 1.0,
    ump: 1.0,
    adenosine: 0.4
  };
  const baseTargetUnitsPerMl_1793122_35 = { catalase: 187.5 };

const baseTargetMm_1793665_74 = {
    hepes_koh: 75,
    potassium_glutamate: 299.8,
    magnesium_glutamate: 8.2,
    glucose: 8.3,
    oxaloacetic_acid: 5.0,
    aa_mix_17: 4.8,
    tyrosine: 1.2,
    cysteine: 4.0,
    potassium_phosphate_ratio_dibasic_monobasic: 15.0,
    nicotinamide: 4.0,
    spermidine: 1.2,
    ribose: 40.0,
    amp: 1.5,
    cmp: 1.0,
    ump: 1.0,
    guanine: 0.6
  };

  const baseTargetMm_1793119_36 = {
    hepes_koh: 75,
    potassium_glutamate: 277.5,
    magnesium_glutamate: 8.2,
    glucose: 9.7,
    sodium_pyruvate: 18.2,
    aa_mix_17: 3.0,
    tyrosine: 3.0,
    potassium_phosphate_ratio_dibasic_monobasic: 15.0,
    dilithium_acetyl_phosphate: 0.2,
    nicotinamide: 0.4,
    ribose: 50.0,
    amp: 1.0,
    cmp: 1.0,
    gmp: 1.0,
    ump: 1.0
  };

  const baseTargetMm_1794089_36 = {
    hepes_koh: 60.0,
    potassium_glutamate: 273.2,
    magnesium_glutamate: 8.2,
    glucose: 8.3,
    aa_mix_17: 4.8,
    tyrosine: 3.2,
    cysteine: 4.0,
    potassium_phosphate_ratio_dibasic_monobasic: 7.5,
    potassium_phosphate_ratio_monobasic_dibasic: 7.5,
    nicotinamide: 3.0,
    spermidine: 1.2,
    ribose: 40.0,
    cmp: 1.1,
    gmp: 1.1,
    ump: 1.1
  };

  const positive_ctrl = {
    potassium_glutamate: 330,
    magnesium_glutamate: 6.6,
    hepes_koh: 80,
    atp: 1.5,
    ctp: 0.9,
    gtp: 1.5,
    utp: 0.9,
    aa_mix_17: 2.5,
    tyrosine: 2.5,
    cysteine: 2.5,
    phosphoenolpyruvic_acid_cyclohexylammonium_salt: 17.5,
    folinic_acid: 0.035,
    nad: 0.35,
    camp: 0.8,
    spermidine: 1
  };
  const positive_ctrl_g_per_l = {
    maltodextrin_17: 10.5
  };
  const positive_ctrl_percent_v_v = {
    dmso: 2
  };
  // Components pre-mixed inside the fixed 2 uL base buffer; values are stock mM in that mix.
  // This lets us subtract base-buffer contribution from defaults and show true final concentrations.
  const baseBufferComponentStockMm = {
    potassium_glutamate: 1500.0,
    magnesium_glutamate: 26.0,
    hepes_koh: 300.0,
    aa_mix_17: 10.0,
    tyrosine: 10.0,
    cysteine: 10.0,
  };

  const defaultTargetProfiles = {
    '1777863_77': { label: '1777863_77', targetMm: { ...baseTargetMm_1777863_77 }, targetUnitsPerMl: { }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    '1784943_26': { label: '1784943_26', targetMm: { ...baseTargetMm_1784943_26 }, targetUnitsPerMl: { }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    '1793122_35': { label: '1793122_35', targetMm: { ...baseTargetMm_1793122_35 }, targetUnitsPerMl: { ...baseTargetUnitsPerMl_1793122_35 }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    '1793665_74': { label: '1793665_74', targetMm: { ...baseTargetMm_1793665_74 }, targetUnitsPerMl: { }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    '1793119_36': { label: '1793119_36', targetMm: { ...baseTargetMm_1793119_36 }, targetUnitsPerMl: { }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    '1794089_36': { label: '1794089_36', targetMm: { ...baseTargetMm_1794089_36 }, targetUnitsPerMl: { }, targetGramsPerLiter: { }, targetVolumePercent: { } },
    'positive_ctrl': {
      label: 'Positive Control',
      targetMm: { ...positive_ctrl },
      targetUnitsPerMl: { },
      targetGramsPerLiter: { ...positive_ctrl_g_per_l },
      targetVolumePercent: { ...positive_ctrl_percent_v_v }
    }
  };
  const DEFAULT_PROFILE_KEY = '1777863_77';
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

  const fixedVolumeSummaryIds = new Set(['cell_lysate', 'base_buffer', 'dna_template']);
  const excludedFromExportIds = new Set(['cell_lysate', 'base_buffer', 'dna_template']);

  const initialVolumes = computeInitialVolumes();

  let designTitle = $state('');
  let author = $state('');
  let rationale = $state('');
  let selectedNodeDisplay = $state('');
  let publishFormError = $state('');
  let selectedProfileKey = $state(DEFAULT_PROFILE_KEY);
  let profileDropdown;
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
      allReagents
        .filter((reagent) => (Number(volumesNl[reagent.id]) || 0) > 0)
        .map((reagent) => reagent.id)
    ).size
  );

  let remainingNl = $derived(Math.max(0, MAX_TOTAL_NL - totalVolumeNl));

  let totalCostUsd = $derived(
    allReagents.reduce(
      (sum, reagent) => sum + ((Number(volumesNl[reagent.id]) || 0) / 1_000_000) * reagent.costPerMl,
      0
    )
  );

  let costPerMlReaction = $derived(
    totalVolumeNl > 0 ? totalCostUsd / (totalVolumeNl / 1_000_000) : 0
  );

  let presetVolumesNl = $derived(computeDefaultVolumes(selectedProfileKey));
  let pieSlices = $derived(buildPieSlices());
  let summaryRows = $derived(buildSummaryRows());
  let exportedComposition = $derived(
    allReagents
      .map((reagent) => {
        const volumeNl = Number(volumesNl[reagent.id]) || 0;
        const identity = identityForReagent(reagent.id);
        return {
          id: reagent.id,
          name: reagent.name,
          volume_nl: volumeNl,
          entity_type: identity.entity_type,
          entity_id: identity.entity_id,
          molecule_id: identity.molecule_id,
          reagent_id: identity.reagent_id
        };
      })
      .filter((item) => item.volume_nl > 0 && !excludedFromExportIds.has(item.id))
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

  function reagentMetaLabel(reagent) {
    const parts = [];
    if (Number(reagent.costPerMl) > 0) {
      parts.push(reagent.concentration);
      parts.push(`$${Number(reagent.costPerMl).toFixed(2)}/mL`);
    }

    parts.push(formatUl(volumesNl[reagent.id] || 0));

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

  function baseBufferContributionMmFromVolumes(reagentId, volumes) {
    const stockMm = baseBufferComponentStockMm[reagentId];
    const totalNl = totalVolumeFor(volumes);
    if (stockMm == null || totalNl <= 0) return 0;
    const baseBufferNl = Number(volumes[BASE_BUFFER_ID]) || 0;
    return stockMm * (baseBufferNl / totalNl);
  }

  function baseBufferContributionMm(reagentId) {
    return baseBufferContributionMmFromVolumes(reagentId, volumesNl);
  }

  function computeDefaultVolumes(profileKey = DEFAULT_PROFILE_KEY) {
    const profile = defaultTargetProfiles[profileKey] || defaultTargetProfiles[DEFAULT_PROFILE_KEY];
    const targetMm = profile?.targetMm || {};
    const targetUnitsPerMl = profile?.targetUnitsPerMl || {};
    const targetGramsPerLiter = profile?.targetGramsPerLiter || {};
    const targetVolumePercent = profile?.targetVolumePercent || {};

    const volumes = Object.fromEntries(
      allReagents.map((reagent) => [reagent.id, reagent.fixedNl ?? 0])
    );

    for (const reagent of allReagents) {
      if (reagent.fixedNl != null) continue;

      let targetNl = 0;
      if (targetMm[reagent.id] != null) {
        const stockM = stockMolarityForReagent(reagent);
        if (stockM && stockM > 0) {
          const baseContributionMm = (baseBufferComponentStockMm[reagent.id] || 0) * ((Number(volumes[BASE_BUFFER_ID]) || 0) / MAX_TOTAL_NL);
          const additionalTargetMm = Math.max(0, targetMm[reagent.id] - baseContributionMm);
          targetNl = ((additionalTargetMm * 1e-3) / stockM) * MAX_TOTAL_NL;
        }
      } else if (targetUnitsPerMl[reagent.id] != null) {
        const stockUnitsPerMl = parseUnitsPerMl(reagent.concentration);
        if (stockUnitsPerMl && stockUnitsPerMl > 0) {
          targetNl = (targetUnitsPerMl[reagent.id] / stockUnitsPerMl) * MAX_TOTAL_NL;
        }
      } else if (targetGramsPerLiter[reagent.id] != null) {
        const stockGL = parseGramsPerLiter(reagent.concentration);
        if (stockGL && stockGL > 0) {
          targetNl = (targetGramsPerLiter[reagent.id] / stockGL) * MAX_TOTAL_NL;
        }
      } else if (targetVolumePercent[reagent.id] != null) {
        const stockPercent = stockVolumePercentForReagent(reagent);
        if (stockPercent && stockPercent > 0) {
          targetNl = (targetVolumePercent[reagent.id] / stockPercent) * MAX_TOTAL_NL;
        }
      }

      volumes[reagent.id] = toStepNl(targetNl);
    }

    const currentTotal = allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
    const waterCurrent = Number(volumes[WATER_ID]) || 0;
    const waterAdjusted = waterCurrent + (MAX_TOTAL_NL - currentTotal);
    volumes[WATER_ID] = Math.max(0, waterAdjusted);

    return volumes;
  }

  function applyDefaultProfile(profileKey) {
    if (!defaultTargetProfiles[profileKey]) return;
    selectedProfileKey = profileKey;
    volumesNl = { ...computeDefaultVolumes(profileKey) };
  }

  function closeProfileDropdownOnOutsideClick(event) {
    if (!profileDropdown?.open) return;
    const target = event.target;
    if (target instanceof Node && !profileDropdown.contains(target)) {
      profileDropdown.removeAttribute('open');
    }
  }

  function finalNmForReagentFromVolumes(reagent, volumes) {
    const stockM = stockMolarityForReagent(reagent);
    const totalNl = totalVolumeFor(volumes);
    if (stockM == null || totalNl <= 0) return null;
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const directNm = stockM * (volumeNl / totalNl) * 1_000_000_000;
    const baseNm = baseBufferContributionMmFromVolumes(reagent.id, volumes) * 1_000_000;
    return directNm + baseNm;
  }

  function finalNmForReagent(reagent) {
    return finalNmForReagentFromVolumes(reagent, volumesNl);
  }

  function finalMmForReagent(reagent) {
    const nm = finalNmForReagent(reagent);
    return nm == null ? null : nm / 1_000_000;
  }

  function finalGramsPerLiterForReagent(reagent) {
    const stockGL = parseGramsPerLiter(reagent.concentration);
    const totalNl = totalVolumeFor(volumesNl);
    if (stockGL == null || totalNl <= 0) return null;
    const volumeNl = Number(volumesNl[reagent.id]) || 0;
    return stockGL * (volumeNl / totalNl);
  }

  function finalVolumePercentForReagentFromVolumes(reagent, volumes) {
    const stockPercent = stockVolumePercentForReagent(reagent);
    const totalNl = totalVolumeFor(volumes);
    if (stockPercent == null || totalNl <= 0) return null;
    const volumeNl = Number(volumes[reagent.id]) || 0;
    return stockPercent * (volumeNl / totalNl);
  }

  function finalVolumePercentForReagent(reagent) {
    return finalVolumePercentForReagentFromVolumes(reagent, volumesNl);
  }

  function baselineVolumePercentForReagent(reagent) {
    return finalVolumePercentForReagentFromVolumes(reagent, presetVolumesNl);
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
    return allReagents.map((reagent) => {
      if (fixedVolumeSummaryIds.has(reagent.id) || reagent.id === WATER_ID) {
        const baselineUl = (Number(presetVolumesNl[reagent.id]) || 0) / 1000;
        const currentUl = (Number(volumesNl[reagent.id]) || 0) / 1000;
        const delta = currentUl - baselineUl;
        return {
          id: reagent.id,
          name: reagent.name,
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
      const baselinePercent = baselineVolumePercentForReagent(reagent);
      const currentPercent = finalVolumePercentForReagent(reagent);

      if (baselineMm != null && currentMm != null) {
        const delta = currentMm - baselineMm;
        return {
          id: reagent.id,
          name: reagent.name,
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
        const baselineUl = (Number(presetVolumesNl[reagent.id]) || 0) / 1000;
        const currentUl = (Number(volumesNl[reagent.id]) || 0) / 1000;
        const delta = currentUl - baselineUl;
        return {
          id: reagent.id,
          name: reagent.name,
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
    return allReagents
      .filter((reagent) => {
        const volumeNl = Number(volumesNl[reagent.id]) || 0;
        return volumeNl > 0 && !excludedFromExportIds.has(reagent.id);
      })
      .map((reagent) => {
        const { label, rankValue } = concentrationLabelAndRankForReagent(reagent);
        return {
          name: reagent.name,
          label,
          rankValue
        };
      })
      .sort((a, b) => b.rankValue - a.rankValue)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  function buildCostRankEntries() {
    return allReagents
      .filter((reagent) => (Number(volumesNl[reagent.id]) || 0) > 0)
      .map((reagent) => {
        const costUsd = costUsdForReagent(reagent);
        return {
          name: reagent.name,
          costUsd,
          costLabel: formatUsd(costUsd),
          volumeLabel: formatUl(Number(volumesNl[reagent.id]) || 0)
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  function buildPieSlices() {
    if (totalVolumeNl <= 0) return [];

    const reagentById = new Map(allReagents.map((reagent) => [reagent.id, reagent]));
    const sliceVolumeById = new Map();

    for (const reagent of allReagents) {
      if (reagent.id === BASE_BUFFER_ID) continue;
      const volumeNl = Number(volumesNl[reagent.id]) || 0;
      if (volumeNl <= 0) continue;
      sliceVolumeById.set(reagent.id, volumeNl);
    }

    const baseBufferNl = Number(volumesNl[BASE_BUFFER_ID]) || 0;
    if (baseBufferNl > 0) {
      const componentEntries = Object.entries(baseBufferComponentStockMm).filter(([, stockMm]) => stockMm > 0);
      const totalStockMm = componentEntries.reduce((sum, [, stockMm]) => sum + stockMm, 0);

      if (totalStockMm > 0) {
        for (const [componentId, stockMm] of componentEntries) {
          const apportionedNl = (baseBufferNl * stockMm) / totalStockMm;
          const currentNl = sliceVolumeById.get(componentId) || 0;
          sliceVolumeById.set(componentId, currentNl + apportionedNl);
        }
      }
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

{#if Array.isArray(data?.reagentGroups)}
{#if reagentGroups.length === 0}
<div class="min-h-screen flex items-center justify-center text-base-content/70">
  <p class="text-sm">No reagent groups found in PocketBase record.</p>
</div>
{:else}
<article class="prose w-full mx-auto mt-5">
    <h2 class="flex justify-center items-center gap-2 text-base-content">
        <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor" >
            <path id="Layer" class="" d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
        </svg>
        Cell-Free Optimization Interface
    </h2>
</article>

<div class="min-h-screen text-base-content px-4 py-1 flex mx-auto">
  <div class="mx-auto max-w-7xl">
    <section class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-base-200/40 px-3 py-2 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base-content/70">Preset</span>
        <details class="dropdown relative z-50" bind:this={profileDropdown}>
          <summary class="rounded-md bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">
            {defaultTargetProfiles[selectedProfileKey]?.label ?? selectedProfileKey}
          </summary>
          <ul class="menu dropdown-content bg-base-100 rounded-box z-[999] w-52 p-2 shadow-sm">
            {#each Object.entries(defaultTargetProfiles) as [profileKey, profile]}
              <li>
                <a
                  class={selectedProfileKey === profileKey ? 'active' : ''}
                  onclick={() => applyDefaultProfile(profileKey)}
                >
                  {profile.label}
                </a>
              </li>
            {/each}
          </ul>
        </details>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/80">
        <span><span class="text-base-content/60">Total</span> {formatUl(totalVolumeNl)}</span>
        <span><span class="text-base-content/60">Reagents</span> {uniqueReagentCount}</span>
        <span><span class="text-base-content/60">Cost/Reaction</span> {formatUsd(totalCostUsd)}</span>
        <span><span class="text-base-content/60">Cost/mL</span> {formatUsd(costPerMlReaction)}</span>
        <button
          class="rounded-md bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600 disabled:opacity-60"
          onclick={() => {
            if (!isPublishing) {
              publishFormError = '';
              uploadModal?.showModal();
            }
          }}
          disabled={isPublishing}
        >
          {isPublishing ? 'Publishing...' : 'Publish Design'}
        </button>
      </div>

      <a href="/cfps-gallery" class="rounded-md bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">Gallery</a>
    </section>

    <section class="mb-4 mx-auto w-full max-w-2xl rounded-md bg-base-200/60 p-3 text-center">
      <h3 class="text-sm font-semibold text-primary">AI Agent Instructions</h3>
      <p class="mt-1 text-xs text-base-content/80">
        For agent-based submission, use the CFPS skill guide:
        <a class="underline" href="/cfps/skill.md" target="_blank" rel="noopener noreferrer">/cfps/skill.md</a>
      </p>
    </section>

    <section class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div class="order-2 md:order-1">
        <h3 class="pb-2 text-md font-semibold text-primary text-center underline">Summary Statistics</h3>
        <div class="h-72 overflow-x-auto overflow-y-scroll rounded-md bg-base-200/60">
          <table class="table table-xs tabular-nums table-fixed">
            <thead>
              <tr>
                <th class="w-[30%]">Reagent</th>
                <th class="w-[17.5%]">Preset</th>
                <th class="w-[17.5%]">Current</th>
                <th class="w-[20%]">Delta</th>
                <th class="w-[15%]">Delta %</th>
              </tr>
            </thead>
            <tbody>
              {#each summaryRows as row}
                <tr>
                  <td class="whitespace-normal break-words leading-tight">{row.name}</td>
                  <td>
                    <span class={isZeroValue(row.baselineValue) ? 'text-base-content/70' : ''}>
                      {row.baselineLabel}
                    </span>
                  </td>
                  <td>
                    <span class={isZeroValue(row.currentValue) ? 'text-base-content/70' : ''}>
                      {row.currentLabel}
                    </span>
                  </td>
                  <td>
                    {#if row.delta == null}
                      <span class="text-base-content/50">n/a</span>
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
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <div class="order-1 md:order-2 flex flex-col md:h-72">
        <h3 class="pb-2 text-md font-semibold text-primary text-center underline">Reaction Composition</h3>
        <svg viewBox="0 0 1000 440" class="block w-full flex-1 min-h-0">
          {#if pieSlices.length === 0}
            <text x="500" y="220" text-anchor="middle" class="fill-slate-600 text-xs">No volume selected</text>
          {:else}
            {#each pieSlices as slice}
              <path d={arcPath(500, 220, 155, slice.start, slice.end)} fill={slice.color} stroke="white" stroke-width="1" />
              {@const x0 = 500 + 155 * Math.cos(slice.mid)}
              {@const y0 = 220 + 155 * Math.sin(slice.mid)}
              {@const x1 = 500 + 181 * Math.cos(slice.mid)}
              {@const y1 = 220 + 181 * Math.sin(slice.mid)}
              {@const rightSide = Math.cos(slice.mid) >= 0}
              {@const x2 = x1 + (rightSide ? 44 : -44)}
              {#if slice.percent >= 3}
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#334155" stroke-width="1" />
                <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="#334155" stroke-width="1" />
                <text
                x={x2 + (rightSide ? 4 : -4)}
                y={y1}
                text-anchor={rightSide ? 'start' : 'end'}
                dominant-baseline="middle"
                font-size="18"
                fill="#fff"
              >
                {slice.name} ({slice.percent.toFixed(1)}%)
              </text>
              {/if}
            {/each}
          {/if}
        </svg>
        <!--
        <div class="mt-1 rounded-md bg-base-200/40 p-2 text-[10px] leading-tight">
          {#if pieSlices.length === 0}
            <p class="text-base-content/60">No composition yet.</p>
          {:else}
            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 xl:grid-cols-3">
              {#each pieSlices as slice}
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="inline-block h-2 w-2 shrink-0 rounded-sm" style={`background:${slice.color}`}></span>
                  <span class="truncate">{slice.name} ({slice.percent.toFixed(1)}%)</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        -->
      </div>
    </section>

    <div class="space-y-4">
      {#each reagentGroups as group}
        <section>
          <h2 class="py-2 text-md font-semibold uppercase tracking-wide text-primary/90">{group.name}</h2>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-3 2xl:grid-cols-3">
            {#each group.reagents as reagent}
              <div
                class="rounded-md p-2 {isLockedAtCap(reagent) ? '' : 'cursor-ew-resize'}"
                style={reagentCardStyle(reagent.id)}
                onpointerdown={(event) => beginReagentDrag(reagent, event)}
              >
                <div class="flex items-center gap-2">
                  <div class="w-3/4 min-w-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <p class="text-sm font-medium leading-tight break-words">{reagent.name}</p>
                      {#if identityLinkForReagent(reagent.id)}
                        <a
                          class="shrink-0 text-[10px] text-primary/50 hover:text-primary"
                          href={identityLinkForReagent(reagent.id)?.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onpointerdown={(event) => event.stopPropagation()}
                        >
                          {identityLinkForReagent(reagent.id)?.value}
                        </a>
                      {/if}
                    </div>
                    <p class="truncate text-xs text-primary/50">
                      {reagentMetaLabel(reagent)}
                    </p>
                  </div>

                  {#if reagent.fixedNl == null}
                    <div class="w-1/4 flex justify-end gap-0.5">
                      <button
                        class="btn btn-xs min-h-0 h-6 px-2 bg-primary/20 rounded"
                        onclick={() => adjustVolumeNl(reagent, -STEP_NL)}
                        onpointerdown={(event) => event.stopPropagation()}
                        disabled={!canDecrease(reagent)}
                      >
                        -
                      </button>

                      <button
                        class="btn btn-xs min-h-0 h-6 px-2 bg-primary/20 rounded"
                        onclick={() => adjustVolumeNl(reagent, STEP_NL)}
                        onpointerdown={(event) => event.stopPropagation()}
                        disabled={!canIncrease(reagent)}
                      >
                        +
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <section class="mt-4 rounded-md bg-base-200/60 p-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-stretch">
        <div class="flex flex-col min-h-0">
          <div class="mb-1 flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold text-primary">Concentration Rank</h4>
            <button class="btn btn-xs" onclick={copyConcentrationRank}>Copy Rank</button>
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
          <div class="mb-1 flex items-center justify-between gap-2">
            <h4 class="text-sm font-semibold text-primary">Cost Rank</h4>
            <button class="btn btn-xs" onclick={copyCostRank}>Copy Rank</button>
          </div>
          <div class="mb-2 rounded bg-base-300/50 p-2 text-xs">
            <p><span class="opacity-60">Cost / Reaction</span> {formatUsd(totalCostUsd)}</p>
            <p><span class="opacity-60">Cost / 384-well plate</span> {formatUsd(totalCostUsd * 384)}</p>
          </div>
          <div class="rounded bg-base-300/50 p-2 text-xs font-mono">
            {#if costRankEntries.length === 0}
              <p>No non-zero reagents in composition.</p>
            {:else}
              {#each costRankEntries as entry}
                <p>{entry.rank}. {entry.name} <span class="opacity-50">{entry.costLabel} ({entry.volumeLabel})</span></p>
              {/each}
            {/if}
          </div>
        </div>

        <div class="flex flex-col min-h-0">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-primary">Composition JSON</h3>
            <button class="btn btn-xs" onclick={copyCompositionJson}>Copy JSON</button>
          </div>
          <pre class="h-56 overflow-auto rounded bg-base-300/50 p-2 text-xs">{exportedCompositionJson}</pre>
          {#if copyError}
            <p class="mt-1 text-xs text-red-400">{copyError}</p>
          {:else if copyMessage}
            <p class="mt-1 text-xs text-emerald-400">{copyMessage}</p>
          {/if}
        </div>
      </div>
    </section>
  </div>
</div>
{/if}
{:else}
<div class="min-h-screen flex items-center justify-center text-base-content/70">
  <p class="text-sm">Loading CFPS reagents...</p>
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

<svelte:window onclick={closeProfileDropdownOnOutsideClick} onpointermove={handlePointerMove} onpointerup={endReagentDrag} />

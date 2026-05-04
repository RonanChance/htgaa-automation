<script>
  import { browser } from '$app/environment';

  let {
    data = {},
    selectedWellLabels = {},
    selectedWellClaims = {},
    selectedWellColors = {},
    selectedWellProteins = {},
    previewClaim = null,
    previewLabel = '',
    previewColor = '',
    previewProtein = '',
    previewUsername = '',
    locked = false,
    deletingAssignment = false,
    activeSelectionSlot = null,
    currentCompositionSlot = 0,
    clearedSlotVersions = {},
    publishDisabled = false,
    onSelectionToggle = () => {},
    onSelectionHover = () => {},
    onSelectionHoverEnd = () => {},
    onDeleteAssignment = () => {},
    onPublishSelected = () => {}
  } = $props();

  const VARIANT_COUNT = 8;
  const STEP_NL = 25;
  const MAX_TOTAL_NL = 20_000;
  const WATER_ID = 'nuclease_free_water';
  const BASE_BUFFER_ID = 'base_buffer';
  const MASTER_MIX_NL = 10_000;
  const HIDDEN_REAGENT_IDS = new Set([BASE_BUFFER_ID]);

  const reagentGroups = (Array.isArray(data?.reagentGroups) ? data.reagentGroups : [])
    .map((group) => ({
      ...group,
      reagents: (Array.isArray(group?.reagents) ? group.reagents : []).filter(
        (reagent) => reagent?.in_stock !== false
      )
    }))
    .filter((group) => group.reagents.length > 0);

  const FIXED_VOLUME_OVERRIDES = {
    cell_lysate: 6000,
    dna_template: 2000,
    base_buffer: MASTER_MIX_NL
  };

  const baselineTargetMm = {
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

  const baselineTargetGramsPerLiter = {
    ribose: 11.625,
    glucose: 1.25
  };

  const fixedVolumeSummaryIds = new Set(['cell_lysate', 'dna_template']);
  const excludedFromExportIds = new Set(['cell_lysate', 'base_buffer', 'dna_template']);

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

  function withFixedVolumeOverrides(reagent, groupName) {
    return {
      ...reagent,
      ...(groupName ? { group: groupName } : {}),
      ...(Object.prototype.hasOwnProperty.call(FIXED_VOLUME_OVERRIDES, reagent.id)
        ? { fixedNl: FIXED_VOLUME_OVERRIDES[reagent.id] }
        : {})
    };
  }

  const allReagents = reagentGroups.flatMap((group) =>
    group.reagents.map((reagent) => withFixedVolumeOverrides(reagent, group.name))
  );

  const visibleReagents = allReagents.filter((reagent) => !HIDDEN_REAGENT_IDS.has(reagent.id));

  let copyMessage = $state('');
  let copyError = $state('');
  let variantVolumes = $state(
    Array.from({ length: VARIANT_COUNT }, () => computeDefaultVolumes())
  );
  let hydratedClaimSignatures = $state({});
  let previewVolumes = $state(computeDefaultVolumes());
  let clearedSlotVersionCache = $state({});

  const presetVolumesNl = computeDefaultVolumes();

  let summaryRows = $derived(buildSummaryRows());
  let variantExportedCompositions = $derived(
    variantVolumes.map((volumes) =>
      visibleReagents
        .filter((reagent) => !excludedFromExportIds.has(reagent.id))
        .map((reagent) => ({
          id: reagent.id,
          supplemental_volume_nl: Number(volumes[reagent.id]) || 0
        }))
        .filter((item) => item.supplemental_volume_nl > 0)
    )
  );
  let variantExportedCompositionJson = $derived(
    variantExportedCompositions.map((composition) => JSON.stringify(composition, null, 2))
  );
  let hasCustomizedAssignedWells = $derived(
    Object.entries(selectedWellClaims || {}).some(([slot, claim]) => {
      const variantIndex = Number(slot);
      if (!claim || !Number.isInteger(variantIndex)) return false;
      return (variantExportedCompositions[variantIndex] || []).length > 0;
    })
  );
  let combinedExportedComposition = $derived(
    Object.entries(selectedWellClaims || {})
      .map(([slot, claim]) => {
        const variantIndex = Number(slot);
        if (!claim) return null;

        return {
          quadrant: String(claim?.plate_id || ''),
          well_label: selectedWellLabels?.[variantIndex] || claim?.well_label || '',
          supplements: variantExportedCompositions[variantIndex] || []
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.well_label || '').localeCompare(String(b.well_label || '')))
  );
  let combinedExportedCompositionJson = $derived(
    JSON.stringify(combinedExportedComposition, null, 2)
  );

  function toStepNl(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric / STEP_NL) * STEP_NL;
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

  function formatPercentDelta(baseValue, deltaValue) {
    if (baseValue == null || deltaValue == null) return 'n/a';
    if (isZeroValue(deltaValue)) return '-';
    if (baseValue === 0) return 'new';
    return `${deltaValue >= 0 ? '+' : ''}${((deltaValue / baseValue) * 100).toFixed(1)}%`;
  }

  function formatUlValue(value) {
    if (value == null) return 'n/a';
    if (isZeroValue(value)) return '-';
    return `${value.toFixed(3)} uL`;
  }

  function isZeroValue(value) {
    if (value == null) return false;
    return Math.abs(Number(value)) < 1e-9;
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

    return gramsPerLiter / molecularWeight;
  }

  function stockVolumePercentForReagent(reagent) {
    return parseVolumePercent(reagent?.concentration);
  }

  function equivalentSourceVolumeNlForReagent(reagent) {
    if (!reagent || reagent.id === BASE_BUFFER_ID) return 0;

    if (baselineTargetMm[reagent.id] != null) {
      const stockM = stockMolarityForReagent(reagent);
      if (stockM && stockM > 0) {
        return ((baselineTargetMm[reagent.id] * 1e-3) / stockM) * MAX_TOTAL_NL;
      }
    }

    if (baselineTargetGramsPerLiter[reagent.id] != null) {
      const stockGL = parseGramsPerLiter(reagent.concentration);
      if (stockGL && stockGL > 0) {
        return (baselineTargetGramsPerLiter[reagent.id] / stockGL) * MAX_TOTAL_NL;
      }
    }

    return 0;
  }

  function baseBufferAllocationEntries() {
    return visibleReagents
      .map((reagent) => [reagent.id, equivalentSourceVolumeNlForReagent(reagent)])
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

  function computeDefaultVolumes() {
    const volumes = Object.fromEntries(allReagents.map((reagent) => [reagent.id, reagent.fixedNl ?? 0]));
    const currentTotal = allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
    const waterCurrent = Number(volumes[WATER_ID]) || 0;
    volumes[WATER_ID] = Math.max(0, waterCurrent + (MAX_TOTAL_NL - currentTotal));
    return volumes;
  }

  function volumesFromSupplementJson(supplements) {
    const volumes = computeDefaultVolumes();
    const entries = Array.isArray(supplements) ? supplements : [];

    for (const item of entries) {
      const reagentId = String(item?.id || '').trim();
      if (!reagentId || reagentId === WATER_ID || HIDDEN_REAGENT_IDS.has(reagentId)) continue;

      const reagent = allReagents.find((candidate) => candidate.id === reagentId);
      if (!reagent || reagent.fixedNl != null) continue;

      const candidateVolume = Math.max(0, toStepNl(Number(item?.supplemental_volume_nl) || 0));
      const allowedVolume = Math.min(candidateVolume, Number(volumes[WATER_ID]) || 0);

      volumes[reagentId] = allowedVolume;
      volumes[WATER_ID] = Math.max(0, (Number(volumes[WATER_ID]) || 0) - allowedVolume);
    }

    return volumes;
  }

  function claimSignatureForSlot(slot) {
    const claim = selectedWellClaims?.[slot];
    if (!claim) return '';
    return JSON.stringify({
      id: claim.id || '',
      reagents: Array.isArray(claim.reagents) ? claim.reagents : []
    });
  }

  $effect(() => {
    for (let slot = 0; slot < VARIANT_COUNT; slot += 1) {
      const signature = claimSignatureForSlot(slot);
      if (!signature || hydratedClaimSignatures[slot] === signature) continue;

      const claim = selectedWellClaims?.[slot];
      variantVolumes[slot] = volumesFromSupplementJson(claim?.reagents);
      hydratedClaimSignatures = {
        ...hydratedClaimSignatures,
        [slot]: signature
      };
    }
  });

  $effect(() => {
    previewVolumes = volumesFromSupplementJson(previewClaim?.reagents);
  });

  $effect(() => {
    for (let slot = 0; slot < VARIANT_COUNT; slot += 1) {
      const nextVersion = Number(clearedSlotVersions?.[slot] || 0);
      const previousVersion = Number(clearedSlotVersionCache?.[slot] || 0);
      if (!nextVersion || nextVersion === previousVersion) continue;

      variantVolumes[slot] = computeDefaultVolumes();
      hydratedClaimSignatures = {
        ...hydratedClaimSignatures,
        [slot]: ''
      };
      clearedSlotVersionCache = {
        ...clearedSlotVersionCache,
        [slot]: nextVersion
      };
    }
  });

  function totalVolumeFor(volumes) {
    return allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0);
  }

  function masterMixScaleFromVolumes(volumes) {
    const masterMixNl = Number(volumes?.[BASE_BUFFER_ID]) || 0;
    if (MASTER_MIX_NL <= 0) return 0;
    return masterMixNl / MASTER_MIX_NL;
  }

  function baseBufferContributionMmFromVolumes(reagentId, volumes) {
    return (baselineTargetMm[reagentId] || 0) * masterMixScaleFromVolumes(volumes);
  }

  function baseBufferContributionGramsPerLiterFromVolumes(reagentId, volumes) {
    return (baselineTargetGramsPerLiter[reagentId] || 0) * masterMixScaleFromVolumes(volumes);
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

  function finalMmForReagentFromVolumes(reagent, volumes) {
    const nm = finalNmForReagentFromVolumes(reagent, volumes);
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

  function finalVolumePercentForReagentFromVolumes(reagent, volumes) {
    const stockPercent = stockVolumePercentForReagent(reagent);
    const volumeNl = Number(volumes[reagent.id]) || 0;
    const totalNl = totalVolumeFor(volumes);
    const directPercent = stockPercent == null || totalNl <= 0 ? 0 : stockPercent * (volumeNl / totalNl);
    if (directPercent <= 0 && stockPercent == null) return null;
    return directPercent;
  }

  function baselineMmForReagent(reagent) {
    const isMolar = stockMolarityForReagent(reagent) != null;
    if (!isMolar) return null;
    return finalMmForReagentFromVolumes(reagent, presetVolumesNl);
  }

  function baselineGramsPerLiterForReagent(reagent) {
    if (baselineTargetGramsPerLiter[reagent.id] == null) return null;
    return finalGramsPerLiterForReagentFromVolumes(reagent, presetVolumesNl);
  }

  function baselineVolumePercentForReagent(reagent) {
    return finalVolumePercentForReagentFromVolumes(reagent, presetVolumesNl);
  }

  function baselineValueForReagent(reagent) {
    const baselineGL = baselineGramsPerLiterForReagent(reagent);
    if (baselineGL != null) return baselineGL;
    const baselineMm = baselineMmForReagent(reagent);
    if (baselineMm != null) return baselineMm;
    const baselinePercent = baselineVolumePercentForReagent(reagent);
    if (baselinePercent != null) return baselinePercent;
    return effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000;
  }

  function baselineLabelForReagent(reagent) {
    const baselineGL = baselineGramsPerLiterForReagent(reagent);
    if (baselineGL != null) return `${baselineGL.toFixed(3)} g/L`;
    const baselineMm = baselineMmForReagent(reagent);
    if (baselineMm != null) return formatMm(baselineMm);
    const baselinePercent = baselineVolumePercentForReagent(reagent);
    if (baselinePercent != null) return formatVolumePercent(baselinePercent);
    return formatUlValue(effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000);
  }

  function variantDisplayForReagent(reagent, volumes) {
    if (fixedVolumeSummaryIds.has(reagent.id) || reagent.id === WATER_ID) {
      const baselineUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000;
      const currentUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, volumes) / 1000;
      const delta = currentUl - baselineUl;
      return {
        currentLabel: formatUlValue(currentUl),
        delta,
        deltaPctLabel: formatPercentDelta(baselineUl, delta)
      };
    }

    const baselineGL = baselineGramsPerLiterForReagent(reagent);
    const currentGL = finalGramsPerLiterForReagentFromVolumes(reagent, volumes);
    if (baselineGL != null && currentGL != null) {
      const delta = currentGL - baselineGL;
      return {
        currentLabel: `${currentGL.toFixed(3)} g/L`,
        delta,
        deltaPctLabel: formatPercentDelta(baselineGL, delta)
      };
    }

    const baselineMm = baselineMmForReagent(reagent);
    const currentMm = finalMmForReagentFromVolumes(reagent, volumes);
    if (baselineMm != null && currentMm != null) {
      const delta = currentMm - baselineMm;
      return {
        currentLabel: formatMm(currentMm),
        delta,
        deltaPctLabel: formatPercentDelta(baselineMm, delta)
      };
    }

    const baselinePercent = baselineVolumePercentForReagent(reagent);
    const currentPercent = finalVolumePercentForReagentFromVolumes(reagent, volumes);
    if (baselinePercent != null && currentPercent != null) {
      const delta = currentPercent - baselinePercent;
      return {
        currentLabel: formatVolumePercent(currentPercent),
        delta,
        deltaPctLabel: formatPercentDelta(baselinePercent, delta)
      };
    }

    const baselineUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, presetVolumesNl) / 1000;
    const currentUl = effectiveVolumeNlForReagentFromVolumes(reagent.id, volumes) / 1000;
    const delta = currentUl - baselineUl;
    return {
      currentLabel: formatUlValue(currentUl),
      delta,
      deltaPctLabel: formatPercentDelta(baselineUl, delta)
    };
  }

  function buildSummaryRows() {
    return visibleReagents.map((reagent) => ({
      id: reagent.id,
      name: reagent.name,
      reagent,
      adjustable: reagent.fixedNl == null && reagent.id !== WATER_ID,
      baselineValue: baselineValueForReagent(reagent),
      baselineLabel: baselineLabelForReagent(reagent),
      currentVariants: variantVolumes.map((volumes) => variantDisplayForReagent(reagent, volumes))
    }));
  }

  function waterVolumeNlForVariant(variantIndex) {
    return Number(variantVolumes[variantIndex]?.[WATER_ID]) || 0;
  }

  function setVolumeNl(variantIndex, reagent, rawValue) {
    if (reagent.fixedNl != null || reagent.id === WATER_ID || !slotHasAssignedWell(variantIndex) || isEditingDisabled()) return;

    const candidate = Math.max(0, toStepNl(rawValue));
    const current = Number(variantVolumes[variantIndex]?.[reagent.id]) || 0;
    const clamped = Math.max(0, Math.min(candidate, current + waterVolumeNlForVariant(variantIndex)));
    const delta = clamped - current;

    variantVolumes[variantIndex][reagent.id] = clamped;
    variantVolumes[variantIndex][WATER_ID] = Math.max(
      0,
      (Number(variantVolumes[variantIndex][WATER_ID]) || 0) - delta
    );
  }

  function adjustVolumeNl(variantIndex, reagent, deltaNl) {
    if (reagent.fixedNl != null || reagent.id === WATER_ID || !slotHasAssignedWell(variantIndex) || isEditingDisabled()) return;
    const current = Number(variantVolumes[variantIndex]?.[reagent.id]) || 0;
    setVolumeNl(variantIndex, reagent, current + deltaNl);
  }

  function canIncrease(variantIndex, reagent) {
    return reagent.fixedNl == null && reagent.id !== WATER_ID && slotHasAssignedWell(variantIndex) && !isEditingDisabled() && waterVolumeNlForVariant(variantIndex) >= STEP_NL;
  }

  function canDecrease(variantIndex, reagent) {
    return reagent.fixedNl == null && reagent.id !== WATER_ID && slotHasAssignedWell(variantIndex) && !isEditingDisabled() && (Number(variantVolumes[variantIndex]?.[reagent.id]) || 0) >= STEP_NL;
  }

  function currentCellToneClass(variant) {
    if (variant?.delta > 0) return 'text-emerald-400';
    if (variant?.delta < 0) return 'text-red-400';
    return 'text-base-content/80';
  }

  async function copyCompositionJson() {
    copyMessage = '';
    copyError = '';
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(combinedExportedCompositionJson || '[]');
      copyMessage = 'Copied selected well supplement JSON to clipboard.';
    } catch {
      copyError = 'Failed to copy JSON.';
    }
  }

  function buildPublishSubmission() {
    const variants = Object.entries(selectedWellClaims || {})
      .map(([slot, claim]) => {
        const variantIndex = Number(slot);
        const volumes = variantVolumes[variantIndex];
        if (!claim || !volumes) return null;

        return {
          slot: variantIndex,
          claim,
          design: {
            maxTotalNl: MAX_TOTAL_NL,
            stepNl: STEP_NL,
            totalVolumeNl: allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0),
            totalVolumeUl: allReagents.reduce((sum, reagent) => sum + (Number(volumes[reagent.id]) || 0), 0) / 1000,
            reagents: allReagents.map((reagent) => ({
              ...identityForReagent(reagent.id),
              id: reagent.id,
              group: reagent.group,
              name: reagent.name,
              concentration: reagent.concentration,
              costPerMl: reagent.costPerMl,
              volumeNl: Number(volumes[reagent.id]) || 0,
              fixed: reagent.fixedNl != null
            })),
            supplement_json: variantExportedCompositions[variantIndex] || []
          }
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.slot - b.slot);

    return {
      current_slot: currentCompositionSlot,
      variants
    };
  }

  function tableTsvText() {
    const header = [
      'Reagent',
      'Preset',
      ...Array.from({ length: VARIANT_COUNT }, (_, index) =>
        selectedWellLabels?.[index]
          ? `Variant ${index + 1} (${selectedWellLabels[index]})`
          : `Variant ${index + 1}`
      )
    ];

    const rows = summaryRows.map((row) => [
      row.name,
      row.baselineLabel,
      ...row.currentVariants.map((variant) => `${variant.currentLabel} (${variant.deltaPctLabel})`)
    ]);

    return [header, ...rows].map((cells) => cells.join('\t')).join('\n');
  }

  async function copyTableTsv() {
    copyMessage = '';
    copyError = '';
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(tableTsvText());
      copyMessage = 'Copied reaction table TSV to clipboard.';
    } catch {
      copyError = 'Failed to copy reaction table.';
    }
  }

  function selectionButtonClasses(variantIndex, hasSelection) {
    return [
      'btn btn-xs h-6 min-h-0 px-2 rounded-md border text-[10px]',
      activeSelectionSlot === variantIndex
        ? 'border-primary text-primary-content'
        : currentCompositionSlot === variantIndex && !isReadOnlyPreview()
          ? 'border-white text-base-content'
        : hasSelection
          ? 'border-base-content/30 text-base-content'
          : 'border-base-content/20 bg-base-200/70 text-base-content/80'
    ].join(' ');
  }

  function selectionButtonStyle(variantIndex) {
    const fill = String(selectedWellColors?.[variantIndex] || '').trim();
    const isCurrent = currentCompositionSlot === variantIndex && !isReadOnlyPreview();
    const whiteOutline = isCurrent ? 'box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.95);' : '';
    if (!fill) return whiteOutline;
    return `background-color: ${fill}; color: ${selectionButtonTextColor(fill)}; border-color: ${fill}; ${whiteOutline}`;
  }

  function previewBadgeStyle() {
    const fill = String(previewColor || '').trim();
    if (!fill) return '';
    return `background-color: ${fill}; color: ${selectionButtonTextColor(fill)}; border-color: ${fill};`;
  }

  function selectionButtonTextColor(color) {
    const normalized = String(color || '').trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
    if (!/^[0-9a-f]{6}$/i.test(hex)) return '#111827';
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
    return luminance > 170 ? '#111827' : '#f9fafb';
  }

  function currentVariantForRow(row) {
    if (previewClaim) {
      return variantDisplayForReagent(row?.reagent, previewVolumes);
    }
    return row?.currentVariants?.[currentCompositionSlot] || row?.currentVariants?.[0] || null;
  }

  function slotHasAssignedWell(slot) {
    return Boolean(selectedWellClaims?.[slot]);
  }

  function slotDisplayLabel(slot) {
    const claim = selectedWellClaims?.[slot];
    const baseLabel = String(selectedWellLabels?.[slot] || claim?.well_label || '').trim();
    const quadrant = String(claim?.plate_id || '').trim();
    if (!baseLabel) return '';
    return quadrant ? `${quadrant}-${baseLabel}` : baseLabel;
  }

  function currentColumnLabel() {
    if (isReadOnlyPreview() && previewLabel) {
      const quadrant = String(previewClaim?.plate_id || '').trim();
      return quadrant ? `${quadrant}-${previewLabel}` : previewLabel;
    }

    const label = slotDisplayLabel(currentCompositionSlot);
    return label || 'Select a well';
  }

  function currentProteinName() {
    if (isReadOnlyPreview()) {
      return String(previewProtein || '').trim();
    }
    return String(selectedWellProteins?.[currentCompositionSlot] || '').trim();
  }

  function currentProteinColor() {
    if (isReadOnlyPreview()) {
      return String(previewColor || '').trim();
    }
    return String(selectedWellColors?.[currentCompositionSlot] || '').trim();
  }

  function shouldShowDeltaLabel(variant) {
    const label = String(variant?.deltaPctLabel || '').trim();
    return Boolean(label) && label !== '-';
  }

  function isReadOnlyPreview() {
    return Boolean(previewClaim);
  }

  function isEditingDisabled() {
    return locked || isReadOnlyPreview();
  }

  function onboardingStep() {
    if (activeSelectionSlot != null) return 2;
    if (slotHasAssignedWell(currentCompositionSlot)) return 3;
    return 1;
  }
</script>

{#if reagentGroups.length > 0}
  <div class="flex flex-col w-full mt-2 gap-1 mx-auto bg-base-200 rounded px-2 py-1.5 text-xs opacity-90">
    <div class="flex flex-col gap-1">
      {#if locked}
        <div class="rounded bg-base-100/70 px-2 py-1 text-[10px] sm:text-[11px] text-center opacity-80">
          Only approved contributors can edit cell-free reaction compositions.
        </div>
      {/if}

      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-[13px] opacity-100">Cell-Free Reaction Compositions</span>
        <div class="flex items-center gap-1">
          <button class="btn btn-xs" onclick={copyTableTsv}>Copy</button>
          <button
            class={`btn btn-xs ${hasCustomizedAssignedWells ? 'btn-primary' : ''}`}
            onclick={() => onPublishSelected(buildPublishSubmission())}
            disabled={publishDisabled || locked}
          >
            Save Concentrations
          </button>
        </div>
      </div>

      <div class={`grid grid-cols-2 items-start gap-2 ${locked ? 'opacity-70' : ''}`}>
        <div class="flex min-w-0 flex-wrap gap-1 pt-1">
          {#each Array.from({ length: VARIANT_COUNT }, (_, index) => index) as variantIndex}
            <button
              class={selectionButtonClasses(variantIndex, !!selectedWellLabels?.[variantIndex])}
              style={selectionButtonStyle(variantIndex)}
              onclick={() => onSelectionToggle(variantIndex)}
              onmouseenter={() => onSelectionHover(variantIndex)}
              onmouseleave={() => onSelectionHoverEnd(variantIndex)}
              title={slotDisplayLabel(variantIndex) ? `Selected well ${slotDisplayLabel(variantIndex)}` : 'Select well'}
              disabled={locked}
            >
              {slotDisplayLabel(variantIndex) || '..'}
            </button>
        {/each}
        {#if isReadOnlyPreview() && previewLabel}
          <span
            class="inline-flex h-6 min-h-0 items-center px-2 rounded-md border text-[10px] opacity-90"
            style={previewBadgeStyle()}
            title={currentColumnLabel()}
          >
            {String(currentColumnLabel()).replace(/^Preview \(/, '').replace(/\)$/, '')}
          </span>
        {/if}
        </div>

        <div class="min-w-0 text-[10px] sm:text-[11px] opacity-60 text-center leading-tight text-green-300 justify-self-end w-full pt-1">
          {#if activeSelectionSlot != null && !slotHasAssignedWell(activeSelectionSlot)}
            Click a well to assign this slot
          {:else if activeSelectionSlot != null}
            Click a well to reassign this slot
          {:else if !slotHasAssignedWell(currentCompositionSlot)}
            <div class={onboardingStep() === 1 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              1. Choose a slot
            </div>
            <div class={onboardingStep() === 2 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              2. Assign a well
            </div>
            <div class={onboardingStep() === 3 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              3. Adjust reagents
            </div>
            <div class={onboardingStep() === 4 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              4. Save changes
            </div>
          {:else}
            <div class={onboardingStep() === 1 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              1. Choose a slot
            </div>
            <div class={onboardingStep() === 2 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              2. Assign a well
            </div>
            <div class={onboardingStep() === 3 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              3. Adjust reagents
            </div>
            <div class={onboardingStep() === 4 ? 'text-green-300 font-medium' : 'text-base-content/60'}>
              4. Save changes
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if isReadOnlyPreview() && previewUsername}
      <div class="px-1 text-center text-[10px] sm:text-[11px] opacity-70">
        Previewing {previewUsername}
      </div>
    {/if}

    <div class="w-full rounded bg-base-300/30 overflow-x-hidden">
      <table class="table table-xs tabular-nums mx-auto w-full min-w-0 sm:min-w-[28rem] table-fixed [&_th]:px-0.5 [&_td]:px-0.5">
        <thead>
          <tr>
            <th class="w-[30%] text-center px-0!">Reagent</th>
            <th class="w-[36%] text-center px-0!">
              <div>{currentColumnLabel()}</div>
              {#if currentProteinName()}
                <div
                  class="mt-0.5 text-[8px] sm:text-[9px] font-medium"
                  style={`color: ${currentProteinColor() || 'inherit'};`}
                >
                  {currentProteinName()}
                </div>
              {/if}
            </th>
            <th class="w-[34%] text-center pl-0! pr-0.5!">Adjust</th>
          </tr>
        </thead>
        <tbody>
          {#each summaryRows as row}
            <tr>
              <td class="align-top py-1 pl-0.5 pr-0">
                <div class="min-w-0 text-left leading-tight">
                  <div class="whitespace-normal break-words text-[10px] sm:text-[11px] font-medium pl-1 sm:pl-2">{row.name}</div>
                  <div class="mt-0 text-[8px] sm:text-[9px] opacity-60 pl-1 sm:pl-2">{row.reagent.concentration}</div>
                </div>
              </td>
              <td class="pl-0 pr-0.5 py-0.5 align-top">
                <div class={`rounded px-0.5 sm:px-1 py-0.5 text-center leading-tight ${currentCellToneClass(currentVariantForRow(row))}`}>
                  <div class="whitespace-nowrap text-[10px] sm:text-[11px]">{currentVariantForRow(row)?.currentLabel}</div>
                  <div class="mt-0 min-h-[0.65rem] sm:min-h-[0.75rem] whitespace-nowrap text-[8px] sm:text-[9px] opacity-80">
                    {#if shouldShowDeltaLabel(currentVariantForRow(row))}
                      ({currentVariantForRow(row)?.deltaPctLabel})
                    {/if}
                  </div>
                </div>
              </td>
              <td class="pl-0.5 pr-0.5 py-0.5 align-top">
                {#if row.adjustable && !isEditingDisabled() && slotHasAssignedWell(currentCompositionSlot)}
                  <div class="flex items-center justify-center gap-0.5 sm:gap-1">
                    <button
                      class="btn btn-xs min-h-0 h-4 w-4 sm:h-5 sm:w-5 rounded bg-primary/20 px-0 text-[10px]"
                      onclick={() => adjustVolumeNl(currentCompositionSlot, row.reagent, -STEP_NL)}
                      disabled={!canDecrease(currentCompositionSlot, row.reagent)}
                      aria-label={`Decrease ${row.name} for variant ${currentCompositionSlot + 1}`}
                    >
                      -
                    </button>
                    <button
                      class="btn btn-xs min-h-0 h-4 w-4 sm:h-5 sm:w-5 rounded bg-primary/20 px-0 text-[10px]"
                      onclick={() => adjustVolumeNl(currentCompositionSlot, row.reagent, STEP_NL)}
                      disabled={!canIncrease(currentCompositionSlot, row.reagent)}
                      aria-label={`Increase ${row.name} for variant ${currentCompositionSlot + 1}`}
                    >
                      +
                    </button>
                  </div>
                {:else}
                  <div class="text-center text-[10px] opacity-35">-</div>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="flex justify-end">
      {#if !isReadOnlyPreview() && slotHasAssignedWell(currentCompositionSlot)}
        <button
          class="btn btn-xs btn-error text-error-content"
          onclick={() => onDeleteAssignment(currentCompositionSlot)}
          disabled={locked || deletingAssignment}
        >
          Delete Well Assignment
        </button>
      {/if}
    </div>

    <div class="rounded bg-base-300/30 p-2">
      <div class="mb-1 flex items-center justify-between gap-2">
        <span class="font-semibold text-sm opacity-100">Reagent Supplement JSON</span>
      </div>
      <div class="rounded bg-base-300/50 p-2">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="text-xs font-semibold">
            Selected wells
          </span>
          <button class="btn btn-xs" onclick={() => copyCompositionJson()}>Copy</button>
        </div>
        <pre class="max-h-[500px] overflow-auto text-xs">{combinedExportedCompositionJson || '[]'}</pre>
      </div>
      {#if copyError}
        <p class="mt-2 text-xs text-red-400">{copyError}</p>
      {:else if copyMessage}
        <p class="mt-2 text-xs text-emerald-400">{copyMessage}</p>
      {/if}
    </div>
  </div>
{/if}

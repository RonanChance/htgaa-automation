<script>
  let { analysis } = $props();
  const { sfgfp, cutinase, reteplase, displayReagents, label1 } = analysis;

  const PROTEINS = [
    { key: 'sfgfp',     label: 'sfGFP',     color: '#2f8f4e' },
    { key: 'cutinase',  label: 'PETase',    color: '#6f4bd0' },
    { key: 'reteplase', label: 'Reteplase', color: '#cf6320' },
  ];
  const DATA = { sfgfp, cutinase, reteplase };

  // Muted categorical palette — toned-down hues that read against the
  // blueprint ground while staying mutually distinguishable at 3px dot size.
  const CAT_COLORS = {
    'Salts': '#5b7a99', 'Buffers': '#3f9169', 'Amino acids': '#c26b2c',
    'Energy': '#bd9a2e', 'Nucleotides': '#8b6fc0', 'Cofactors': '#7a8590',
    'Redox': '#c0705f', 'Chaperones': '#3f9992',
    'Nucleosides': '#6f77c0', 'Nucleobases': '#b571c0',
  };

  const ROW_H = 20;
  const LABEL_W = 110;
  const BAR_W = 165;
  const PAD = 6;
  const COL_GAP = 28;
  const MAX_LABEL_W = 56; // room at the right of each bar for its "max unit" label

  const activeData = DATA;
  const activeLabel = label1;
  const activeDisplay = displayReagents;

  // Each reagent row is scaled to its OWN max across the three proteins, so
  // low-concentration reagents (CoA, NAD, NMPs, DsbC µM, folinic acid mg/mL …)
  // show a legible range bar instead of collapsing to a sliver against the
  // K-glutamate axis. A per-row "max unit" label restores the absolute scale.
  function rowMax(reagentId) {
    let mx = 0;
    for (const p of PROTEINS) {
      const v = activeData[p.key]?.stats?.[reagentId]?.disp?.max ?? 0;
      if (v > mx) mx = v;
    }
    return mx || 1;
  }
  function reagentUnit(reagentId) {
    for (const p of PROTEINS) {
      const u = activeData[p.key]?.stats?.[reagentId]?.unit;
      if (u) return u;
    }
    return 'mM';
  }
  // x position within a bar area beginning at colX, scaled to the row's own max.
  function xIn(colX, val, mx) { return colX + LABEL_W + PAD + (val / mx) * BAR_W; }

  function fmtMax(v) {
    if (v >= 10) return v.toFixed(0);
    if (v >= 1) return v.toFixed(1);
    if (v >= 0.1) return v.toFixed(2);
    return v.toFixed(3);
  }

  let showChangingOnly = $state(false);
  let selectedProtein = $state(null); // null = all, or protein key

  const activeProteins = $derived(
    selectedProtein ? PROTEINS.filter(p => p.key === selectedProtein) : PROTEINS
  );
  let tooltip = $state(null); // { x, y, reagent, label }

  function handleMouseMove(e, reagent) {
    const rect = e.currentTarget.getBoundingClientRect();
    tooltip = {
      x: e.clientX,
      y: e.clientY,
      reagent,
    };
  }
  function clearTooltip() { tooltip = null; }

  // "Changing" = at least one protein has a non-zero range (max > min) for this reagent
  const filteredReagents = $derived(
    showChangingOnly
      ? activeDisplay.filter(r =>
          PROTEINS.some(p => {
            const s = activeData[p.key]?.stats?.[r.id];
            return s && s.disp.max > 0 && s.disp.max > s.disp.min;
          })
        )
      : activeDisplay
  );

  // Split into two columns
  const half = $derived(Math.ceil(filteredReagents.length / 2));
  const col1 = $derived(filteredReagents.slice(0, half));
  const col2 = $derived(filteredReagents.slice(half));

  const SVG_W = (LABEL_W + PAD + BAR_W + MAX_LABEL_W) * 2 + COL_GAP;
  const SVG_H = $derived(half * ROW_H + 16);

  function renderReagent(reagent, ri, colOffset) {
    const x0 = colOffset;
    const y = ri * ROW_H + ROW_H / 2;
    const catColor = CAT_COLORS[reagent.cat] ?? '#7a8590';
    return { x0, y, catColor };
  }

  const SUMMARY = {
    sfgfp:     `OFAT (one-factor-at-a-time) rev3 control plate: from three baselines — PANOx-SP, Ginkgo3, and RFopt — it sweeps K-glutamate, Mg-glutamate, K-phosphate and glucose one at a time, plus a native/NMP/NTP nucleotide swap, mapping which salt and energy parameters drive sfGFP yield.`,
    cutinase:  `Same OFAT sweeps as sfGFP with DsbC chaperone held constant to support TfCut2's 1 disulfide bond — testing whether the salt and energy conditions that favor sfGFP transfer to a disulfide-containing enzyme.`,
    reteplase: `Same OFAT sweeps on an oxidizing baseline: the GSSG/GSH redox pair and DsbC are fixed (with 500 µM iodoacetamide lysate pretreatment) for reteplase's 9 disulfide bonds, while salt and energy parameters are explored to maximize active yield.`,
  };

  const activeSummary = SUMMARY;
</script>

<div class="rounded-lg border border-base-300 bg-base-200 p-3 space-y-3">
  <div class="flex items-center justify-between flex-wrap gap-2">
    <div>
      <h4 class="text-sm font-semibold text-base-content/70">Plate Designs — Reagent Ranges</h4>
      <p class="text-[10px] text-base-content/40 mt-0.5">{activeLabel}</p>
    </div>
    <div class="flex items-center gap-3 text-[10px]">
      <button
        class="rounded border px-2 py-0.5 transition {showChangingOnly ? 'border-base-content/40 text-base-content/70 bg-base-content/5' : 'border-base-content/15 text-base-content/35'}"
        onclick={() => showChangingOnly = !showChangingOnly}
      >Varying only</button>
      {#each PROTEINS as p}
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:{p.color}"></span>{p.label}</span>
      {/each}
    </div>
  </div>

  <svg viewBox="0 0 {SVG_W} {SVG_H}" class="w-full" style="max-height:320px;">
    <!-- Column 1 -->
    {#each col1 as reagent, ri}
      {@const y = ri * ROW_H + ROW_H / 2}
      {@const catColor = CAT_COLORS[reagent.cat] ?? '#7a8590'}
      {@const mx = rowMax(reagent.id)}
      {@const unit = reagentUnit(reagent.id)}
      <circle cx={4} cy={y} r={3} fill={catColor} opacity={0.7}/>
      <text x={10} y={y + 3.5} font-size="9" fill="oklch(var(--bc)/0.65)">{reagent.label}</text>
      <!-- per-row baseline (0 → row max) -->
      <line x1={LABEL_W + PAD} y1={y} x2={LABEL_W + PAD + BAR_W} y2={y} stroke="oklch(var(--bc)/0.08)" stroke-width="0.5"/>
      {#each activeProteins as protein, pi}
        {@const stat = activeData[protein.key]?.stats?.[reagent.id]}
        {@const dy = selectedProtein ? 0 : (pi - 1) * 5}
        {#if stat && stat.disp.max > 0}
          <rect x={xIn(0, stat.disp.min, mx)} y={y + dy - 2} width={Math.max(1, xIn(0, stat.disp.max, mx) - xIn(0, stat.disp.min, mx))} height={4} rx={1} fill={protein.color} opacity={0.2}/>
          <rect x={xIn(0, stat.disp.q1, mx)} y={y + dy - 2} width={Math.max(1, xIn(0, stat.disp.q3, mx) - xIn(0, stat.disp.q1, mx))} height={4} rx={1} fill={protein.color} opacity={0.55}/>
          <circle cx={xIn(0, stat.disp.median, mx)} cy={y + dy} r={2.5} fill={protein.color}/>
        {/if}
      {/each}
      <!-- per-row max + unit -->
      <text x={LABEL_W + PAD + BAR_W + 4} y={y + 3} font-size="7.5" fill="oklch(var(--bc)/0.42)">{fmtMax(mx)} {unit}</text>
      <!-- Invisible hover rect for the whole row -->
      <rect x={0} y={ri * ROW_H} width={LABEL_W + PAD + BAR_W + MAX_LABEL_W} height={ROW_H}
        fill="transparent" style="cursor:default;"
        onmousemove={(e) => handleMouseMove(e, reagent)}
        onmouseleave={clearTooltip}
      />
    {/each}

    <!-- Column 2 -->
    {#each col2 as reagent, ri}
      {@const y = ri * ROW_H + ROW_H / 2}
      {@const x0 = LABEL_W + PAD + BAR_W + MAX_LABEL_W + COL_GAP}
      {@const catColor = CAT_COLORS[reagent.cat] ?? '#7a8590'}
      {@const mx = rowMax(reagent.id)}
      {@const unit = reagentUnit(reagent.id)}
      <circle cx={x0 + 4} cy={y} r={3} fill={catColor} opacity={0.7}/>
      <text x={x0 + 10} y={y + 3.5} font-size="9" fill="oklch(var(--bc)/0.65)">{reagent.label}</text>
      <line x1={x0 + LABEL_W + PAD} y1={y} x2={x0 + LABEL_W + PAD + BAR_W} y2={y} stroke="oklch(var(--bc)/0.08)" stroke-width="0.5"/>
      {#each activeProteins as protein, pi}
        {@const stat = activeData[protein.key]?.stats?.[reagent.id]}
        {@const dy = selectedProtein ? 0 : (pi - 1) * 5}
        {#if stat && stat.disp.max > 0}
          <rect x={xIn(x0, stat.disp.min, mx)} y={y + dy - 2} width={Math.max(1, xIn(x0, stat.disp.max, mx) - xIn(x0, stat.disp.min, mx))} height={4} rx={1} fill={protein.color} opacity={0.2}/>
          <rect x={xIn(x0, stat.disp.q1, mx)} y={y + dy - 2} width={Math.max(1, xIn(x0, stat.disp.q3, mx) - xIn(x0, stat.disp.q1, mx))} height={4} rx={1} fill={protein.color} opacity={0.55}/>
          <circle cx={xIn(x0, stat.disp.median, mx)} cy={y + dy} r={2.5} fill={protein.color}/>
        {/if}
      {/each}
      <text x={x0 + LABEL_W + PAD + BAR_W + 4} y={y + 3} font-size="7.5" fill="oklch(var(--bc)/0.42)">{fmtMax(mx)} {unit}</text>
      <rect x={x0} y={ri * ROW_H} width={LABEL_W + PAD + BAR_W + MAX_LABEL_W} height={ROW_H}
        fill="transparent" style="cursor:default;"
        onmousemove={(e) => handleMouseMove(e, reagent)}
        onmouseleave={clearTooltip}
      />
    {/each}
    <text x={SVG_W / 2} y={SVG_H - 2} text-anchor="middle" font-size="7" fill="oklch(var(--bc)/0.3)">each row scaled to its own max (shown at right) · bar = IQR, line = full range, dot = median</text>
  </svg>

  <!-- Hover tooltip -->
  {#if tooltip}
    <div
      class="fixed z-50 pointer-events-none rounded border border-base-300 bg-base-100 shadow-lg px-3 py-2 text-[10px] font-mono"
      style="left:{tooltip.x + 12}px; top:{tooltip.y - 10}px; min-width:180px;"
    >
      <div class="font-sans font-semibold text-base-content/80 mb-1">{tooltip.reagent.label}</div>
      {#each PROTEINS as p}
        {@const s = activeData[p.key]?.stats?.[tooltip.reagent.id]}
        <div class="flex items-center gap-2 mb-0.5">
          <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background:{p.color}"></span>
          <span class="text-base-content/50 w-14 shrink-0">{p.label}</span>
          {#if s && s.disp.max > 0}
            <span class="text-base-content/70">
              {fmtMax(s.disp.min)}–{fmtMax(s.disp.max)}
              <span class="text-base-content/40 ml-1">med {fmtMax(s.disp.median)} {s.unit}</span>
            </span>
          {:else}
            <span class="text-base-content/30">—</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Summaries — click to isolate -->
  <div class="grid grid-cols-3 gap-2 text-[10px]">
    {#each PROTEINS as p}
      {@const isSelected = selectedProtein === p.key}
      {@const isDimmed = selectedProtein && !isSelected}
      <button
        class="rounded p-2 text-left border transition"
        style="background: oklch(var(--b3)/0.5); border-color: {isSelected ? p.color : 'oklch(var(--bc)/0.08)'}; opacity:{isDimmed ? 0.35 : 1}; box-shadow:{isSelected ? `0 0 0 1px ${p.color}` : 'none'};"
        onclick={() => selectedProtein = selectedProtein === p.key ? null : p.key}
      >
        <div class="font-semibold mb-1" style="color:{p.color};">{p.label}</div>
        <p class="text-base-content/55 leading-relaxed">{activeSummary[p.key]}</p>
      </button>
    {/each}
  </div>
</div>

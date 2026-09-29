<script>
  // Detailed plate-reader modal for the /cfps assay section — the "click into"
  // view behind each inline PlateReaderCard. Mirrors overview.html's "scope":
  // a 384-well plate you can scrub through time, hover for per-well signal,
  // toggle in-well numbers, read a detailed timecourse, and click an
  // experimental well to load its exact reagent combination into the design.
  import { untrack } from 'svelte';
  import PlateGrid from './PlateGrid.svelte';
  import PlateTimecourse from './PlateTimecourse.svelte';
  import PlateRankedTiters from './PlateRankedTiters.svelte';
  import { computeScale, computeTimecourse, computeRankedTiters, fmtVal, fmtHours } from './plateReader.js';

  // onSelectComposition({ label, recipe, wellNames }) → parent loads the picked
  // composition into the designer's Comparison column.
  let { data, onLoadWell, onSelectComposition, onClose, initialIndex = 0 } = $props();

  let targets = $derived(data?.targets ?? []);
  // Capture the opening target once — the modal remounts on each open, so the
  // caller's focused index takes effect while tabs still let you switch.
  let activeIdx = $state(untrack(() => initialIndex));
  let target = $derived(targets[activeIdx] ?? null);

  // Timepoint scrubber — default to the last read (fully developed signal).
  let tpIndex = $state(0);
  $effect(() => {
    const n = target?.grids?.length ?? 0;
    tpIndex = Math.max(0, n - 1);
  });

  let showValues = $state(true); // exact per-well numbers on by default

  let currentGrid = $derived(target?.grids?.[tpIndex] ?? []);
  let wells = $derived(target?.wells ?? []);
  let scale = $derived(computeScale(target?.grids));
  let series = $derived(computeTimecourse(target));

  // ── ranked-sample titers + platemap spotlight ──────────────────────────────
  let ranked = $derived(computeRankedTiters(target));
  // Hover in the chart = transient spotlight; a click sticks the selection so it
  // stays highlighted after loading into the Comparison column. Both reset when
  // the active target (tab) changes.
  let highlightLabel = $state(null);
  let selectedLabel = $state(null);
  $effect(() => {
    activeIdx; // re-run on tab switch
    untrack(() => {
      highlightLabel = null;
      selectedLabel = null;
    });
  });
  let activeLabel = $derived(highlightLabel ?? selectedLabel);
  let activeEntry = $derived(activeLabel ? (ranked.find((e) => e.label === activeLabel) ?? null) : null);
  let highlightIdx = $derived(activeEntry?.wellIdx ?? []);
  function onRankHighlight(label) {
    highlightLabel = label;
  }
  function onRankSelect(entry) {
    selectedLabel = entry.label;
    onSelectComposition?.({ label: entry.label, recipe: entry.recipe, wellNames: entry.wellNames });
  }

  // ── hover tooltip ─────────────────────────────────────────────────────────
  let hover = $state(null); // { idx, x, y }
  function onGridHover(info) {
    hover = info;
  }

  let hoverInfo = $derived.by(() => {
    if (!hover || !target) return null;
    const w = wells[hover.idx];
    const v = currentGrid[hover.idx];
    if (!w) return null;
    const ratios = [];
    if (v != null && !Number.isNaN(v)) {
      if (target.posctrl) ratios.push(`${(v / target.posctrl).toFixed(2)}× pos ctrl`);
      if (target.blank) ratios.push(`${(v / target.blank).toFixed(1)}× blank`);
    }
    return {
      well: w.well,
      value: `${fmtVal(v, target.kind)} ${target.unit}`,
      ratios: ratios.join(' · '),
      type: w.sampleType,
      label: w.label,
      loadable: !!w.recipe,
    };
  });

  function onGridClick(idx) {
    const w = wells[idx];
    if (w?.recipe) onLoadWell?.(w);
  }

  function onKey(e) {
    if (e.key === 'Escape') onClose?.();
  }

  const TYPE_LABELS = {
    experimental: 'experimental',
    standard: 'standard curve',
    target_control: 'target control',
    positive_control_mixed: 'positive control',
    negative: 'negative',
  };
</script>

<svelte:window onkeydown={onKey} />

<div
  class="pr-ov"
  role="button"
  tabindex="-1"
  aria-label="Close plate reader"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose?.();
  }}
  onkeydown={() => {}}
>
  <div class="pr-panel" role="dialog" aria-modal="true" aria-label="Plate reader">
    <header class="pr-hd">
      <div class="pr-tabs">
        {#each targets as t, i}
          <button class="pr-tab" class:on={i === activeIdx} onclick={() => (activeIdx = i)}>{t.label}</button>
        {/each}
      </div>
      <span class="pr-spacer"></span>
      {#if target}
        <span class="pr-meta">{target.run} · {target.assayKind} · {target.grids.length} reads</span>
      {/if}
      <button class="pr-x" title="Close" aria-label="Close" onclick={() => onClose?.()}>✕</button>
    </header>

    <div class="pr-bd">
      {#if !target}
        <p class="pr-empty">No kinetic reads available.</p>
      {:else}
        <div class="pr-scope">
          <PlateGrid
            grid={currentGrid}
            {wells}
            rows={target.rows}
            cols={target.cols}
            {scale}
            kind={target.kind}
            interactive
            {showValues}
            axis
            {highlightIdx}
            onhover={onGridHover}
            onwellclick={onGridClick}
          />
        </div>

        <!-- timepoint scrubber -->
        {#if target.grids.length > 1}
          <div class="pr-scrub">
            <input
              type="range"
              class="pr-range"
              min="0"
              max={target.grids.length - 1}
              bind:value={tpIndex}
              aria-label="Timepoint"
            />
            <span class="pr-t">time = {fmtHours(target.timepoints[tpIndex])}</span>
          </div>
        {/if}

        <!-- colour scale + controls -->
        <div class="pr-legend">
          <div class="pr-ramp">
            <span class="pr-ramp__lo">{fmtVal(scale.lo, target.kind)}</span>
            <span class="pr-ramp__bar"></span>
            <span class="pr-ramp__hi">{fmtVal(scale.hi, target.kind)} {target.unit}</span>
          </div>
          <div class="pr-row">
            <button class="pr-toggle" class:on={showValues} onclick={() => (showValues = !showValues)}>
              {showValues ? '☑' : '☐'} show values
            </button>
            <p class="pr-hint">
              Hover a well for its signal · click an <b>experimental</b> well to load its recipe.
            </p>
          </div>
        </div>

        <!-- detailed timecourse (kinetic) or endpoint summary -->
        {#if series && target.grids.length > 1}
          <div class="pr-tc">
            <div class="pr-tc__hd">signal timecourse — median across the plate</div>
            <PlateTimecourse {series} unit={target.unit} kind={target.kind} detailed />
          </div>
        {:else if series}
          <div class="pr-tc">
            <div class="pr-tc__hd">endpoint read — single timepoint, median across the plate</div>
            <div class="pr-ep">
              <span class="pr-ep__v">exp {fmtVal(series.experimental[0], target.kind)} {target.unit}</span>
              <span class="pr-ep__v pr-ep__v--pos">pos ctrl {fmtVal(series.posctrl[0], target.kind)}</span>
              <span class="pr-ep__v pr-ep__v--blank">blank (background signal) {fmtVal(series.blank, target.kind)}</span>
            </div>
          </div>
        {/if}

        <!-- ranked sample titers — every composition ranked by endpoint signal.
             Hover a point to spotlight its wells above; click to load it into the
             designer's Comparison column. Present for all three targets. -->
        {#if ranked.length}
          <div class="pr-tc">
            <div class="pr-tc__hd">
              ranked sample titers — {ranked.length} compositions by endpoint signal (error bars ±SD)
            </div>
            <PlateRankedTiters
              entries={ranked}
              kind={target.kind}
              unit={target.unit}
              {highlightLabel}
              {selectedLabel}
              onhighlight={onRankHighlight}
              onselect={onRankSelect}
            />
            <div class="pr-rank-foot">
              {#if activeEntry}
                <span class="pr-rank-active">
                  <b>#{activeEntry.rank} {activeEntry.label}</b>
                  · {fmtVal(activeEntry.mean, target.kind)} {target.unit}
                  · n={activeEntry.n} · CV {activeEntry.cv.toFixed(0)}%
                  · {activeEntry.wellNames.join(', ')}
                  {#if activeEntry.label === selectedLabel}
                    <span class="pr-rank-loaded">→ loaded into Comparison column</span>
                  {/if}
                </span>
              {:else}
                <span class="pr-hint">Hover a sample to spotlight its wells · click to load it into the Comparison column below.</span>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if hoverInfo}
  <div
    class="pr-tip"
    style="left:{Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 240)}px; top:{hover.y + 14}px;"
  >
    <div class="pr-tip__well">{hoverInfo.well}
      {#if hoverInfo.type}<span class="pr-tip__type">{TYPE_LABELS[hoverInfo.type] ?? hoverInfo.type}</span>{/if}
    </div>
    <div class="pr-tip__val">{hoverInfo.value}</div>
    {#if hoverInfo.ratios}<div class="pr-tip__sub">{hoverInfo.ratios}</div>{/if}
    {#if hoverInfo.label}<div class="pr-tip__sub">{hoverInfo.label}</div>{/if}
    {#if hoverInfo.loadable}<div class="pr-tip__load">click → load recipe</div>{/if}
  </div>
{/if}

<style>
  .pr-ov {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(6, 10, 12, 0.72);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .pr-panel {
    width: min(760px, 96vw);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    background: var(--surface, #10161a);
    border: 1px solid var(--hair, #2a3339);
    border-radius: var(--r-md, 8px);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .pr-hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--hair, #2a3339);
  }
  .pr-tabs {
    display: flex;
    gap: 4px;
  }
  .pr-tab {
    font: 11px var(--mono, monospace);
    padding: 3px 10px;
    border-radius: var(--r-sm, 4px);
    border: 1px solid var(--hair, #2a3339);
    background: var(--recess, #0b1013);
    color: var(--muted, #8a969c);
    cursor: pointer;
  }
  .pr-tab.on {
    color: var(--ink, #e6edf0);
    border-color: var(--phosphor, #4fd1c5);
    background: color-mix(in srgb, var(--phosphor, #4fd1c5) 12%, transparent);
  }
  .pr-spacer {
    flex: 1;
  }
  .pr-meta {
    font: 10.5px var(--mono, monospace);
    color: var(--faint, #5b666c);
  }
  .pr-x {
    border: 0;
    background: transparent;
    color: var(--muted, #8a969c);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
  }
  .pr-x:hover {
    color: var(--ink, #e6edf0);
  }
  .pr-bd {
    padding: 14px;
    overflow: auto;
  }
  .pr-empty {
    color: var(--muted, #8a969c);
    font: 12px var(--mono, monospace);
    text-align: center;
    margin: 24px 0;
  }
  .pr-scope {
    position: relative;
    max-width: 600px;
    margin: 0 auto;
  }
  .pr-scrub {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 600px;
    margin: 12px auto 0;
  }
  .pr-range {
    flex: 1;
    accent-color: var(--phosphor, #4fd1c5);
  }
  .pr-t {
    font: 11px var(--mono, monospace);
    color: var(--ink-2, #b8c2c7);
    min-width: 74px;
    text-align: right;
  }
  .pr-legend {
    max-width: 600px;
    margin: 12px auto 0;
  }
  .pr-ramp {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 10px var(--mono, monospace);
    color: var(--faint, #5b666c);
  }
  .pr-ramp__bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(
      to right,
      rgb(68, 1, 84),
      rgb(59, 82, 139),
      rgb(33, 145, 140),
      rgb(94, 201, 98),
      rgb(253, 231, 37)
    );
  }
  .pr-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }
  .pr-toggle {
    font: 10.5px var(--mono, monospace);
    padding: 3px 9px;
    border-radius: var(--r-sm, 4px);
    border: 1px solid var(--hair, #2a3339);
    background: var(--recess, #0b1013);
    color: var(--muted, #8a969c);
    cursor: pointer;
    white-space: nowrap;
  }
  .pr-toggle.on {
    color: var(--ink, #e6edf0);
    border-color: var(--phosphor, #4fd1c5);
    background: color-mix(in srgb, var(--phosphor, #4fd1c5) 12%, transparent);
  }
  .pr-hint {
    margin: 0;
    font: 11px var(--mono, monospace);
    color: var(--muted, #8a969c);
  }
  .pr-rank-foot {
    margin-top: 6px;
    min-height: 1.2em;
  }
  .pr-rank-active {
    font: 10.5px var(--mono, monospace);
    color: var(--ink-2, #b8c2c7);
  }
  .pr-rank-active b {
    color: var(--phosphor, #4fd1c5);
  }
  .pr-rank-loaded {
    color: var(--phosphor, #4fd1c5);
    font-weight: 600;
  }
  .pr-tc {
    max-width: 600px;
    margin: 16px auto 0;
    padding-top: 12px;
    border-top: 1px solid var(--hair, #2a3339);
  }
  .pr-tc__hd {
    font: 10.5px var(--mono, monospace);
    color: var(--faint, #5b666c);
    margin-bottom: 6px;
  }
  .pr-ep {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font: 11px var(--mono, monospace);
  }
  .pr-ep__v {
    color: var(--phosphor, #4fd1c5);
  }
  .pr-ep__v--pos {
    color: var(--muted, #8a969c);
  }
  .pr-ep__v--blank {
    color: var(--faint, #5b666c);
  }
  .pr-tip {
    position: fixed;
    z-index: 210;
    pointer-events: none;
    background: var(--surface, #10161a);
    border: 1px solid var(--hair, #2a3339);
    border-radius: var(--r-sm, 4px);
    padding: 6px 8px;
    font: 10.5px/1.4 var(--mono, monospace);
    color: var(--ink, #e6edf0);
    max-width: 230px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  }
  .pr-tip__well {
    font-weight: 600;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .pr-tip__type {
    color: var(--faint, #5b666c);
    font-weight: 400;
  }
  .pr-tip__val {
    color: var(--phosphor, #4fd1c5);
  }
  .pr-tip__sub {
    color: var(--muted, #8a969c);
  }
  .pr-tip__load {
    margin-top: 3px;
    color: var(--amber, #e0a74a);
  }
  @media (prefers-reduced-motion: reduce) {
    .pr-ov {
      backdrop-filter: none;
    }
  }
</style>

<script>
  // Inline plate-reader card shown under "assay setup": a static plate at the
  // final timepoint plus a compact signal timecourse. Clicking opens the modal
  // for per-well numbers, timepoint scrubbing, and the detailed timecourse.
  import PlateGrid from './PlateGrid.svelte';
  import PlateTimecourse from './PlateTimecourse.svelte';
  import { computeScale, computeTimecourse, fmtVal, fmtHours } from './plateReader.js';

  let { target, onExpand } = $props();

  let scale = $derived(computeScale(target?.grids));
  let series = $derived(computeTimecourse(target));
  let nLoadable = $derived((target?.wells ?? []).filter((w) => w.recipe).length);
  let isKinetic = $derived((target?.grids?.length ?? 0) > 1);

  // Inline timepoint scrubber (kinetic targets) — default to the last read so the
  // card opens on the fully-developed signal, same as the modal.
  let tpIndex = $state(0);
  $effect(() => {
    const n = target?.grids?.length ?? 0;
    tpIndex = Math.max(0, n - 1);
  });
  let currentGrid = $derived(target?.grids?.[tpIndex] ?? []);

  // Whole card is clickable; the slider stops propagation so scrubbing never
  // opens the modal.
  function onCardKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onExpand?.();
    }
  }
  const stop = (e) => e.stopPropagation();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="prc"
  role="button"
  tabindex="0"
  onclick={() => onExpand?.()}
  onkeydown={onCardKey}
  title="Open detailed plate reader"
>
  <div class="prc-hd">
    <span class="prc-title">{target.label}</span>
    <span class="prc-unit">{target.unit}</span>
    <span class="prc-expand" aria-hidden="true">⤢</span>
  </div>

  <div class="prc-plate">
    <PlateGrid grid={currentGrid} wells={target.wells} rows={target.rows} cols={target.cols} {scale} kind={target.kind} />
  </div>

  <div class="prc-ramp">
    <span>{fmtVal(scale.lo, target.kind)}</span>
    <span class="prc-bar"></span>
    <span>{fmtVal(scale.hi, target.kind)}</span>
  </div>

  {#if isKinetic}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="prc-scrub" onclick={stop} onkeydown={stop}>
      <input
        type="range"
        class="prc-range"
        min="0"
        max={target.grids.length - 1}
        bind:value={tpIndex}
        onmousedown={stop}
        onpointerdown={stop}
        aria-label="Timepoint"
      />
      <span class="prc-t">time = {fmtHours(target.timepoints?.[tpIndex])}</span>
    </div>
  {/if}

  {#if isKinetic && series}
    <div class="prc-tc"><PlateTimecourse {series} unit={target.unit} kind={target.kind} /></div>
  {/if}

  <div class="prc-ft">
    <span>
      {#if isKinetic}
        {target.grids.length} reads · {fmtHours(target.timepoints?.at(-1) ?? target.spanHours)}
      {:else}
        endpoint · single read
      {/if}
    </span>
    <span>{nLoadable} loadable wells →</span>
  </div>
</div>

<style>
  .prc {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    background: var(--surface, #10161a);
    border: 1px solid var(--hair, #2a3339);
    border-radius: var(--r-md, 8px);
    padding: 10px 12px 11px;
    cursor: pointer;
    transition: border-color 0.14s ease, transform 0.14s ease;
    font: inherit;
    color: inherit;
  }
  .prc:hover {
    border-color: var(--phosphor, #4fd1c5);
  }
  .prc:hover .prc-expand {
    color: var(--phosphor, #4fd1c5);
  }
  .prc-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }
  .prc-title {
    font: 12px var(--mono, monospace);
    color: var(--ink, #e6edf0);
    font-weight: 600;
  }
  .prc-unit {
    font: 10px var(--mono, monospace);
    color: var(--faint, #5b666c);
  }
  .prc-expand {
    margin-left: auto;
    font-size: 13px;
    color: var(--muted, #8a969c);
  }
  .prc-plate {
    /* Full width so the 1fr well grid (height derived from width via
       aspect-ratio) resolves. NB: `margin: 0 auto` here would cancel the flex
       column's cross-axis stretch and collapse the grid to zero — don't. */
    width: 100%;
  }
  .prc-ramp {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 7px;
    font: 8.5px var(--mono, monospace);
    color: var(--faint, #5b666c);
  }
  .prc-bar {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      rgb(68, 1, 84),
      rgb(59, 82, 139),
      rgb(33, 145, 140),
      rgb(94, 201, 98),
      rgb(253, 231, 37)
    );
  }
  .prc-tc {
    margin-top: 8px;
  }
  .prc-scrub {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .prc-range {
    flex: 1;
    min-width: 0;
    accent-color: var(--phosphor, #4fd1c5);
    cursor: pointer;
  }
  .prc-t {
    font: 9px var(--mono, monospace);
    color: var(--muted, #8a969c);
    min-width: 52px;
    text-align: right;
  }
  .prc-ft {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    /* Pin the footer to the bottom so endpoint cards (sfGFP, no timecourse
       graph) stay the same height as kinetic cards and their footers align. */
    margin-top: auto;
    padding-top: 8px;
    font: 9.5px var(--mono, monospace);
    color: var(--muted, #8a969c);
  }
</style>

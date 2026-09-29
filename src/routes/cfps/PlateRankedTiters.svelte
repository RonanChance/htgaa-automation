<script>
  // Ranked-sample-titers scatter for the plate-reader modal — the interactive
  // version of the last figure in the assay report. Each experimental composition
  // is one point: y = mean endpoint signal (blank-subtracted), error bar = ±SD
  // (the report's mean × CV%/100), sorted best-first left→right. Hovering a point
  // highlights that composition's wells on the platemap above; clicking it loads
  // the composition into the designer's Comparison column.
  import { fmtVal, ramp } from './plateReader.js';

  let {
    entries = [],
    kind = 'od',
    unit = '',
    highlightLabel = null, // transient (hover) — drives the platemap highlight
    selectedLabel = null, // sticky (clicked) — stays highlighted after selection
    onhighlight = null,
    onselect = null,
  } = $props();

  const W = 560;
  const VH = 210;
  const PAD_L = 50;
  const PAD_R = 12;
  const PAD_T = 54; // headroom for the fanned top-sample name labels
  const PAD_B = 26;

  let N = $derived(entries.length);
  const plotW = W - PAD_L - PAD_R;
  const plotH = VH - PAD_T - PAD_B;

  // y-range spans the error bars, always anchored at 0 so bar heights read as
  // absolute signal; a little headroom on top so the tallest cap isn't clipped.
  let yb = $derived.by(() => {
    let hi = 0;
    let lo = 0;
    for (const e of entries) {
      if (e.mean + e.sd > hi) hi = e.mean + e.sd;
      if (e.mean - e.sd < lo) lo = e.mean - e.sd;
    }
    if (hi <= lo) hi = lo + 1;
    return { lo, hi: hi + (hi - lo) * 0.06 };
  });

  const X = (i) => PAD_L + (N > 0 ? ((i + 0.5) / N) * plotW : 0);
  const Y = (v) => PAD_T + plotH - ((v - yb.lo) / (yb.hi - yb.lo)) * plotH;

  // Point fill follows the same viridis ramp as the plate wells, normalised over
  // this chart's own y-range so the best samples read hot / yellow.
  function fill(v) {
    return ramp((v - yb.lo) / (yb.hi - yb.lo));
  }

  // The top few compositions carry a name label. They cluster at the top-left, so
  // rotated labels would pile up — instead they fan out as a ladder of leader-line
  // callouts in the headroom band, one row per rank. Any other point gets named
  // only while it's the active (hovered/selected) one.
  let activeLabel = $derived(highlightLabel ?? selectedLabel);
  const TOP_LABELS = 4;
  function shortName(name) {
    if (!name) return '';
    return name.length > 22 ? name.slice(0, 21) + '…' : name;
  }

  // Callout rows: the top-ranked compositions, plus the active (hovered/selected)
  // one when it ranks below the cut, so it's always named. Laddered top→down.
  let callouts = $derived.by(() => {
    const rows = [];
    entries.forEach((e, i) => {
      if (i < TOP_LABELS) rows.push({ label: e.label, i, mean: e.mean, rank: e.rank });
    });
    if (activeLabel) {
      const ai = entries.findIndex((e) => e.label === activeLabel);
      if (ai >= TOP_LABELS) {
        const e = entries[ai];
        rows.push({ label: e.label, i: ai, mean: e.mean, rank: e.rank });
      }
    }
    return rows.map((r, row) => ({ ...r, labelY: 12 + row * 11 }));
  });

  // A wider gap between points earns bigger dots; clamp so a crowded plate stays legible.
  let dotR = $derived(Math.max(2.2, Math.min(4.5, plotW / (N * 2.4 || 1))));

  function enter(e) {
    onhighlight?.(e.label);
  }
  function leave() {
    onhighlight?.(null);
  }
  function pick(e) {
    onselect?.(e);
  }
  function keydown(ev, e) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onselect?.(e);
    }
  }
</script>

<svg class="prt" viewBox="0 0 {W} {VH}" role="img" aria-label="Ranked sample titers ({unit})">
  <!-- axes -->
  <line class="prt-axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} />
  <line class="prt-axis" x1={PAD_L} y1={Y(0)} x2={W - PAD_R} y2={Y(0)} />
  <text class="prt-tick" x={PAD_L - 4} y={Y(yb.hi)} text-anchor="end" dominant-baseline="middle">{fmtVal(yb.hi, kind)}</text>
  <text class="prt-tick" x={PAD_L - 4} y={Y(0)} text-anchor="end" dominant-baseline="middle">0</text>
  <text class="prt-unit" x={W - PAD_R} y={10} text-anchor="end">{unit} · blank-subtracted endpoint</text>
  <text class="prt-xlabel" x={PAD_L + plotW / 2} y={VH - 4} text-anchor="middle">ranked compositions (best → worst)</text>

  {#each entries as e, i (e.label)}
    {@const cx = X(i)}
    {@const cy = Y(e.mean)}
    {@const isActive = e.label === activeLabel}
    {@const isSel = e.label === selectedLabel}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <g
      class="prt-pt"
      class:active={isActive}
      role="button"
      tabindex="0"
      aria-label={`${e.label}: ${fmtVal(e.mean, kind)} ${unit}, n=${e.n}`}
      onmouseenter={() => enter(e)}
      onmouseleave={leave}
      onclick={() => pick(e)}
      onkeydown={(ev) => keydown(ev, e)}
    >
      <!-- full-height hit target so the whole column is easy to hover/click -->
      <rect class="prt-hit" x={cx - plotW / (N * 2 || 1)} y={PAD_T} width={plotW / (N || 1)} height={plotH} />
      <!-- error bar (±SD) -->
      {#if e.sd > 0}
        <line class="prt-err" x1={cx} y1={Y(e.mean - e.sd)} x2={cx} y2={Y(e.mean + e.sd)} />
        <line class="prt-cap" x1={cx - 2.5} y1={Y(e.mean + e.sd)} x2={cx + 2.5} y2={Y(e.mean + e.sd)} />
        <line class="prt-cap" x1={cx - 2.5} y1={Y(e.mean - e.sd)} x2={cx + 2.5} y2={Y(e.mean - e.sd)} />
      {/if}
      {#if isSel}
        <circle class="prt-ring" cx={cx} cy={cy} r={dotR + 2.5} />
      {/if}
      <circle class="prt-dot" cx={cx} cy={cy} r={isActive ? dotR + 1 : dotR} style="fill:{fill(e.mean)};" />
    </g>
  {/each}

  <!-- Fanned name callouts for the top compositions (+ the active one if it sits
       further down the ranking), laddered in the headroom band with leader lines
       so the clustered top-left points stay readable. -->
  {#each callouts as c (c.label)}
    {@const cx = X(c.i)}
    {@const cy = Y(c.mean)}
    {@const anchorEnd = cx > W * 0.62}
    <line class="prt-lead" class:active={c.label === activeLabel} x1={cx} y1={c.labelY + 2} x2={cx} y2={cy} />
    <text
      class="prt-name"
      class:active={c.label === activeLabel}
      x={anchorEnd ? cx + 3 : cx - 3}
      y={c.labelY}
      text-anchor={anchorEnd ? 'end' : 'start'}
    >{c.rank}. {shortName(c.label)}</text>
  {/each}
</svg>

<style>
  .prt {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .prt-axis {
    stroke: var(--hair, #2a3339);
    stroke-width: 0.75;
    vector-effect: non-scaling-stroke;
  }
  .prt-tick {
    font: 7px var(--mono, monospace);
    fill: var(--faint, #5b666c);
  }
  .prt-unit,
  .prt-xlabel {
    font: 7.5px var(--mono, monospace);
    fill: var(--muted, #8a969c);
  }
  .prt-pt {
    cursor: pointer;
  }
  .prt-hit {
    fill: transparent;
  }
  .prt-err {
    stroke: var(--faint, #5b666c);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: 0.75;
  }
  .prt-cap {
    stroke: var(--faint, #5b666c);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: 0.75;
  }
  .prt-dot {
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 0.5;
    transition: r 0.08s ease;
  }
  .prt-pt.active .prt-dot {
    stroke: var(--ink, #e6edf0);
    stroke-width: 1;
  }
  .prt-pt.active .prt-err,
  .prt-pt.active .prt-cap {
    stroke: var(--ink-2, #b8c2c7);
    opacity: 1;
  }
  .prt-ring {
    fill: none;
    stroke: var(--phosphor, #4fd1c5);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .prt-lead {
    stroke: var(--hair, #2a3339);
    stroke-width: 0.75;
    vector-effect: non-scaling-stroke;
    opacity: 0.6;
  }
  .prt-lead.active {
    stroke: var(--phosphor, #4fd1c5);
    opacity: 0.9;
  }
  .prt-name {
    font: 7px var(--mono, monospace);
    fill: var(--muted, #8a969c);
    pointer-events: none;
  }
  .prt-name.active {
    fill: var(--ink, #e6edf0);
    font-weight: 600;
  }
</style>

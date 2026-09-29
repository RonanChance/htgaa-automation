<script>
  // Median kinetic signal vs time — mirrors overview.js progressFig: experimental
  // median (accent) vs positive-control median (muted), with the blank as a flat
  // dashed baseline. `detailed` adds axis ticks, a legend, and a hover crosshair.
  import { fmtVal, fmtHours } from './plateReader.js';

  let { series, unit = '', kind = 'od', detailed = false } = $props();

  const W = 320;
  const VH = $derived(detailed ? 150 : 84);
  const PAD_L = $derived(detailed ? 46 : 8);
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = $derived(detailed ? 22 : 8);

  let hours = $derived(series?.hours ?? []);
  let tmax = $derived(hours.length ? Math.max(...hours) : 1);
  let ymax = $derived.by(() => {
    let m = 0;
    for (const arr of [series?.experimental, series?.posctrl]) {
      for (const v of arr ?? []) if (v != null && v > m) m = v;
    }
    if (series?.blank != null && series.blank > m) m = series.blank;
    return m > 0 ? m : 1;
  });

  const X = (h) => PAD_L + (tmax > 0 ? h / tmax : 0) * (W - PAD_L - PAD_R);
  const Y = (v) => VH - PAD_B - (v / ymax) * (VH - PAD_T - PAD_B);

  function line(arr) {
    return (arr ?? [])
      .map((v, i) => (v == null ? null : `${X(hours[i]).toFixed(1)},${Y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  }

  let expLine = $derived(line(series?.experimental));
  let posLine = $derived(line(series?.posctrl));

  // ── hover crosshair (detailed only) ─────────────────────────────────────────
  let hi = $state(null);
  function move(e) {
    if (!detailed || !hours.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    hours.forEach((h, i) => {
      const d = Math.abs(X(h) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    hi = best;
  }
  function leave() {
    hi = null;
  }
</script>

<svg
  class="ptc"
  class:ptc--detailed={detailed}
  viewBox="0 0 {W} {VH}"
  role="img"
  aria-label="{unit} signal over time"
  onmousemove={move}
  onmouseleave={leave}
>
  <!-- plot frame / axes (detailed) -->
  {#if detailed}
    <line class="ptc-axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={VH - PAD_B} />
    <line class="ptc-axis" x1={PAD_L} y1={VH - PAD_B} x2={W - PAD_R} y2={VH - PAD_B} />
    <text class="ptc-tick" x={PAD_L - 4} y={Y(ymax)} text-anchor="end" dominant-baseline="middle"
      >{fmtVal(ymax, kind)}</text
    >
    <text class="ptc-tick" x={PAD_L - 4} y={Y(0)} text-anchor="end" dominant-baseline="middle">0</text>
    <text class="ptc-tick" x={PAD_L} y={VH - PAD_B + 10} text-anchor="start">0h</text>
    <text class="ptc-tick" x={W - PAD_R} y={VH - PAD_B + 10} text-anchor="end">{tmax.toFixed(2)}h</text>
    <text class="ptc-unit" x={PAD_L} y={PAD_T - 1} text-anchor="start">{unit}</text>
  {/if}

  <!-- blank baseline -->
  {#if series?.blank}
    <line class="ptc-blank" x1={PAD_L} y1={Y(series.blank)} x2={W - PAD_R} y2={Y(series.blank)} />
  {/if}

  <!-- positive control -->
  {#if posLine}
    <polyline class="ptc-pos" points={posLine} />
  {/if}
  <!-- experimental median -->
  {#if expLine}
    <polyline class="ptc-exp" points={expLine} />
  {/if}

  <!-- hover crosshair + readout (detailed) -->
  {#if detailed && hi != null && hours[hi] != null}
    {@const hx = X(hours[hi])}
    <line class="ptc-cross" x1={hx} y1={PAD_T} x2={hx} y2={VH - PAD_B} />
    {#if series?.experimental?.[hi] != null}
      <circle class="ptc-dot ptc-dot--exp" cx={hx} cy={Y(series.experimental[hi])} r="2.4" />
    {/if}
    {#if series?.posctrl?.[hi] != null}
      <circle class="ptc-dot ptc-dot--pos" cx={hx} cy={Y(series.posctrl[hi])} r="2" />
    {/if}
    <text class="ptc-read" x={hx < W / 2 ? hx + 4 : hx - 4} y={PAD_T + 8} text-anchor={hx < W / 2 ? 'start' : 'end'}>
      {fmtHours(hours[hi])}
    </text>
    <text class="ptc-read ptc-read--exp" x={hx < W / 2 ? hx + 4 : hx - 4} y={PAD_T + 17} text-anchor={hx < W / 2 ? 'start' : 'end'}>
      exp {fmtVal(series.experimental?.[hi], kind)}
    </text>
  {/if}
</svg>

{#if detailed}
  <div class="ptc-legend">
    <span class="ptc-lg ptc-lg--exp">experimental median</span>
    <span class="ptc-lg ptc-lg--pos">positive control</span>
    <span class="ptc-lg ptc-lg--blank">blank (background signal)</span>
  </div>
{/if}

<style>
  .ptc {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .ptc-axis {
    stroke: var(--hair, #2a3339);
    stroke-width: 0.75;
    vector-effect: non-scaling-stroke;
  }
  .ptc-tick {
    font: 7px var(--mono, monospace);
    fill: var(--faint, #5b666c);
  }
  .ptc-unit {
    font: 7px var(--mono, monospace);
    fill: var(--muted, #8a969c);
  }
  .ptc-blank {
    stroke: var(--faint, #5b666c);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
    opacity: 0.7;
  }
  .ptc-pos {
    fill: none;
    stroke: var(--muted, #8a969c);
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
    opacity: 0.8;
  }
  .ptc-exp {
    fill: none;
    stroke: var(--phosphor, #4fd1c5);
    stroke-width: 1.75;
    vector-effect: non-scaling-stroke;
  }
  .ptc-cross {
    stroke: var(--ink-2, #b8c2c7);
    stroke-width: 0.75;
    stroke-dasharray: 2 2;
    vector-effect: non-scaling-stroke;
    opacity: 0.6;
  }
  .ptc-dot--exp {
    fill: var(--phosphor, #4fd1c5);
  }
  .ptc-dot--pos {
    fill: var(--muted, #8a969c);
  }
  .ptc-read {
    font: 7px var(--mono, monospace);
    fill: var(--ink, #e6edf0);
  }
  .ptc-read--exp {
    fill: var(--phosphor, #4fd1c5);
  }
  .ptc-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
    font: 9.5px var(--mono, monospace);
    color: var(--muted, #8a969c);
  }
  .ptc-lg {
    display: inline-flex;
    align-items: center;
  }
  .ptc-lg::before {
    content: '';
    width: 12px;
    height: 0;
    border-top-width: 2px;
    border-top-style: solid;
    margin-right: 5px;
  }
  .ptc-lg--exp::before {
    border-top-color: var(--phosphor, #4fd1c5);
  }
  .ptc-lg--pos::before {
    border-top-color: var(--muted, #8a969c);
  }
  .ptc-lg--blank::before {
    border-top-color: var(--faint, #5b666c);
    border-top-style: dashed;
  }
</style>

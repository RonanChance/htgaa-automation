<script>
  // Chapter 8: a sweep — submitted designs identical but for one ingredient. The
  // model's predicted curve along it, the band it isn't sure within, the range
  // the plates ran, and the amounts round 1 would actually measure.
  //
  // Follows the deck's shared reagent when it has a sweep, and picking a sweep
  // here sets it. Click or drag on the plot to read the curve at any amount.
  import { ROLE_STYLE } from './colors.js';

  let { sweeps, reagent = null, setReagent = null } = $props();

  const withCurve = $derived(sweeps.filter((s) => s.curve));
  const sw = $derived(withCurve.find((s) => s.reagent === reagent) ?? withCurve[0] ?? null);
  const priceOnly = $derived(sweeps.filter((s) => !s.curve));

  const W = 640, H = 260, PL = 46, PR = 16, PT = 16, PB = 34;
  const PW = W - PL - PR;
  const xMax = $derived(sw ? Math.max(...sw.curve.nL, ...sw.amounts) * 1.02 : 1);
  const yMax = $derived(sw ? Math.max(...sw.curve.hi, ...sw.toRun.map((t) => t.y)) * 1.1 : 1);
  const sx = (v) => PL + (v / xMax) * PW;
  const sy = (v) => PT + (1 - v / yMax) * (H - PT - PB);
  const path = (ys) => sw.curve.nL.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join('');
  const band = $derived(sw ? path(sw.curve.hi) + sw.curve.nL.slice().reverse()
    .map((x, ri) => `L${sx(x).toFixed(1)},${sy(sw.curve.lo[sw.curve.nL.length - 1 - ri]).toFixed(1)}`).join('') + 'Z' : '');

  // ── reading the curve at a picked amount ─────────────────────────────────
  let pickNl = $state(null);
  $effect(() => { sw; pickNl = null; });
  const interp = (xs, ys, x) => {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
    }
    return ys[ys.length - 1];
  };
  const read = $derived(sw && pickNl != null ? {
    y: interp(sw.curve.nL, sw.curve.y, pickNl),
    lo: interp(sw.curve.nL, sw.curve.lo, pickNl),
    hi: interp(sw.curve.nL, sw.curve.hi, pickNl),
    run: sw.toRun.reduce((b, t) => (b == null || Math.abs(t.nL - pickNl) < Math.abs(b.nL - pickNl) ? t : b), null)
  } : null);
  let svg = $state(null);
  let scrubbing = false;
  function at(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return Math.max(0, Math.min(xMax, ((q.x - PL) / PW) * xMax));
  }
  function down(ev) { scrubbing = true; svg.setPointerCapture(ev.pointerId); pickNl = at(ev); }
  const move = (ev) => { if (scrubbing) pickNl = at(ev); };
  const up = () => (scrubbing = false);
  const x2 = (v) => `${v.toFixed(2)}×`;
</script>

{#if !sw}
  <p class="fig-note">No recommended sweep with a predicted curve for this protein.</p>
{:else}
  <div class="fig-controls">
    <label class="grow">ingredient
      <select value={sw.reagent} onchange={(e) => setReagent?.(e.currentTarget.value)}>
        {#each withCurve as s}<option value={s.reagent}>{s.ingredient} · leads {s.leadsGroups} groups</option>{/each}
      </select>
    </label>
  </div>
  <svg bind:this={svg} viewBox="0 0 {W} {H}" class="fig-svg scrub" role="img"
    aria-label="Predicted yield curve along {sw.ingredient}; click or drag to read it"
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <rect x={PL} y={PT} width={PW} height={H - PT - PB} class="hit" />
    {#if sw.platesRangeNl}
      <rect x={sx(sw.platesRangeNl[0])} y={PT} width={Math.max(2, sx(sw.platesRangeNl[1]) - sx(sw.platesRangeNl[0]))} height={H - PT - PB} class="plates" />
    {/if}
    <line x1={PL} x2={W - PR} y1={sy(1)} y2={sy(1)} class="one" />
    <text x={W - PR} y={sy(1) - 4} text-anchor="end" class="axt">Ginkgo's best</text>
    <path d={band} class="band" />
    <path d={path(sw.curve.y)} class="mean" />
    {#each sw.amounts as a}<line x1={sx(a)} x2={sx(a)} y1={H - PB} y2={H - PB + 7} class="tick" />{/each}
    {#if read}
      <line x1={sx(pickNl)} x2={sx(pickNl)} y1={PT} y2={H - PB} class="cursor" />
      <line x1={sx(pickNl)} x2={sx(pickNl)} y1={sy(read.lo)} y2={sy(read.hi)} class="err" />
      <circle cx={sx(pickNl)} cy={sy(read.y)} r="4.5" class="dot" />
    {/if}
    {#each sw.toRun as t}
      <circle cx={sx(t.nL)} cy={sy(t.y)} r={read?.run === t ? 8.5 : 6} fill={(ROLE_STYLE[t.role] ?? ROLE_STYLE.sweep).color}
        class="run" class:hot={read?.run === t} />
    {/each}
    <text x={PL - 6} y={sy(0) + 4} text-anchor="end" class="axt">0×</text>
    <text x={PL - 6} y={sy(1) + 4} text-anchor="end" class="axt">1×</text>
    <text x={PL} y={H - 6} class="axt">0 nL</text>
    <text x={W - PR} y={H - 6} text-anchor="end" class="axt">{Math.round(xMax)} nL · {sw.ingredient}</text>
  </svg>
  <div class="fig-readout">
    {#if read}
      <span>at <b class="y">{Math.round(pickNl)} nL</b></span>
      <span>predicted <b class="y">{x2(read.y)}</b> Ginkgo's best (band {x2(read.lo)}–{x2(read.hi)})</span>
      <span>nearest test: <b>{read.run.nL} nL</b>, {(ROLE_STYLE[read.run.role] ?? ROLE_STYLE.sweep).label}</span>
    {:else}
      <span class="hint">click or drag on the plot to read the curve</span>
    {/if}
  </div>
  <ul class="fig-legend">
    <li><i class="sw" style="background:var(--blue)"></i>predicted yield vs Ginkgo's best, with its band</li>
    <li><i class="sw sw--band"></i>the plates' range</li>
    <li><i class="sw" style="background:var(--white)"></i>amounts submitted (ticks)</li>
    <li><i class="sw" style="background:{ROLE_STYLE.sweep.color}"></i>tested compositions that measure it</li>
  </ul>
  {#if priceOnly.length}
    <p class="fig-note">No curve for {priceOnly.map((s) => s.ingredient).join(', ')}: the plates never ran
      {priceOnly.length === 1 ? 'it' : 'them'}, so the model can only price {priceOnly.length === 1 ? 'it' : 'them'}.
      Their sweeps will be the first measurement.</p>
  {/if}
{/if}

<style>
  .scrub { cursor: col-resize; }
  .hit { fill: transparent; }
  .hint { color: var(--faint); }
  .plates { fill: var(--green); opacity: .1; pointer-events: none; }
  .one { stroke: var(--faint); stroke-dasharray: 2 3; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); pointer-events: none; }
  .band { fill: var(--blue); opacity: .16; pointer-events: none; }
  .mean { fill: none; stroke: var(--blue); stroke-width: 2.4; pointer-events: none; }
  .tick { stroke: var(--white); stroke-width: 1.3; }
  .cursor { stroke: var(--yellow); opacity: .4; }
  .err { stroke: var(--yellow); stroke-width: 3; opacity: .5; }
  .dot { fill: var(--yellow); stroke: var(--bg); stroke-width: 2; }
  .run { stroke: var(--bg); stroke-width: 2; transition: r .15s; }
  .run.hot { stroke: var(--yellow); stroke-width: 2.5; }
</style>

<script>
  // Chapter 1: how one amount in nL becomes one coordinate. Three stacked number
  // lines — nL, ln(1 + c/s), z — with evenly spaced nL guides threaded through
  // so you can watch the log squeeze the top end and the z-score re-centre it.
  //
  // The reagent and amount are shared with the rest of the deck (the page owns
  // them), so what you pick here is what the later figures show. Click or drag
  // on any of the three lines to set the amount; designs and wells using about
  // that much light up.
  import { coord, uncoord } from '$lib/clusterMath.js';

  let { model, designs = null, step = 0, reagent, amount = null, setReagent, setAmount } = $props();

  const gp = $derived(model.gp);
  const wellNl = $derived(model.settings.wellNl);
  const j = $derived(Math.max(0, gp.cols.indexOf(reagent)));

  // nL ↔ concentration ↔ coordinate, for column j.
  const toC = (nl) => (nl / wellNl) * gp.stock[j];
  const toNl = (c) => (c / gp.stock[j]) * wellNl;
  const L = (nl) => Math.log1p(toC(nl) / gp.scale[j]);
  const Z = (nl) => coord(gp, j, toC(nl));
  const nlOfZ = (z) => toNl(uncoord(gp, j, z));

  const ctrlNl = $derived(model.controls.map((c) => nlOfZ(c.x[j])));
  const designNl = $derived(designs ? designs.map((d) => nlOfZ(d.x[j])) : []);
  const maxNl = $derived(Math.max(50, ...ctrlNl, ...designNl) * 1.08);
  const plates = $derived([toNl(gp.lo[j]), toNl(gp.hi[j])]);
  // Until someone picks an amount, start at Ginkgo's best composition.
  const baseNl = $derived(nlOfZ(model.incumbentX[j]));
  const nl = $derived(Math.min(maxNl, amount ?? baseNl));

  const W = 640, X0 = 40, X1 = 600;
  const Y = [52, 150, 248];
  const lerp = (a, b, t) => a + (b - a) * t;
  const sx1 = $derived((v) => lerp(X0, X1, v / maxNl));
  const lMax = $derived(L(maxNl));
  const sx2 = $derived((v) => lerp(X0, X1, L(v) / lMax));
  const zLo = $derived(Math.min(Z(0), -2.5));
  const zHi = $derived(Math.max(Z(maxNl), 2.5));
  const sx3 = $derived((v) => lerp(X0, X1, (Z(v) - zLo) / (zHi - zLo)));
  const guides = $derived(Array.from({ length: 11 }, (_, i) => (i / 10) * maxNl));
  const zTicks = $derived(
    Array.from({ length: Math.floor(zHi) - Math.ceil(zLo) + 1 }, (_, i) => Math.ceil(zLo) + i)
  );
  const fmt = (v, d = 0) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(d));

  // "About this amount": the same 25 nL grid step the compositions are dispensed on.
  const near = (v) => Math.abs(v - nl) <= 12.5;
  const nearDesigns = $derived(designNl.filter(near).length);
  const nearCtrls = $derived(ctrlNl.filter(near).length);

  // ── scrubbing ─────────────────────────────────────────────────────────────
  let svg = $state(null);
  let scrubbing = false;
  function nlAt(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const t = Math.max(0, Math.min(1, (q.x - X0) / (X1 - X0)));
    // whichever line the pointer is nearest decides how to read x
    const axis = step >= 1 ? [0, 1, 2].sort((a, b) => Math.abs(q.y - Y[a]) - Math.abs(q.y - Y[b]))[0] : 0;
    if (axis === 0) return t * maxNl;
    if (axis === 1) return toNl(gp.scale[j] * Math.expm1(t * lMax));
    return Math.max(0, nlOfZ(lerp(zLo, zHi, t)));
  }
  function down(ev) {
    scrubbing = true;
    svg.setPointerCapture(ev.pointerId);
    setAmount(nlAt(ev));
  }
  const move = (ev) => scrubbing && setAmount(nlAt(ev));
  const up = () => (scrubbing = false);
</script>

<div class="fig-controls">
  <label>reagent
    <select value={reagent} onchange={(e) => setReagent(e.currentTarget.value)}>
      {#each gp.cols as c, i}<option value={c}>{gp.names[i]}</option>{/each}
    </select>
  </label>
  <span class="readout-nl">amount <b class="y">{fmt(nl)} nL</b></span>
  <button type="button" class="fig-btn" onclick={() => setAmount(null)} disabled={amount == null}>Ginkgo’s best</button>
</div>

<svg bind:this={svg} viewBox="0 0 {W} 304" class="fig-svg scrub" role="img"
  aria-label="Amount of {gp.names[j]}, {Math.round(nl)} nL: click or drag along the lines to change it"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  <!-- evenly spaced nL guides, threaded through all three axes -->
  {#each guides as g}
    <polyline class="guide" class:on={step >= 1}
      points="{sx1(g)},{Y[0]} {sx2(g)},{Y[1]} {sx3(g)},{Y[2]}" />
  {/each}

  <!-- the plates' range on the nL axis -->
  <rect x={sx1(plates[0])} y={Y[0] - 9} width={Math.max(2, sx1(plates[1]) - sx1(plates[0]))} height="18"
    class="plates" />

  {#each [0, 1, 2] as a}
    {@const sx = [sx1, sx2, sx3][a]}
    <g class="axis" class:on={a === 0 || step >= 1}>
      <rect x={X0 - 6} y={Y[a] - 16} width={X1 - X0 + 12} height="32" class="hit" />
      <line x1={X0} x2={X1} y1={Y[a]} y2={Y[a]} />
      {#each designNl as v}
        <line class="tick-d" class:hot={near(v)} x1={sx(v)} x2={sx(v)} y1={Y[a] - 6} y2={Y[a] + 6} />
      {/each}
      {#each ctrlNl as v}
        <line class="tick-c" class:hot={near(v)} x1={sx(v)} x2={sx(v)} y1={Y[a] - 9} y2={Y[a] + 9} />
      {/each}
    </g>
  {/each}

  <text class="lbl" x={X0} y={Y[0] - 18}>amount in the 20 µL well (nL)</text>
  <text class="num" x={X0} y={Y[0] + 24}>0</text>
  <text class="num" x={X1} y={Y[0] + 24} text-anchor="end">{fmt(maxNl)}</text>
  <g class:on={step >= 1} class="axis">
    <text class="lbl" x={X0} y={Y[1] - 18}>log-compressed: ln(1 + c / s)</text>
    <text class="lbl" x={X0} y={Y[2] - 18}>z-score: units of how much Ginkgo's plates varied it</text>
    {#each zTicks as z}
      <text class="num" x={lerp(X0, X1, (z - zLo) / (zHi - zLo))} y={Y[2] + 24} text-anchor="middle">{z}</text>
    {/each}
  </g>

  <!-- the chosen amount, followed through the mapping -->
  <polyline class="path" class:on={step >= 1}
    points="{sx1(nl)},{Y[0]} {sx2(nl)},{Y[1]} {sx3(nl)},{Y[2]}" />
  <circle class="dot" cx={sx1(nl)} cy={Y[0]} r="6" />
  {#if step >= 1}
    <circle class="dot" cx={sx2(nl)} cy={Y[1]} r="6" />
    <circle class="dot" cx={sx3(nl)} cy={Y[2]} r="6" />
    <text class="val" x={sx3(nl)} y={Y[2] + 42} text-anchor="middle">z = {Z(nl).toFixed(2)}</text>
  {/if}
</svg>

<div class="fig-readout">
  <span>at about this amount: <b class="y">{nearCtrls}</b> control well{nearCtrls === 1 ? '' : 's'}{#if designs} · <b class="y">{nearDesigns}</b> design{nearDesigns === 1 ? '' : 's'}{/if}</span>
  <span class="hint">click or drag along a line</span>
</div>
<ul class="fig-legend">
  <li><i class="sw" style="background:var(--white)"></i>Ginkgo's control wells</li>
  {#if designs}<li><i class="sw" style="background:var(--blue)"></i>class designs</li>{/if}
  <li><i class="sw sw--band"></i>the plates' range: {fmt(plates[0])}–{fmt(plates[1])} nL</li>
</ul>

<style>
  .scrub { cursor: col-resize; }
  .hit { fill: transparent; }
  .readout-nl { font: 12px var(--sans); color: var(--dim); }
  .hint { color: var(--faint); }
  .guide { fill: none; stroke: var(--faint); stroke-width: 0.6; opacity: 0; transition: opacity .6s; }
  .guide.on { opacity: .55; }
  .axis { opacity: 0; transition: opacity .6s; }
  .axis.on { opacity: 1; }
  .axis line { stroke: var(--dim); stroke-width: 1; }
  .axis .tick-d { stroke: var(--blue); stroke-width: 1; opacity: .25; }
  .axis .tick-c { stroke: var(--white); stroke-width: 1.4; opacity: .9; }
  .axis .tick-d.hot, .axis .tick-c.hot { stroke: var(--yellow); opacity: 1; stroke-width: 2; }
  .plates { fill: var(--green); opacity: .16; pointer-events: none; }
  .lbl { fill: var(--dim); font: 12px var(--sans); pointer-events: none; }
  .num { fill: var(--faint); font: 11px var(--mono); pointer-events: none; }
  .val { fill: var(--yellow); font: 600 12px var(--mono); }
  .path { fill: none; stroke: var(--yellow); stroke-width: 2; opacity: 0; transition: opacity .4s; pointer-events: none; }
  .path.on { opacity: 1; }
  .dot { fill: var(--yellow); stroke: var(--bg); stroke-width: 2; pointer-events: none; }
</style>

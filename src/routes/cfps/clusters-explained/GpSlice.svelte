<script>
  // Chapter 2: one slice through the real 30-D Gaussian process. Start from
  // Ginkgo's best composition, hold 29 reagents still, sweep the 30th, and draw what
  // the model predicts — mean and 95% band — against the range the plates ran.
  // Reagent and amount are the deck's shared ones; click or drag on the plot.
  import { coord, uncoord, prep, predict } from '$lib/clusterMath.js';

  let { model, designs = null, reagent, amount = null, setReagent, setAmount } = $props();

  const gp = $derived(model.gp);
  const wellNl = $derived(model.settings.wellNl);
  const j = $derived(Math.max(0, gp.cols.indexOf(reagent)));
  const toNl = (c) => (c / gp.stock[j]) * wellNl;
  const toC = (nl) => (nl / wellNl) * gp.stock[j];

  const plates = $derived([toNl(gp.lo[j]), toNl(gp.hi[j])]);
  const baseNl = $derived(toNl(uncoord(gp, j, model.incumbentX[j])));
  const designNl = $derived(designs ? designs.map((d) => toNl(uncoord(gp, j, d.x[j]))) : []);
  const ctrlNl = $derived(model.controls.map((c) => toNl(uncoord(gp, j, c.x[j]))));
  const maxNl = $derived(Math.max(plates[1] * 2.6, Math.max(0, ...designNl) * 1.1, baseNl * 2, 50));
  const nl = $derived(Math.min(maxNl, amount ?? baseNl));

  const N = 140;
  const curve = $derived.by(() => {
    const x = Float64Array.from(model.incumbentX);
    return Array.from({ length: N }, (_, i) => {
      const v = (maxNl * i) / (N - 1);
      x[j] = coord(gp, j, toC(v));
      const p = predict(gp, prep(gp, Float64Array.from(x)));
      return { nl: v, m: p.lnY - model.strikeLnY, sd: p.sd };
    });
  });
  const at = $derived.by(() => {
    const x = Float64Array.from(model.incumbentX);
    x[j] = coord(gp, j, toC(nl));
    const p = predict(gp, prep(gp, x));
    return { m: p.lnY - model.strikeLnY, sd: p.sd };
  });

  const W = 640, H = 300, PL = 52, PR = 18, PT = 18, PB = 40;
  const PW = W - PL - PR;
  const yLo = $derived(Math.min(-2.2, ...curve.map((c) => c.m - 2 * c.sd)));
  const yHi = $derived(Math.max(1.2, ...curve.map((c) => c.m + 2 * c.sd)));
  const sx = (v) => PL + (v / maxNl) * PW;
  const sy = (v) => PT + (1 - (v - yLo) / (yHi - yLo)) * (H - PT - PB);
  const path = (f) => curve.map((c, i) => `${i ? 'L' : 'M'}${sx(c.nl).toFixed(1)},${sy(f(c)).toFixed(1)}`).join('');
  const band = $derived(
    path((c) => c.m + 2 * c.sd) +
    curve.slice().reverse().map((c) => `L${sx(c.nl).toFixed(1)},${sy(c.m - 2 * c.sd).toFixed(1)}`).join('') + 'Z'
  );
  // ln-ratio ticks labelled as multiples of Ginkgo's best
  const TICKS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
  const mult = (v) => `${v >= 0.1 ? +v.toFixed(2) : +v.toFixed(3)}×`;
  // axis ticks read better as fractions: ⅛×, ¼×, ½×
  const tickLabel = (t) => (t < 1 ? `1/${Math.round(1 / t)}×` : `${t}×`);
  const outside = $derived(nl < plates[0] * 0.9 || nl > plates[1] * 1.1);
  const widen = $derived(at.sd / Math.min(...curve.map((c) => c.sd)));

  // Designs and wells using about this amount: within half of the 25 nL grid
  // step compositions are dispensed on.
  const near = (v) => Math.abs(v - nl) <= 12.5;
  const WIN = $derived(12.5 / maxNl);
  const nearDesigns = $derived(designNl.filter(near).length);
  const nearCtrls = $derived(ctrlNl.filter(near).length);

  let svg = $state(null);
  let scrubbing = false;
  function nlAt(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return Math.max(0, Math.min(maxNl, ((q.x - PL) / PW) * maxNl));
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
  <span class="readout-nl">amount <b class="y">{Math.round(nl)} nL</b></span>
  <button type="button" class="fig-btn" onclick={() => setAmount(null)} disabled={amount == null}>Ginkgo’s best</button>
</div>

<svg bind:this={svg} viewBox="0 0 {W} {H}" class="fig-svg scrub" role="img"
  aria-label="Predicted yield along {gp.names[j]} from the real model; click or drag to pick an amount"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  <rect x={PL} y={PT} width={PW} height={H - PT - PB} class="hit" />
  <rect x={sx(plates[0])} y={PT} width={Math.max(2, sx(plates[1]) - sx(plates[0]))} height={H - PT - PB} class="plates" />
  <text x={sx(plates[1]) + 4} y={H - PB - 6} class="axt">← the plates ran this</text>
  {#each TICKS as t}
    {@const v = Math.log(t)}
    {#if v > yLo && v < yHi}
      <line x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} class="gl" class:one={t === 1} />
      <text x={PL - 6} y={sy(v) + 4} text-anchor="end" class="axt">{tickLabel(t)}</text>
    {/if}
  {/each}
  <path d={band} class="band" />
  <path d={path((c) => c.m)} class="mean" />
  {#each designNl as v}<line x1={sx(v)} x2={sx(v)} y1={H - PB + 1} y2={H - PB + 6} class="tick-d" class:hot={near(v)} />{/each}
  {#each ctrlNl as v}<line x1={sx(v)} x2={sx(v)} y1={H - PB} y2={H - PB + 8} class="tick-c" class:hot={near(v)} />{/each}
  <line x1={sx(baseNl)} x2={sx(baseNl)} y1={PT} y2={H - PB} class="base" />
  <rect x={sx(nl) - WIN * PW} y={PT} width={2 * WIN * PW} height={H - PT - PB} class="win" />
  <line x1={sx(nl)} x2={sx(nl)} y1={PT} y2={H - PB} class="cursor" />
  <line x1={sx(nl)} x2={sx(nl)} y1={sy(at.m - 2 * at.sd)} y2={sy(at.m + 2 * at.sd)} class="err" />
  <circle cx={sx(nl)} cy={sy(at.m)} r="5.5" class="dot" />
  <text x={PL} y={H - 8} class="axt">0 nL</text>
  <text x={W - PR} y={H - 8} class="axt" text-anchor="end">{Math.round(maxNl)} nL · {gp.names[j]}</text>
  <text x={PL + 4} y={PT + 12} class="axt">yield vs Ginkgo's best</text>
</svg>

<div class="fig-readout">
  <span>predicted <b class="y">{mult(Math.exp(at.m))}</b> Ginkgo's best</span>
  <span>95% band <b>{mult(Math.exp(at.m - 2 * at.sd))}–{mult(Math.exp(at.m + 2 * at.sd))}</b></span>
  <span>σ <b class:warn={outside}>{at.sd.toFixed(2)}</b>{#if widen > 1.15} <i class="warn">· {widen.toFixed(1)}× its narrowest</i>{/if}</span>
  <span>nearby: <b class="y">{nearCtrls}</b> wells{#if designs} · <b class="y">{nearDesigns}</b> designs{/if}</span>
</div>
<ul class="fig-legend">
  <li><i class="sw" style="background:var(--blue)"></i>predicted mean, 95% band</li>
  <li><i class="sw sw--band"></i>the plates' range</li>
  <li><i class="sw" style="background:var(--white)"></i>control wells' amounts (ticks{designs ? '; blue: designs' : ''})</li>
  <li><i class="sw sw--dash"></i>Ginkgo's best: {model.incumbent}</li>
</ul>

<style>
  .scrub { cursor: col-resize; }
  .hit { fill: transparent; }
  .readout-nl { font: 12px var(--sans); color: var(--dim); }
  .plates { fill: var(--green); opacity: .1; pointer-events: none; }
  .gl { stroke: var(--line); stroke-width: 1; }
  .gl.one { stroke: var(--faint); stroke-dasharray: 2 3; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); pointer-events: none; }
  .band { fill: var(--blue); opacity: .16; pointer-events: none; }
  .mean { fill: none; stroke: var(--blue); stroke-width: 2.4; pointer-events: none; }
  .tick-c { stroke: var(--white); stroke-width: 1.3; }
  .tick-d { stroke: var(--blue); stroke-width: 1; opacity: .35; }
  .tick-c.hot, .tick-d.hot { stroke: var(--yellow); opacity: 1; stroke-width: 2; }
  .base { stroke: var(--white); stroke-width: 1; stroke-dasharray: 3 4; opacity: .55; }
  .win { fill: var(--yellow); opacity: .07; pointer-events: none; }
  .cursor { stroke: var(--yellow); stroke-width: 1; opacity: .4; }
  .err { stroke: var(--yellow); stroke-width: 3; opacity: .5; }
  .dot { fill: var(--yellow); stroke: var(--bg); stroke-width: 2; }
  .warn { color: var(--gold); font-style: normal; }
</style>

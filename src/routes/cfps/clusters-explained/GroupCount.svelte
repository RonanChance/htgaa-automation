<script>
  // Chapter 6 on the real designs: the whole dendrogram is built once in the
  // browser, so any threshold is just a cut. Groups and loners against τ, with
  // the export's 0.5 marked.
  import { groupsAt } from '$lib/clusterMath.js';

  let { n, merges, rc, tau = $bindable(0.5), exportGroups } = $props();

  const TAUS = Array.from({ length: 61 }, (_, i) => 0.05 + (0.9 * i) / 60);
  const counts = $derived(TAUS.map((t) => {
    const l = groupsAt(n, merges, t, rc);
    return { t, groups: new Set(l.filter((x) => x >= 0)).size, loners: l.filter((x) => x < 0).length };
  }));
  const now = $derived.by(() => {
    const l = groupsAt(n, merges, tau, rc);
    return { groups: new Set(l.filter((x) => x >= 0)).size, loners: l.filter((x) => x < 0).length };
  });

  const W = 640, H = 170, PL = 40, PR = 40, PT = 12, PB = 26;
  const yMax = $derived(Math.max(...counts.map((c) => c.groups), 10) * 1.1);
  const lMax = $derived(n);
  const sx = (t) => PL + ((t - 0.05) / 0.9) * (W - PL - PR);
  const sy = (v) => PT + (1 - v / yMax) * (H - PT - PB);
  const sl = (v) => PT + (1 - v / lMax) * (H - PT - PB);
  // Click or drag across the chart to set τ.
  let svg = $state(null);
  let scrubbing = false;
  function tauAt(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const t = 0.05 + ((q.x - PL) / (W - PL - PR)) * 0.9;
    return Math.round(Math.max(0.05, Math.min(0.95, t)) * 100) / 100;
  }
  function down(ev) { scrubbing = true; svg.setPointerCapture(ev.pointerId); tau = tauAt(ev); }
  const move = (ev) => { if (scrubbing) tau = tauAt(ev); };
  const up = () => (scrubbing = false);

  const line = (f, s) => counts.map((c, i) => `${i ? 'L' : 'M'}${sx(c.t).toFixed(1)},${s(f(c)).toFixed(1)}`).join('');
</script>

<div class="fig-controls">
  <label class="grow">threshold τ <b class="y">{tau.toFixed(2)}</b>
    <input type="range" min="0.05" max="0.95" step="0.01" bind:value={tau} />
  </label>
  <button type="button" class="fig-btn" onclick={() => (tau = 0.5)}>back to 0.5</button>
</div>
<svg bind:this={svg} viewBox="0 0 {W} {H}" class="fig-svg scrub" role="img"
  aria-label="Number of groups at each threshold; click or drag to set τ"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} class="hit" />
  <line x1={sx(0.5)} x2={sx(0.5)} y1={PT} y2={H - PB} class="mark" />
  <text x={sx(0.5) + 4} y={PT + 10} class="axt">the export: 0.5 → {exportGroups} groups</text>
  <path d={line((c) => c.loners, sl)} class="lon" />
  <path d={line((c) => c.groups, sy)} class="grp" />
  <line x1={sx(tau)} x2={sx(tau)} y1={PT} y2={H - PB} class="cur" />
  <circle cx={sx(tau)} cy={sy(now.groups)} r="5" class="dot" />
  <text x={PL - 6} y={sy(0) + 4} text-anchor="end" class="axt">0</text>
  <text x={PL - 6} y={sy(yMax / 1.1) + 4} text-anchor="end" class="axt grpt">{Math.round(yMax / 1.1)}</text>
  <text x={W - PR + 6} y={sl(lMax) + 8} class="axt lont">{lMax}</text>
  <text x={PL} y={H - 6} class="axt">τ 0.05 · everything links</text>
  <text x={W - PR} y={H - 6} text-anchor="end" class="axt">τ 0.95 · only near-twins</text>
</svg>
<div class="fig-readout">
  <span><i class="sw" style="background:var(--yellow)"></i>groups <b class="y">{now.groups}</b></span>
  <span><i class="sw" style="background:var(--purple)"></i>on their own <b>{now.loners}</b></span>
  <span class="hint">click or drag across the chart</span>
</div>

<style>
  .scrub { cursor: col-resize; }
  .hit { fill: transparent; }
  .hint { color: var(--faint); }
  .axt { fill: var(--faint); font: 10.5px var(--mono); pointer-events: none; }
  .grpt { fill: var(--yellow); }
  .lont { fill: var(--purple); }
  .mark { stroke: var(--white); stroke-dasharray: 2 3; opacity: .5; }
  .grp { fill: none; stroke: var(--yellow); stroke-width: 2.2; }
  .lon { fill: none; stroke: var(--purple); stroke-width: 1.5; opacity: .8; }
  .cur { stroke: var(--yellow); opacity: .35; }
  .dot { fill: var(--yellow); stroke: var(--bg); stroke-width: 2; }
</style>

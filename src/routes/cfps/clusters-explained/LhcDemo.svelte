<script>
  // Chapter 8: why "virtual compositions" are drawn with a Latin hypercube. Cut each
  // ingredient's range into N slices and use every slice exactly once: N points
  // that cover every row and column, where N random points leave gaps.
  import { mulberry32 } from '$lib/clusterMath.js';

  let N = $state(10);
  let kind = $state('lhc');
  let seed = $state(3);

  const pts = $derived.by(() => {
    const rng = mulberry32(seed * 7919 + N);
    if (kind === 'random') return Array.from({ length: N }, () => [rng(), rng()]);
    // one shuffled slice order per axis, then a random spot inside each slice
    const perm = () => {
      const a = Array.from({ length: N }, (_, i) => i);
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const px = perm(), py = perm();
    return px.map((sx, i) => [(sx + rng()) / N, (py[i] + rng()) / N]);
  });
  const rowsHit = $derived(new Set(pts.map((p) => Math.floor(p[1] * N))).size);
  const colsHit = $derived(new Set(pts.map((p) => Math.floor(p[0] * N))).size);

  const SZ = 280, P = 26;
  const s = (v) => P + v * SZ;
</script>

<div class="fig-controls">
  <div class="cx-seg" role="group" aria-label="Sampling scheme">
    <button type="button" class:is-on={kind === 'lhc'} onclick={() => (kind = 'lhc')}>Latin hypercube</button>
    <button type="button" class:is-on={kind === 'random'} onclick={() => (kind = 'random')}>random</button>
  </div>
  <label>points <b class="y">{N}</b><input type="range" min="4" max="20" bind:value={N} /></label>
  <button type="button" class="fig-btn" onclick={() => seed++}>resample</button>
</div>
<div class="lhc">
  <svg viewBox="0 0 {SZ + 2 * P} {SZ + 2 * P}" role="img" aria-label="{N} sample points, {kind}">
    {#each Array(N) as _, i}
      {@const hitR = pts.some((p) => Math.floor(p[1] * N) === i)}
      {@const hitC = pts.some((p) => Math.floor(p[0] * N) === i)}
      <rect x={P} y={s(1 - (i + 1) / N)} width={SZ} height={SZ / N} class="band" class:miss={!hitR} />
      <rect x={s(i / N)} y={P} width={SZ / N} height={SZ} class="band" class:miss={!hitC} />
    {/each}
    {#each Array(N + 1) as _, i}
      <line x1={s(i / N)} x2={s(i / N)} y1={P} y2={P + SZ} class="g" />
      <line y1={s(i / N)} y2={s(i / N)} x1={P} x2={P + SZ} class="g" />
    {/each}
    {#each pts as p}<circle cx={s(p[0])} cy={s(1 - p[1])} r="5" class="pt" />{/each}
    <text x={P} y={P + SZ + 18} class="axt">ingredient 1 →</text>
    <text x={P - 8} y={P - 8} class="axt">ingredient 2 ↑</text>
  </svg>
  <div class="txt">
    <p><b class="y">{colsHit}/{N}</b> slices of ingredient 1 covered</p>
    <p><b class="y">{rowsHit}/{N}</b> slices of ingredient 2 covered</p>
    <p class="dim">Red bands are slices no point landed in. The model does this in as many dimensions as
      the group varies, with 160 or more points, then predicts each point's cost per gram.</p>
  </div>
</div>

<style>
  .lhc { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .lhc svg { width: 320px; max-width: 100%; flex: none; }
  .band { fill: transparent; }
  .band.miss { fill: var(--red); opacity: .1; }
  .g { stroke: var(--line); stroke-width: 1; }
  .pt { fill: var(--yellow); stroke: var(--bg); stroke-width: 1.5; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); }
  .txt p { font: 13px/1.5 var(--sans); color: var(--dim); margin: 0 0 6px; }
  .txt b { font: 600 18px var(--mono); }
  .dim { color: var(--faint) !important; }
</style>

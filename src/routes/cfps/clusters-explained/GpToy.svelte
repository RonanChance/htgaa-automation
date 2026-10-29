<script>
  // A one-reagent Gaussian process you can push around, for building intuition
  // before the real 30-D one.
  //
  //   mode 'fit'      measurements, the fitted mean and its ±2σ band
  //        'samples'  + curves drawn from the posterior, gliding continuously
  //                   (each frame is a valid sample: m + L(z₁cos t + z₂sin t))
  //        'link'     + two probes A and B, and every sample's (f(A), f(B))
  //                   pair, whose tilt is the link
  import { onMount } from 'svelte';
  import { cholesky, solve, mulberry32, randn } from '$lib/clusterMath.js';

  let { mode = 'fit' } = $props();

  const W = 640, H = 280, PAD = 34;
  const X0 = 0, X1 = 10, Y0 = -2.6, Y1 = 2.6;
  const G = 96; // grid points the curves are drawn on
  const grid = Array.from({ length: G }, (_, i) => X0 + ((X1 - X0) * i) / (G - 1));
  const sx = (x) => PAD + ((x - X0) / (X1 - X0)) * (W - 2 * PAD);
  const sy = (y) => H - PAD + ((y - Y0) / (Y1 - Y0)) * -(H - 2 * PAD);

  const START = [{ x: 1.4, y: 0.1 }, { x: 2.9, y: 1.1 }, { x: 4.3, y: 0.5 }, { x: 7.6, y: -0.6 }];
  let pts = $state(START.map((p) => ({ ...p })));
  let ls = $state(1.2);
  const AMP = 1, NOISE = 0.004;
  let A = $state(5.6), B = $state(6.6);

  const k = (a, b) => AMP * Math.exp(-((a - b) ** 2) / (2 * ls * ls));

  // Posterior over the grid plus the two probes (appended at the end).
  const post = $derived.by(() => {
    const xs = [...grid, A, B];
    const n = pts.length;
    const K = pts.map((p, i) => pts.map((q, j) => k(p.x, q.x) + (i === j ? NOISE : 0)));
    const L = n ? cholesky(K) : [];
    const alpha = n ? solve(L, pts.map((p) => p.y)) : [];
    const kx = xs.map((x) => pts.map((p) => k(x, p.x)));
    const v = kx.map((row) => (n ? solve(L, row) : []));
    const dot = (a, b) => a.reduce((s, ai, i) => s + ai * b[i], 0);
    const mean = kx.map((row) => dot(row, alpha));
    const cov = xs.map((xa, a) => xs.map((xb, b) => k(xa, xb) - dot(kx[a], v[b])));
    return { xs, mean, cov };
  });
  const sd = $derived(post.cov.map((row, i) => Math.sqrt(Math.max(row[i], 0))));
  const gA = G, gB = G + 1;
  const r = $derived(post.cov[gA][gB] / Math.sqrt(Math.max(post.cov[gA][gA] * post.cov[gB][gB], 1e-12)));

  // Fixed normal draws, so the samples move smoothly instead of re-rolling.
  const S = 9, SCATTER = 260;
  const rng = mulberry32(7);
  const Z1 = Array.from({ length: S }, () => Array.from({ length: G + 2 }, () => randn(rng)));
  const Z2 = Array.from({ length: S }, () => Array.from({ length: G + 2 }, () => randn(rng)));
  const ZS = Array.from({ length: SCATTER }, () => [randn(rng), randn(rng)]);

  const basis = $derived.by(() => {
    const L = cholesky(post.cov.map((row) => [...row]));
    const mul = (z) => L.map((row) => row.reduce((s, l, j) => s + l * z[j], 0));
    return { u1: Z1.map(mul), u2: Z2.map(mul) };
  });

  let t = $state(0);
  let raf;
  const animate = () => {
    t += 0.012;
    raf = requestAnimationFrame(animate);
  };
  // Cleanup lives in onMount's return: onDestroy also runs during SSR.
  onMount(() => {
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  });

  const samples = $derived(
    basis.u1.map((u1, s) => {
      const u2 = basis.u2[s];
      const ph = t + s * 0.7;
      return post.mean.map((m, i) => m + u1[i] * Math.cos(ph) + u2[i] * Math.sin(ph));
    })
  );

  const path = (ys) => grid.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join('');
  const band = $derived(
    grid.map((x, i) => `${i ? 'L' : 'M'}${sx(x)},${sy(post.mean[i] + 2 * sd[i])}`).join('') +
    grid.slice().reverse().map((x, ri) => {
      const i = G - 1 - ri;
      return `L${sx(x)},${sy(post.mean[i] - 2 * sd[i])}`;
    }).join('') + 'Z'
  );

  // (f(A), f(B)) for many draws from the 2×2 posterior.
  const scatter = $derived.by(() => {
    const saa = Math.max(post.cov[gA][gA], 1e-9), sbb = Math.max(post.cov[gB][gB], 1e-9), sab = post.cov[gA][gB];
    const l11 = Math.sqrt(saa), l21 = sab / l11, l22 = Math.sqrt(Math.max(sbb - l21 * l21, 0));
    return ZS.map(([z1, z2]) => [l11 * z1, l21 * z1 + l22 * z2]);
  });
  const live = $derived(samples.map((s, j) => {
    const u1 = basis.u1[j], u2 = basis.u2[j], ph = t + j * 0.7;
    return [u1[gA] * Math.cos(ph) + u2[gA] * Math.sin(ph), u1[gB] * Math.cos(ph) + u2[gB] * Math.sin(ph)];
  }));

  // ── dragging ──────────────────────────────────────────────────────────────
  let svg = $state(null);
  let drag = null;
  function toData(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    const x = X0 + ((q.x - PAD) / (W - 2 * PAD)) * (X1 - X0);
    const y = Y0 + ((H - PAD - q.y) / (H - 2 * PAD)) * (Y1 - Y0);
    return { x: Math.min(X1, Math.max(X0, x)), y: Math.min(Y1 - 0.1, Math.max(Y0 + 0.1, y)) };
  }
  function start(ev, what) {
    ev.stopPropagation(); // don't also add a point underneath
    drag = what;
    // capture on the point itself, so a double-click still reaches it
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }
  // A press anywhere else on the plot adds a measurement there, already
  // grabbed, so press-and-drag places it.
  const MAX_PTS = 14;
  function addAt(ev) {
    if (pts.length >= MAX_PTS) return;
    pts.push(toData(ev));
    drag = pts.length - 1;
    svg.setPointerCapture(ev.pointerId);
  }
  function move(ev) {
    if (drag == null) return;
    const d = toData(ev);
    if (drag === 'A') A = d.x;
    else if (drag === 'B') B = d.x;
    else pts[drag] = d;
  }
  const end = () => (drag = null);
  const reset = () => { pts = START.map((p) => ({ ...p })); ls = 1.2; A = 5.6; B = 6.6; };

  const SC = 170, sc = (v) => SC / 2 + (v / 3.2) * (SC / 2 - 8);
  const linkColor = (v) => (v > 0.5 ? 'var(--yellow)' : v > 0.2 ? 'var(--teal)' : 'var(--dim)');
</script>

<div class="fig-controls">
  <label class="grow">length-scale ℓ <b class="y">{ls.toFixed(2)}</b>
    <input type="range" min="0.25" max="4" step="0.01" bind:value={ls} />
  </label>
  <button type="button" class="fig-btn" onclick={reset}>reset</button>
</div>

<svg bind:this={svg} viewBox="0 0 {W} {H}" class="fig-svg" role="img"
  aria-label="A one-dimensional Gaussian process; click to add a measurement, drag to move one"
  onpointerdown={addAt} onpointermove={move} onpointerup={end} onpointercancel={end}>
  <rect x="0" y="0" width={W} height={H} class="hit" />
  <line class="ax" x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} />
  <text class="axt" x={W - PAD} y={H - 10} text-anchor="end">amount of one reagent →</text>
  <text class="axt" x={PAD} y={18}>predicted yield</text>

  <path d={band} class="band" />
  {#if mode !== 'fit'}
    {#each samples as s, i}<path d={path(s)} class="sample" style="opacity:{0.28 + (i % 3) * 0.12}" />{/each}
  {/if}
  <path d={path(post.mean)} class="mean" />

  {#if mode === 'link'}
    {#each [['A', A, 'var(--blue)'], ['B', B, 'var(--gold)']] as [name, x, c]}
      <line x1={sx(x)} x2={sx(x)} y1={PAD - 6} y2={H - PAD} stroke={c} class="probe" />
      {#each live as pair}
        <circle cx={sx(x)} cy={sy(post.mean[name === 'A' ? gA : gB] + pair[name === 'A' ? 0 : 1])} r="2.6" fill={c} />
      {/each}
      <g class="handle" role="slider" tabindex="0" aria-label="probe {name}" aria-valuenow={x.toFixed(2)}
        onpointerdown={(ev) => start(ev, name)}>
        <rect x={sx(x) - 11} y={H - PAD + 4} width="22" height="18" rx="3" fill={c} />
        <text x={sx(x)} y={H - PAD + 17} text-anchor="middle">{name}</text>
      </g>
    {/each}
  {/if}

  {#each pts as p, i}
    <circle class="pt" cx={sx(p.x)} cy={sy(p.y)} r="7" role="button" tabindex="0"
      aria-label="measurement {i + 1}" onpointerdown={(ev) => start(ev, i)}
      ondblclick={() => pts.length > 1 && pts.splice(i, 1)} />
  {/each}
</svg>

{#if mode === 'link'}
  <div class="link-row">
    <svg viewBox="0 0 {SC} {SC}" class="scatter" role="img" aria-label="Scatter of the two probes' sampled errors">
      <line x1="0" x2={SC} y1={SC / 2} y2={SC / 2} class="ax" />
      <line y1="0" y2={SC} x1={SC / 2} x2={SC / 2} class="ax" />
      {#each scatter as [a, b]}<circle cx={sc(a)} cy={SC - sc(b)} r="1.6" class="sc" />{/each}
      {#each live as [a, b]}<circle cx={sc(a)} cy={SC - sc(b)} r="3.4" class="sc-live" />{/each}
      <text x="6" y="12" class="axt">error at B ↑</text>
      <text x={SC - 4} y={SC - 6} class="axt" text-anchor="end">error at A →</text>
    </svg>
    <div class="lk-readout">
      <span class="k">link r<sub>AB</sub></span>
      <b style="color:{linkColor(r)}">{r.toFixed(2)}</b>
      <div class="bar"><i style="width:{Math.max(0, r) * 100}%; background:{linkColor(r)}"></i></div>
      <p>Each dot is one sampled curve: its error at A (across) and at B (up). A tight
        diagonal means a curve that is off at A is off the same way at B.</p>
    </div>
  </div>
{/if}
<p class="fig-note">Click anywhere to add a measurement · drag to move it{mode === 'link' ? ' · drag the A / B handles' : ''} · double-click one to remove it</p>

<style>
  svg.fig-svg { cursor: crosshair; }
  .hit { fill: transparent; }
  .ax { stroke: var(--line); stroke-width: 1; pointer-events: none; }
  .band, .mean, .sample, .probe, .axt { pointer-events: none; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); }
  .band { fill: var(--blue); opacity: .14; }
  .mean { fill: none; stroke: var(--blue); stroke-width: 2.4; }
  .sample { fill: none; stroke: var(--teal); stroke-width: 1.1; }
  .pt { fill: var(--white); stroke: var(--bg); stroke-width: 2; cursor: grab; }
  .pt:hover, .pt:focus-visible { fill: var(--yellow); outline: none; }
  .probe { stroke-width: 1.5; stroke-dasharray: 3 4; }
  .handle { cursor: ew-resize; }
  .handle text { font: 700 11px var(--mono); fill: var(--bg); pointer-events: none; }
  .link-row { display: flex; gap: 18px; align-items: center; margin-top: 6px; }
  .scatter { width: 170px; flex: none; background: var(--fig-2); border-radius: 4px; }
  .sc { fill: var(--teal); opacity: .35; }
  .sc-live { fill: var(--yellow); }
  .lk-readout .k { font: 11px var(--mono); color: var(--dim); }
  .lk-readout b { display: block; font: 600 34px/1.1 var(--mono); }
  .lk-readout p { font: 12.5px/1.5 var(--sans); color: var(--dim); margin: 6px 0 0; }
  .bar { height: 5px; background: var(--line); border-radius: 3px; overflow: hidden; width: 180px; }
  .bar i { display: block; height: 100%; transition: width .15s; }
</style>

<script>
  // The flat counterpart of Cloud3D: the same points, seen along two principal
  // components at a time. Points glide when you switch pairs.
  //
  //   points  [{ p: [pc1, pc2, pc3, pc4], c, s, a, shape }] — as for Cloud3D
  //   pair    which two components to plot, e.g. [0, 1]
  //   axes    a caption per component ("PC1 · 38%")
  let { points = [], pair = [0, 1], label = null, axes = null, height = 420 } = $props();

  const W = 640, H = 420, PAD = 30;
  let svg = $state(null);
  let wrap = $state(null);
  let hover = $state(null);

  // Centre on the mean and scale so most points fit, as Cloud3D does.
  const placed = $derived.by(() => {
    if (!points.length) return [];
    const [a, b] = pair;
    const mx = points.reduce((s, q) => s + q.p[a], 0) / points.length;
    const my = points.reduce((s, q) => s + q.p[b], 0) / points.length;
    const ex = points.map((q) => Math.abs(q.p[a] - mx)).sort((u, v) => u - v);
    const ey = points.map((q) => Math.abs(q.p[b] - my)).sort((u, v) => u - v);
    const k = Math.floor(points.length * 0.98);
    const sx = (W / 2 - PAD) / (ex[k] || 1), sy = (H / 2 - PAD) / (ey[k] || 1);
    return points.map((q, i) => ({
      i,
      x: W / 2 + (q.p[a] - mx) * sx,
      y: H / 2 - (q.p[b] - my) * sy,
      c: q.c, r: (q.s ?? 7) / 2.6, a: q.a ?? 1, shape: q.shape ?? 0
    }));
  });
  // designs first, controls (diamonds) on top
  const order = $derived([...placed].sort((u, v) => u.shape - v.shape));

  function onMove(ev) {
    if (!label || !svg) return;
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    let best = null, bd = 12 * 12;
    for (const pt of placed) {
      if (pt.a < 0.15) continue;
      const d = (pt.x - q.x) ** 2 + (pt.y - q.y) ** 2;
      if (d < bd) { bd = d; best = pt; }
    }
    const text = best ? label(best.i) : null;
    const r = wrap.getBoundingClientRect();
    hover = text ? { text, x: ev.clientX - r.left, y: ev.clientY - r.top, i: best.i } : null;
  }
</script>

<div class="sc2" bind:this={wrap} style="height:{typeof height === 'number' ? `${height}px` : height}">
  <svg bind:this={svg} viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" role="img"
    aria-label="Designs plotted on {axes?.[pair[0]] ?? 'one component'} against {axes?.[pair[1]] ?? 'another'}"
    onpointermove={onMove} onpointerleave={() => (hover = null)}>
    <line x1={PAD / 2} x2={W - PAD / 2} y1={H / 2} y2={H / 2} class="ax" />
    <line y1={PAD / 2} y2={H - PAD / 2} x1={W / 2} x2={W / 2} class="ax" />
    {#each order as pt (pt.i)}
      <g class="pt" style="transform: translate({pt.x}px, {pt.y}px)" opacity={pt.a}>
        {#if pt.shape === 1}
          <rect x={-pt.r} y={-pt.r} width={pt.r * 2} height={pt.r * 2} transform="rotate(45)" fill={pt.c}
            class:hot={hover?.i === pt.i} />
        {:else}
          <circle r={pt.r} fill={pt.c} class:hot={hover?.i === pt.i} />
        {/if}
      </g>
    {/each}
    {#if axes}
      <text x={W - PAD / 2} y={H / 2 - 6} text-anchor="end" class="axt">{axes[pair[0]]} →</text>
      <text x={W / 2 + 6} y={PAD / 2 + 8} class="axt">↑ {axes[pair[1]]}</text>
    {/if}
  </svg>
  {#if hover}<div class="tip" style="left:{hover.x + 14}px; top:{hover.y + 10}px">{hover.text}</div>{/if}
</div>

<style>
  .sc2 { position: relative; width: 100%; }
  svg { width: 100%; height: 100%; display: block; }
  .ax { stroke: #2c333d; stroke-width: 1; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); pointer-events: none; }
  .pt { transition: transform .7s cubic-bezier(.2, .7, .3, 1); }
  .pt circle, .pt rect { stroke: var(--bg); stroke-width: .6; }
  .pt .hot { stroke: var(--yellow); stroke-width: 2; }
  .tip {
    position: absolute; pointer-events: none; z-index: 2; max-width: 260px;
    padding: 6px 9px; border-radius: 4px; background: rgba(10, 12, 16, .94);
    border: 1px solid var(--line); font: 11px/1.45 var(--mono); color: var(--text); white-space: pre-line;
  }
</style>

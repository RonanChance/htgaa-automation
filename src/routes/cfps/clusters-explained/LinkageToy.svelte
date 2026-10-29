<script>
  // Chapter 6: agglomerative clustering on a dozen points you can drag. Links
  // here are just closeness, exp(−d²/2s²), so you can see them; the real ones
  // come from chapter 3 and 4. Step through the merges, compare single and
  // complete linkage on the chain, drag the threshold, and watch the
  // one-composition pair get turned away.
  import { completeLinkage, groupColor } from '$lib/clusterMath.js';

  let { step = 0 } = $props();

  const START = [
    [1.0, 1.3], [1.6, 0.8], [1.25, 1.85],
    [4.6, 4.9], [5.15, 4.45], [4.95, 5.3], [4.25, 5.35],
    [2.9, 1.0], [3.8, 1.35], [4.7, 1.1], [5.6, 1.5],
    [2.4, 3.3], [2.4, 3.3]
  ];
  // The last two are the same composition submitted twice.
  const RC = START.map((_, i) => (i === 12 ? 11 : i));
  let pts = $state(START.map((p) => [...p]));
  const n = START.length;
  const S2 = 2 * 0.9 * 0.9;
  const sim = (a, b) => Math.exp(-((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) / S2);

  let method = $state('complete');
  let tau = $state(0.5);
  let k = $state(n - 1); // merges shown

  const R = $derived.by(() => {
    const m = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i * n + j] = sim(pts[i], pts[j]);
    return m;
  });

  // Single linkage for contrast: groups join at their *strongest* pair.
  function singleLinkage(R) {
    const cl = Array.from({ length: n }, (_, i) => ({ id: i, m: [i] }));
    const out = [];
    while (cl.length > 1) {
      let best = -1, bi = 0, bj = 1;
      for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
        let s = -Infinity;
        for (const a of cl[i].m) for (const b of cl[j].m) s = Math.max(s, R[a * n + b]);
        if (s > best) { best = s; bi = i; bj = j; }
      }
      out.push({ a: cl[bi].id, b: cl[bj].id, h: best });
      cl[bi] = { id: n + out.length - 1, m: [...cl[bi].m, ...cl[bj].m] };
      cl.splice(bj, 1);
    }
    return out;
  }

  const merges = $derived(method === 'complete' ? completeLinkage(n, R) : singleLinkage(R));

  // Steps drive the defaults; the controls stay live afterwards.
  $effect(() => {
    if (step === 0) { k = 0; method = 'complete'; }
    else if (step === 1) { k = n - 1; method = 'single'; }
    else { k = n - 1; method = 'complete'; }
  });
  const showTau = $derived(step >= 1);
  const dupRule = $derived(step >= 3);

  // Clusters after the first k merges (and above τ once the line is on).
  const labels = $derived.by(() => {
    const parent = Array.from({ length: n + merges.length }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) a = parent[a]; return a; };
    merges.forEach((m, i) => {
      if (i >= k || (showTau && m.h < tau)) return;
      parent[find(m.a)] = n + i;
      parent[find(m.b)] = n + i;
    });
    const roots = new Map(), size = new Map(), rcs = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      size.set(r, (size.get(r) || 0) + 1);
      if (!rcs.has(r)) rcs.set(r, new Set());
      rcs.get(r).add(RC[i]);
    }
    return Array.from({ length: n }, (_, i) => {
      const r = find(i);
      if (size.get(r) < 2) return { g: -1 };
      if (dupRule && rcs.get(r).size < 2) return { g: -1, dup: true };
      if (!roots.has(r)) roots.set(r, roots.size);
      return { g: roots.get(r) };
    });
  });
  const nGroups = $derived(new Set(labels.filter((l) => l.g >= 0).map((l) => l.g)).size);

  // ── dendrogram geometry ───────────────────────────────────────────────────
  const DX0 = 330, DX1 = 625, DY0 = 22, DY1 = 290;
  // similarity 1 at the bottom (leaves), 0 at the top
  const yOf = (h) => DY0 + (1 - Math.max(0, Math.min(1, h))) * (DY1 - DY0);
  const leafOrder = $derived.by(() => {
    const kids = new Map(merges.map((m, i) => [n + i, [m.a, m.b]]));
    const out = [];
    const walk = (id) => (id < n ? out.push(id) : kids.get(id).forEach(walk));
    walk(n + merges.length - 1);
    return out;
  });
  const geo = $derived.by(() => {
    const x = new Map(), h = new Map(), rep = new Map();
    leafOrder.forEach((leaf, i) => { x.set(leaf, DX0 + ((i + 0.5) / n) * (DX1 - DX0)); h.set(leaf, 1); rep.set(leaf, leaf); });
    return merges.map((m, i) => {
      const xa = x.get(m.a), xb = x.get(m.b);
      // any leaf under this merge, to colour the branch by its group
      const seg = { xa, xb, ya: yOf(h.get(m.a)), yb: yOf(h.get(m.b)), y: yOf(m.h), h: m.h, i, rep: rep.get(m.a) };
      x.set(n + i, (xa + xb) / 2);
      h.set(n + i, m.h);
      rep.set(n + i, seg.rep);
      return seg;
    });
  });
  const leafColor = (i) => (labels[i].g >= 0 ? groupColor(labels[i].g) : 'var(--dim)');

  // ── dragging points and the threshold ────────────────────────────────────
  let svg = $state(null);
  let drag = null;
  const SX = (v) => 20 + (v / 6.4) * 280, SY = (v) => 300 - (v / 6.4) * 280;
  function svgPt(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function down(ev, what) { drag = what; ev.currentTarget.setPointerCapture(ev.pointerId); }
  function move(ev) {
    if (drag == null) return;
    const q = svgPt(ev);
    if (drag === 'tau') tau = Math.max(0.02, Math.min(0.98, 1 - (q.y - DY0) / (DY1 - DY0)));
    else pts[drag] = [Math.max(0.1, Math.min(6.3, ((q.x - 20) / 280) * 6.4)), Math.max(0.1, Math.min(6.3, ((300 - q.y) / 280) * 6.4))];
  }
  const up = () => (drag = null);
</script>

<div class="fig-controls">
  <div class="cx-seg" role="group" aria-label="Linkage rule">
    <button type="button" class:is-on={method === 'single'} onclick={() => (method = 'single')}>single (strongest pair)</button>
    <button type="button" class:is-on={method === 'complete'} onclick={() => (method = 'complete')}>complete (weakest pair)</button>
  </div>
  <button type="button" class="fig-btn" disabled={k === 0} onclick={() => (k = Math.max(0, k - 1))}>◀</button>
  <span class="dim">merge {k}/{n - 1}</span>
  <button type="button" class="fig-btn" disabled={k === n - 1} onclick={() => (k = Math.min(n - 1, k + 1))}>▶</button>
  <button type="button" class="fig-btn" onclick={() => (pts = START.map((p) => [...p]))}>reset</button>
</div>

<svg bind:this={svg} viewBox="0 0 640 310" class="fig-svg" role="img"
  aria-label="Points being merged into groups, with the dendrogram of merges"
  onpointermove={move} onpointerup={up} onpointercancel={up}>
  <!-- links strong enough to matter, so the chain is visible -->
  {#each pts as a, i}
    {#each pts as b, j}
      {#if j > i && R[i * n + j] > 0.3 && RC[i] !== RC[j]}
        <line x1={SX(a[0])} y1={SY(a[1])} x2={SX(b[0])} y2={SY(b[1])} class="edge"
          style="opacity:{(R[i * n + j] - 0.3) * 1.2}" />
      {/if}
    {/each}
  {/each}
  {#each pts as p, i}
    {#if i !== 12}
      <circle cx={SX(p[0])} cy={SY(p[1])} r="9" fill={leafColor(i)} class="pt" class:dup={labels[i].dup}
        role="button" tabindex="0" aria-label="point {i + 1}" onpointerdown={(ev) => down(ev, i)} />
    {/if}
  {/each}
  <text x={SX(pts[11][0]) - 13} y={SY(pts[11][1]) + 4} text-anchor="end" class="dim">same composition ×2</text>
  {#if dupRule && labels[11].dup}<text x={SX(pts[11][0]) - 13} y={SY(pts[11][1]) + 17} text-anchor="end" class="dim">not a group</text>{/if}

  <line x1="318" x2="318" y1="14" y2="300" class="sep" />
  {#each geo as s}
    {@const on = s.i < k && (!showTau || s.h >= tau)}
    <path d="M{s.xa},{s.ya} V{s.y} H{s.xb} V{s.yb}" class="den" class:on
      style={on ? `stroke:${leafColor(s.rep)}` : ''} />
  {/each}
  {#each leafOrder as leaf, i}
    <circle cx={DX0 + ((i + 0.5) / n) * (DX1 - DX0)} cy={DY1 + 7} r="4" fill={leafColor(leaf)} />
  {/each}
  <text x={DX1} y={DY0 - 8} text-anchor="end" class="dim">merge height = weakest link inside</text>
  {#each [0, 0.5, 1] as h}<text x={DX0 - 4} y={yOf(h) + 4} text-anchor="end" class="dim">{h}</text>{/each}
  {#if showTau}
    <g class="tau" role="slider" tabindex="0" aria-label="threshold" aria-valuenow={tau.toFixed(2)}
      onpointerdown={(ev) => down(ev, 'tau')}>
      <line x1={DX0} x2={DX1} y1={yOf(tau)} y2={yOf(tau)} />
      <rect x={DX1 - 64} y={yOf(tau) - 10} width="64" height="20" rx="3" />
      <text x={DX1 - 32} y={yOf(tau) + 4} text-anchor="middle">τ {tau.toFixed(2)}</text>
    </g>
  {/if}
</svg>
<div class="fig-readout">
  <span>groups <b class="y">{nGroups}</b></span>
  <span>on their own <b>{labels.filter((l) => l.g < 0).length}</b></span>
  <span class="dim">drag points{showTau ? ' and the τ line' : ''}</span>
</div>

<style>
  .edge { stroke: var(--teal); stroke-width: 1.2; }
  .pt { stroke: var(--bg); stroke-width: 2; cursor: grab; transition: fill .35s; }
  .pt.dup { stroke: var(--white); stroke-dasharray: 2 2; }
  .sep { stroke: var(--line); }
  .den { fill: none; stroke: var(--line); stroke-width: 1.4; transition: stroke .3s; }
  .den.on { stroke-width: 2; }
  .dim { fill: var(--faint); color: var(--faint); font: 10.5px var(--mono); }
  .tau { cursor: ns-resize; }
  .tau line { stroke: var(--yellow); stroke-width: 1.5; stroke-dasharray: 5 4; }
  .tau rect { fill: var(--yellow); }
  .tau text { fill: var(--bg); font: 700 11px var(--mono); pointer-events: none; }
</style>

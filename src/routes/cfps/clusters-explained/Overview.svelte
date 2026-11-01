<script>
  // The whole process on one figure, the same for every protein: ideas appear,
  // the model's confidence spreads from the measured wells, links form, the
  // link matrix sorts itself into blocks, the blocks become clusters, and the
  // clusters choose what gets tested.
  //
  // The points are made up (31 ideas, 8 measured wells) so the picture stays
  // simple, but the clustering is the real thing: complete linkage at 0.5 from
  // $lib/clusterMath.js, run on these links.
  import { scale } from 'svelte/transition';
  import { completeLinkage, groupsAt, groupColor, mulberry32 } from '$lib/clusterMath.js';

  let { step = 0, onstep = null } = $props();

  const STAGES = ['Ideas', 'Predict', 'Link', 'Matrix', 'Cluster', 'Choose'];

  // ── the made-up ideas ─────────────────────────────────────────────────────
  const ring = (cx, cy, n, r, rot = 0) =>
    Array.from({ length: n }, (_, k) => [cx + r * Math.cos(rot + (2 * Math.PI * k) / n), cy + r * Math.sin(rot + (2 * Math.PI * k) / n)]);
  const SETS = [
    ring(150, 105, 6, 17, 0.3),
    ring(335, 85, 5, 15, 1.1),
    ring(425, 225, 6, 18, 0.7),
    ring(255, 255, 4, 13, 0.2),
    // far apart, but all add the same untested reagent
    [[70, 190], [305, 340], [480, 330], [205, 30]]
  ];
  const SHARED = 4;
  const LONERS = [[470, 40], [60, 340], [360, 160], [130, 250], [500, 140], [395, 340]];
  const WELLS = [[95, 300], [120, 285], [110, 320], [140, 305], [85, 275], [130, 335], [150, 285], [100, 345]];
  const rng = mulberry32(11);
  const ideas = [
    ...SETS.flatMap((pts, s) => pts.map(([x, y]) => ({ x, y, shared: s === SHARED }))),
    ...LONERS.map(([x, y]) => ({ x, y, shared: false }))
  ].map((d, i) => ({ ...d, i, odds: rng(), delay: rng() }));
  const n = ideas.length;

  // links: closeness, plus a shared term for ideas that add the same untested reagent
  const S = 45;
  const R = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d2 = (ideas[i].x - ideas[j].x) ** 2 + (ideas[i].y - ideas[j].y) ** 2;
      const shared = ideas[i].shared && ideas[j].shared ? 0.7 : 0;
      R[i * n + j] = i === j ? 1 : Math.min(1, Math.exp(-d2 / (2 * S * S)) + shared);
    }
  }
  const labels = groupsAt(n, completeLinkage(n, R), 0.5, ideas.map((_, i) => i));
  const clusters = [...new Set(labels.filter((l) => l >= 0))].map((c) => ideas.filter((d) => labels[d.i] === c));

  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const r = R[i * n + j];
      if (r > 0.2) edges.push({ a: ideas[i], b: ideas[j], r, shared: ideas[i].shared && ideas[j].shared });
    }
  }

  // uncertainty: how far an idea is from the nearest measured well
  const unsure = (d) => 1 - Math.max(...WELLS.map(([x, y]) => Math.exp(-((d.x - x) ** 2 + (d.y - y) ** 2) / (2 * 90 * 90))));

  // ── choosing: best odds first, then the member least linked to it ────────
  const picks = new Map();
  for (const members of clusters) {
    const first = members.reduce((b, d) => (d.odds > b.odds ? d : b));
    const check = members.filter((d) => d !== first).reduce((b, d) => (R[first.i * n + d.i] < R[first.i * n + b.i] ? d : b));
    picks.set(first.i, 'first');
    picks.set(check.i, 'check');
  }
  ideas.forEach((d) => { if (labels[d.i] < 0) picks.set(d.i, 'independent'); });
  const tally = {
    first: [...picks.values()].filter((v) => v === 'first').length,
    check: [...picks.values()].filter((v) => v === 'check').length,
    independent: [...picks.values()].filter((v) => v === 'independent').length
  };
  const tested = tally.first + tally.check + tally.independent;

  // ── the matrix: shuffled, then sorted into clusters ──────────────────────
  const shuffled = (() => {
    const a = ideas.map((d) => d.i);
    const r2 = mulberry32(5);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  })();
  const sortedOrder = [...clusters.flatMap((m) => m.map((d) => d.i)), ...ideas.filter((d) => labels[d.i] < 0).map((d) => d.i)];
  let sorted = $state(false);
  let autoSort = null;
  $effect(() => {
    clearTimeout(autoSort);
    if (step < 3) { sorted = false; return; }
    if (step > 3) { sorted = true; return; }
    sorted = false;
    autoSort = setTimeout(() => (sorted = true), 900);
    return () => clearTimeout(autoSort);
  });
  // Clicking the matrix flips it between shuffled and sorted, to compare the two.
  function toggleSort() {
    clearTimeout(autoSort);
    sorted = !sorted;
  }
  const pos = $derived.by(() => {
    const p = new Array(n);
    (sorted ? sortedOrder : shuffled).forEach((id, k) => (p[id] = k));
    return p;
  });
  const CS = 9, MX = 600, MY = 92;
  const blocks = (() => {
    let at = 0;
    return clusters.map((m) => { const b = { at, size: m.length }; at += m.length; return b; });
  })();
  const cellColor = (r) => {
    const v = Math.max(0, Math.min(1, r));
    const stops = [[14, 17, 22], [32, 68, 104], [44, 140, 170], [92, 208, 179], [255, 216, 102]];
    const x = v * 4, k = Math.min(3, Math.floor(x)), t = x - k;
    return `rgb(${stops[k].map((c, q) => Math.round(c + (stops[k + 1][q] - c) * t)).join(',')})`;
  };

  // convex hull, for drawing compact clusters as a soft blob
  function hull(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
    for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((q) => q.join(',')).join(' ');
  }

  // the scatter sits centred until the matrix needs the room
  const shift = $derived(step >= 3 ? 0 : 185);
  const colorOf = (d) => (step >= 4 && labels[d.i] >= 0 ? groupColor(labels[d.i]) : step >= 4 ? '#8a7fd0' : '#58c4dd');
  const roleOf = (d) => (step >= 5 ? picks.get(d.i) ?? 'wait' : null);
</script>

<div class="ov">
  <ol class="pipe" aria-label="The steps">
    {#each STAGES as s, k}
      <li class:on={k === step} class:done={k < step}>
        <button type="button" onclick={() => onstep?.(k)}>{k + 1} {s}</button>
      </li>
    {/each}
  </ol>

  <svg viewBox="0 0 900 400" role="img" aria-label="The clustering process on illustrative data, stage {step + 1} of 6: {STAGES[step]}">
    <defs>
      <radialGradient id="ov-glow">
        <stop offset="0" stop-color="#5cd0b3" stop-opacity=".32" />
        <stop offset="1" stop-color="#5cd0b3" stop-opacity="0" />
      </radialGradient>
    </defs>

    <g class="scatter" style="transform: translate({shift}px, 18px)">
      <!-- the model's confidence: strongest at the measured wells -->
      <g class="fade" class:show={step === 1}>
        {#each WELLS as [x, y]}<circle cx={x} cy={y} r="120" fill="url(#ov-glow)" />{/each}
      </g>

      <!-- links -->
      <g class="fade" class:show={step >= 2 && step <= 4}>
        {#each edges as e}
          <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} class="edge" class:shared={e.shared}
            style="opacity:{step === 4 && labels[e.a.i] !== labels[e.b.i] ? 0.05 : 0.15 + e.r * 0.75}" />
        {/each}
      </g>

      <!-- compact clusters as soft blobs -->
      <g class="fade" class:show={step >= 4}>
        {#each clusters as m, k}
          {#if !m[0].shared}
            <polygon points={hull(m.map((d) => [d.x, d.y]))} class="blob" style="stroke:{groupColor(k)}; fill:{groupColor(k)}" />
          {/if}
        {/each}
      </g>

      <!-- cluster numbers, matching the numbered blocks on the matrix -->
      <g class="fade" class:show={step >= 4}>
        {#each clusters as m, k}
          {@const cx = m.reduce((a, d) => a + d.x, 0) / m.length}
          {@const top = Math.min(...m.map((d) => d.y))}
          {#if m[0].shared}
            <!-- the spread-out cluster: number its first member instead of a centre -->
            <text x={m[0].x + 12} y={m[0].y - 10} class="cnum" style="fill:{groupColor(k)}">{k + 1}</text>
          {:else}
            <text x={cx} y={top - 20} text-anchor="middle" class="cnum" style="fill:{groupColor(k)}">{k + 1}</text>
          {/if}
        {/each}
      </g>

      <!-- measured wells -->
      {#each WELLS as [x, y]}
        <rect x={x - 5} y={y - 5} width="10" height="10" transform="rotate(45 {x} {y})" class="well" />
      {/each}

      <!-- ideas -->
      {#each ideas as d (d.i)}
        {@const role = roleOf(d)}
        <g class="idea" style="transform: translate({d.x}px, {d.y}px)" class:wait={role === 'wait'}>
          <!-- ideas arrive one by one, as submissions did -->
          <g in:scale|global={{ delay: 200 + d.delay * 1100, duration: 380, start: 0 }}>
          {#if step === 1}<circle r={6 + unsure(d) * 14} class="halo" />{/if}
          {#if d.shared && step >= 2 && step <= 4}<circle r="9" class="unk" />{/if}
          {#if role === 'first'}
            <path d="M0,-11 L3.2,-3.4 11,-3.4 4.7,1.5 6.8,9.4 0,4.7 -6.8,9.4 -4.7,1.5 -11,-3.4 -3.2,-3.4Z" fill={colorOf(d)} class="star" />
          {:else}
            <circle r={role === 'check' ? 7 : 6} fill={role === 'check' ? 'none' : role === 'independent' ? '#a87cd8' : colorOf(d)}
              stroke={role === 'check' ? colorOf(d) : 'none'} stroke-width={role === 'check' ? 2.6 : 0} class="dot" />
          {/if}
          </g>
        </g>
      {/each}
    </g>

    <!-- the link matrix: click to flip between shuffled and sorted -->
    <g class="fade matrix" class:show={step >= 3} role="button" tabindex={step >= 3 ? 0 : -1}
      aria-label="Link matrix, {sorted ? 'sorted into clusters' : 'shuffled'}; click to {sorted ? 'shuffle' : 'sort'} it"
      onclick={toggleSort} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleSort())}>
      <text x={MX} y={MY - 12} class="cap">every pair’s link · {n} × {n} · click to {sorted ? 'shuffle' : 'sort'}</text>
      <rect x={MX} y={MY} width={n * CS} height={n * CS} class="hit" />
      {#each ideas as a (a.i)}
        {#each ideas as b (b.i)}
          <rect width={CS} height={CS} fill={cellColor(R[a.i * n + b.i])} class="cell"
            style="transform: translate({MX + pos[b.i] * CS}px, {MY + pos[a.i] * CS}px)" />
        {/each}
      {/each}
      {#if step >= 4 && sorted}
        {#each blocks as bl, k}
          <rect x={MX + bl.at * CS} y={MY + bl.at * CS} width={bl.size * CS} height={bl.size * CS} class="outline" style="stroke:{groupColor(k)}" />
          <text x={MX + (bl.at + bl.size) * CS + 5} y={MY + (bl.at + bl.size / 2) * CS} dominant-baseline="central"
            class="cnum small" style="fill:{groupColor(k)}">{k + 1}</text>
        {/each}
      {/if}
    </g>

    <!-- legend / tally for the stage -->
    <g class="legend" transform="translate(20, 392)">
      {#if step === 0}
        <text class="lg">● student ideas ({n})   ◆ Ginkgo’s measured wells ({WELLS.length})</text>
      {:else if step === 1}
        <text class="lg">glow: where the model is confident · bigger halo: more unsure</text>
      {:else if step === 2}
        <text class="lg">line strength = link · <tspan class="red">red dashes</tspan>: linked by a shared untested reagent, not by closeness</text>
      {:else if step === 3}
        <text class="lg">{sorted ? 'sorted: linked ideas sit together, and blocks appear' : 'in random order the table looks like noise…'}</text>
      {:else if step === 4}
        <text class="lg">{clusters.length} clusters (every pair linked ≥ 0.5) · {n - clusters.reduce((a, m) => a + m.length, 0)} ideas in no cluster</text>
      {:else}
        <text class="lg">{n} ideas → <tspan class="y">{tested} tested compositions</tspan>: ★ {tally.first} first · ◯ {tally.check} check · <tspan class="pur">●</tspan> {tally.independent} independent · faded ideas follow their cluster</text>
      {/if}
    </g>
  </svg>
  <p class="fig-note">Illustrative data, the same for every protein. The clustering itself is the real algorithm, run on these links.</p>
</div>

<style>
  .pipe { display: flex; gap: 4px; list-style: none; margin: 0 0 8px; padding: 0; flex-wrap: wrap; }
  .pipe li { flex: 1; min-width: 70px; }
  .pipe button {
    width: 100%; font: 11px var(--mono); padding: 5px 6px; cursor: pointer; text-align: left;
    background: var(--fig-2); color: var(--faint); border: 1px solid var(--line); border-radius: 4px;
  }
  .pipe li.done button { color: var(--dim); }
  .pipe li.on button { color: var(--bg); background: var(--yellow); border-color: var(--yellow); font-weight: 600; }
  .pipe button:hover { border-color: var(--faint); }
  svg { width: 100%; height: auto; display: block; }
  .scatter { transition: transform .9s cubic-bezier(.2, .7, .3, 1); }
  .fade { opacity: 0; transition: opacity .6s; pointer-events: none; }
  .fade.show { opacity: 1; }
  .edge { stroke: var(--teal); stroke-width: 1.3; }
  .edge.shared { stroke: var(--red); stroke-dasharray: 5 4; stroke-width: 1.6; }
  .blob { fill-opacity: .12; stroke-opacity: .5; stroke-width: 26; stroke-linejoin: round; }
  .well { fill: var(--white); }
  .idea { transition: transform .6s, opacity .5s; }
  .idea.wait { opacity: .28; }
  .halo { fill: none; stroke: var(--gold); stroke-opacity: .55; stroke-width: 1.2; }
  .unk { fill: none; stroke: var(--red); stroke-width: 1.6; stroke-dasharray: 3 2; }
  .dot, .star { stroke-linejoin: round; }
  .cell { transition: transform .9s cubic-bezier(.2, .7, .3, 1); }
  .matrix.show { pointer-events: auto; cursor: pointer; }
  .matrix:focus { outline: none; }
  .matrix:focus-visible .hit { stroke: var(--yellow); stroke-width: 1.5; }
  .hit { fill: transparent; }
  .outline { fill: none; stroke-width: 1.6; }
  .cnum { font: 700 14px var(--mono); paint-order: stroke; stroke: var(--bg); stroke-width: 3px; pointer-events: none; }
  .cnum.small { font-size: 12px; }
  .cap { fill: var(--faint); font: 11px var(--mono); }
  .lg { fill: var(--dim); font: 12px var(--sans); }
  .red { fill: var(--red); }
  .pur { fill: var(--purple); }
  .y { fill: var(--yellow); font-weight: 600; }
</style>

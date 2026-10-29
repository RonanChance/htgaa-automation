<script>
  // Chapter 5: every link at once. One pixel per pair, first in submission
  // order (noise), then slid into group order, where the groups appear as
  // bright blocks on the diagonal. Rows and columns move separately each frame:
  // columns are drawn as strips into a scratch canvas, then rows from that.
  import { onMount } from 'svelte';
  import { heatRGB } from './colors.js';
  import { mulberry32 } from '$lib/clusterMath.js';

  let { n, R, G, groupOf, groups, sorted = false, labelFor = null, eff = null, target = '' } = $props();

  // Numbers for the reading guide: how much of the matrix is bright, and why.
  const stats = $derived.by(() => {
    let pairs = 0, strong = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) { pairs++; if (R[i * n + j] >= 0.5) strong++; }
    }
    const grouped = groups.reduce((a, g) => a + g.members.length, 0) / n;
    // Counted per group, not per pair: pairs would let a few big groups dominate.
    const bets = groups.filter((g) => g.fromUntested > g.fromSimilar).length;
    return { strong: strong / pairs, grouped, bets, shared: groups.length ? bets / groups.length : 0 };
  });
  const pct = (v) => `${v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;

  let part = $state('r'); // 'r' full link | 'g' composition similarity only | 's' shared unknown only
  let view = $state(null);
  let wrap = $state(null);
  let srcs = {};
  let tmp = null;
  let raf;
  let hover = $state(null);
  let done = $state(false);

  // Display order: shuffled to start (the export lists designs by author, which
  // already bunches them), then groups in turn, first test first, then everyone
  // on their own.
  const shuffled = $derived.by(() => {
    const a = Array.from({ length: n }, (_, i) => i);
    const rng = mulberry32(n);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  });
  const order = $derived.by(() => {
    if (!sorted) return shuffled;
    const out = [];
    for (const g of groups) out.push(g.first, ...g.members.filter((i) => i !== g.first));
    const seen = new Set(out);
    for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
    return out;
  });
  // where each design sits on screen, now and at the end of the animation
  let posFrom = null, posTo = null, t0 = 0;
  const DUR = 1600;

  function render(which) {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = which === 'g' ? G[i] : which === 's' ? R[i] - G[i] : R[i];
      const [r, g, b] = heatRGB(v);
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  const src = (which) => (srcs[which] ??= render(which));

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function draw(now) {
    if (!view) return;
    const e = posTo && posFrom ? ease(Math.min(1, (now - t0) / DUR)) : 1;
    const pos = posTo.map((p, i) => posFrom[i] + (p - posFrom[i]) * e);
    const s = src(part);
    tmp ??= document.createElement('canvas');
    tmp.width = tmp.height = n;
    const tc = tmp.getContext('2d');
    tc.clearRect(0, 0, n, n);
    for (let i = 0; i < n; i++) tc.drawImage(s, i, 0, 1, n, pos[i], 0, 1, n);
    const vc = view.getContext('2d');
    vc.fillStyle = '#0a0c10';
    vc.fillRect(0, 0, n, n);
    for (let i = 0; i < n; i++) vc.drawImage(tmp, 0, i, n, 1, 0, pos[i], n, 1);
    if (e < 1) raf = requestAnimationFrame(draw);
    else { posFrom = posTo.slice(); done = true; }
  }

  function retarget() {
    const to = new Array(n);
    order.forEach((d, slot) => (to[d] = slot));
    posFrom = posFrom && posFrom.length === n ? posFrom : to.slice();
    posTo = to;
    t0 = performance.now();
    done = false;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  onMount(() => {
    srcs = {};
    retarget();
    return () => cancelAnimationFrame(raf);
  });
  $effect(() => { order; if (view) retarget(); });
  $effect(() => { part; if (view && posTo) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } });
  // A new matrix (another protein) invalidates the cached renders.
  $effect(() => { R; G; srcs = {}; posFrom = null; if (view) retarget(); });

  // Group outlines, once the rows have landed.
  const blocks = $derived.by(() => {
    if (!sorted) return [];
    let at = 0;
    return groups.map((g) => {
      const b = { at, size: g.members.length, letter: g.letter };
      at += g.members.length;
      return b;
    });
  });

  function onMove(ev) {
    const r = view.getBoundingClientRect();
    const col = Math.floor(((ev.clientX - r.left) / r.width) * n);
    const row = Math.floor(((ev.clientY - r.top) / r.height) * n);
    if (col < 0 || row < 0 || col >= n || row >= n) { hover = null; return; }
    const a = order[row], b = order[col];
    const total = R[a * n + b], gp = G[a * n + b];
    const w = wrap.getBoundingClientRect();
    hover = {
      x: ev.clientX - w.left, y: ev.clientY - w.top,
      text: `${labelFor ? labelFor(a) : `#${a}`}\n× ${labelFor ? labelFor(b) : `#${b}`}\n` +
        `link ${total.toFixed(2)} = composition ${gp.toFixed(2)} + shared unknown ${(total - gp).toFixed(2)}`
    };
  }
</script>

<div class="fig-controls">
  <div class="cx-seg" role="group" aria-label="Which part of the link to show">
    <button type="button" class:is-on={part === 'r'} onclick={() => (part = 'r')}>full link</button>
    <button type="button" class:is-on={part === 'g'} onclick={() => (part = 'g')}>composition similarity</button>
    <button type="button" class:is-on={part === 's'} onclick={() => (part = 's')}>shared unknown</button>
  </div>
  <span class="dim">{n} × {n} = {(n * n).toLocaleString()} links</span>
</div>

<div class="hmrow">
  <div class="hmcol">
    <div class="hm" bind:this={wrap} onpointermove={onMove} onpointerleave={() => (hover = null)}
      role="img" aria-label="Heatmap of every pairwise link, {sorted ? 'sorted by group' : 'in shuffled order'}">
      <canvas bind:this={view} width={n} height={n}></canvas>
      {#if sorted && done}
        <svg viewBox="0 0 {n} {n}" preserveAspectRatio="none" class="outl">
          {#each blocks as b}
            {#if b.size >= 3}<rect x={b.at} y={b.at} width={b.size} height={b.size} />{/if}
          {/each}
        </svg>
      {/if}
      {#if hover}<div class="tip" style="left:{hover.x + 14}px; top:{hover.y + 10}px">{hover.text}</div>{/if}
    </div>
    <div class="ramp">
      <span>0</span><i></i><span>1</span>
      <em>{part === 'r' ? 'link: how closely two results are expected to move together' : part === 'g' ? 'the part from compositions being close in the 30 measured dimensions' : 'the part from untested changes both designs make'}</em>
    </div>
  </div>

  <!-- how to read it, with this protein's numbers -->
  <div class="guide">
    <b>How to read it</b>
    <ul>
      <li>Each pixel is one pair of designs: the row’s and the column’s. Bright means the model expects their results to
        move together; dark means they are unrelated.</li>
      <li>A <span class="y">bright square on the diagonal</span> is a group: designs that should succeed or fail
        together, so testing one can speak for all of them.</li>
      <li>Bright patches <i>off</i> the diagonal are separate groups that are still related.</li>
      <li>Dark rows are designs linked to nothing. Each one is its own experiment.</li>
    </ul>
    <b>What it says for {target}</b>
    <ul>
      <li><span class="y">{pct(stats.strong)}</span> of pairs are linked 0.5 or more, and
        <span class="y">{pct(stats.grouped)}</span> of designs sit in a group.
        {stats.bets} of {groups.length} groups are held together mainly by a shared untested reagent.</li>
      <li>More brightness means more overlap. That helps the budget: a few tests cover many designs{#if eff}
        ({n} designs behave like ~{eff.toFixed(1)} independent experiments){/if}. It also concentrates risk: if the
        shared assumption behind a block is wrong, every design in it is wrong together.</li>
      <li>{stats.shared > 0.5
        ? 'So most blocks here are bets on an untested reagent that the first tests will settle.'
        : 'So most blocks here are compositions that look alike; they mostly repeat what the plates already suggest, and the bright squares from untested reagents are the real bets.'}</li>
    </ul>
  </div>
</div>

<style>
  .hmrow { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
  .hmcol { flex: 1 1 300px; max-width: 480px; }
  .hm { position: relative; width: 100%; aspect-ratio: 1; }
  .guide { flex: 1 1 210px; font: 12px/1.5 var(--sans); color: var(--dim); }
  .guide b { display: block; font: 600 11px var(--mono); color: var(--text); text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px; }
  .guide ul { margin: 0 0 12px; padding-left: 16px; list-style: disc; }
  .guide li { margin: 0 0 5px; }
  canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; border: 1px solid var(--line); }
  .outl { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .outl rect { fill: none; stroke: var(--white); stroke-width: 1.2; vector-effect: non-scaling-stroke; opacity: .8; }
  .tip {
    position: absolute; pointer-events: none; z-index: 2; max-width: 300px;
    padding: 6px 9px; border-radius: 4px; background: rgba(10, 12, 16, .95);
    border: 1px solid var(--line); font: 11px/1.45 var(--mono); color: var(--text); white-space: pre-line;
  }
  .ramp { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; font: 10.5px var(--mono); color: var(--faint); flex-wrap: wrap; }
  .ramp i { flex: 0 0 160px; height: 8px; border-radius: 2px; background: linear-gradient(90deg, rgb(14,17,22), rgb(32,68,104), rgb(44,140,170), rgb(92,208,179), rgb(255,216,102)); }
  .ramp em { font-style: normal; flex-basis: 100%; }
  .dim { color: var(--faint); font: 11px var(--mono); }
</style>

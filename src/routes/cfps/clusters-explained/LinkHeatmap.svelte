<script>
  // Chapter 5: every link at once. One pixel per pair, first in submission
  // order (noise), then slid into group order, where the groups appear as
  // bright blocks on the diagonal. Rows and columns move separately each frame:
  // columns are drawn as strips into a scratch canvas, then rows from that.
  import { onMount } from 'svelte';
  import { heatRGB } from './colors.js';
  import { mulberry32, groupColor } from '$lib/clusterMath.js';

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

  // Cluster blocks along the diagonal, once the rows have landed. Numbered in
  // display order; colour follows the export cluster, as in the 3-D views.
  const blocks = $derived.by(() => {
    if (!sorted) return [];
    let at = 0;
    return groups.map((g, k) => {
      const b = { k, num: k + 1, at, size: g.members.length, letter: g.letter, name: g.name, color: groupColor(k) };
      at += g.members.length;
      return b;
    });
  });
  // design → its block, for naming clusters on hover
  const blockOf = $derived.by(() => {
    const m = new Map();
    for (const b of blocks) for (const i of groups[b.k].members) m.set(i, b);
    return m;
  });

  // "Number the clusters": every block outlined in its colour and numbered,
  // with a key beside the matrix. Hovering a key row or a block highlights it.
  let showKey = $state(false);
  let hl = $state(null);
  let hmW = $state(400);
  const u = $derived(n / Math.max(hmW, 1)); // viewBox units per screen pixel
  // Number the blocks big enough to carry a label, without labels colliding.
  const labelled = $derived.by(() => {
    const out = [];
    let lastY = -Infinity;
    for (const b of blocks) {
      const px = b.size / u;
      if (px < 2.5) continue;
      const inside = px >= 22;
      const y = b.at + b.size / 2;
      if (!inside && y - lastY < 11 * u) continue;
      out.push({ ...b, inside, x: inside ? b.at + b.size / 2 : b.at + b.size + 4 * u, y });
      if (!inside) lastY = y;
    }
    return out;
  });

  function onMove(ev) {
    const r = view.getBoundingClientRect();
    const col = Math.floor(((ev.clientX - r.left) / r.width) * n);
    const row = Math.floor(((ev.clientY - r.top) / r.height) * n);
    if (col < 0 || row < 0 || col >= n || row >= n) { hover = null; return; }
    const a = order[row], b = order[col];
    const total = R[a * n + b], gp = G[a * n + b];
    const w = wrap.getBoundingClientRect();
    const ba = blockOf.get(a), bb = blockOf.get(b);
    const where = showKey && sorted
      ? `\n${ba ? `cluster ${ba.num}` : 'no cluster'} × ${bb ? `cluster ${bb.num}` : 'no cluster'}${ba && ba === bb ? ' (inside one block)' : ''}`
      : '';
    if (showKey) hl = ba && ba === bb ? ba.k : null;
    hover = {
      x: ev.clientX - w.left, y: ev.clientY - w.top,
      text: `${labelFor ? labelFor(a) : `#${a}`}\n× ${labelFor ? labelFor(b) : `#${b}`}\n` +
        `link ${total.toFixed(2)} = composition ${gp.toFixed(2)} + shared unknown ${(total - gp).toFixed(2)}${where}`
    };
  }
</script>

<div class="fig-controls">
  <div class="cx-seg" role="group" aria-label="Which part of the link to show">
    <button type="button" class:is-on={part === 'r'} onclick={() => (part = 'r')}>full link</button>
    <button type="button" class:is-on={part === 'g'} onclick={() => (part = 'g')}>composition similarity</button>
    <button type="button" class:is-on={part === 's'} onclick={() => (part = 's')}>shared unknown</button>
  </div>
  {#if sorted}
    <button type="button" class="fig-btn keybtn" class:on={showKey} aria-pressed={showKey}
      onclick={() => { showKey = !showKey; hl = null; }}>{showKey ? '✓ ' : ''}number the clusters</button>
  {/if}
  <span class="dim">{n} × {n} = {(n * n).toLocaleString()} links</span>
</div>

<div class="hmrow">
  <div class="hmcol">
    <div class="hm" bind:this={wrap} bind:clientWidth={hmW} onpointermove={onMove}
      onpointerleave={() => { hover = null; if (showKey) hl = null; }}
      role="img" aria-label="Heatmap of every pairwise link, {sorted ? 'sorted by group' : 'in shuffled order'}">
      <canvas bind:this={view} width={n} height={n}></canvas>
      {#if sorted && done}
        <svg viewBox="0 0 {n} {n}" preserveAspectRatio="none" class="outl" class:keyed={showKey}>
          {#each blocks as b (b.k)}
            {#if showKey}
              <rect x={b.at} y={b.at} width={b.size} height={b.size} class="kb" class:hl={hl === b.k} class:dim={hl != null && hl !== b.k}
                style="stroke:{b.color}" />
            {:else if b.size >= 3}
              <rect x={b.at} y={b.at} width={b.size} height={b.size} />
            {/if}
          {/each}
          {#if showKey && hl != null}
            <!-- crosshair bands through the highlighted cluster's rows and columns -->
            {@const hb = blocks[hl]}
            <rect x="0" y={hb.at} width={n} height={hb.size} class="band" style="fill:{hb.color}" />
            <rect x={hb.at} y="0" width={hb.size} height={n} class="band" style="fill:{hb.color}" />
          {/if}
          {#if showKey}
            {#each labelled as b (b.k)}
              <text x={b.x} y={b.y} font-size={(b.inside ? 11 : 9.5) * u} class="num" class:dim={hl != null && hl !== b.k}
                text-anchor={b.inside ? 'middle' : 'start'} dominant-baseline="central"
                style="fill:{b.inside ? '#0b0d11' : b.color}; stroke:{b.inside ? b.color : '#0b0d11'}; stroke-width:{3 * u}">{b.num}</text>
            {/each}
          {/if}
        </svg>
      {/if}
      {#if hover}<div class="tip" style="left:{hover.x + 14}px; top:{hover.y + 10}px">{hover.text}</div>{/if}
    </div>
    <div class="ramp">
      <span>0</span><i></i><span>1</span>
      <em>{part === 'r' ? 'link: how closely two results are expected to move together' : part === 'g' ? 'the part from compositions being close in the 30 measured dimensions' : 'the part from untested changes both designs make'}</em>
    </div>
  </div>

  {#if showKey && sorted}
    <!-- the cluster key: one row per block, numbered as on the matrix -->
    <div class="guide key">
      <b>Cluster key · {groups.length} clusters</b>
      <p class="keynote">Each outlined block on the diagonal is one cluster: its designs, row against column. Small blocks
        are outlined but too thin to number; hover one, or a row here, to light up its rows and columns.</p>
      <ol>
        {#each blocks as b (b.k)}
          <li class:hl={hl === b.k} onpointerenter={() => (hl = b.k)} onpointerleave={() => (hl = null)}>
            <i style="background:{b.color}"></i><span class="kn">{b.num}</span>
            <span class="kname"><em>{b.letter}</em> {b.name}</span><span class="ks">{b.size}</span>
          </li>
        {/each}
      </ol>
    </div>
  {:else}
  <!-- how to read it, with this protein's numbers -->
  <div class="guide">
    <b>How to read it</b>
    <ul>
      <li>Each pixel is one pair of designs: the row’s and the column’s. Bright means the model expects their results to
        move together; dark means they are unrelated.</li>
      <li>A <span class="y">bright square on the diagonal</span> is a cluster: designs that should succeed or fail
        together, so testing one can speak for all of them.</li>
      <li>Bright patches <i>off</i> the diagonal are separate clusters that are still related.</li>
      <li>Dark rows are designs linked to nothing. Each one is its own experiment.</li>
    </ul>
    <b>What it says for {target}</b>
    <ul>
      <li><span class="y">{pct(stats.strong)}</span> of pairs are linked 0.5 or more, and
        <span class="y">{pct(stats.grouped)}</span> of designs sit in a cluster.
        {stats.bets} of {groups.length} clusters are held together mainly by a shared untested reagent.</li>
      <li>More brightness means more overlap. That helps the budget: a few tests cover many designs{#if eff}
        ({n} designs behave like ~{eff.toFixed(1)} independent experiments){/if}. It also concentrates risk: if the
        shared assumption behind a block is wrong, every design in it is wrong together.</li>
      <li>{stats.shared > 0.5
        ? 'So most blocks here are bets on an untested reagent that the first tests will settle.'
        : 'So most blocks here are compositions that look alike; they mostly repeat what the plates already suggest, and the bright squares from untested reagents are the real bets.'}</li>
    </ul>
  </div>
  {/if}
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
  .outl rect.kb { stroke-width: 1.4; opacity: .95; transition: opacity .15s; }
  .outl rect.kb.hl { stroke-width: 3; opacity: 1; }
  .outl rect.band { stroke: none; opacity: .16; }
  .outl .dim { opacity: .18 !important; }
  .outl .num { font-family: var(--mono); font-weight: 700; paint-order: stroke; stroke-linejoin: round; transition: opacity .15s; }
  .keybtn.on { color: var(--yellow); border-color: var(--yellow); }
  .key .keynote { margin: 0 0 8px; font-size: 11.5px; color: var(--faint); }
  .key ol { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow-y: auto; }
  .key li { display: grid; grid-template-columns: 10px 2.2em 1fr 2.4em; gap: 6px; align-items: center; padding: 2px 4px; border-radius: 3px; cursor: default; }
  .key li.hl { background: var(--fig-2); }
  .key li i { width: 10px; height: 10px; border-radius: 2px; }
  .key .kn { font: 600 11px var(--mono); color: var(--text); text-align: right; }
  .key .kname { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .key .kname em { font: 600 10.5px var(--mono); font-style: normal; color: var(--dim); margin-right: 3px; }
  .key .ks { font: 11px var(--mono); color: var(--faint); text-align: right; }
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

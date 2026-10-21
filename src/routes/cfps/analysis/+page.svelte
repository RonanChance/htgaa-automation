<script>
  import '../blueprint.css';
  import { page } from '$app/state';
  import { loginHref } from '../loginHref.js';

  let { data } = $props();

  const TARGET_COLORS = { sfGFP: 'var(--sfgfp)', PETase: 'var(--petase)', Reteplase: 'var(--reteplase)' };
  const VIEWS = ['all', 'sfGFP', 'PETase', 'Reteplase'];
  const TARGET_ORDER = ['sfGFP', 'PETase', 'Reteplase'];
  // Names shown in a hover before it gets taller than the screen.
  const BULLET_MAX = 12;
  // Blueprint palette only: blue-grey ink for structure, amber for "new",
  // the site's up/down colours (sfgfp green / rust) for direction, target colours for targets.
  const DIR_GLYPH = { up: '↑', down: '↓', add: '+', drop: '−' };
  const DIR_CLASS = { up: 'is-up', add: 'is-up', down: 'is-dn', drop: 'is-dn' };

  let viewKey = $state('all');
  const analysis = $derived(data.analysis);
  const view = $derived(analysis?.views?.[viewKey]);
  const strategyByKey = $derived(Object.fromEntries((view?.strategies ?? []).map((s) => [s.key, s])));
  const moveByKey = $derived(Object.fromEntries((view?.branches ?? []).flatMap((b) => b.moves.map((m) => [m.key, m]))));
  const reagentByKey = $derived(Object.fromEntries((view?.branches ?? []).flatMap((b) => b.reagents.map((r) => [r.key, r]))));

  // ── selection: a person (highlights their reagents) or a node (highlights its people) ──
  let selectedPerson = $state(null); // person key
  let selectedNode = $state(null);   // reagent id or `branch:<key>`
  const personObj = $derived(view?.people.find((p) => p.key === selectedPerson) ?? null);
  const personReagents = $derived(new Set((personObj?.moves ?? []).map((k) => k.split(':')[0])));
  const nodePeople = $derived.by(() => {
    if (!selectedNode || !view) return null;
    if (selectedNode.startsWith('branch:')) {
      const b = view.branches.find((x) => `branch:${x.key}` === selectedNode);
      return new Set((b?.moves ?? []).flatMap((m) => m.people.map((p) => p.key)));
    }
    return new Set((reagentByKey[selectedNode]?.people ?? []).map((p) => p.key));
  });
  $effect(() => {
    // Drop a selection that doesn't exist in the newly picked target view.
    viewKey;
    if (selectedPerson && !view?.people.some((p) => p.key === selectedPerson)) selectedPerson = null;
    if (selectedNode && !selectedNode.startsWith('branch:') && !reagentByKey[selectedNode]) selectedNode = null;
  });

  // ── mind map: grid-snapped schematic ──
  // A controller bar (the hub) sits on the centre line with a bus above and below it.
  // Each lever is a module hung off a bus — header box, then its reagents stacked as
  // chips on a trunk line. Everything lands on a G-unit grid and every wire is
  // orthogonal. Modules are ordered centre-out, so the most-shared levers sit nearest
  // the hub; even ranks go up, odd ranks go down, keeping the two halves balanced.
  const G = 16;
  const COL = 14 * G;          // module pitch
  const MW = 13 * G;           // module width
  const CHIP_X = 2 * G;        // chip inset from the module's left edge (trunk at 1G)
  const CHIP_W = MW - CHIP_X;
  const CHIP_H = 24;
  const MAX_REAGENTS = 6;
  // Levers opened via their "+N more" chip show every reagent; keyed by branch key.
  let expanded = $state({});
  function toggleExpand(key) {
    hideTip();
    expanded = { ...expanded, [key]: !expanded[key] };
  }
  const HUB_W = 18 * G, HUB_H = 4 * G;
  const BUS_Y = 4 * G, HEAD_Y0 = 6 * G, HEAD_Y1 = 8 * G;
  const chipY = (i) => HEAD_Y1 + G + 2 * G * i; // chip centre, measured away from the hub

  function centreOut(n) {
    // Column slots ordered by distance from the middle: e.g. n=5 → [2, 1, 3, 0, 4].
    const mid = (n - 1) / 2;
    return [...Array(n).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  }

  const map = $derived.by(() => {
    if (!view?.branches?.length) return null;
    // The map counts designs (hovers still list the students), so levers and their
    // reagents are ordered by design count too — numbers read largest-first.
    const byDesigns = (a, z) => z.designs - a.designs || z.peopleCount - a.peopleCount;
    const ranked = [...view.branches].sort(byDesigns).map((b) => ({ ...b, reagents: [...b.reagents].sort(byDesigns) }));
    const rows = { top: ranked.filter((_, i) => i % 2 === 0), bottom: ranked.filter((_, i) => i % 2 === 1) };
    const maxRP = Math.max(1, ...ranked.flatMap((b) => b.reagents.slice(0, MAX_REAGENTS).map((r) => r.designs)));
    const modules = [];
    const buses = [];
    let maxCols = 0;
    const depth = { top: 0, bottom: 0 };
    for (const [side, list] of Object.entries(rows)) {
      if (!list.length) continue;
      const sign = side === 'top' ? -1 : 1;
      const n = list.length;
      maxCols = Math.max(maxCols, n);
      const slots = centreOut(n);
      const left0 = -Math.floor((14 * n - 1) / 2) * G;
      const centres = [];
      list.forEach((b, rank) => {
        const left = left0 + slots[rank] * COL;
        const open = !!expanded[b.key];
        const shown = open ? b.reagents : b.reagents.slice(0, MAX_REAGENTS);
        const chips = shown.map((r, i) => ({ ...r, x: left + CHIP_X, y: sign * chipY(i), bar: Math.min(1, r.designs / maxRP) }));
        const more = b.reagents.length - shown.length;
        const toggle = more > 0 || (open && b.reagents.length > MAX_REAGENTS);
        const lastY = chipY(shown.length - 1 + (toggle ? 1 : 0));
        depth[side] = Math.max(depth[side], lastY + CHIP_H / 2);
        centres.push(left + MW / 2);
        modules.push({
          ...b, side, sign, left, cx: left + MW / 2, chips, more, open, toggle,
          head: { y: sign < 0 ? -HEAD_Y1 : HEAD_Y0 },
          trunk: { x: left + G, y0: sign * HEAD_Y1, y1: sign * lastY },
          moreY: toggle ? sign * chipY(shown.length) : null
        });
      });
      buses.push({ side, y: sign * BUS_Y, x0: Math.min(0, ...centres), x1: Math.max(0, ...centres) });
    }
    const halfW = Math.max(HUB_W / 2, Math.ceil((14 * maxCols - 1) / 2) * G) + G / 2;
    const vb = { x: -halfW, y: -(depth.top || HEAD_Y1) - G, w: 2 * halfW, h: (depth.top || HEAD_Y1) + (depth.bottom || HEAD_Y1) + 2 * G };
    return { modules, buses, vb };
  });

  const clipLabel = (s, n = 17) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function nodeDim(key, peopleKeys) {
    if (personObj) {
      if (key.startsWith('branch:')) return !personObj.branches.includes(key.slice(7));
      return !personReagents.has(key);
    }
    if (selectedNode) {
      if (selectedNode === key) return false;
      if (selectedNode.startsWith('branch:') && key.startsWith('branch:')) return true;
      if (selectedNode.startsWith('branch:')) return reagentByKey[key]?.branch !== selectedNode.slice(7);
      return !(peopleKeys ?? []).some((k) => nodePeople?.has(k));
    }
    return false;
  }
  function pickNode(key) {
    hideTip();
    selectedPerson = null;
    selectedNode = selectedNode === key ? null : key;
  }

  // ── tooltip ──
  let tip = $state(null); // { x, y, ...content }
  function showTip(e, content) {
    const pad = 16, w = 330;
    // Rough height, since the card isn't in the DOM yet: a base for the header and
    // stats, plus a row per named contributor. A bullet list of 12 is ~3× the old
    // fixed guess, so without this the card ran off the bottom on lower rows.
    const h = Math.min(
      520,
      150 + (content.bullets ? Math.min(content.bullets.length, BULLET_MAX) + 1 : 0) * 20
        + (content.quotes?.length ?? 0) * 46 + (content.note ? 34 : 0)
    );
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    // Prefer below-right; flip above the cursor when that would overflow, then
    // clamp so the card is always fully on screen.
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    tip = { x, y: Math.max(8, Math.min(y, window.innerHeight - h - 8)), ...content };
  }
  const hideTip = () => (tip = null);
  const names = (people, n = 10) => {
    const list = people.map((p) => p.name ?? p);
    return list.length > n ? `${list.slice(0, n).join(', ')} +${list.length - n}` : list.join(', ');
  };
  const branchLabel = (key) => view?.branches.find((b) => b.key === key)?.label;
  const DIR_ROW = [['up', '↑ Raised'], ['down', '↓ Lowered'], ['add', '+ Added'], ['drop', '− Removed']];
  function reagentTip(r) {
    return {
      kicker: branchLabel(r.branch),
      title: r.name,
      stats: [['Students', r.peopleCount], ['Designs', r.designs], ...(r.magDown ? [['Typical cut', pctDown(r.magDown)]] : []), ...(r.magUp ? [['Typical raise', pctUp(r.magUp)]] : [])],
      list: DIR_ROW.filter(([d]) => r.dirs[d]).map(([d, l]) => [l, `${r.dirs[d]} students`]),
      targets: r.targets,
      quotes: r.quotes,
      people: names(r.people)
    };
  }
  function branchTip(b) {
    return {
      kicker: 'Lever',
      title: b.label,
      note: b.blurb,
      stats: [['Students', b.peopleCount], ['Designs', b.designs], ['Reagents', b.reagents.length]],
      list: b.reagents.slice(0, 7).map((m) => [m.label, `${m.peopleCount} students`])
    };
  }
  function strategyTip(s) {
    return { kicker: 'Approach', title: s.label, note: s.blurb, stats: [['Students', s.peopleCount], ['Designs', s.designs]], quotes: s.quotes, people: names(s.people, 14) };
  }
  function personTip(p) {
    const levers = (view?.branches ?? []).filter((b) => p.branches.includes(b.key)).map((b) => b.label);
    return {
      kicker: p.models.length ? p.models.join(' · ') : 'Student',
      title: p.name,
      stats: [['Designs', p.designs], ['Moves', p.moves.length]],
      targets: p.targets,
      note: levers.length ? `Levers: ${levers.join(', ')}` : null,
      quotes: p.quote ? [{ author: p.name, text: p.quote }] : []
    };
  }

  // ── helpers ──
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const initials = (name) =>
    String(name).split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const maxStrategy = $derived(Math.max(1, ...(view?.strategies ?? []).map((s) => s.peopleCount)));
  const maxVotes = $derived(Math.max(1, ...(analysis?.suggestions ?? []).map((s) => s.votes)));
  const maxModel = $derived(Math.max(1, ...(view?.models ?? []).map((m) => m.designs)));
  // Designs crediting a model but carrying no valid protein target — rare, but they
  // must still occupy their share of the bar or the split would overstate the rest.
  const untargeted = (m) => m.designs - TARGET_ORDER.reduce((n, t) => n + (m.targets[t] || 0), 0);


  // People × lever matrix columns follow the mind-map ranking.
  const matrixBranches = $derived(view?.branches ?? []);
  const branchCount = (p, bkey) => p.moves.filter((k) => moveByKey[k]?.branch === bkey).length;

  // ── edit hotspots (under the map): how often vs how much ──
  // Diverging bars: lowered/removed grow left from a centre axis, raised/added grow right.
  let hotMode = $state('often');
  // The card has its own target picker; it starts on (and follows) the page filter.
  let hotTarget = $state('all');
  $effect(() => { hotTarget = viewKey; });
  const hotView = $derived(analysis?.views?.[hotTarget] ?? view);
  const lowerN = (n) => (n.dirs.down || 0) + (n.dirs.drop || 0);
  const raiseN = (n) => (n.dirs.up || 0) + (n.dirs.add || 0);
  const hotMaxSide = $derived(Math.max(1, ...(hotView?.hotspots?.often ?? []).flatMap((n) => [lowerN(n), raiseN(n)])));
  const hotMaxMag = $derived(Math.max(1.01, ...(hotView?.hotspots?.much ?? []).map((n) => n.mag)));
  // Folds are stored as ≥ 1 for both directions; shown as % change from the starting recipe.
  const pctDown = (f) => `−${Math.round((1 - 1 / f) * 100)}%`;
  const pctUp = (f) => `+${Math.round((f - 1) * 100)}%`;
  const magPct = (m) => (m ? Math.max(4, (100 * Math.log(m)) / Math.log(hotMaxMag)) : 0);

  let mapEl = $state(null);
  function focusPerson(key) {
    // The click scrolls the page to the map, so the pointer never "leaves" the chip /
    // row that opened the popup — close it explicitly or it hangs over the map.
    hideTip();
    selectedNode = null;
    selectedPerson = selectedPerson === key ? null : key;
    mapEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<!-- Any scroll moves content out from under a stationary pointer; drop the popup. -->
<svelte:window onscroll={hideTip} />

<svelte:head>
  <title>Community Mind Map · CFPS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="cfps-page an" data-theme="light">
  <header class="an-top">
    <a class="an-back" href="/cfps">← Designer</a>
    <div class="an-top__title">
      <h1>Community Mind Map</h1>
      {#if view}<span class="an-top__sub">{view.totals.people} students · {view.totals.designs} designs</span>{/if}
    </div>
  </header>

  <main class="an-main">
  {#if data.locked}
    <section class="an-card an-locked">
      <h2>Sign in to see the community</h2>
      <p>Submissions are visible to signed-in participants only.</p>
      <a class="btn-bp" href={loginHref(page.url)}>Sign in</a>
    </section>
  {:else if !view || view.totals.designs === 0}
    <section class="an-card an-locked"><h2>No submissions yet</h2></section>
  {:else}
    <!-- ═════════ 1 · At a glance ═════════ -->
    <section class="an-card an-card--first">
      <div class="an-kpis">
        <div class="an-kpi" role="note" onmousemove={(e) => showTip(e, { kicker: 'Total', title: 'Designs submitted', stats: [['Batches', view.totals.batches], ['Avg changes / design', view.totals.avgMoves]] })} onmouseleave={hideTip}>
          <span>Designs</span><b>{view.totals.designs}</b>
        </div>
        <div class="an-kpi" role="note" onmousemove={(e) => showTip(e, { kicker: 'Total', title: 'Students', note: 'Distinct signed-in students who submitted at least one design.' })} onmouseleave={hideTip}>
          <span>Students</span><b>{view.totals.people}</b>
        </div>
        <div class="an-kpi" role="note" onmousemove={(e) => showTip(e, { kicker: 'AI-assisted', title: `${view.totals.assisted} of ${view.totals.designs} designs`, note: 'Submitted by an agent, or credited to an AI model by the author.' })} onmouseleave={hideTip}>
          <span>AI-assisted</span><b>{pct(view.totals.assisted, view.totals.designs)}<small>%</small></b>
        </div>
      </div>

      {#if viewKey === 'all'}
        <div class="an-bars">
          <div class="an-bar">
            <span class="an-lbl">Targets</span>
            <div class="an-stack">
              {#each Object.entries(view.totals.targets).sort((a, b) => b[1] - a[1]) as [t, n]}
                <div class="an-stack__seg" style="flex:{n};background:{TARGET_COLORS[t]}" role="note"
                  onmousemove={(e) => showTip(e, { kicker: 'Target', title: t, stats: [['Designs', n], ['Share', `${pct(n, view.totals.designs)}%`]] })} onmouseleave={hideTip}>
                  <span>{t} · {n}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </section>

    <!-- ═════════ 2 · Mind map ═════════ -->
    <div class="an-sec-row an-map-bar" bind:this={mapEl}>
      <h2 class="an-sec">Mind map</h2>
      <label class="an-pick">
        <span>Highlight</span>
        <select bind:value={selectedPerson} onchange={() => { selectedNode = null; hideTip(); }}>
          <option value={null}>Everyone</option>
          {#each [...view.people].sort((a, b) => a.name.localeCompare(b.name)) as p}
            <option value={p.key}>{p.name} ({p.designs})</option>
          {/each}
        </select>
      </label>
      {#if selectedPerson || selectedNode}
        <button type="button" class="btn-bp" onclick={() => { selectedPerson = null; selectedNode = null; }}>Clear ✕</button>
      {/if}
      <!-- The page's one protein filter: every section below follows it too. -->
      <div class="an-seg" role="radiogroup" aria-label="Protein target">
        {#each VIEWS as v}
          <button type="button" role="radio" aria-checked={viewKey === v} class:is-on={viewKey === v} onclick={() => (viewKey = v)}
            style={v !== 'all' ? `--dot:${TARGET_COLORS[v]}` : ''}>
            {#if v !== 'all'}<i class="an-dot"></i>{/if}{v === 'all' ? 'All' : v}
            <span class="an-seg__n">{analysis?.views?.[v]?.totals.designs ?? 0}</span>
          </button>
        {/each}
      </div>
    </div>
    <section class="an-card an-card--map">
      {#if map}
        <svg class="an-map" viewBox="{map.vb.x} {map.vb.y} {map.vb.w} {map.vb.h}" role="img" aria-label="Schematic of community approaches">
          <defs>
            <pattern id="an-grid" width={2 * G} height={2 * G} patternUnits="userSpaceOnUse">
              <path d="M {2 * G} 0 L 0 0 0 {2 * G}" fill="none" class="an-gridline" />
            </pattern>
          </defs>
          <rect x={map.vb.x} y={map.vb.y} width={map.vb.w} height={map.vb.h} fill="url(#an-grid)" />

          <!-- buses + hub risers -->
          {#each map.buses as bus}
            <line class="an-wire an-wire--bus" x1={bus.x0} y1={bus.y} x2={bus.x1} y2={bus.y} />
            <line class="an-wire an-wire--bus" x1="0" y1={Math.sign(bus.y) * (HUB_H / 2)} x2="0" y2={bus.y} />
            <rect class="an-joint" x="-3" y={bus.y - 3} width="6" height="6" />
          {/each}

          <!-- modules -->
          {#each map.modules as mod (mod.key)}
            {@const bKey = `branch:${mod.key}`}
            {@const mDim = nodeDim(bKey, null) && mod.chips.every((c) => nodeDim(c.key, c.people.map((p) => p.key)))}
            <g class="an-mod" class:is-dim={mDim}>
              <!-- drop from the bus into the header -->
              <line class="an-wire" x1={mod.cx} y1={mod.sign * BUS_Y} x2={mod.cx} y2={mod.sign * HEAD_Y0} />
              <rect class="an-joint" x={mod.cx - 3} y={mod.sign * BUS_Y - 3} width="6" height="6" />
              <!-- trunk -->
              <line class="an-wire" x1={mod.trunk.x} y1={mod.trunk.y0} x2={mod.trunk.x} y2={mod.trunk.y1} />
            </g>
            <g class="an-node an-head" class:is-dim={mDim} class:is-sel={selectedNode === bKey} role="button" tabindex="0"
              onmousemove={(e) => showTip(e, branchTip(mod))} onmouseleave={hideTip}
              onclick={() => pickNode(bKey)} onkeydown={(e) => e.key === 'Enter' && pickNode(bKey)}>
              <rect x={mod.left} y={mod.head.y} width={MW} height={2 * G} rx="2" />
              <text x={mod.left + 10} y={mod.head.y + G + 4} class="an-head__lbl">{mod.label.toUpperCase()}</text>
              <text x={mod.left + MW - 10} y={mod.head.y + G + 4.5} text-anchor="end" class="an-head__n">{mod.designs}</text>
            </g>
            {#each mod.chips as c (c.key)}
              {@const dim = nodeDim(c.key, c.people.map((p) => p.key))}
              <g class="an-wiregrp" class:is-dim={dim}>
                <line class="an-wire" x1={mod.trunk.x} y1={c.y} x2={c.x} y2={c.y} />
                <rect class="an-joint an-joint--sm" x={mod.trunk.x - 2.5} y={c.y - 2.5} width="5" height="5" />
              </g>
              <g class="an-node an-chip" class:is-dim={dim} class:is-sel={selectedNode === c.key} role="button" tabindex="0"
                onmousemove={(e) => showTip(e, reagentTip(c))} onmouseleave={hideTip}
                onclick={() => pickNode(c.key)} onkeydown={(e) => e.key === 'Enter' && pickNode(c.key)}>
                <rect class="an-chip__box" x={c.x} y={c.y - CHIP_H / 2} width={CHIP_W} height={CHIP_H} rx="2" />
                <rect class="an-chip__tick {DIR_CLASS[c.dir]}" x={c.x} y={c.y - CHIP_H / 2} width="3" height={CHIP_H} />
                <rect class="an-chip__bar" x={c.x + 3} y={c.y + CHIP_H / 2 - 3} width={(CHIP_W - 3) * c.bar} height="3" />
                <text x={c.x + 10} y={c.y + 3.5} class="an-chip__lbl">
                  {clipLabel(c.name, 16)}<tspan class="an-chip__dir {DIR_CLASS[c.dir]}" dx="5">{DIR_GLYPH[c.dir]}</tspan>
                </text>
                <text x={c.x + CHIP_W - 8} y={c.y + 3.5} text-anchor="end" class="an-chip__n">{c.designs}</text>
              </g>
            {/each}
            {#if mod.toggle}
              <g class:is-dim={mDim} class="an-more" role="button" tabindex="0"
                aria-label={mod.open ? `Show fewer ${mod.label} reagents` : `Show all ${mod.label} reagents`}
                onclick={() => toggleExpand(mod.key)} onkeydown={(e) => e.key === 'Enter' && toggleExpand(mod.key)}>
                <line class="an-wire an-wire--dash" x1={mod.trunk.x} y1={mod.moreY} x2={mod.left + CHIP_X} y2={mod.moreY} />
                <rect x={mod.left + CHIP_X} y={mod.moreY - CHIP_H / 2} width={CHIP_W} height={CHIP_H} rx="2" />
                <text x={mod.left + CHIP_X + 10} y={mod.moreY + 3.5}>{mod.open ? '− Show less' : `+${mod.more} more`}</text>
              </g>
            {/if}
          {/each}

          <!-- hub / controller -->
          <g class="an-hub">
            <rect x={-HUB_W / 2} y={-HUB_H / 2} width={HUB_W} height={HUB_H} rx="2" />
            <path class="an-hub__tick" d="M {-HUB_W / 2 + 6} {-HUB_H / 2 + 14} v -8 h 8 M {HUB_W / 2 - 6} {-HUB_H / 2 + 14} v -8 h -8 M {-HUB_W / 2 + 6} {HUB_H / 2 - 14} v 8 h 8 M {HUB_W / 2 - 6} {HUB_H / 2 - 14} v 8 h -8" />
            {#if personObj}
              <text x="0" y="-3" text-anchor="middle" class="an-hub__n an-hub__n--name">{clipLabel(personObj.name, 22)}</text>
              <text x="0" y="17" text-anchor="middle" class="an-hub__l">{personObj.designs} designs · {personObj.moves.length} moves</text>
            {:else}
              <text x="0" y="3" text-anchor="middle" class="an-hub__n">{view.totals.designs}<tspan class="an-hub__unit" dx="7">DESIGNS</tspan></text>
              <text x="0" y="20" text-anchor="middle" class="an-hub__l">{view.totals.people} students{#if viewKey !== 'all'}<tspan class="an-hub__unit" dx="6">{viewKey.toUpperCase()}</tspan>{/if}</text>
            {/if}
          </g>
        </svg>
      {/if}

      {#if nodePeople && selectedNode}
        <div class="an-chips" aria-label="Students behind the selected node">
          {#each view.people.filter((p) => nodePeople.has(p.key)) as p (p.key)}
            <button type="button" class="an-pchip" onclick={() => focusPerson(p.key)}
              onmousemove={(e) => showTip(e, personTip(p))} onmouseleave={hideTip}>
              <i class="an-av">{initials(p.name)}</i>{p.name}
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- ═════════ 2b · Edit hotspots ═════════ -->
    {#if hotView.hotspots?.often?.length}
      <section class="an-card an-hot">
        <div class="an-hot__hd">
          <span class="an-hot__t">{hotMode === 'often' ? 'Most-changed reagents' : 'Size of changes'}</span>
          <span class="an-hot__ctl">
          <div class="an-seg" role="radiogroup" aria-label="Protein target for this chart">
            {#each VIEWS as v}
              <button type="button" role="radio" aria-checked={hotTarget === v} class:is-on={hotTarget === v} onclick={() => (hotTarget = v)}
                style={v !== 'all' ? `--dot:${TARGET_COLORS[v]}` : ''}>
                {#if v !== 'all'}<i class="an-dot"></i>{/if}{v === 'all' ? 'All' : v}
              </button>
            {/each}
          </div>
          <div class="an-seg" role="radiogroup" aria-label="Rank reagents by">
            <button type="button" role="radio" aria-checked={hotMode === 'often'} class:is-on={hotMode === 'often'} onclick={() => (hotMode = 'often')}>How often</button>
            <button type="button" role="radio" aria-checked={hotMode === 'much'} class:is-on={hotMode === 'much'} onclick={() => (hotMode = 'much')}>How much</button>
          </div>
          </span>
        </div>
        <div class="an-hot__cols">
          {#each [0, 1] as col}
            <div class="an-hot__col">
              <div class="an-hot__axis">
                <span></span>
                <span class="is-dn">{hotMode === 'often' ? '← lowered' : '← typical cut'}</span>
                <span class="is-up">{hotMode === 'often' ? 'raised →' : 'typical raise →'}</span>
              </div>
              {#each (hotMode === 'often' ? hotView.hotspots.often : hotView.hotspots.much).slice(col * 6, col * 6 + 6) as n (n.key)}
                <div class="an-hot__row" role="note" onmousemove={(e) => showTip(e, reagentTip(n))} onmouseleave={hideTip}>
                  <span class="an-hot__name">{n.name}</span>
                  <span class="an-hot__side is-dn">
                    {#if hotMode === 'often'}
                      {#if lowerN(n)}<em>{lowerN(n)}</em>{/if}
                      <span class="an-hot__bar" style="width:{(100 * lowerN(n)) / hotMaxSide}%">
                        {#if n.dirs.drop}<i class="is-drop" style="flex:{n.dirs.drop}"></i>{/if}
                        {#if n.dirs.down}<i class="is-down" style="flex:{n.dirs.down}"></i>{/if}
                      </span>
                    {:else}
                      {#if n.magDown}<em>{pctDown(n.magDown)}</em>{/if}
                      <span class="an-hot__bar" style="width:{magPct(n.magDown)}%"><i class="is-down" style="flex:1"></i></span>
                    {/if}
                  </span>
                  <span class="an-hot__side is-up">
                    {#if hotMode === 'often'}
                      <span class="an-hot__bar" style="width:{(100 * raiseN(n)) / hotMaxSide}%">
                        {#if n.dirs.up}<i class="is-up" style="flex:{n.dirs.up}"></i>{/if}
                        {#if n.dirs.add}<i class="is-add" style="flex:{n.dirs.add}"></i>{/if}
                      </span>
                      {#if raiseN(n)}<em>{raiseN(n)}</em>{/if}
                    {:else}
                      <span class="an-hot__bar" style="width:{magPct(n.magUp)}%"><i class="is-up" style="flex:1"></i></span>
                      {#if n.magUp}<em>{pctUp(n.magUp)}</em>{/if}
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
        <div class="an-hot__ft">
          {#if hotMode === 'often'}
            <span class="an-hot__legend">
              <span><i class="is-down"></i><i class="is-up"></i>Changed the amount</span>
              <span><i class="is-drop"></i><i class="is-add"></i>Removed / added entirely</span>
              <span>Counts are students</span>
            </span>
          {:else}
            <span class="an-hot__note">Median % change vs. each design's starting recipe · final concentration for base-buffer reagents · 3+ designs per side</span>
          {/if}
          {#if hotView.hotspots.least.length}
            <span><b>Least edited</b> {hotView.hotspots.least.map((x) => `${x.name} ${x.students}`).join(' · ')}</span>
          {/if}
          {#if hotView.hotspots.untouched.length}
            <span><b>Never touched</b> {hotView.hotspots.untouched.join(' · ')}</span>
          {/if}
        </div>
      </section>
    {/if}

    {#if view.summary?.approaches?.length}
        <details class="an-sum an-sum--solo" open>
          <summary>
            <span class="an-sum__caret" aria-hidden="true">▸</span>
            <span class="an-sum__t">Big picture</span>
            <span class="an-lbl">{viewKey === 'all' ? 'All targets' : viewKey}</span>
          </summary>
          <div class="an-sum__cols">
            <div class="an-sum__col">
              <div class="an-lbl an-sum__h"><b>Round 1</b> · approaches</div>
              <ul>{#each view.summary.approaches as x}<li><b>{x.head}</b><span>{x.body}</span></li>{/each}</ul>
            </div>
            <div class="an-sum__col">
              <div class="an-lbl an-sum__h"><b>Round 2</b> · reagents of interest</div>
              <ul>{#each view.summary.reagents as x}<li><b>{x.head}</b><span>{x.body}</span></li>{/each}</ul>
            </div>
          </div>
        </details>
      {/if}

    <!-- ═════════ 3 · Approaches ═════════ -->
    <h2 class="an-sec">Approaches</h2>
    <section class="an-card">
      <div class="an-strats">
        {#each [...view.strategies].sort((a, b) => b.peopleCount - a.peopleCount) as s (s.key)}
          <div class="an-strat" role="note" onmousemove={(e) => showTip(e, strategyTip(s))} onmouseleave={hideTip}>
            <span class="an-strat__g">{s.glyph}</span>
            <span class="an-strat__lbl">{s.label}</span>
            <b class="an-strat__n">{s.peopleCount}<small>students</small></b>
            <span class="an-strat__bar"><i style="width:{(100 * s.peopleCount) / maxStrategy}%"></i></span>
          </div>
        {/each}
      </div>
    </section>

    <!-- ═════════ 3b · AI usage ═════════ -->
    {#if view.models?.length}
      <div class="an-sec-row">
        <h2 class="an-sec">AI usage</h2>
        <span class="an-sec-sub">
          {view.totals.modelCount} distinct model{view.totals.modelCount === 1 ? '' : 's'} credited across
          {view.totals.credited} of {view.totals.designs} designs{viewKey === 'all' ? '' : ` · ${viewKey}`}
        </span>
        <span class="an-mlegend">
          {#each TARGET_ORDER as t}<span><i style="background:{TARGET_COLORS[t]}"></i>{t}</span>{/each}
        </span>
      </div>
      <section class="an-card">
        <div class="an-models">
          {#each view.models as m (m.label)}
            <div class="an-model" role="note"
              onmousemove={(e) => showTip(e, {
                kicker: m.family === 'Other' ? 'Model' : m.family,
                title: m.label,
                stats: [['Designs', m.designs], ['Students', m.peopleCount]],
                targets: m.targets,
                // Who used this model, busiest first.
                bullets: m.people.map((p) => [p.name, `${p.designs} design${p.designs === 1 ? '' : 's'}`])
              })}
              onmouseleave={hideTip}>
              <span class="an-model__name">{m.label}</span>
              <!-- Bar length = designs; the split inside it = which proteins those
                   designs targeted, in the page's target colours. -->
              <span class="an-model__track">
                <span class="an-model__fill" style="width:{Math.max(2, (100 * m.designs) / maxModel)}%">
                  {#each TARGET_ORDER as t}
                    {#if m.targets[t]}
                      <i style="flex:{m.targets[t]};background:{TARGET_COLORS[t]}"
                        title="{t}: {m.targets[t]} of {m.designs} ({pct(m.targets[t], m.designs)}%)"></i>
                    {/if}
                  {/each}
                  {#if untargeted(m)}<i class="is-none" style="flex:{untargeted(m)}" title="No protein target: {untargeted(m)}"></i>{/if}
                </span>
              </span>
              <b class="an-model__n">{m.designs}</b>
              <span class="an-model__ppl">{m.peopleCount} student{m.peopleCount === 1 ? '' : 's'}</span>
            </div>
          {/each}
        </div>
        <p class="an-foot">
          Counted from each design's <code>metadata.ai_model</code>, which is free text — spellings and
          versions are normalised onto one label per model, so &ldquo;claude-opus-5&rdquo; and &ldquo;Claude Opus 5&rdquo; are
          one row. A design crediting two models counts once for each. Designs naming no model are excluded.
        </p>
      </section>
    {/if}

    <!-- ═════════ 3c · Scientific approach by target ═════════ -->
    {#if data.approaches}
      <div class="an-sec-row">
        <h2 class="an-sec">What each target is testing</h2>
        <span class="an-sec-sub">The scientific approach behind the compositions, per protein</span>
      </div>
      <section class="an-card an-card--appr">
        <div class="an-appr">
          {#each ['sfGFP', 'PETase', 'Reteplase'] as t}
            {@const a = data.approaches[t]}
            {#if a}
              <article class="an-appr__col" style="--tc:{TARGET_COLORS[t]}">
                <header class="an-appr__hd">
                  <span class="an-appr__t"><i class="an-dot" style="--dot:{TARGET_COLORS[t]}"></i>{t}</span>
                  <span class="an-appr__n">{analysis.views?.[t]?.totals.designs ?? 0} designs</span>
                </header>
                <p class="an-appr__note">{a.note}</p>
                <ol class="an-appr__list">
                  {#each a.bullets as b}
                    <li>
                      <div class="an-appr__row"><b>{b.head}</b><span class="an-appr__cnt">~{b.n}</span></div>
                      <span>{b.body}</span>
                    </li>
                  {/each}
                </ol>
                {#if a.niche}<p class="an-appr__niche"><span class="an-lbl">Also tried</span>{a.niche}</p>{/if}
              </article>
            {/if}
          {/each}
        </div>
        <p class="an-foot">
          Written from the hypothesis and comment text on all {analysis.views?.all?.totals.designs ?? 0} designs.
          The &ldquo;~N&rdquo; counts are students, read from those rationales rather than measured from the
          reagent diffs, so treat them as rough. Unlike the rest of this page it doesn't recompute — it
          needs a re-read when the submissions change.
        </p>
      </section>
    {/if}

    <!-- ═════════ 4 · Novel ideas ═════════ -->
    {#if analysis.proposals?.length}
      <h2 class="an-sec"><span class="an-amber">✦</span> Novel ideas</h2>
      <section class="an-card">
        {#if analysis.proposals?.length}
          <div class="an-lbl an-novel__h"><b>Proposed for round 2</b> · requested reagents not stocked yet</div>
          <div class="an-novel">
            {#each analysis.proposals as w (w.id)}
              <div class="an-idea is-prop" role="note"
                onmousemove={(e) => showTip(e, { kicker: `Proposal · ${w.category}`, title: w.name, note: w.description, stats: [['Votes', w.votes], ['Comments', w.comments]], people: w.by ? `Proposed by ${w.by}` : null })}
                onmouseleave={hideTip}>
                <span class="an-lbl an-idea__tag">{w.theme}</span>
                <b class="an-idea__name">{w.short}</b>
                <span class="an-idea__meta">{w.votes} vote{w.votes === 1 ? '' : 's'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <!-- ═════════ 5 · Who's thinking what ═════════ -->
    <h2 class="an-sec">Who's thinking what</h2>
    <section class="an-card an-card--flush">
      <div class="an-matrix-wrap">
        <table class="an-matrix">
          <thead>
            <tr>
              <th class="an-matrix__name">Student</th>
              <th>Targets</th>
              {#each matrixBranches as b (b.key)}
                <th class="an-matrix__b" onmousemove={(e) => showTip(e, branchTip(b))} onmouseleave={hideTip}><span>{b.label}</span></th>
              {/each}
              <th class="an-matrix__s">Approach</th>
            </tr>
          </thead>
          <tbody>
            {#each view.people as p (p.key)}
              <tr class:is-sel={selectedPerson === p.key} onclick={() => focusPerson(p.key)} onmousemove={(e) => showTip(e, personTip(p))} onmouseleave={hideTip}>
                <td class="an-matrix__name"><i class="an-av">{initials(p.name)}</i>{p.name}<small>{p.designs}</small></td>
                <td>
                  {#each ['sfGFP', 'PETase', 'Reteplase'] as t}
                    <span class="an-tdot" style="background:{p.targets[t] ? TARGET_COLORS[t] : 'transparent'};border-color:{TARGET_COLORS[t]}"></span>
                  {/each}
                </td>
                {#each matrixBranches as b (b.key)}
                  {@const n = branchCount(p, b.key)}
                  <td class="an-matrix__c">{#if n}<span class="an-cell" style="--s:{Math.min(1, 0.3 + n * 0.14)}"></span>{/if}</td>
                {/each}
                <td class="an-matrix__s">{#each p.strategies as k}<span title={strategyByKey[k]?.label}>{strategyByKey[k]?.glyph}</span>{/each}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ═════════ 6 · Wishlist ═════════ -->
    {#if analysis.suggestions?.length}
      <div class="an-sec-row">
        <h2 class="an-sec">Wishlist</h2>
        <span class="an-sec-sub">Most-voted reagents to stock</span>
      </div>
      <section class="an-card">
        <div class="an-wish">
          {#each analysis.suggestions as s (s.id)}
            <div class="an-wish__row" role="note"
              onmousemove={(e) => showTip(e, { kicker: s.category, title: s.name, note: s.description, stats: [['Votes', s.votes], ['Comments', s.comments]], people: s.by ? `Proposed by ${s.by}` : null })}
              onmouseleave={hideTip}>
              <span class="an-wish__name">{s.name}</span>
              <span class="an-wish__bar"><i style="width:{Math.max(2, (100 * s.votes) / maxVotes)}%"></i></span>
              <b>{s.votes}</b>
            </div>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
  </main>

  {#if tip}
    <div class="an-tip" style="left:{tip.x}px;top:{tip.y}px">
      <div class="an-tip__hd">
        {#if tip.kicker}<div class="an-lbl">{tip.kicker}</div>{/if}
        <div class="an-tip__t">{tip.title}</div>
      </div>
      <div class="an-tip__body">
        {#if tip.note}<p class="an-tip__note">{tip.note}</p>{/if}
        {#if tip.stats?.length}
          <div class="an-tip__stats">{#each tip.stats as [l, v]}<span><b>{v}</b>{l}</span>{/each}</div>
        {/if}
        {#if tip.targets && Object.keys(tip.targets).length}
          <div class="an-tip__targets">
            {#each Object.entries(tip.targets) as [t, n]}<span style="--dot:{TARGET_COLORS[t]}"><i class="an-dot"></i>{t} {n}</span>{/each}
          </div>
        {/if}
        {#if tip.bullets?.length}
          <ul class="an-tip__bul">
            {#each tip.bullets.slice(0, BULLET_MAX) as [who, much]}
              <li><span>{who}</span><b>{much}</b></li>
            {/each}
            {#if tip.bullets.length > BULLET_MAX}
              <li class="an-tip__bul-more"><span>+{tip.bullets.length - BULLET_MAX} more</span></li>
            {/if}
          </ul>
        {/if}
        {#if tip.list?.length}
          <ul class="an-tip__list">{#each tip.list as [a, b]}<li><span>{a}</span><b>{b}</b></li>{/each}</ul>
        {/if}
        {#each tip.quotes ?? [] as q}
          <blockquote>“{q.text}”<cite>— {q.author}</cite></blockquote>
        {/each}
        {#if tip.people}<div class="an-tip__ppl">{tip.people}</div>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Same ground as /cfps below its intro: dark grey with the faint 38px blueprint grid. */
  .an {
    min-height: 100vh;
    background-color: var(--paper-2);
    background-image:
      linear-gradient(to right, rgba(255, 255, 255, 0.038) 0 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.038) 0 1px, transparent 1px);
    background-size: 38px 38px;
    padding: 0 var(--pad) 80px;
  }
  .an::before { display: none; }
  .an-main { max-width: 1180px; margin: 0 auto; }

  /* ── top bar ── */
  .an-top {
    position: sticky; top: 0; z-index: 20;
    display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
    max-width: 1180px; margin: 0 auto; padding: 18px 0 14px;
    background: linear-gradient(var(--paper-2) 78%, transparent);
  }
  .an-back { font: 500 11.5px/1 var(--mono); color: rgba(255, 255, 255, 0.6); letter-spacing: 0.03em; }
  .an-back:hover { color: #fff; }
  .an-top__title { display: flex; align-items: baseline; gap: 14px; margin-right: auto; }
  .an-top h1 { font: 600 22px/1.1 var(--sans); color: #fff; margin: 0; letter-spacing: -0.015em; }
  .an-top__sub { font: 11px/1 var(--mono); color: rgba(255, 255, 255, 0.6); }
  .an-seg { display: inline-flex; border: 1px solid var(--groove); border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
  .an-seg button {
    display: inline-flex; align-items: center; gap: 6px;
    font: 500 11.5px/1 var(--mono); color: var(--ink-2); background: none; border: 0;
    padding: 7px 12px; cursor: pointer;
  }
  .an-seg button + button { border-left: 1px solid var(--groove); }
  .an-seg button:hover { color: var(--ink); background: #fff; }
  .an-seg button.is-on { background: var(--teal); color: #fff; }
  .an-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }

  /* ── section heads (outside the cards, like "Cell-Free Reaction Designer") ── */
  .an-sec { margin: 34px 0 10px; font: 600 17px/1.15 var(--sans); letter-spacing: -0.015em; color: #fff; }
  .an-sec-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 34px 0 10px; scroll-margin-top: 70px; }
  .an-sec-row .an-sec { margin: 0; }
  .an-sec-sub { font: 11px/1.5 var(--mono); color: rgba(255, 255, 255, 0.6); margin-right: auto; }
  .an-amber { color: var(--amber); fill: var(--amber); }
  .an-lbl { font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }

  .an-card {
    box-sizing: border-box; background: var(--surface-2); border: 1px solid var(--groove);
    border-radius: var(--r); padding: 20px 22px; box-shadow: var(--shadow-2);
  }
  .an-card--first { margin-top: 14px; }
  .an-card--flush { padding: 0; overflow: hidden; }
  .an-card--map { padding: 6px; }
  .an-locked { text-align: center; padding: 60px 30px; margin-top: 30px; }
  .an-locked h2 { font: 600 20px/1.2 var(--sans); margin: 0 0 8px; }
  .an-locked p { color: var(--muted); margin: 0 0 18px; }

  /* edit hotspots — diverging bars around a centre axis */
  .an-hot { margin-top: 12px; padding: 16px 20px; }
  .an-hot__hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .an-hot__t { font: 600 14px/1.2 var(--sans); color: var(--ink); margin-right: auto; }
  .an-hot__ctl { display: inline-flex; gap: 10px; flex-wrap: wrap; }
  .an-hot__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; }
  .an-hot__axis, .an-hot__row { display: grid; grid-template-columns: 120px 1fr 1fr; align-items: center; }
  .an-hot__axis { margin-bottom: 4px; font: 500 9.5px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .an-hot__axis .is-dn { color: var(--rust); text-align: right; padding-right: 8px; }
  .an-hot__axis .is-up { color: var(--sfgfp); padding-left: 8px; }
  .an-hot__row { padding: 3px 0; cursor: default; }
  .an-hot__row:hover .an-hot__name { color: var(--ink); font-weight: 600; }
  .an-hot__name { font: 500 12px/1.2 var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
  .an-hot__side { display: flex; align-items: center; gap: 6px; height: 14px; }
  .an-hot__side.is-dn { justify-content: flex-end; border-right: 1px solid var(--ink-2); padding-right: 0; }
  .an-hot__side.is-up { justify-content: flex-start; }
  .an-hot__bar { display: flex; height: 12px; min-width: 0; }
  .an-hot__bar i, .an-hot__legend i { display: block; height: 100%; }
  .an-hot__side em { font: 600 11px/1 var(--mono); font-style: normal; color: var(--ink-2); white-space: nowrap; }
  .is-up.an-hot__side em, .an-hot__side.is-up em { color: var(--sfgfp); }
  .an-hot__side.is-dn em { color: var(--rust); }
  .an-hot i.is-up { background: var(--sfgfp); }
  .an-hot i.is-add { background: color-mix(in srgb, var(--sfgfp) 45%, #fff); }
  .an-hot i.is-down { background: var(--rust); }
  .an-hot i.is-drop { background: color-mix(in srgb, var(--rust) 45%, #fff); }
  .an-hot__ft {
    display: flex; flex-wrap: wrap; gap: 6px 22px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hair);
    font: 11px/1.5 var(--mono); color: var(--muted);
  }
  .an-hot__ft b { font-weight: 600; color: var(--ink-2); margin-right: 6px; }
  .an-hot__legend { display: inline-flex; flex-wrap: wrap; gap: 6px 18px; }
  .an-hot__legend > span { display: inline-flex; align-items: center; gap: 3px; color: var(--ink-2); }
  .an-hot__legend i { width: 10px; height: 10px; }
  .an-hot__legend i + i { margin-right: 4px; }

  /* big-picture summary (collapsible) */
  .an-sum--solo { margin-top: 12px; box-shadow: var(--shadow-2); border-color: var(--groove); border-radius: var(--r); overflow: hidden; }
  .an-sum { margin-top: 18px; border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--surface); }
  .an-sum summary {
    display: flex; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer; list-style: none; user-select: none;
  }
  .an-sum summary::-webkit-details-marker { display: none; }
  .an-sum summary:hover .an-sum__t { color: var(--ink); }
  .an-sum__caret { font-size: 11px; color: var(--muted); transition: transform 0.15s var(--ease); }
  .an-sum[open] .an-sum__caret { transform: rotate(90deg); }
  .an-sum__t { font: 600 14px/1 var(--sans); color: var(--ink-2); margin-right: auto; }
  .an-sum__cols { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--hair); }
  .an-sum__col { padding: 14px 16px 16px; background: var(--surface-2); }
  .an-sum__col + .an-sum__col { border-left: 1px solid var(--hair); }
  .an-sum__h { margin-bottom: 10px; }
  .an-sum__h b { color: var(--ink); font-weight: 600; }
  .an-sum ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .an-sum li { display: grid; grid-template-columns: 150px 1fr; gap: 12px; align-items: baseline; }
  .an-sum li b { font: 600 12.5px/1.35 var(--sans); color: var(--ink); }
  .an-sum li span { font: 12px/1.45 var(--mono); color: var(--ink-2); }

  /* KPIs */
  .an-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; border: 1px solid var(--hair); border-radius: var(--r-sm); }
  .an-kpi { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; background: var(--surface); cursor: default; }
  .an-kpi + .an-kpi { border-left: 1px solid var(--hair); }
  .an-kpi span { font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  .an-kpi b { font: 600 40px/1 var(--sans); letter-spacing: -0.02em; color: var(--ink); }
  .an-kpi b small { font-size: 22px; margin-left: 2px; color: var(--ink-2); }
  .an-kpi:hover { background: #fff; }

  .an-bars { display: flex; flex-direction: column; gap: 14px; margin-top: 20px; }
  .an-bar { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 6px 14px; }
  .an-stack { display: flex; height: 28px; border-radius: var(--r-sm); overflow: hidden; gap: 1px; background: var(--hair); }
  .an-stack__seg { display: flex; align-items: center; padding: 0 9px; min-width: 5px; overflow: hidden; cursor: default; transition: filter 0.12s; }
  .an-stack__seg:hover { filter: brightness(1.12); }
  .an-stack__seg span { font: 500 11px/1 var(--mono); color: #fff; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }

  /* ── mind map (schematic) ── */
  /* Just the Highlight picker above the map, right-aligned. */
  .an-map-bar { margin-top: 18px; }
  .an-map-bar .an-sec { margin-right: auto; }
  .an-seg__n { font-size: 10px; opacity: 0.65; font-variant-numeric: tabular-nums; }
  .an-pick { display: inline-flex; align-items: center; gap: 8px; font: 500 10px/1 var(--mono); color: rgba(255, 255, 255, 0.6); text-transform: uppercase; letter-spacing: 0.1em; }
  .an-pick select {
    font: 500 11.5px/1 var(--mono); text-transform: none; letter-spacing: 0; color: var(--ink);
    padding: 5px 8px; border: 1px solid var(--groove); border-radius: var(--r-sm); background: var(--surface-2); max-width: 240px;
  }
  /* Always the card's full width — no viewport-height cap, which shrank the map and
     left empty bands either side on shorter screens. */
  .an-map { display: block; width: 100%; height: auto; margin: 0 auto; user-select: none; }
  .an-gridline { stroke: var(--hair); stroke-width: 0.6; opacity: 0.7; }
  .an-wire { stroke: var(--faint); stroke-width: 1.25; fill: none; shape-rendering: crispEdges; }
  .an-wire--bus { stroke: var(--teal); stroke-width: 2; stroke-dasharray: 6 4; animation: an-flow 1.6s linear infinite; }
  .an-wire--dash { stroke-dasharray: 3 3; }
  @keyframes an-flow { to { stroke-dashoffset: -20; } }
  @media (prefers-reduced-motion: reduce) { .an-wire--bus { animation: none; } }
  .an-joint { fill: var(--teal); }
  .an-joint--sm { fill: var(--faint); }
  .an-mod, .an-wiregrp, .an-node, .an-more { transition: opacity 0.18s; }
  .is-dim { opacity: 0.16; }
  .an-node { cursor: pointer; outline: none; }

  .an-head rect { fill: var(--teal); }
  .an-head:hover rect, .an-head.is-sel rect { fill: var(--ink); }
  .an-head__lbl { font: 600 10.5px var(--mono); letter-spacing: 0.1em; fill: #fff; }
  .an-head__n { font: 600 14px var(--sans); fill: #fff; }

  .an-chip__box { fill: #fff; stroke: var(--groove); stroke-width: 1; }
  .an-chip:hover .an-chip__box, .an-chip.is-sel .an-chip__box { stroke: var(--ink); stroke-width: 1.5; }
  .an-chip__tick.is-up { fill: var(--sfgfp); }
  .an-chip__tick.is-dn { fill: var(--rust); }
  .an-chip__bar { fill: var(--teal); opacity: 0.32; }
  .an-chip__lbl { font: 500 11.5px var(--mono); fill: var(--ink); }
  .an-chip__dir { font-weight: 600; }
  .an-chip__dir.is-up { fill: var(--sfgfp); }
  .an-chip__dir.is-dn { fill: var(--rust); }
  .an-chip__n { font: 500 11px var(--mono); fill: var(--muted); }
  .an-more { cursor: pointer; outline: none; }
  .an-more rect { fill: transparent; stroke: var(--groove); stroke-dasharray: 3 3; }
  .an-more text { font: 500 11px var(--mono); fill: var(--muted); }
  .an-more:hover rect, .an-more:focus-visible rect { stroke: var(--ink-2); stroke-dasharray: none; fill: #fff; }
  .an-more:hover text, .an-more:focus-visible text { fill: var(--ink); }

  .an-hub rect { fill: var(--ink); }
  .an-hub__tick { stroke: var(--faint); stroke-width: 1.25; fill: none; }
  .an-hub__n { font: 600 26px var(--sans); fill: #fff; letter-spacing: -0.01em; }
  .an-hub__n--name { font-size: 17px; }
  .an-hub__unit { font: 500 11px var(--mono); letter-spacing: 0.12em; fill: var(--faint); }
  .an-hub__l { font: 500 10px var(--mono); fill: var(--faint); letter-spacing: 0.06em; }

  .an-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 6px 2px; margin-top: 8px; border-top: 1px solid var(--hair); }
  .an-pchip {
    display: inline-flex; align-items: center; gap: 7px; padding: 2px 9px 2px 2px;
    font: 500 11px/1 var(--mono); color: var(--ink-2); background: var(--surface); border: 1px solid var(--hair); border-radius: var(--r-sm); cursor: pointer;
  }
  .an-pchip:hover { border-color: var(--ink-2); color: var(--ink); }
  .an-av {
    display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 2px;
    font: 600 9px/1 var(--mono); font-style: normal; color: var(--teal-ink); background: var(--teal-wash); border: 1px solid var(--groove);
  }

  /* approaches */
  .an-strats { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .an-strat {
    display: grid; grid-template-columns: 32px 1fr auto; grid-template-rows: auto auto; align-items: center; gap: 10px 12px;
    padding: 14px 16px; background: var(--surface); border: 1px solid var(--hair); border-radius: var(--r-sm); cursor: default;
  }
  .an-strat:hover { border-color: var(--groove); background: #fff; }
  .an-strat__g {
    grid-row: span 2; display: grid; place-items: center; width: 32px; height: 32px; box-sizing: border-box;
    font-size: 16px; color: var(--teal-ink); background: var(--surface-2); border: 1px solid var(--hair); border-radius: var(--r-sm);
  }
  .an-strat__lbl { font: 600 14px/1.2 var(--sans); color: var(--ink); }
  .an-strat__n { font: 600 20px/1 var(--sans); color: var(--ink); }
  .an-strat__n { text-align: right; }
  .an-strat__n small { display: block; margin-top: 3px; font: 500 9.5px/1 var(--mono); color: var(--muted); letter-spacing: 0.04em; }
  .an-strat__bar { grid-column: 2 / span 2; height: 3px; background: var(--recess); overflow: hidden; }
  .an-strat__bar i { display: block; height: 100%; background: var(--teal); }

  /* AI usage */
  .an-models { display: flex; flex-direction: column; gap: 7px; }
  .an-model { display: grid; grid-template-columns: minmax(150px, 240px) 1fr 38px 86px; align-items: center; gap: 14px; cursor: default; padding: 2px 0; }
  .an-model__name { font: 500 12px/1.2 var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .an-model:hover .an-model__name { color: var(--ink); }
  .an-model__track { height: 10px; background: var(--recess); overflow: hidden; }
  /* The fill is split by protein target, so each bar shows both how much a model
     was used and what it was used on. 1px gaps keep the segments legible. */
  .an-model__fill { display: flex; height: 100%; gap: 1px; }
  .an-model__fill i { display: block; height: 100%; min-width: 0; }
  .an-model__fill i.is-none { background: var(--faint); }
  .an-mlegend { display: inline-flex; gap: 12px; font: 10.5px/1 var(--mono); color: var(--muted); }
  .an-mlegend span { display: inline-flex; align-items: center; gap: 5px; }
  .an-mlegend i { width: 9px; height: 9px; border-radius: 2px; }
  .an-model__n { font: 600 14px/1 var(--sans); text-align: right; color: var(--ink); }
  .an-model__ppl { font: 10.5px/1 var(--mono); color: var(--muted); text-align: right; }

  /* scientific approach, one column per target */
  .an-card--appr { padding-bottom: 14px; }
  .an-appr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 22px; }
  .an-appr__col { min-width: 0; padding-left: 14px; border-left: 3px solid var(--tc); }
  .an-appr__hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .an-appr__t { display: inline-flex; align-items: center; gap: 7px; font: 600 15px/1.2 var(--sans); color: var(--ink); }
  .an-appr__n { font: 10.5px/1 var(--mono); color: var(--muted); margin-left: auto; }
  .an-appr__note { margin: 0 0 12px; font: 12px/1.5 var(--sans); color: var(--muted); }
  .an-appr__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 11px; counter-reset: ap; }
  .an-appr__list li { display: flex; flex-direction: column; gap: 3px; }
  .an-appr__row { display: flex; align-items: baseline; gap: 8px; }
  .an-appr__row b { font: 600 12.5px/1.3 var(--sans); color: var(--ink); }
  .an-appr__cnt { margin-left: auto; font: 500 10.5px/1 var(--mono); color: var(--muted); white-space: nowrap; }
  .an-appr__list li > span { font: 12px/1.5 var(--sans); color: var(--ink-2); }
  .an-appr__niche { margin: 12px 0 0; padding-top: 9px; border-top: 1px solid var(--hair); font: 11.5px/1.5 var(--sans); color: var(--muted); }
  .an-appr__niche .an-lbl { display: block; margin-bottom: 4px; }
  .an-foot { margin: 14px 0 0; padding-top: 10px; border-top: 1px solid var(--hair); font: 11px/1.6 var(--mono); color: var(--muted); }
  .an-foot code { font-size: 10.5px; color: var(--ink-2); }

  /* novel ideas */
  .an-novel__h { margin: 0 0 10px; }
  .an-novel__h b { color: var(--ink); font-weight: 600; }
  .an-novel { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .an-idea {
    display: flex; flex-direction: column; gap: 6px; padding: 14px 14px 12px;
    background: var(--surface); border: 1px solid var(--hair); border-left: 3px solid var(--groove); border-radius: var(--r-sm); cursor: default;
  }
  .an-idea:hover { background: #fff; border-color: var(--groove); }
  .an-idea.is-prop, .an-idea.is-prop:hover { border-left-color: var(--amber); }
  .an-idea__name { font: 600 17px/1.15 var(--sans); color: var(--ink); }
  .an-idea__meta { font: 11px/1 var(--mono); color: var(--muted); }

  /* matrix */
  .an-matrix-wrap { max-height: 560px; overflow: auto; }
  .an-matrix { border-collapse: separate; border-spacing: 0; width: 100%; font: 500 11.5px/1 var(--mono); }
  .an-matrix thead th {
    position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--groove);
    font: 500 9.5px/1.15 var(--mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); padding: 10px 6px; text-align: center; vertical-align: bottom;
  }
  .an-matrix__b { cursor: default; }
  .an-matrix__b span { display: inline-block; max-width: 76px; color: var(--ink-2); }
  .an-matrix tbody tr { cursor: pointer; }
  .an-matrix tbody tr:hover td { background: var(--surface); }
  .an-matrix tbody tr.is-sel td { background: var(--teal-wash); }
  .an-matrix td { padding: 5px 6px; border-bottom: 1px solid var(--hair); text-align: center; color: var(--ink-2); }
  .an-matrix .an-matrix__name { text-align: left; white-space: nowrap; padding-left: 16px; }
  .an-matrix td.an-matrix__name { color: var(--ink); }
  .an-matrix__name .an-av { margin-right: 9px; vertical-align: middle; }
  .an-matrix__name small { margin-left: 8px; color: var(--faint); }
  .an-tdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid; margin: 0 2px; vertical-align: middle; }
  .an-cell { display: inline-block; width: 14px; height: 14px; border-radius: 2px; background: var(--teal); opacity: var(--s); vertical-align: middle; }
  .an-matrix .an-matrix__s { white-space: nowrap; text-align: left; padding-right: 16px; }
  .an-matrix td.an-matrix__s { letter-spacing: 0.2em; font-size: 12.5px; }

  /* wishlist */
  .an-wish { display: flex; flex-direction: column; gap: 7px; }
  .an-wish__row { display: grid; grid-template-columns: minmax(160px, 260px) 1fr 36px; align-items: center; gap: 14px; cursor: default; padding: 2px 0; }
  .an-wish__name { font: 500 12px/1.2 var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .an-wish__row:hover .an-wish__name { color: var(--ink); }
  .an-wish__bar { height: 10px; background: var(--recess); overflow: hidden; }
  .an-wish__bar i { display: block; height: 100%; background: var(--teal); }
  .an-wish__row b { font: 600 14px/1 var(--sans); text-align: right; color: var(--ink); }

  /* tooltip — the designer's light hover-card: header strip + body */
  .an-tip {
    position: fixed; z-index: 100; width: 330px; box-sizing: border-box; pointer-events: none;
    background: var(--surface-2); border: 1px solid var(--groove); border-radius: var(--r);
    box-shadow: 0 16px 36px -14px rgba(27, 31, 37, 0.45); overflow: hidden;
    max-height: calc(100vh - 16px);
    font: 400 12px/1.5 var(--sans); color: var(--ink-2);
  }
  .an-tip__hd { padding: 10px 14px 9px; background: var(--surface); border-bottom: 1px solid var(--hair); }
  .an-tip__hd .an-lbl { margin-bottom: 5px; }
  .an-tip__t { font: 600 15px/1.2 var(--sans); color: var(--ink); }
  .an-tip__body { padding: 10px 14px 12px; }
  .an-tip__body > :first-child { margin-top: 0; }
  .an-tip__note { margin: 6px 0 0; }
  .an-tip__stats { display: flex; gap: 18px; margin-top: 8px; }
  .an-tip__stats span { display: flex; flex-direction: column; gap: 3px; font: 500 9.5px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .an-tip__stats b { font: 600 17px/1 var(--sans); color: var(--ink); letter-spacing: 0; text-transform: none; }
  .an-tip__targets { display: flex; gap: 12px; margin-top: 9px; font: 500 11px/1 var(--mono); color: var(--ink-2); }
  .an-tip__targets span { display: inline-flex; align-items: center; gap: 5px; }
  /* Named contributors behind a hovered row — a real bulleted list, ranked. */
  .an-tip__bul { list-style: none; margin: 9px 0 0; padding: 0; }
  .an-tip__bul li {
    display: flex; justify-content: space-between; gap: 10px; align-items: baseline;
    padding: 2px 0 2px 11px; position: relative;
    font: 500 11px/1.4 var(--mono); color: var(--ink);
  }
  .an-tip__bul li::before { content: '•'; position: absolute; left: 0; color: var(--faint); }
  .an-tip__bul b { font-weight: 500; color: var(--muted); white-space: nowrap; }
  .an-tip__bul-more { color: var(--muted); font-style: italic; }
  .an-tip__list { list-style: none; margin: 9px 0 0; padding: 0; }
  .an-tip__list li { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-top: 1px solid var(--hair); font: 500 11px/1.3 var(--mono); color: var(--ink); }
  .an-tip__list b { color: var(--muted); font-weight: 500; white-space: nowrap; }
  .an-tip blockquote { margin: 9px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--groove); color: var(--ink-2); font-style: italic; }
  .an-tip cite { display: block; margin-top: 3px; font: 500 10px/1 var(--mono); font-style: normal; color: var(--muted); }
  .an-tip__ppl { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--hair); font: 500 10.5px/1.5 var(--mono); color: var(--muted); }

  @media (max-width: 800px) {
    .an-hot__cols { grid-template-columns: 1fr; }
    .an-appr { grid-template-columns: 1fr; gap: 20px; }
    .an-model { grid-template-columns: minmax(110px, 1fr) 1fr 32px; }
    .an-mlegend { width: 100%; }
    .an-model__ppl { display: none; }
    .an-sum__cols { grid-template-columns: 1fr; }
    .an-sum__col + .an-sum__col { border-left: 0; border-top: 1px solid var(--hair); }
    .an-sum li { grid-template-columns: 1fr; gap: 2px; }
    .an-card { padding: 16px; }
    .an-bar { grid-template-columns: 1fr; }
  }
</style>

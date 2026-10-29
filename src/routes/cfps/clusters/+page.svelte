<script>
  // Round-1 planner. The CFPS Arena model (Clinton Monteiro's export_clusters.js)
  // groups the submitted designs into hypotheses it expects to succeed or fail
  // together. This page turns that into a decision you can actually make: which
  // hypotheses to test, how deeply, what it costs in wells — then exports the
  // four plates.
  //
  // The budget is the point. sfGFP alone has 365 scheduled runs against 320
  // wells, so something has to give, and every change re-counts wells,
  // participants represented and hypotheses covered at once.
  //
  // Styling follows the rest of /cfps (blueprint.css, light). The model's own
  // dark heatmap view answers "why is this a group" and is one click away,
  // unchanged — this page deliberately doesn't try to re-render it.
  import '../blueprint.css';
  import { page } from '$app/state';
  import { loginHref } from '../loginHref.js';
  import {
    PLATES_PER_TARGET, PER_PLATE, REPLICATES, ROWS, COLS, RESERVED_COLS,
    slotWell, placementFor, plateKey
  } from '../plateMap.js';

  let { data } = $props();

  const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];
  const COLOR = { sfGFP: 'var(--sfgfp)', PETase: 'var(--petase)', Reteplase: 'var(--reteplase)' };
  const CAPACITY = PLATES_PER_TARGET * PER_PLATE; // 320 designs × 4 replicates

  let target = $state('sfGFP');
  let showArena = $state(false);
  let query = $state('');
  let sort = $state('odds');
  let busy = $state(false);
  let notice = $state('');

  const plan = $derived(data.plan?.targets?.[target] ?? null);

  // Per group: 0 = off, 1 = first run, 2 = + check runs, 3 = every arm.
  let depth = $state({});
  let takeIndependents = $state(true);
  let takeSweeps = $state(true);

  const groupsOf = () => data.plan?.targets?.[target]?.groups ?? [];
  // `depth[letter]` is how many of the group's arms to run — a plain count, so
  // you can sit anywhere between the checks and the whole group. The named
  // stops below are shortcuts onto that same number.
  const checksStop = (g) => Math.min(g.size, 1 + g.checks);
  const stopsFor = (g) => [
    { label: 'Off', n: 0 },
    { label: 'First', n: 1 },
    ...(g.checks ? [{ label: '+Checks', n: checksStop(g) }] : []),
    { label: 'All', n: g.size }
  ];
  const countAt = (g, n) => Math.max(0, Math.min(g.size, n ?? 0));
  const designsAt = (g, n) => g.designs.slice(0, countAt(g, n));
  const setDepth = (letter, n) => (depth = { ...depth, [letter]: n });
  // True only between the named stops — the state you can only reach with ±.
  const isCustom = (g, n) => n > 0 && !stopsFor(g).some((s) => s.n === n);
  const nudge = (g, by) => setDepth(g.letter, countAt(g, (depth[g.letter] ?? 0) + by));

  function applyPreset(kind) {
    const next = {};
    for (const g of groupsOf()) {
      next[g.letter] =
        kind === 'none' ? 0 : kind === 'first' ? 1 : kind === 'all' ? g.size : checksStop(g);
    }
    depth = next;
    takeIndependents = kind === 'model' || kind === 'all';
    takeSweeps = kind === 'model' || kind === 'all';
    notice = '';
  }
  // Seed from the model's own plan, and re-seed when the target changes.
  $effect(() => {
    target;
    if (data.plan) applyPreset('model');
  });

  // Everything chosen, in plate order: grouped arms first so a hypothesis lands
  // together, then the loose runs.
  const selected = $derived.by(() => {
    if (!plan) return [];
    const out = [];
    for (const g of plan.groups) {
      // Carry the hypothesis onto each design so a well can say what it tests.
      designsAt(g, depth[g.letter] ?? 0).forEach((d, i) => out.push({
        ...d,
        group: g.letter,
        groupName: g.name + (g.also ? ` · plus ${g.also}` : ''),
        // designsAt is ordered first run → checks → rest, so position is the role.
        why: i === 0 ? 'the group’s first run — tests what every design in it shares'
          : i <= g.checks ? 'a check run — probes the ingredient the model thinks matters'
            : 'another arm of the group'
      }));
    }
    if (takeIndependents) {
      out.push(...plan.independents.map((d) => ({
        ...d, group: null, groupName: 'Independent run',
        why: 'in no group — nothing else on the plates predicts it'
      })));
    }
    if (takeSweeps) {
      out.push(...plan.sweepRuns.map((d) => ({
        ...d, group: null, groupName: 'Sweep run',
        why: 'one ingredient varied across a series, to measure a curve'
      })));
    }
    return out;
  });

  // Co-submitters of an identical recipe share the well and are credited on the
  // exported plate, so they count as represented too.
  const authorsSelected = $derived(
    new Set(selected.flatMap((d) => [d.author, ...(d.coAuthors ?? [])]).filter(Boolean)).size
  );
  const hypothesesOn = $derived(plan ? plan.groups.filter((g) => (depth[g.letter] ?? 0) > 0).length : 0);
  const over = $derived(Math.max(0, selected.length - CAPACITY));
  const pct = $derived(Math.min(100, Math.round((selected.length / CAPACITY) * 100)));

  const rows = $derived.by(() => {
    if (!plan) return [];
    const q = query.trim().toLowerCase();
    const best = (g) => Math.max(...g.designs.map((d) => d.pBeat ?? 0), 0);
    return plan.groups
      .filter((g) => !q || `${g.letter} ${g.name} ${g.also ?? ''} ${g.matters.join(' ')}`.toLowerCase().includes(q))
      .toSorted((a, b) =>
        sort === 'size' ? b.size - a.size
          : sort === 'link' ? b.averageLink - a.averageLink
            : sort === 'letter' ? a.letter.localeCompare(b.letter)
              : best(b) - best(a));
  });

  // Plate preview, laid out exactly as the export will.
  const layout = $derived.by(() => {
    const plates = [];
    for (let i = 0; i < PLATES_PER_TARGET; i++) {
      const chunk = selected.slice(i * PER_PLATE, (i + 1) * PER_PLATE);
      const occupied = new Set();
      const bySlot = new Map();
      for (const d of chunk) {
        const w = placementFor(plateKey(target, i), d.id, occupied);
        if (!w) break;
        for (const s of w) { occupied.add(s); bySlot.set(s, d); }
      }
      plates.push({ index: i + 1, wells: bySlot, n: chunk.length });
    }
    return plates;
  });

  // Alert categories, worst first. The warnings share one yellow→amber ramp so
  // severity reads at a glance on the plate; a contract error is red because it
  // is a different kind of problem, not a worse warning.
  const ALERT_CATS = [
    { id: 'error', label: 'Contract error', fill: '#eeb0b0', edge: '#cf8585' },
    { id: 'energy', label: 'No energy substrate', fill: '#eda93c', edge: '#c0831f' },
    { id: 'high', label: 'Far above the reference', fill: '#f5c75a', edge: '#cc9e2e' },
    { id: 'missing', label: 'Reference reagent not dosed', fill: '#fadf90', edge: '#d9b85b' },
    { id: 'low', label: 'Far below the reference', fill: '#fcefc4', edge: '#dcc98a' }
  ];
  const catOf = (d) => ALERT_CATS.find((c) => d?.alerts?.some((a) => a.cat === c.id)) ?? null;
  // Only the categories actually on these plates get a legend entry.
  // What the plates actually hold. Over capacity `selected` runs past 320, so
  // the alert list has to count these, not the selection, or it would report
  // alerts for designs that never made it onto a plate.
  const placed = $derived.by(() => {
    const seen = new Map();
    for (const p of layout) for (const d of p.wells.values()) seen.set(d.id, d);
    return [...seen.values()];
  });
  const legend = $derived.by(() => {
    const on = new Set(placed.flatMap((d) => (d.alerts ?? []).map((a) => a.cat)));
    return ALERT_CATS.filter((c) => on.has(c.id));
  });

  // Every alert the chosen designs carry, grouped by what tripped. These are
  // the relaxed 'site' checks from the designer (see $lib/cfpsRangeChecks.js),
  // computed server-side because recipes never reach the browser.
  const alertGroups = $derived.by(() => {
    const by = new Map();
    for (const d of placed) {
      for (const a of d.alerts ?? []) {
        const key = `${a.kind}:${a.component ?? a.text}`;
        if (!by.has(key)) by.set(key, { kind: a.kind, component: a.component, text: a.text, designs: [] });
        by.get(key).designs.push(d);
      }
    }
    return [...by.values()].sort((x, y) =>
      (x.kind === 'error' ? 0 : 1) - (y.kind === 'error' ? 0 : 1) || y.designs.length - x.designs.length);
  });
  const flaggedDesigns = $derived(placed.filter((d) => d.alerts?.length).length);
  let openAlert = $state(null);

  // Replacing the model from the browser — the same two files
  // `npm run clusters:publish` sends. The button only exists for allowlisted
  // accounts (see clusterAdmin.js); the endpoint checks again.
  const PUBLISHED_ID = 'published';
  let fileInput = $state(null);
  let uploading = $state(false);
  let uploadNote = $state('');
  let uploadErr = $state(false);
  let busyModel = $state(false);
  // Server list by default; a mutation swaps in the response until the reload.
  let modelsOverride = $state(null);
  const models = $derived(modelsOverride ?? data.models ?? []);
  const activeId = $derived(models.find((m) => m.active)?.id ?? PUBLISHED_ID);

  function noteFrom(e) {
    uploadErr = true;
    uploadNote = e.message;
  }

  // Switching version changes what every signed-in participant sees, so the
  // page reloads onto the new plan rather than mixing the two.
  async function activateModel(id) {
    if (id === activeId) return;
    busyModel = true;
    uploadErr = false;
    uploadNote = '';
    try {
      const res = await fetch('/cfps/clusters/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || `switch failed (${res.status})`);
      modelsOverride = out.models;
      uploadNote = 'Switched. Reloading…';
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      noteFrom(e);
      modelsOverride = [...models]; // snap the <select> back to the real active row
    } finally {
      busyModel = false;
    }
  }

  async function removeModel(id) {
    busyModel = true;
    uploadErr = false;
    uploadNote = '';
    try {
      const res = await fetch('/cfps/clusters/models', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || `delete failed (${res.status})`);
      modelsOverride = out.models;
      uploadNote = 'Deleted.';
    } catch (e) {
      noteFrom(e);
    } finally {
      busyModel = false;
    }
  }

  async function onPickModel(ev) {
    const files = [...(ev.currentTarget.files ?? [])];
    ev.currentTarget.value = ''; // let the same file be re-picked after a failure
    if (!files.length) return;
    const body = new FormData();
    // Match by filename so the order you shift-select them in doesn't matter.
    const designs = files.find((f) => /designs/i.test(f.name));
    const clusters = files.find((f) => f !== designs && /clusters/i.test(f.name));
    if (!designs) {
      uploadErr = true;
      uploadNote = 'Pick clusters_designs.json (and optionally clusters.json.gz).';
      return;
    }
    body.append('designs', designs);
    if (clusters) body.append('clusters', clusters);

    uploading = true;
    uploadErr = false;
    uploadNote = '';
    try {
      const res = await fetch('/cfps/clusters/upload', { method: 'POST', body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || `upload failed (${res.status})`);
      uploadNote = `Live: ${out.designs} designs, ${out.groups} groups. Reloading…`;
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      noteFrom(e);
    } finally {
      uploading = false;
    }
  }

  // Plain-language definitions for the jargon in the model write-up. Two
  // sentences each: enough to follow the argument, not a statistics lesson.
  const TERMS = {
    gp: ['Gaussian process regression',
      'A curve-fit that also reports its own confidence. It predicts a recipe’s yield from how close that recipe sits to wells Ginkgo actually ran, and the further away you get, the wider the error bars it returns.'],
    plates: ['Ginkgo’s control plates',
      'The reference experiment this is all fitted to: 78 recipes per protein, each varying one ingredient at a time, on a single lysate and template. A 384-well and a 96-well plate, fitted separately.'],
    lhc: ['Latin hypercube',
      'A way of sampling a many-ingredient space evenly with few points — each ingredient’s range is cut into equal slices and every slice is used exactly once. It covers the space far better than picking at random.'],
    ppg: ['Price per gram',
      'Recipe cost ÷ predicted yield, the number everything is ranked on. The cost half is exact; only the yield half is predicted.'],
    crash: ['Crash risk',
      'For an ingredient the plates never ran, the model can’t predict an effect, so it assigns a chance the reaction fails outright. That figure is an assumption from the ingredient’s type, not a measurement.'],
    linked: ['Linked designs',
      'Two designs are linked when the model’s prediction errors for them would move together — so if it is wrong about one, it is wrong about both. Strongly linked designs form a group.'],
    untested: ['Never on a Ginkgo plate',
      'An ingredient absent from the control plates, so the regression has nothing to learn from: PEG-8000, maltodextrin-17, DsbC, glutathione. The model can only price these, not predict their effect.'],
    sweep: ['Sweep run',
      'A set of submitted designs identical but for one ingredient, run together to measure that ingredient’s actual yield curve instead of a single point.'],
    stretched: ['Past the plates’ range',
      'An ingredient Ginkgo did test, but the design uses more or less of it than any well they ran. The model extrapolates, so its error bars widen.'],
    refdesigns: ['Pan-Ox-SP and RF-opt',
      'Two published starting recipes, alongside Ginkgo’s own, that the control plates were built from. The plates varied each of their ingredients one at a time.']
  };
  const TERM_W = 320;
  let term = $state(null);
  function showTerm(ev, key) {
    const r = ev.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - TERM_W - 8));
    const above = r.bottom + 170 > window.innerHeight && r.top > 170;
    term = { key, left, top: above ? r.top - 6 : r.bottom + 6, above };
  }
  const hideTerm = () => (term = null);

  // Row hover: the science behind a grouping, short enough to say out loud.
  const GRP_W = 360;
  let gHover = $state(null);
  function showGroup(ev, g) {
    const r = ev.currentTarget.getBoundingClientRect();
    const left = Math.min(r.left + 40, window.innerWidth - GRP_W - 8);
    const above = r.bottom + 230 > window.innerHeight && r.top > 230;
    gHover = { g, left, top: above ? r.top - 6 : r.bottom + 6, above };
  }
  const hideGroup = () => (gHover = null);
  const nlRange = (r) => (!r ? '' : r[0] === r[1] ? `${r[0]} nL` : `${r[0]}–${r[1]} nL`);

  // Well hover. Fixed-position so the card never reflows the plate grid.
  const POP_W = 330;
  let hover = $state(null);
  function showWell(ev, entry) {
    const r = ev.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - POP_W / 2, window.innerWidth - POP_W - 8));
    const above = r.bottom + 210 > window.innerHeight && r.top > 210;
    hover = { ...entry, left, top: above ? r.top - 6 : r.bottom + 6, above };
  }
  const hideWell = () => (hover = null);

  const pctFmt = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  // Share of a group's link that comes from an ingredient no Ginkgo plate ran.
  const betShare = (g) => Math.round((g.fromUntested / Math.max(g.averageLink, 0.01)) * 100);

  async function exportBatch() {
    busy = true;
    notice = '';
    try {
      const res = await fetch('/cfps/clusters/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, designIds: selected.map((d) => d.id) })
      });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const { batch, summary } = await res.json();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }));
      a.download = `cfps-round1-${target}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      notice = `Exported ${summary.plates} plates · ${summary.placed} designs · ${summary.wells} wells · ${summary.authors} participants`
        + (summary.overCapacity ? ` · ${summary.overCapacity} didn’t fit` : '')
        + (summary.skipped.length ? ` · ${summary.skipped.length} skipped` : '');
    } catch (e) {
      notice = e.message;
    } finally {
      busy = false;
    }
  }

  // The model's own dark view, loaded on demand.
  let arenaLoaded = false;
  $effect(() => {
    if (!showArena || arenaLoaded) return;
    arenaLoaded = true;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/cfps/clusters-data/clusters.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/cfps/clusters-data/clusters_page.js';
    document.body.appendChild(s);
  });
</script>

<svelte:head><title>Round-1 planner · CFPS</title></svelte:head>

{#snippet t(key)}<button type="button" class="cl-term"
  onmouseenter={(ev) => showTerm(ev, key)} onmouseleave={hideTerm}
  onfocus={(ev) => showTerm(ev, key)} onblur={hideTerm}>{TERMS[key][0]}</button>{/snippet}

<div class="cfps-page cl" data-theme="light">
  <header class="cl-top">
    <div class="cl-top__left"><a class="cl-back" href="/cfps">← Designer</a></div>
    <div class="cl-top__mid">
      <h1>Round-1 planner</h1>
      <p class="cl-sub">
        The model groups the submitted designs into hypotheses it expects to succeed or fail
        together. Choose which to test and how deeply — {CAPACITY} designs fit per protein
        ({PLATES_PER_TARGET} plates × {PER_PLATE}, {REPLICATES} replicates each).
      </p>
    </div>
    <div class="cl-hdr-right">
      {#if data.plan}<div class="cl-built">built {new Date(data.plan.built).toLocaleDateString()}</div>{/if}
      <a class="cl-back" href="/cfps/clusters-explained">how the model chose these →</a>
      {#if data.canUpload}
        <a class="cl-back" href="#the-model">manage model ↓</a>
      {/if}
    </div>
  </header>

  <main class="cl-main">
    {#if data.locked}
      <section class="cl-card cl-locked">
        <h2>Sign in to see the round-1 planner</h2>
        <p>It names every submitted design and its author, so it’s for signed-in participants.</p>
        <a class="btn-bp" href={loginHref(page.url)}>Sign in</a>
      </section>
    {:else if !plan}
      <section class="cl-card cl-locked">
        <h2>Cluster data unavailable</h2>
        <p>Publish an export with <code>npm run clusters:publish -- --apply</code>.</p>
      </section>
    {:else}

      <div class="cl-stick">
      <nav class="cl-tabs" aria-label="Protein target">
        <span class="cl-tabs__lbl">Target</span>
        {#each TARGETS as t}
          <button type="button" class="cl-tab" class:is-on={target === t}
            style={target === t ? `border-color:${COLOR[t]};color:${COLOR[t]};` : ''}
            onclick={() => (target = t)}>{t}</button>
        {/each}
        <span class="cl-tabs__spacer"></span>
        <button type="button" class="btn-bp" disabled={busy || !selected.length} onclick={exportBatch}>
          {busy ? 'Building…' : `↓ Export ${target} plates`}
        </button>
      </nav>

      <section class="cl-card">
        <div class="cl-meters">
          <div class="cl-meter">
            <span>Wells used</span>
            <b class:is-over={over > 0}>{selected.length}<i>/{CAPACITY}</i></b>
            <div class="cl-bar"><div class="cl-bar__fill" class:is-over={over > 0} style="width:{pct}%"></div></div>
            <small>{over ? `${over} over — trim a hypothesis` : `${CAPACITY - selected.length} free`}</small>
          </div>
          <div class="cl-meter">
            <span>Participants represented</span>
            <b>{authorsSelected}<i>/{plan.authors}</i></b>
            <div class="cl-bar"><div class="cl-bar__fill cl-bar__fill--alt" style="width:{Math.round((authorsSelected / plan.authors) * 100)}%"></div></div>
            <small>of everyone who submitted for {target}</small>
          </div>
          <div class="cl-meter">
            <span>Hypotheses covered</span>
            <b>{hypothesesOn}<i>/{plan.groups.length}</i></b>
            <div class="cl-bar"><div class="cl-bar__fill cl-bar__fill--alt" style="width:{Math.round((hypothesesOn / plan.groups.length) * 100)}%"></div></div>
            <small>each one is a question the plates would answer</small>
          </div>
        </div>
        <div class="cl-presets">
          <span>Start from</span>
          <button type="button" class="btn-bp" onclick={() => applyPreset('model')}>Model’s plan</button>
          <button type="button" class="btn-bp" onclick={() => applyPreset('first')}>One run each</button>
          <button type="button" class="btn-bp" onclick={() => applyPreset('all')}>Every arm</button>
          <button type="button" class="btn-bp" onclick={() => applyPreset('none')}>Clear</button>
          {#if notice}<span class="cl-notice">{notice}</span>{/if}
        </div>
      </section>
      </div>

      <section class="cl-card">
        <div class="cl-hd">
          <h2>Hypotheses</h2>
          <div class="cl-filters">
            <input class="cl-search" type="search" placeholder="search a hypothesis or reagent…" bind:value={query} />
            <select class="cl-sel" bind:value={sort}>
              <option value="odds">best odds first</option>
              <option value="size">most designs first</option>
              <option value="link">tightest group first</option>
              <option value="letter">by letter</option>
            </select>
          </div>
        </div>
        <ul class="cl-note cl-keys">
          <li><b>First</b> — runs the group’s best-odds design on its own, which tests only what every
            design in the group shares.</li>
          <li><b>+Checks</b> — adds the arms that probe whichever ingredient the model thinks is doing
            the work inside the group.</li>
          <li><b>All</b> — runs every arm in the group.</li>
          <li><b>Shared bet</b> — how much of the group’s link comes from an ingredient
            <i>no Ginkgo plate ever ran</i>. High means the grouping is a real bet these plates would
            settle; low means it already rests on measured recipe similarity.</li>
        </ul>
        <div class="cl-tablewrap">
          <table class="cl-table">
            <thead>
              <tr>
                <th>Hypothesis</th><th>Designs</th><th>People</th>
                <th title="The model's best odds of beating Ginkgo's control in this group">Best odds</th>
                <th title="Share of the group's link that comes from an ingredient no Ginkgo plate ran">Shared bet</th>
                <th>Depth</th><th>Wells</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as g (g.letter)}
                {@const d = depth[g.letter] ?? 0}
                {@const take = countAt(g, d)}
                {@const people = new Set(designsAt(g, d).map((x) => x.author)).size}
                <tr class:is-off={take === 0}>
                  <td>
                    <button type="button" class="cl-letter cl-letter--btn"
                      aria-label="What hypothesis {g.letter} tests"
                      onmouseenter={(ev) => showGroup(ev, g)} onmouseleave={hideGroup}
                      onfocus={(ev) => showGroup(ev, g)} onblur={hideGroup}>{g.letter}</button><b>{g.name}</b>
                    {#if g.also}<span class="cl-also">plus {g.also}</span>{/if}
                    {#if g.matters.length}<small>matters: {g.matters.join(', ')}</small>{/if}
                  </td>
                  <td>{g.size}</td>
                  <td>{people || '—'}</td>
                  <td>{pctFmt(Math.max(...g.designs.map((x) => x.pBeat ?? 0), 0))}</td>
                  <td><span class="cl-dot" style="opacity:{Math.max(0.12, betShare(g) / 100)}"></span>{betShare(g)}%</td>
                  <td>
                    <div class="cl-depth" role="group" aria-label="How many arms of group {g.letter} to run">
                      {#each stopsFor(g) as stop}
                        <button type="button" class:is-on={take === stop.n}
                          title="{stop.n} of {g.size} arms"
                          onclick={() => setDepth(g.letter, stop.n)}>{stop.label}</button>
                      {/each}
                      <button type="button" class="cl-step" disabled={take === 0}
                        aria-label="One fewer arm of group {g.letter}" onclick={() => nudge(g, -1)}>−</button>
                      <button type="button" class="cl-step" disabled={take === g.size}
                        aria-label="One more arm of group {g.letter}" onclick={() => nudge(g, 1)}>+</button>
                    </div>
                  </td>
                  <td class="cl-wells">
                    <span class="cl-arms" class:is-part={isCustom(g, take)}>{take}/{g.size}</span>
                    {take ? take * REPLICATES : '—'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="cl-card">
        <h2>Runs outside the groups</h2>
        <div class="cl-loose">
          <label class="cl-toggle">
            <input type="checkbox" bind:checked={takeIndependents} />
            <div>
              <b>Independent runs · {plan.independents.length}</b>
              <small>
                In no group, so nothing else on the plates predicts them —
                {new Set(plan.independents.map((d) => d.author)).size} participants,
                {plan.independents.length * REPLICATES} wells.
              </small>
            </div>
          </label>
          <label class="cl-toggle">
            <input type="checkbox" bind:checked={takeSweeps} />
            <div>
              <b>Sweep runs · {plan.sweepRuns.length}</b>
              <small>
                Submitted one-ingredient series that measure a curve rather than a point —
                {plan.sweeps.filter((s) => s.recommended).length} ingredients recommended,
                {plan.sweepRuns.length * REPLICATES} wells.
              </small>
            </div>
          </label>
        </div>
      </section>

      <section class="cl-card">
        <h2>{target} — the four plates</h2>
        <p class="cl-note">
          Columns 1–4 stay empty for Ginkgo’s standards and controls. Each design takes four
          non-touching wells. This is the layout the export produces.
        </p>
        <ul class="cl-legend">
          <li><span class="cl-key" style="background:#cfe3d6; border-color:#8fbca3;"></span>no alerts</li>
          {#each legend as c}
            <li><span class="cl-key" style="background:{c.fill}; border-color:{c.edge};"></span>{c.label}</li>
          {/each}
          <li><span class="cl-key cl-key--res"></span>reserved</li>
        </ul>
        <div class="cl-plates">
          {#each layout as p}
            <figure class="cl-plate">
              <figcaption>Plate {p.index}<small>{p.n}/{PER_PLATE}</small></figcaption>
              <div class="cl-grid" style="grid-template-columns: repeat({COLS}, 1fr);">
                {#each Array(ROWS) as _, r}
                  {#each Array(COLS) as _2, c}
                    {@const reserved = RESERVED_COLS.includes(c + 1)}
                    {@const slot = (c - RESERVED_COLS.length) * ROWS + r}
                    {@const d = reserved ? null : p.wells.get(slot)}
                    {#if d}
                      {@const cat = catOf(d)}
                      <button type="button" class="cl-well is-on" class:is-flagged={!!cat}
                        style={cat ? `background:${cat.fill}; border-color:${cat.edge};` : null}
                        aria-label="{slotWell(slot)} · {d.name}{cat ? ` · ${cat.label}` : ''}"
                        onmouseenter={(ev) => showWell(ev, { ...d, plate: p.index, slot })}
                        onmouseleave={hideWell}
                        onfocus={(ev) => showWell(ev, { ...d, plate: p.index, slot })}
                        onblur={hideWell}></button>
                    {:else}
                      <div class="cl-well" class:is-res={reserved}
                        title={reserved ? 'reserved for standards / controls' : `${slotWell(slot)} · empty`}></div>
                    {/if}
                  {/each}
                {/each}
              </div>
            </figure>
          {/each}
        </div>
      </section>

      <section class="cl-card">
        <h2>Alerts on these plates</h2>
        <p class="cl-note">
          The same checks the designer runs on a submission, against the relaxed site
          ranges — a flag here means a recipe is <i>highly concerning</i>, not merely
          off the reference. Nothing is blocked: this is what you would be signing off on.
        </p>
        {#if !alertGroups.length}
          <p class="cl-ok">✓ No alerts — all {placed.length} designs on the plates sit inside the ranges.</p>
        {:else}
          <p class="cl-note cl-note--tight">
            <b>{flaggedDesigns}</b> of the {placed.length} designs on the plates trip
            <b>{alertGroups.length}</b> distinct {alertGroups.length === 1 ? 'check' : 'checks'}
            — {flaggedDesigns * REPLICATES} wells.
            {#if selected.length > placed.length}
              <span class="cl-over">({selected.length - placed.length} selected designs don’t fit and aren’t counted.)</span>
            {/if}
          </p>
          <ul class="cl-alerts">
            {#each alertGroups as a (a.kind + (a.component ?? a.text))}
              {@const key = a.kind + (a.component ?? a.text)}
              <li class:is-err={a.kind === 'error'}>
                <button type="button" class="cl-alert__hd"
                  aria-expanded={openAlert === key}
                  onclick={() => (openAlert = openAlert === key ? null : key)}>
                  <span class="cl-alert__n">{a.designs.length}</span>
                  <span class="cl-alert__txt">{a.text}</span>
                  <span class="cl-alert__chev">{openAlert === key ? '−' : '+'}</span>
                </button>
                {#if openAlert === key}
                  <ol class="cl-alert__list">
                    {#each a.designs as d (d.id)}
                      <li>
                        <b>{d.name}</b>
                        <small>{d.author ?? 'unknown author'} · {d.group ? `hypothesis ${d.group}` : d.groupName}</small>
                      </li>
                    {/each}
                  </ol>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="cl-card" id="the-model">
        <div class="cl-hd">
          <h2>The model</h2>
          {#if data.canUpload}
            <div class="cl-models">
              <label class="cl-models__lbl" for="cl-model">Version</label>
              <select id="cl-model" class="cl-sel" disabled={busyModel} value={activeId}
                onchange={(e) => activateModel(e.currentTarget.value)}>
                {#each models as m}
                  <option value={m.id}>
                    {m.label}{m.designs ? ` · ${m.designs} designs` : ''}{m.active ? ' — live' : ''}
                  </option>
                {/each}
              </select>
              <button type="button" class="btn-bp cl-upload" disabled={uploading || busyModel}
                onclick={() => fileInput?.click()}>
                {uploading ? 'Uploading…' : '↑ Upload a new model'}
              </button>
              {#if activeId !== PUBLISHED_ID}
                <button type="button" class="cl-del" disabled={busyModel}
                  title="Delete this version (switch to another one first)"
                  onclick={() => removeModel(activeId)}>✕</button>
              {/if}
              <input class="cl-file" type="file" accept=".json,.gz" multiple
                bind:this={fileInput} onchange={onPickModel} />
            </div>
          {/if}
        </div>
        {#if uploadNote}<p class="cl-note cl-upnote" class:is-err={uploadErr}>{uploadNote}</p>{/if}

        <p class="cl-note cl-note--tight">
          Built by <b>Clinton Monteiro</b>. Everything on this page is the model’s
          <i>prediction</i>, made before any class design has been run — round 1 is what checks it.
        </p>

        <div class="cl-mdl">
          <div>
            <h3>Where the numbers come from</h3>
            <ul class="cl-note cl-keys">
              <li><b>Price is exact</b> — each recipe’s cost is the sum of its ingredients at
                Ginkgo’s listed reagent prices.</li>
              <li><b>Yield is predicted</b> by a {@render t('gp')} fitted to
                {@render t('plates')} — 78 recipes per protein built from Ginkgo’s own design plus
                {@render t('refdesigns')}, varied one ingredient at a time on a single lysate and
                template. 30 ingredients were varied.</li>
              <li><b>{@render t('ppg')}</b> is cost ÷ predicted yield, and is what every ranking
                here uses.</li>
            </ul>
          </div>
          <div>
            <h3>What it can’t see</h3>
            <ul class="cl-note cl-keys">
              <li>Ingredients {@render t('untested')} get priced but not predicted — the regression
                has nothing to learn from.</li>
              <li>For those the model adds extra uncertainty and a {@render t('crash')}, set by the
                ingredient’s type rather than measured.</li>
              <li>The control plates weren’t large enough to show where the price/output curve
                bends, so the curves are close to straight lines carrying roughly 2–3× uncertainty.</li>
            </ul>
          </div>
          <div>
            <h3>How groups form</h3>
            <ul class="cl-note cl-keys">
              <li>Designs are {@render t('linked')} when the model expects them to succeed or fail
                together — because they share an untested change, or because the recipes are close.</li>
              <li><b>What matters</b> inside a group comes from a second, simpler regression: ≥160
                virtual recipes drawn across the group’s range with a {@render t('lhc')}, scored for
                price per gram, then regressed on the ingredients.</li>
              <li>That second regression runs on the model’s <i>own predictions</i>, not lab data —
                which is precisely what round 1 is there to test.</li>
            </ul>
          </div>
          <div>
            <h3>What round 1 buys</h3>
            <ul class="cl-note cl-keys">
              <li>A {@render t('sweep')} turns an ingredient the model can only price into a measured
                yield curve. Several may come out flat — still a win, because it means you can cut
                them back on cost.</li>
              <li>Cluster runs test whether a group really moves together, and which way each
                ingredient pushes it.</li>
              <li>Independent designs sit in no group, so each one is its own data point.</li>
              <li>Results — the sweeps especially — go back into the regression. That is the
                round-2 model.</li>
            </ul>
          </div>
        </div>

        <h3>What the class added</h3>
        <p class="cl-note cl-note--tight">
          Ginkgo’s plates are a thorough map of a narrow space: 30 ingredients, one at a time, one
          lysate, one template. Almost everything interesting is outside it, and that is the part
          the submissions bought.
        </p>
        <div class="cl-contrib">
          <div><b>76%</b><small>of the 1,600 submitted designs change something the plates
            cannot answer — a reagent never run, or one pushed {@render t('stretched')}. The
            other 24% sit inside tested space, where the model can already predict them: cheap
            to run, but they buy less.</small></div>
          <div><b>23</b><small>reagents introduced that <i>no</i> Ginkgo plate ever ran — PEG-8000,
            Maltodextrin&nbsp;17, DsbC, both glutathiones, Brij-35, DMSO, pyruvate oxidase and
            16 more. Against Ginkgo’s 30, the class roughly doubled the ingredient space.</small></div>
          <div><b>29</b><small>more reagents pushed past the range the plates covered, from ATP and
            magnesium glutamate to the amino-acid mix — turning single tested points into
            an actual range.</small></div>
          <div><b>57</b><small>one-ingredient sweeps across 31 ingredients, submitted as deliberate
            series. Each one converts an ingredient the model can only price into a measured
            yield curve.</small></div>
        </div>
        <ul class="cl-note cl-keys">
          <li><b>Every hypothesis on this page is someone’s submission.</b> The 219 groups aren’t
            the model’s inventions — it only grouped what 108 participants proposed. Without the
            submissions there is nothing to cluster and round 1 is just Ginkgo’s plates again.</li>
          <li><b>The duplicates are a finding, not waste.</b> 169 designs are byte-identical to
            another participant’s, which is independent convergence on the same idea from people
            reading the same papers — a signal about where the field’s attention sits, and the
            reason the planner credits co-submitters rather than dropping them.</li>
        </ul>

        <h3>What that means for this export</h3>
        <p class="cl-note cl-note--tight">
          Reading the numbers currently loaded, the three proteins are not asking the same kind of
          question, which is worth knowing before you trust a grouping:
        </p>
        <div class="cl-tablewrap">
          <table class="cl-table cl-mdl__tbl">
            <thead>
              <tr><th>Target</th><th>Groups</th><th>Resting on an untested reagent</th>
                <th>Pure recipe similarity</th><th>What the bet is on</th></tr>
            </thead>
            <tbody>
              <tr><td><b>Reteplase</b></td><td>54</td><td>34 (63%)</td><td>15</td>
                <td>Mostly one wager: DsbC, GSSG and GSH, none ever on a plate.</td></tr>
              <tr><td><b>PETase</b></td><td>79</td><td>22 (28%)</td><td>38</td>
                <td>Split — the same folding package, plus carbon and energy changes.</td></tr>
              <tr><td><b>sfGFP</b></td><td>86</td><td>21 (24%)</td><td>62 (72%)</td>
                <td>Mostly interpolation inside tested space; Maltodextrin 17 and PEG-8000 lead.</td></tr>
            </tbody>
          </table>
        </div>
        <ul class="cl-note cl-keys">
          <li><b>Reteplase round 1 is largely a single question.</b> Nearly two thirds of its groups
            hold together because of the redox/folding package, so one result moves a lot of the
            board at once — high information, but correlated risk.</li>
          <li><b>sfGFP is the opposite, and that argues for caution.</b> 72% of its groups rest on
            recipes merely looking alike rather than a shared unknown, so a group holding together
            tells you less. This matches Clinton’s own warning that the sfGFP check runs are the
            noisiest — the <b>Shared bet</b> column above is where you can see it per group.</li>
        </ul>

        <p class="cl-note">
          Source: <a class="cl-link" href="https://pages.htgaa.org/2026b/clinton-monteiro/week-4.5/cfps-clusters/index.html"
            target="_blank" rel="noopener">the clusters view</a> and
          <a class="cl-link" href="https://pages.htgaa.org/2026b/clinton-monteiro/week-3/cfps-arena/index.html"
            target="_blank" rel="noopener">the CFPS Arena calculator</a> (test your design tab).
        </p>
      </section>

      <section class="cl-card">
        <div class="cl-hd">
          <h2>Why these are groups</h2>
          <button type="button" class="btn-bp" onclick={() => (showArena = !showArena)}>
            {showArena ? 'Hide' : 'Show'} the model’s heatmaps
          </button>
        </div>
        <p class="cl-note">
          The full CFPS Arena analysis — group-against-group links, per-group maps and the predicted
          sweep curves — exactly as the model produced it.
        </p>
        {#if showArena}
          <div id="cfps-arena" class="cfa cl-arena"><p>Loading the CFPS Clusters…</p></div>
        {/if}
      </section>
    {/if}
  </main>

  <!-- Inside .cl so the blueprint variables resolve; position:fixed still lifts
       it out of the plate grid, so hovering never reflows the page. -->
  {#if term}
    <div class="cl-pop cl-pop--term" class:cl-pop--above={term.above} role="tooltip"
      style="top:{term.top}px; left:{term.left}px; width:{TERM_W}px;">
      <b>{TERMS[term.key][0]}</b>
      <p>{TERMS[term.key][1]}</p>
    </div>
  {/if}

  {#if gHover}
    {@const g = gHover.g}
    <div class="cl-pop cl-pop--grp" class:cl-pop--above={gHover.above} role="tooltip"
      style="top:{gHover.top}px; left:{gHover.left}px; width:{GRP_W}px;">
      <span class="cl-pop__hd"><span class="cl-letter">{g.letter}</span><b>{g.name}</b></span>
      <dl class="cl-sci">
        <dt>Holds together</dt>
        <dd>
          {Math.round(g.averageLink * 100)}% average similarity, weakest pair {Math.round(g.weakestLink * 100)}% —
          {betShare(g)}% of that is a reagent <i>no Ginkgo plate ever ran</i>, the rest is recipes that already look alike.
        </dd>
        {#if g.drivers.length}
          <dt>What drives it</dt>
          <dd>
            {#each g.drivers as i, n}{n ? ' · ' : ''}<b>{i.name}</b> ({i.strength}{i.rangeNl ? `, ${nlRange(i.rangeNl)}` : ''}){/each}
            {#if g.explains != null}
              <br />Single reagents explain {Math.round(g.explains * 100)}% of the spread across
              {g.virtualRecipes} modelled recipes{g.explains < 0.6 ? ' — the rest is interactions, so one-at-a-time reads will mislead' : ''}.
            {/if}
          </dd>
        {/if}
        {#if g.checkRunsInfo.length}
          <dt>What the checks settle</dt>
          <dd>
            {#each g.checkRunsInfo as c}
              <span class="cl-sci__chk"><b>{c.ingredient}</b> {c.from} → {c.nL} nL · {c.gain}% new</span>
            {/each}
          </dd>
        {/if}
        <dt>If it works</dt>
        <dd>
          best arm has a {pctFmt(Math.max(...g.designs.map((x) => x.pBeat ?? 0), 0))} chance of beating Ginkgo's
          control; {g.size} arms from {new Set(g.designs.map((x) => x.author).filter(Boolean)).size} participants.
        </dd>
      </dl>
    </div>
  {/if}

  {#if hover}
    <div class="cl-pop" class:cl-pop--above={hover.above} role="tooltip"
      style="top:{hover.top}px; left:{hover.left}px; width:{POP_W}px;">
      <span class="cl-pop__hd">
        {#if hover.group}<span class="cl-letter">{hover.group}</span>{/if}
        <b>{hover.groupName}</b>
      </span>
      <small>{hover.why}</small>
      <p>{hover.name}</p>
      <small>
        {hover.author ?? 'unknown author'}
        {#if hover.coAuthors?.length}
          · with {hover.coAuthors.join(', ')} <i>(identical recipe, shared well)</i>
        {/if}
      </small>
      <small>plate {hover.plate} · {slotWell(hover.slot)} · {REPLICATES} replicates
        {#if hover.pBeat != null} · {pctFmt(hover.pBeat)} to beat Ginkgo{/if}</small>
      {#if hover.alerts?.length}
        {@const cat = catOf(hover)}
        <div class="cl-pop__alerts" style="background:{cat.fill}33; border-color:{cat.edge};">
          <b class="cl-pop__cat"><span class="cl-key" style="background:{cat.fill}; border-color:{cat.edge};"></span>{cat.label}</b>
          <ul>{#each hover.alerts as a}<li>{a.text}</li>{/each}</ul>
        </div>
      {/if}
      {#if hover.tries}<p class="cl-pop__tries">{hover.tries}</p>{/if}
    </div>
  {/if}
</div>

<style>
  /* No background here on purpose: blueprint.css paints the page — black
     through the first viewport, fading to --paper-2, with the faint grid below
     it — and the cards sit on top of that. (This rule used to say
     `background: var(--bg)`, a token blueprint.css doesn't define, so it was
     transparent by accident rather than by intent.) */
  .cl { min-height: 100vh; color: var(--ink); }
  .cl-top {
    display: grid; grid-template-columns: 1fr minmax(0, auto) 1fr; align-items: start; gap: 20px;
    padding: 22px 26px 16px; border-bottom: 1px solid var(--hair); background: var(--surface);
  }
  .cl-top__mid { text-align: center; }
  .cl-top__mid .cl-sub { margin-inline: auto; }
  /* The rails hold the back link and the model controls; the title stays
     centred on the page whether or not the controls are there. */
  .cl-top__left { justify-self: start; }
  .cl-back { font: 11px var(--mono); color: var(--muted); text-decoration: none; }
  .cl-back:hover { color: var(--ink); }
  .cl-top h1 { font: 600 22px/1.2 var(--sans); margin: 0 0 4px; }
  .cl-sub { font: 11px/1.6 var(--mono); color: var(--muted); margin: 0; max-width: 88ch; }
  .cl-built { font: 10px var(--mono); color: var(--muted); }
  .cl-hdr-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; justify-self: end; }

  @media (max-width: 900px) {
    .cl-top { grid-template-columns: 1fr; }
    .cl-top__mid { text-align: left; }
    .cl-hdr-right { align-items: flex-start; justify-self: start; }
  }
  .cl-upload { font-size: 11px; }
  .cl-models { display: flex; align-items: center; gap: 6px; }
  .cl-models__lbl {
    font: 10px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  }
  .cl-models .cl-sel { max-width: 30ch; }
  .cl-del {
    font: 11px var(--mono); line-height: 1; padding: 5px 7px; cursor: pointer;
    background: var(--surface); color: var(--muted);
    border: 1px solid var(--hair); border-radius: 4px;
  }
  .cl-del:hover:not(:disabled) { color: var(--err, #b4453c); border-color: #e0b4b4; }
  .cl-del:disabled { opacity: .4; cursor: default; }
  .cl-file { display: none; }
  .cl-upnote { max-width: 34ch; text-align: right; }
  .cl-upnote.is-err { color: var(--err, #b4453c); }
  .cl-main { max-width: 1240px; margin: 0 auto; padding: 18px 26px 80px; display: grid; gap: 16px; }
  .cl-card { border: 1px solid var(--hair); border-radius: var(--r, 5px); background: var(--surface); padding: 16px 18px; }
  /* The pinned tabs+meters block is ~210px tall, so anchor jumps have to clear
     it or they land underneath. */
  .cl-main [id] { scroll-margin-top: 220px; }
  .cl-card h2 { font: 600 14px/1.2 var(--sans); margin: 0 0 6px; }
  .cl-hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .cl-note { font: 11px/1.65 var(--mono); color: var(--muted); margin: 0 0 10px; max-width: 94ch; }
  /* Tailwind's preflight strips ul markers, so set them back explicitly
     (and never lay the list out with grid — that drops them again). */
  ul.cl-note { padding-left: 16px; list-style: disc; }
  .cl-keys li { margin: 0 0 3px; }
  .cl-keys b { color: var(--ink-2); }
  .cl-locked { text-align: center; padding: 60px 30px; }

  /* Target tabs and the budget meters travel together: you change the target
     or a preset and want to watch wells/participants move without scrolling
     back. Sticking them as one block stops the two cards overlapping. */
  /* The page behind this is a black→grey gradient, so no solid colour would
     match it at every scroll position. Instead the block is opaque by
     construction: the two cards butt together with no gap and it pins flush to
     the viewport edge, leaving nothing for content to show through. */
  .cl-stick {
    position: sticky; top: 0; z-index: 30; display: grid; gap: 0; padding: 0;
  }
  .cl-stick > * { border-radius: 0; }
  .cl-stick > :first-child { border-radius: var(--r, 5px) var(--r, 5px) 0 0; }
  .cl-stick > :last-child { border-radius: 0 0 var(--r, 5px) var(--r, 5px); }
  .cl-stick > * + * { border-top: 0; }
  .cl-stick > :last-child { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); }
  .cl-tabs {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 12px; background: var(--surface); border: 1px solid var(--hair);
    border-radius: var(--r, 5px); box-shadow: 0 4px 16px rgba(27, 31, 37, 0.1);
  }
  .cl-tabs__lbl { font: 9px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .cl-tabs__spacer { flex: 1; }
  .cl-tab {
    font: 600 12px var(--sans); padding: 6px 13px; border: 1px solid var(--hair);
    border-radius: var(--r, 5px); background: var(--surface); color: var(--muted); cursor: pointer;
  }
  .cl-tab.is-on { background: var(--surface); border-width: 2px; }

  .cl-meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 18px; }
  .cl-meter > span { font: 9px var(--mono); text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .cl-meter b { display: block; font: 600 24px var(--sans); margin: 1px 0 5px; }
  .cl-meter b.is-over { color: #a3392a; }
  .cl-meter i { font: 400 13px var(--mono); color: var(--muted); font-style: normal; }
  .cl-meter small { display: block; font: 10px var(--mono); color: var(--muted); margin-top: 4px; }
  .cl-bar { height: 5px; background: var(--recess); border: 1px solid var(--hair); border-radius: 3px; overflow: hidden; }
  .cl-bar__fill { height: 100%; background: #2f8f4e; }
  .cl-bar__fill--alt { background: #6b7480; }
  .cl-bar__fill.is-over { background: #a3392a; }
  .cl-presets {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hair);
  }
  .cl-presets > span { font: 9px var(--mono); text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .cl-notice { font: 11px var(--mono); color: var(--ink-2); }

  .cl-filters { display: flex; gap: 7px; }
  .cl-search, .cl-sel {
    font: 11px var(--mono); padding: 5px 9px; border: 1px solid var(--hair);
    border-radius: 4px; background: var(--surface); color: var(--ink);
  }
  .cl-search { min-width: 220px; }

  .cl-tablewrap { overflow: auto; max-height: 620px; border: 1px solid var(--hair); border-radius: 4px; }
  .cl-table { width: 100%; border-collapse: collapse; font: 11px var(--mono); }
  .cl-table th {
    position: sticky; top: 0; background: var(--surface); text-align: left; padding: 7px 9px;
    border-bottom: 1px solid var(--hair); font: 9.5px var(--mono); text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); z-index: 1; white-space: nowrap;
  }
  .cl-table td { padding: 6px 9px; border-bottom: 1px solid var(--hair-2, #eef0f2); vertical-align: middle; }
  .cl-table tr.is-off { opacity: .45; }
  .cl-table td b { font: 600 11px var(--mono); }
  .cl-table td small { display: block; color: var(--muted); font-size: 10px; margin-top: 1px; }
  .cl-also { color: var(--muted); font: 11px var(--mono); margin-left: 6px; white-space: nowrap; }
  .cl-letter {
    display: inline-block; min-width: 2.4em; margin-right: 6px; padding: 1px 5px; text-align: center;
    font: 600 10px var(--mono); background: var(--surface); border: 1px solid var(--hair); border-radius: 3px;
  }
  /* The letter is the handle for the science card, so it has to look hoverable. */
  .cl-letter--btn { cursor: help; color: var(--ink-2); }
  .cl-letter--btn:hover, .cl-letter--btn:focus-visible {
    background: var(--ink); color: var(--surface); border-color: var(--ink); outline: none;
  }
  .cl-wells { text-align: right; font-variant-numeric: tabular-nums; }
  .cl-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: #cf6320; margin-right: 5px; vertical-align: middle;
  }

  .cl-arms {
    display: inline-block; min-width: 4.2em; margin-right: 7px; text-align: right;
    color: var(--muted); font-size: 10px;
  }
  /* Partway between the named stops — the state the +/- steppers reach. */
  .cl-arms.is-part { color: #a8651f; font-weight: 600; }
  .cl-step { font-weight: 600; padding-inline: 6px; }
  .cl-depth button:disabled { opacity: .35; cursor: default; }

  .cl-pop--grp, .cl-pop--term { pointer-events: none; }

  /* Jargon the write-up can't avoid; the definition is one hover away so the
     prose doesn't have to stop and explain itself. */
  .cl-term {
    font: inherit; color: var(--ink-2); background: none; border: 0; padding: 0;
    border-bottom: 1px dotted var(--groove); cursor: help;
  }
  .cl-term:hover, .cl-term:focus-visible {
    color: var(--teal-ink); border-bottom-style: solid; border-bottom-color: var(--teal); outline: none;
  }
  /* Two columns, so four blocks sit 2×2 rather than 3+1 with a hole. */
  .cl-mdl { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 4px 28px; }
  .cl-mdl h3, .cl-card h3 {
    font: 600 9px var(--mono); letter-spacing: .08em; text-transform: uppercase;
    color: var(--muted); margin: 12px 0 5px;
  }
  .cl-mdl__tbl td { font: 11px/1.5 var(--mono); color: var(--ink-2); vertical-align: top; }
  .cl-contrib {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
    gap: 12px 28px; margin: 2px 0 10px;
  }
  .cl-contrib > div { display: flex; gap: 10px; align-items: baseline; }
  .cl-contrib b { font: 600 21px/1 var(--sans); color: var(--ink); flex: none; min-width: 2.4em; }
  .cl-contrib small { font: 10.5px/1.5 var(--mono); color: var(--muted); }
  .cl-link { color: var(--teal-ink); text-decoration: underline; text-underline-offset: 2px; }
  .cl-sci { margin: 7px 0 0; font: 10px/1.5 var(--mono); }
  .cl-sci dt {
    font: 600 9px var(--mono); letter-spacing: .06em; text-transform: uppercase;
    color: var(--muted); margin-top: 7px;
  }
  .cl-sci dt:first-child { margin-top: 0; }
  .cl-sci dd { margin: 2px 0 0; color: var(--ink-2); }
  .cl-sci b { font-weight: 600; }
  .cl-sci__chk { display: block; }

  .cl-depth { display: inline-flex; border: 1px solid var(--hair); border-radius: 4px; overflow: hidden; }
  .cl-depth button {
    font: 10px var(--mono); padding: 3px 8px; border: 0; border-right: 1px solid var(--hair);
    background: var(--surface); color: var(--muted); cursor: pointer; white-space: nowrap;
  }
  .cl-depth button:last-child { border-right: 0; }
  .cl-depth button.is-on { background: var(--ink); color: #fff; }
  .cl-depth button:disabled { opacity: .3; cursor: not-allowed; }

  .cl-loose { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px; }
  .cl-toggle { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
  .cl-toggle input { margin-top: 3px; flex: none; }
  .cl-toggle b { font: 600 11px var(--mono); }
  .cl-toggle small { display: block; font: 10px/1.55 var(--mono); color: var(--muted); margin-top: 2px; }

  .cl-plates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  @media (max-width: 760px) { .cl-plates { grid-template-columns: minmax(0, 1fr); } }
  .cl-plate figcaption { display: flex; justify-content: space-between; font: 600 11px var(--sans); margin-bottom: 5px; }
  .cl-plate figcaption small { font: 10px var(--mono); color: var(--muted); }
  .cl-grid { display: grid; gap: 1px; }
  .cl-well { aspect-ratio: 1; border: 1px solid var(--hair); border-radius: 1px; background: var(--surface); min-width: 0; }
  .cl-well.is-on { background: #cfe3d6; border-color: #8fbca3; }
  .cl-well.is-res { background: repeating-linear-gradient(45deg, #eceff2, #eceff2 2px, #f6f7f9 2px, #f6f7f9 4px); }
  /* Filled wells are buttons so they answer to keyboard focus as well as hover. */
  button.cl-well { padding: 0; cursor: help; }
  button.cl-well:hover, button.cl-well:focus-visible {
    background: #9ecbb2; border-color: #4f8f6c; outline: none;
  }
  /* The inline colour wins over the hover rule, so flag the well with an outline. */
  button.cl-well.is-flagged:hover, button.cl-well.is-flagged:focus-visible {
    outline: 2px solid var(--ink); outline-offset: -1px;
  }

  .cl-pop {
    position: fixed; z-index: 1000; padding: 9px 11px; background: var(--surface);
    border: 1px solid var(--hair); border-radius: var(--r, 5px);
    box-shadow: 0 8px 24px rgba(16, 22, 30, .14); pointer-events: none;
  }
  .cl-pop--above { transform: translateY(-100%); }
  .cl-pop__hd { display: flex; align-items: baseline; gap: 2px; }
  .cl-pop b { font: 600 11px/1.4 var(--mono); overflow-wrap: anywhere; }
  .cl-pop small { display: block; font: 10px/1.5 var(--mono); color: var(--muted); margin-top: 3px; }
  .cl-pop p { font: 11px/1.5 var(--mono); margin: 6px 0 0; overflow-wrap: anywhere; }
  .cl-pop__tries { color: var(--ink-2); font-size: 10px; }
  .cl-pop__alerts {
    margin: 6px 0 0; padding: 6px 7px; border-radius: 3px;
    border: 1px solid; font: 10px/1.45 var(--mono); color: #6b4a16;
  }
  .cl-pop__alerts ul { list-style: none; margin: 3px 0 0; padding: 0; }
  .cl-pop__alerts li + li { margin-top: 3px; }
  .cl-pop__cat { display: flex; align-items: center; gap: 5px; font: 600 10px var(--mono); }

  .cl-legend {
    list-style: none; display: flex; flex-wrap: wrap; gap: 4px 14px;
    margin: 0 0 10px; padding: 0; font: 10px var(--mono); color: var(--muted);
  }
  .cl-legend li { display: flex; align-items: center; gap: 5px; }
  .cl-key {
    display: inline-block; width: 9px; height: 9px; flex: none;
    border: 1px solid var(--hair); border-radius: 1px;
  }
  .cl-key--res { background: repeating-linear-gradient(45deg, #eceff2, #eceff2 2px, #f6f7f9 2px, #f6f7f9 4px); }

  .cl-note--tight { margin-bottom: 6px; }
  .cl-over { color: #a85f2a; }
  .cl-ok { font: 11px/1.6 var(--mono); color: #3f7d59; margin: 0; }
  .cl-alerts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .cl-alerts > li { border: 1px solid var(--hair); border-radius: 3px; background: var(--surface-2); }
  .cl-alerts > li.is-err { border-color: #e0b4b4; background: #fdf6f6; }
  .cl-alert__hd {
    display: flex; align-items: baseline; gap: 9px; width: 100%; padding: 7px 10px;
    background: none; border: 0; text-align: left; cursor: pointer;
    font: 11px/1.5 var(--mono); color: var(--ink-2);
  }
  .cl-alert__hd:hover { background: var(--surface); }
  .cl-alert__n {
    flex: none; min-width: 2.4em; padding: 1px 5px; text-align: center;
    font: 600 10px var(--mono); background: #f3e2cf; border: 1px solid #ddbf9c; border-radius: 3px;
  }
  .is-err .cl-alert__n { background: #f6dede; border-color: #e0b4b4; }
  .cl-alert__txt { flex: 1; }
  .cl-alert__chev { flex: none; color: var(--muted); }
  .cl-alert__list {
    list-style: none; margin: 0; padding: 2px 10px 9px 10px;
    display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--hair);
  }
  .cl-alert__list b { font: 600 10.5px var(--mono); overflow-wrap: anywhere; }
  .cl-alert__list small { display: block; font: 10px var(--mono); color: var(--muted); }

  /* The arena ships its own near-black styling; give it a dark frame to sit in. */
  .cl-arena { background: #04060c; color: #eaf2ff; border-radius: var(--r, 5px); padding: 14px; margin-top: 8px; }
</style>

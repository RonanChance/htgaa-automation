<script>
  // Final plate picker: which submitted compositions fill the four plates per
  // protein target, and why each one did or didn't make it.
  //
  // The selection runs HERE, in the browser, from live data loaded on every
  // visit — so an edited composition is re-judged on the next reload, and the
  // knobs below re-derive the whole set instantly. Nothing is stored: the plates
  // are always a pure function of (submissions, options), which is what makes the
  // decision table below auditable by anyone.
  import '../blueprint.css';
  import { page } from '$app/state';
  import { loginHref } from '../loginHref.js';
  import {
    selectFinalPlates, DEFAULT_OPTIONS, SELECTION_RULES, TARGETS,
    CAPACITY, PLATES_PER_TARGET, DESIGNS_PER_PLATE
  } from '$lib/cfpsFinalPlates.js';
  import {
    ROWS, COLS, RESERVED_COLS, SLOTS, REPLICATES, ROWL, slotWell, placementFor, plateJson, plateKey
  } from '../plateMap.js';

  let { data } = $props();

  const TARGET_COLOR = { sfGFP: 'var(--sfgfp)', PETase: 'var(--petase)', Reteplase: 'var(--reteplase)' };

  let perUserFloor = $state(DEFAULT_OPTIONS.perUserFloor);
  let perUserCap = $state(DEFAULT_OPTIONS.perUserCap);
  let maxBatchArms = $state(DEFAULT_OPTIONS.maxBatchArms);
  let coverageBins = $state(DEFAULT_OPTIONS.coverageBins);
  let target = $state('sfGFP');
  let filter = $state('all'); // all | selected | not-selected | excluded
  let query = $state('');
  let showRules = $state(true);

  const options = $derived({ perUserFloor, perUserCap, maxBatchArms, coverageBins });
  const result = $derived(
    data.locked ? null : selectFinalPlates(data.designs ?? [], options)
  );
  const tgt = $derived(result?.perTarget?.[target] ?? null);

  // ── placement preview ─────────────────────────────────────────────────────
  // Lay the chosen candidates onto the four plates, keeping each batch on ONE
  // plate so its arms stay directly comparable, and spreading each composition's
  // 4 replicates apart (placementFor). Display only — the authoritative export
  // runs the same helpers.
  function layoutFor(t, res) {
    if (!res) return [];
    const plates = Array.from({ length: PLATES_PER_TARGET }, () => ({ entries: [], occupied: new Set() }));
    const units = new Map();
    for (const c of res.chosen) {
      const key = c.unitKey;
      if (!units.has(key)) units.set(key, []);
      units.get(key).push(c);
    }
    for (const [, members] of units) {
      // First plate with room for the whole unit, else the first with any room.
      const home =
        plates.find((p) => DESIGNS_PER_PLATE - p.entries.length >= members.length) ??
        plates.find((p) => p.entries.length < DESIGNS_PER_PLATE);
      for (const m of members) {
        const p = (home && home.entries.length < DESIGNS_PER_PLATE)
          ? home
          : plates.find((q) => q.entries.length < DESIGNS_PER_PLATE);
        if (!p) break;
        const wells = placementFor(`${t}-${plates.indexOf(p) + 1}`, m.key, p.occupied);
        if (!wells) break;
        for (const w of wells) p.occupied.add(w);
        p.entries.push({ ...m, wells });
      }
    }
    return plates.map((p, i) => ({ index: i + 1, entries: p.entries }));
  }
  const layout = $derived(layoutFor(target, tgt));

  // slot → entry, per plate, for the well grid.
  const bySlot = $derived(layout.map((p) => {
    const m = new Map();
    for (const e of p.entries) for (const w of e.wells) m.set(w, e);
    return m;
  }));

  // A stable colour per batch so a batch reads as one block on its plate.
  function hue(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return h;
  }
  // Only BATCH wells are tinted, each batch its own hue, so a batch reads as one
  // block on its plate. Standalone compositions stay neutral — otherwise every
  // well is coloured and the batches stop standing out.
  const wellStyle = (e) =>
    e?.batchId ? `background: hsl(${hue(e.batchId)} 62% 84%); border-color: hsl(${hue(e.batchId)} 45% 58%);` : '';

  // Click a well or a row to follow one composition across the plates.
  let picked = $state(null); // candidate key
  const pickedEntry = $derived(
    picked ? layout.flatMap((p) => p.entries.map((e) => ({ ...e, plate: p.index }))).find((e) => e.key === picked) : null
  );
  $effect(() => { target; picked = null; });

  // Hover detail floats over the plate (fixed position from the well's rect) so
  // nothing below it moves — a panel that pushes the grid down makes the well you
  // are pointing at jump away from the cursor.
  let hover = $state(null); // { entry, top, left, above }
  const POP_W = 340;
  function showWell(e, entry) {
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - POP_W / 2, window.innerWidth - POP_W - 8));
    const above = r.bottom + 190 > window.innerHeight && r.top > 190;
    hover = { entry, left, top: above ? r.top - 8 : r.bottom + 8, above };
  }
  const hideWell = () => (hover = null);

  // The four plates for one target as a PlateBatch the lab can run — the same
  // plateJson the plate builder exports, so it validates against the pydantic
  // model. Partial plates are padded with empty wells like the validation set.
  function batchFor(t) {
    const res = result?.perTarget?.[t];
    if (!res) return null;
    const lookup = new Map();
    for (const c of res.chosen) for (const d of c.designs) lookup.set(d.id, {
      name: d.name, reagentList: c.reagentList, author: d.author,
      aiModel: d.aiModel, aiConversationLink: d.aiConversationLink,
      acknowledgements: d.acknowledgements, rationale: d.comments, comments: d.comments,
      proteinTarget: t
    });
    const plates = layoutFor(t, res).map((p) => {
      const json = plateJson(
        plateKey(t, p.index - 1),
        p.entries.map((e) => ({ designIds: e.designs.map((d) => d.id), wells: e.wells })),
        (id) => lookup.get(id),
        { viewerName: data.kcUser?.name ?? '' }
      );
      const filled = new Set(p.entries.flatMap((e) => e.wells));
      for (let slot = 0; slot < SLOTS; slot++) {
        if (!filled.has(slot)) {
          json.samples.push({ sample_id: 'empty', sample_type: 'empty', reagent_list: null, metadata: { well: slotWell(slot) } });
        }
      }
      json.metadata = { ...json.metadata, source: 'htbaa-final-plates', selection: result.options };
      return json;
    });
    return { plates };
  }

  function downloadBatch(t) {
    const batch = batchFor(t);
    if (!batch) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }));
    a.download = `cfps-final-plates-${t}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  const authorsOf = (e) => [...new Set(e.designs.map((d) => d.author).filter(Boolean))].join(', ');
  const titleOf = (e, slot) =>
    `${slotWell(slot)} · ${e.designs.map((d) => d.name).join(' · ')}\n${authorsOf(e)}` +
    (e.batchId ? `\nbatch ${e.batchId}` : '');

  // Open any composition in the designer. ?design=<id> works signed out too.
  const designHref = (id) => `/cfps?design=${id}`;

  // Decisions span ALL THREE targets and are grouped by protein, so someone
  // asking "did my idea make it?" can search once without knowing the target.
  const groups = $derived.by(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return TARGETS.map((t) => ({
      target: t,
      rows: result.perTarget[t].decisions
        .filter((d) => filter === 'all' || d.status === filter)
        .filter((d) => !q || `${d.name} ${d.author ?? ''} ${d.reason} ${d.batchId ?? ''}`.toLowerCase().includes(q))
        .sort((a, b) => a.status.localeCompare(b.status) || String(a.author).localeCompare(String(b.author)))
    })).filter((g) => g.rows.length);
  });
  const matchCount = $derived(groups.reduce((n, g) => n + g.rows.length, 0));
  const statusCount = (f) =>
    TARGETS.reduce((n, t) =>
      n + result.perTarget[t].decisions.filter((d) => f === 'all' || d.status === f).length, 0);

  const fmt = (v, digits = 2) =>
    v == null ? '—' : String(Number(v.toPrecision(digits + 1)));

  function downloadDecisions() {
    const head = ['target', 'composition', 'author', 'batch', 'status', 'step', 'reason', 'detail'];
    const body = TARGETS.flatMap((t) =>
      result.perTarget[t].decisions.map((d) =>
        [t, d.name, d.author ?? '', d.batchId ?? '', d.status, d.step, d.reason, d.detail ?? ''])
    );
    const csv = [head, ...body]
      .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `cfps-final-plate-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }
</script>

<svelte:head><title>Final plates · CFPS coopetition</title></svelte:head>

<div class="cfps-page fp" data-theme="light">
  <header class="fp-top">
    <div>
      <a class="fp-back" href="/cfps">← Designer</a>
      <h1>Final plate selection</h1>
      <p class="fp-sub">
        Four 384-well plates per protein target · {DESIGNS_PER_PLATE} compositions each at
        {REPLICATES} replicates · <b>{CAPACITY} wells’ worth per target</b>
      </p>
    </div>
    {#if !data.locked && result}
      <div class="fp-top__stats">
        <div><span>Submitted</span><b>{result.totals.submitted}</b></div>
        <div><span>Placed</span><b>{result.totals.slotsUsed}/{result.totals.capacity}</b></div>
        <div><span>Participants</span><b>{result.totals.participantsRepresented}/{result.totals.participantsEligible}</b></div>
      </div>
    {/if}
  </header>

  <main class="fp-main">
    {#if data.locked}
      <section class="fp-card fp-locked">
        <h2>Sign in to see the plate selection</h2>
        <p>Submissions are visible to signed-in participants only.</p>
        <a class="btn-bp" href={loginHref(page.url)}>Sign in</a>
      </section>
    {:else if !tgt}
      <section class="fp-card fp-locked"><h2>No submissions yet</h2></section>
    {:else}

      <!-- ═══ How the picks are made — the rules, in order ═══ -->
      <section class="fp-card">
        <div class="fp-hd">
          <h2>Final Composition Selection Criteria</h2>
          <button type="button" class="btn-bp" onclick={() => (showRules = !showRules)}>
            {showRules ? 'Hide' : 'Show'} the rules
          </button>
        </div>
        <p class="fp-note">
          The steps run in this order, and every composition below carries the step that decided it.
          The picker is deterministic: the same submissions and settings always give the same plates,
          so anyone can re-run it and get this exact result.
        </p>
        {#if showRules}
          <ol class="fp-rules">
            {#each SELECTION_RULES as rule, i}
              <li>
                <b>{i + 1}. {rule.title}</b>
                <ul class="fp-rule-b">
                  {#each rule.bullets as point}<li>{point}</li>{/each}
                </ul>
                {#if rule.example}
                  <p class="fp-example"><b>What a “level” means</b> {rule.example}</p>
                {/if}
                {#if rule.plain}
                  <p class="fp-plain"><b>In plain terms</b> {rule.plain}</p>
                {/if}
                {#if rule.math}
                  <dl class="fp-math">
                    {#each rule.math as m}
                      <dt>{m.expr}</dt>
                      <dd>{m.note}</dd>
                    {/each}
                  </dl>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>

      <!-- ═══ Settings ═══ -->
      <section class="fp-card">
        <h2>Settings</h2>
        <p class="fp-note">Change any of these and the plates re-derive immediately.</p>
        <div class="fp-knobs">
          <label>
            <span>Guaranteed slots per participant</span>
            <input type="number" min="0" max="5" bind:value={perUserFloor} />
            <small>Everyone with a runnable composition gets at least this many.</small>
          </label>
          <label>
            <span>Cap per participant</span>
            <input type="number" min="1" max="80" bind:value={perUserCap} />
            <small>Stops one prolific submitter filling a plate.</small>
          </label>
          <label>
            <span>Longest batch kept whole</span>
            <input type="number" min="2" max="80" bind:value={maxBatchArms} />
            <small>Longer batches are subsetted evenly along the reagent they vary.</small>
          </label>
          <label>
            <span>Coverage levels per reagent</span>
            <input type="number" min="3" max="20" bind:value={coverageBins} />
            <small>How finely each reagent’s range is split when scoring breadth.</small>
          </label>
        </div>
      </section>

      <!-- ═══ Target tabs — sticky, so the target can be switched from anywhere ═══ -->
      <nav class="fp-tabs" aria-label="Protein target">
        <span class="fp-tabs__lbl">Target</span>
        {#each TARGETS as t}
          <button
            type="button"
            class="fp-tab"
            class:is-on={target === t}
            style={target === t ? `border-color:${TARGET_COLOR[t]};color:${TARGET_COLOR[t]};` : ''}
            onclick={() => (target = t)}
          >
            {t}
            <small>{result.perTarget[t].slotsUsed}/{CAPACITY}</small>
          </button>
        {/each}
        <a class="fp-tabs__jump" href="#search">Search a composition ↓</a>
      </nav>

      <section class="fp-card">
        <div class="fp-kpis">
          <div><span>Compositions placed</span><b>{tgt.slotsUsed}</b><small>of {CAPACITY} slots</small></div>
          <div><span>Participants represented</span><b>{tgt.participants.represented}</b><small>of {tgt.participants.eligible} with a runnable design</small></div>
          <div><span>Set aside as unrunnable</span><b>{tgt.decisions.filter((d) => d.status === 'excluded').length}</b><small>missing a reagent the reaction needs — not for being off a reference</small></div>
          <div><span>Batches subsetted</span><b>{tgt.subsetted.length}</b><small>too long to keep whole</small></div>
        </div>
        <div class="fp-fill" class:is-short={tgt.shortfall > 0}>
          {#if tgt.shortfall > 0}
            <b>{tgt.shortfall} wells would be empty.</b> There aren’t enough runnable {target} compositions
            to fill four plates — every eligible one is already placed.
          {:else}
            <b>All {CAPACITY} wells filled.</b>
            {#if tgt.capRelaxedFor}
              The per-participant cap was relaxed for the last {tgt.capRelaxedFor}
              {tgt.capRelaxedFor === 1 ? 'slot' : 'slots'} rather than leave wells empty — they went to the
              least-represented participants first.
            {/if}
          {/if}
        </div>
      </section>

      <!-- ═══ The plates ═══ -->
      <section class="fp-card">
        <div class="fp-hd">
          <h2>{target} — the four plates</h2>
          <div class="fp-dl">
            {#each TARGETS as t}
              <button type="button" class="btn-bp" onclick={() => downloadBatch(t)}
                title="Download the four {t} plates as a PlateBatch JSON">↓ {t} plates</button>
            {/each}
          </div>
        </div>
        <p class="fp-note">
          Columns 1–4 are Ginkgo’s standards and controls and are never filled here. Each composition
          takes four non-touching wells. <b>Coloured wells are batches</b> — one hue per batch, kept on a
          single plate so its arms stay comparable; grey wells are standalone. <b>Click any well</b> to
          follow that composition across the plates.
        </p>

        {#if pickedEntry}
          <p class="fp-note fp-pinned">
            Pinned:
            {#each pickedEntry.designs as d, i}{i ? ' · ' : ''}<a class="fp-link" href={designHref(d.id)} target="_blank" rel="noopener">{d.name}</a>{/each} ·
            plate {pickedEntry.plate}, wells {pickedEntry.wells.map(slotWell).join(', ')}
            <button type="button" onclick={() => (picked = null)}>clear</button>
          </p>
        {/if}

        <div class="fp-plates">
          {#each layout as plate}
            <figure class="fp-plate">
              <figcaption>
                Plate {plate.index}
                <small>{plate.entries.length}/{DESIGNS_PER_PLATE} compositions</small>
              </figcaption>
              <div class="fp-grid" style="grid-template-columns: repeat({COLS}, 1fr);">
                {#each Array(ROWS) as _, r}
                  {#each Array(COLS) as _2, c}
                    {@const reserved = RESERVED_COLS.includes(c + 1)}
                    {@const slot = (c - RESERVED_COLS.length) * ROWS + r}
                    {@const e = reserved ? null : bySlot[plate.index - 1]?.get(slot)}
                    {#if e}
                      <button
                        type="button"
                        class="fp-well is-filled"
                        class:is-picked={picked === e.key}
                        class:is-hover={hover?.entry?.key === e.key}
                        class:is-dim={picked && picked !== e.key}
                        style={wellStyle(e)}
                        aria-label={titleOf(e, slot)}
                        onmouseenter={(ev) => showWell(ev, { ...e, plate: plate.index, slot })}
                        onmouseleave={hideWell}
                        onfocus={(ev) => showWell(ev, { ...e, plate: plate.index, slot })}
                        onblur={hideWell}
                        onclick={() => (picked = picked === e.key ? null : e.key)}
                      ></button>
                    {:else}
                      <div
                        class="fp-well"
                        class:is-reserved={reserved}
                        title={reserved
                          ? `${ROWL[r]}${String(c + 1).padStart(2, '0')} · reserved for standards / controls`
                          : `${slotWell(slot)} · empty`}
                      ></div>
                    {/if}
                  {/each}
                {/each}
              </div>
            </figure>
          {/each}
        </div>
      </section>

      <!-- ═══ What's being tested ═══ -->
      <section class="fp-card">
        <h2>Reagent ranges on these plates</h2>
        <p class="fp-note">
          The span each reagent is tested across, in delivered concentration (base buffer included).
          <b>Levels</b> splits that reagent’s range into ten equal bands plus an eleventh for “not dosed
          at all”, so <b>11/11</b> means every band — and leaving it out — is tested somewhere on these
          four plates, while <b>8/11</b> means three never get tried. Spreading these is what the picker
          maximises.
        </p>
        <div class="fp-tablewrap">
          <table class="fp-table">
            <thead>
              <tr>
                <th>Reagent</th>
                <th>Range tested</th>
                <th title="Bands of this reagent's range that appear somewhere on the plates, out of ten bands plus “absent”">Levels covered</th>
                <th title="Compositions on these plates that dose this reagent">Dosed in</th>
                <th title="Compositions on these plates that leave this reagent out">Absent in</th>
              </tr>
            </thead>
            <tbody>
              {#each tgt.coverage.slice(0, 28) as c}
                <tr>
                  <td><code>{c.field}</code></td>
                  <td>{fmt(c.min)} – {fmt(c.max)} {c.unit} <small>({c.minNl}–{c.maxNl} nL)</small></td>
                  <td><b>{c.levelsCovered}</b>/{c.levelsPossible}</td>
                  <td>{c.dosedIn}</td>
                  <td>{c.absentIn}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="fp-card">
        <h2>What these plates are testing</h2>
        <p class="fp-note">
          The three questions the {target} plates answer. The framing is ours; every number is measured
          from the compositions actually selected. “Levels” counts how many bands of a reagent’s range
          get tested — ten equal bands across what people proposed, plus one for leaving it out.
        </p>
        <div class="fp-themes">
          {#each tgt.themes as th}
            <article class="fp-theme">
              <h3>{th.title}</h3>
              <p class="fp-theme__q">{th.question}</p>
              <p class="fp-theme__why">{th.why}</p>
              <div class="fp-theme__stats">
                <span><b>{th.compositions}</b> compositions</span>
                <span><b>{th.people}</b> people</span>
                <span><b>{th.reagentCount}</b> reagents moved</span>
              </div>
              <ul class="fp-theme__r">
                {#each th.reagents as r}
                  <li>
                    <code>{r.field}</code>
                    <span>{fmt(r.min)}–{fmt(r.max)} {r.unit}</span>
                    <small title="{r.levelsCovered} of {r.levelsPossible} bands of this reagent's range are tested ({r.levelsPossible - 1} equal bands plus “not dosed”)">{r.levelsCovered}/{r.levelsPossible} levels</small>
                  </li>
                {/each}
              </ul>
            </article>
          {/each}
        </div>

        <h3 class="fp-subhd">In participants’ own words</h3>
        <p class="fp-note">
          Every hypothesis recorded on a selected {target} composition, most-represented first.
          The number is how many wells’ worth of compositions carry it.
        </p>
        <ul class="fp-hyps">
          {#each tgt.hypotheses as h}
            <li>
              <span class="fp-hyps__n">{h.slots}</span>
              <div>
                <p>{h.text}</p>
                <small>{h.authors.join(', ')}</small>
              </div>
            </li>
          {:else}
            <li><p>No hypotheses recorded on the selected compositions.</p></li>
          {/each}
        </ul>
      </section>

      {#if tgt.subsetted.length}
        <section class="fp-card">
          <h2>Batches that were subsetted</h2>
          <p class="fp-note">Kept as a run, but trimmed — arms taken evenly along the reagent the batch varies, so both ends of the trend survive.</p>
          <ul class="fp-subset">
            {#each tgt.subsetted as s}
              <li>
                <code>{s.batchId}</code> — kept <b>{s.kept} of {s.of}</b> arms
                {#if s.variedField}<span>, spaced along <code>{s.variedField}</code></span>{/if}
                <small>{s.author ?? 'unknown author'} · {s.reason}</small>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- ═══ Every decision ═══ -->
      <section class="fp-card" id="search">
        <div class="fp-hd">
          <h2>Did my composition make it?</h2>
          <button type="button" class="btn-bp" onclick={downloadDecisions}>↓ All decisions (CSV)</button>
        </div>
        <p class="fp-note">
          Every submitted composition across all three proteins, with the rule that decided it.
          Search a name, an author or a batch — then click a composition to open it in the designer.
        </p>
        <div class="fp-filters">
          <input
            class="fp-search"
            type="search"
            placeholder="Search by composition name, author or batch…"
            bind:value={query}
          />
          {#each ['all', 'selected', 'not-selected', 'excluded'] as f}
            <button type="button" class="fp-chip" class:is-on={filter === f} onclick={() => (filter = f)}>
              {f}
              <small>{statusCount(f)}</small>
            </button>
          {/each}
        </div>
        {#if query.trim()}
          <p class="fp-note"><b>{matchCount}</b> {matchCount === 1 ? 'match' : 'matches'} for “{query.trim()}”.</p>
        {/if}
        <div class="fp-tablewrap fp-tablewrap--tall">
          <table class="fp-table">
            <thead>
              <tr><th>Composition</th><th>Author</th><th>Outcome</th><th>Rule</th><th>Why</th></tr>
            </thead>
            {#each groups as g}
              <tbody>
                <tr class="fp-grouprow">
                  <th colspan="5" style="border-left:3px solid {TARGET_COLOR[g.target]}">
                    {g.target}
                    <small>{g.rows.length} shown · {result.perTarget[g.target].slotsUsed} on the plates</small>
                  </th>
                </tr>
                {#each g.rows.slice(0, 250) as d}
                  <tr>
                    <td>
                      <a class="fp-link" href={designHref(d.id)} target="_blank" rel="noopener"
                        title="Open {d.name} in the designer">{d.name}</a>
                      {#if d.batchId}<small class="fp-batch">batch {d.batchId}</small>{/if}
                    </td>
                    <td>{d.author ?? '—'}</td>
                    <td><span class="fp-status fp-status--{d.status}">{d.status}</span></td>
                    <td><small>{d.step}</small></td>
                    <td>
                      {d.reason}
                      {#if d.detail}<small class="fp-detail">{d.detail}</small>{/if}
                      {#if d.coveredBy?.length}
                        <small class="fp-covered">
                          already covered by:
                          {#each d.coveredBy as cb, i}{i ? ', ' : ' '}<a class="fp-link" href={designHref(cb.id)} target="_blank" rel="noopener" title="{cb.author ?? 'unknown'} — covers {cb.levels} of its levels">{cb.name}</a>{/each}
                        </small>
                      {/if}
                    </td>
                  </tr>
                {/each}
                {#if g.rows.length > 250}
                  <tr><td colspan="5"><small>+{g.rows.length - 250} more {g.target} rows — narrow the search or download the CSV.</small></td></tr>
                {/if}
              </tbody>
            {/each}
          </table>
        </div>
        {#if !groups.length}
          <p class="fp-note">Nothing matches that search.</p>
        {/if}
      </section>

      <!-- ═══ Contributors ═══ -->
      <section class="fp-card">
        <h2>Ideas on the plates, by contributor</h2>
        <p class="fp-note">
          Across all three targets. A shared well counts for everyone who submitted that reaction.
          Hover a name to see what they contributed.
        </p>
        <ol class="fp-board">
          {#each result.leaderboard as p, i}
            <li class="fp-board__row">
              <span class="fp-board__rank">{i + 1}</span>
              <span class="fp-board__who" title={p.author}>
                <span class="fp-board__name">{p.author}</span>
                <div class="fp-board__pop">
                  <b>{p.author}</b>
                  <small>{p.ideas} on the plates · {p.submitted} submitted{#if p.batches} · {p.batches} {p.batches === 1 ? 'batch' : 'batches'}{/if}</small>
                  <ul>
                    {#each p.items.slice(0, 14) as it}
                      <li>
                        <span class="fp-board__t" style="color:{TARGET_COLOR[it.target]}">{it.target}</span>
                        <a class="fp-link" href={designHref(it.id)} target="_blank" rel="noopener">{it.name}</a>{#if it.shared} <em>shared</em>{/if}
                      </li>
                    {/each}
                    {#if p.items.length > 14}<li class="fp-board__more">+{p.items.length - 14} more</li>{/if}
                  </ul>
                </div>
              </span>
              <span class="fp-board__bars">
                {#each TARGETS as t}
                  {#if p.byTarget[t]}
                    <span class="fp-board__bar" style="background:{TARGET_COLOR[t]};width:{p.byTarget[t] * 7}px"
                      title="{p.byTarget[t]} on {t}"></span>
                  {/if}
                {/each}
              </span>
              <span class="fp-board__n">{p.ideas}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </main>

  <!-- Inside .cfps-page so the blueprint CSS variables resolve; position:fixed
       still escapes the plate grid's scroll context. -->
{#if hover}
  <div class="fp-pop" class:fp-pop--above={hover.above}
    style="top:{hover.top}px;left:{hover.left}px;width:{POP_W}px;" role="tooltip">
    <b>{hover.entry.designs.map((d) => d.name).join(' · ')}</b>
    <small class="fp-pop__hint">click the well to pin it, then open it in the designer</small>
    <small>
      {authorsOf(hover.entry) || 'unknown author'} · plate {hover.entry.plate} ·
      {slotWell(hover.entry.slot)} of {hover.entry.wells.map(slotWell).join(', ')}
      {#if hover.entry.batchId} · batch {hover.entry.batchId}{/if}
      {#if hover.entry.designs.length > 1} · shared well, {hover.entry.designs.length} submitters{/if}
    </small>
    {#if hover.entry.designs[0]?.comments}
      <p>{hover.entry.designs[0].comments.slice(0, 320)}</p>
    {/if}
  </div>
{/if}
</div>


<style>
  .fp { min-height: 100vh; background: var(--bg); color: var(--ink); }
  .fp-top {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap;
    padding: 22px 26px 16px; border-bottom: 1px solid var(--hair); background: var(--surface);
  }
  .fp-back { font: 11px var(--mono); color: var(--muted); text-decoration: none; }
  .fp-back:hover { color: var(--ink); }
  .fp-top h1 { font: 600 22px/1.2 var(--sans); margin: 6px 0 4px; }
  .fp-sub { font: 11px/1.5 var(--mono); color: var(--muted); margin: 0; }
  .fp-top__stats { display: flex; gap: 22px; }
  .fp-top__stats div { display: flex; flex-direction: column; gap: 2px; }
  .fp-top__stats span { font: 9px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .fp-top__stats b { font: 600 17px var(--sans); }
  .fp-main { max-width: 1240px; margin: 0 auto; padding: 22px 26px 80px; display: grid; gap: 18px; }
  .fp-card { border: 1px solid var(--hair); border-radius: var(--r, 5px); background: var(--surface); padding: 16px 18px; }
  .fp-card h2 { font: 600 14px/1.2 var(--sans); margin: 0 0 6px; }
  .fp-hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .fp-note { font: 11px/1.6 var(--mono); color: var(--muted); margin: 0 0 10px; max-width: 86ch; }
  .fp-locked { text-align: center; padding: 60px 30px; }

  .fp-rules { margin: 4px 0 0; padding-left: 0; list-style: none; display: grid; gap: 10px; counter-reset: r; }
  .fp-rules > li { padding-left: 2px; }
  .fp-rules b { font: 600 12px var(--sans); }
  .fp-math {
    background: var(--bg); border: 1px solid var(--hair); border-radius: 4px;
    padding: 9px 11px; margin: 8px 0 0;
  }
  .fp-math dt {
    font: 600 11px/1.6 var(--mono); color: var(--ink); white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .fp-math dd {
    font: 10.5px/1.65 var(--mono); color: var(--ink-2); margin: 2px 0 9px 0;
    padding-left: 12px; border-left: 2px solid var(--hair); max-width: 90ch;
  }
  .fp-math dd:last-child { margin-bottom: 0; }

  .fp-knobs { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
  .fp-knobs label { display: flex; flex-direction: column; gap: 4px; }
  .fp-knobs span { font: 9.5px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .fp-knobs input { font: 13px var(--mono); padding: 6px 8px; border: 1px solid var(--hair); border-radius: 4px; background: var(--bg); color: var(--ink); }
  .fp-knobs small { font: 10px/1.4 var(--mono); color: var(--muted); }

  /* Sticky so the target can be changed from anywhere on the page: a
     self-contained bar that floats just below the top edge. */
  .fp-tabs {
    position: sticky; top: 8px; z-index: 30;
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--hair); border-radius: var(--r, 5px);
    box-shadow: 0 4px 16px rgba(27, 31, 37, 0.1);
  }
  .fp-tabs__lbl {
    font: 9px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  }
  .fp-tabs__jump { margin-left: auto; font: 10px var(--mono); color: var(--muted); text-decoration: none; }
  .fp-tabs__jump:hover { color: var(--ink); text-decoration: underline; }
  .fp-tab {
    font: 600 12px var(--sans); padding: 7px 14px; border: 1px solid var(--hair);
    border-radius: var(--r, 5px); background: var(--surface); color: var(--muted); cursor: pointer;
    display: flex; align-items: baseline; gap: 7px;
  }
  .fp-tab small { font: 10px var(--mono); opacity: .75; }
  .fp-tab.is-on { background: var(--bg); border-width: 2px; }

  .fp-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
  .fp-kpis div { display: flex; flex-direction: column; gap: 1px; }
  .fp-kpis span { font: 9px var(--mono); text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .fp-kpis b { font: 600 20px var(--sans); }
  .fp-kpis small { font: 10px var(--mono); color: var(--muted); }
  .fp-fill {
    margin-top: 12px; padding: 8px 11px; border-radius: 4px; font: 11px/1.6 var(--mono);
    background: var(--sfgfp-wash, #dcefe1); color: #1f6b3a;
  }
  .fp-fill.is-short { background: #fff3d1; color: #8a5a00; }

  /* Always 2×2 — the four plates of a target read as one set. */
  .fp-plates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  @media (max-width: 760px) { .fp-plates { grid-template-columns: minmax(0, 1fr); } }
  .fp-plate figcaption {
    font: 600 11px var(--sans); margin-bottom: 5px; display: flex; justify-content: space-between;
  }
  .fp-plate figcaption small { font: 10px var(--mono); color: var(--muted); }
  .fp-grid { display: grid; gap: 1px; }
  .fp-well {
    aspect-ratio: 1; border: 1px solid var(--hair); border-radius: 1px; background: var(--bg);
    min-width: 0;
  }
  .fp-well.is-filled { background: #dfe3e7; border-color: #b9c0c7; }
  .fp-well.is-reserved { background: repeating-linear-gradient(45deg, #eceff2, #eceff2 2px, #f6f7f9 2px, #f6f7f9 4px); }

  .fp-tablewrap { overflow: auto; border: 1px solid var(--hair); border-radius: 4px; }
  .fp-tablewrap--tall { max-height: 560px; }
  .fp-table { width: 100%; border-collapse: collapse; font: 11px var(--mono); }
  .fp-table th {
    position: sticky; top: 0; background: var(--surface); text-align: left; padding: 7px 9px;
    border-bottom: 1px solid var(--hair); font: 9.5px var(--mono); text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); z-index: 1;
  }
  .fp-table td { padding: 6px 9px; border-bottom: 1px solid var(--hair-2, #eef0f2); vertical-align: top; }
  .fp-table code { font: 11px var(--mono); overflow-wrap: anywhere; }
  .fp-table small { color: var(--muted); }
  .fp-detail, .fp-batch { display: block; margin-top: 2px; }
  .fp-covered { display: block; margin-top: 3px; line-height: 1.6; }
  .fp-plain {
    font: 11px/1.7 var(--mono); color: var(--ink); background: var(--sfgfp-wash, #eef4f8);
    border-radius: 4px; padding: 8px 11px; margin: 7px 0 0; max-width: 92ch;
  }
  .fp-plain b { font: 600 11px var(--sans); }
  .fp-example {
    font: 11px/1.7 var(--mono); color: var(--ink); background: var(--bg);
    border: 1px dashed var(--hair); border-radius: 4px; padding: 8px 11px; margin: 7px 0 0; max-width: 92ch;
  }
  .fp-example b { font: 600 11px var(--sans); display: block; margin-bottom: 2px; }
  .fp-link { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
  .fp-link:hover { color: var(--teal, #0f7c84); }
  .fp-grouprow th {
    position: static; background: var(--bg); padding: 7px 9px; font: 600 11px var(--sans);
    text-transform: none; letter-spacing: 0; color: var(--ink); border-top: 1px solid var(--hair);
  }
  .fp-grouprow small { font: 10px var(--mono); color: var(--muted); margin-left: 7px; }
  /* display:grid on a <ul> drops the markers — keep it a plain list so these
     read as real bullets. */
  .fp-rule-b { margin: 5px 0 0; padding-left: 18px; list-style: disc outside; }
  .fp-rule-b li { font: 11px/1.65 var(--mono); color: var(--ink-2); max-width: 92ch; display: list-item; margin: 0 0 2px; }
  .fp-rule-b li::marker { color: var(--muted); }
  .fp-pop__hint { font-style: italic; opacity: .8; }

  .fp-status { font: 600 10px var(--mono); padding: 1px 6px; border-radius: 9px; white-space: nowrap; }
  .fp-status--selected { background: var(--sfgfp-wash, #dcefe1); color: #1f6b3a; }
  .fp-status--not-selected { background: #f1f3f5; color: #6a737c; }
  .fp-status--excluded { background: #fbe4e0; color: #a3392a; }

  .fp-filters { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-bottom: 9px; }
  .fp-chip {
    font: 11px var(--mono); padding: 4px 10px; border: 1px solid var(--hair); border-radius: 12px;
    background: var(--surface); color: var(--muted); cursor: pointer; display: flex; gap: 5px;
  }
  .fp-chip.is-on { background: var(--bg); color: var(--ink); border-color: var(--ink-2); }
  .fp-search {
    flex: 1; min-width: 180px; font: 11px var(--mono); padding: 5px 9px;
    border: 1px solid var(--hair); border-radius: 4px; background: var(--bg); color: var(--ink);
  }

  .fp-hyps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .fp-hyps li { display: flex; gap: 10px; align-items: flex-start; }
  .fp-hyps__n {
    flex: none; min-width: 26px; text-align: center; font: 600 10px var(--mono);
    background: var(--bg); border: 1px solid var(--hair); border-radius: 9px; padding: 2px 5px;
  }
  .fp-hyps p { font: 11px/1.55 var(--mono); margin: 0; }
  .fp-hyps small { font: 10px var(--mono); color: var(--muted); }

  .fp-subset { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
  .fp-subset li { font: 11px/1.5 var(--mono); }
  .fp-subset small { display: block; color: var(--muted); }

  .fp-dl { display: flex; gap: 6px; flex-wrap: wrap; }

  .fp-pinned { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
  .fp-pinned button {
    font: 10px var(--mono); border: 1px solid var(--hair); background: var(--surface);
    border-radius: 3px; padding: 1px 7px; cursor: pointer; color: var(--muted);
  }
  .fp-pop {
    position: fixed; z-index: 1000; padding: 9px 11px; background: var(--surface);
    border: 1px solid var(--ink-2); border-radius: 5px; box-shadow: 0 8px 22px rgba(0,0,0,.18);
    pointer-events: none; text-align: left;
  }
  .fp-pop--above { transform: translateY(-100%); }
  .fp-pop b { font: 600 11px var(--mono); overflow-wrap: anywhere; }
  .fp-pop small { display: block; font: 10px/1.5 var(--mono); color: var(--muted); margin-top: 3px; }
  .fp-pop p { font: 11px/1.5 var(--mono); margin: 6px 0 0; }
  .fp-well.is-hover { outline: 2px solid var(--ink-2); outline-offset: 1px; position: relative; z-index: 2; }

  button.fp-well { padding: 0; cursor: pointer; font: inherit; }
  .fp-well.is-picked { outline: 2px solid var(--ink); outline-offset: 1px; z-index: 2; position: relative; }
  .fp-well.is-dim { opacity: .35; }


  .fp-subhd { font: 600 12px var(--sans); margin: 20px 0 4px; padding-top: 14px; border-top: 1px solid var(--hair); }
  .fp-themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 14px; }
  .fp-theme { border: 1px solid var(--hair); border-radius: 4px; padding: 12px 13px; background: var(--bg); }
  .fp-theme h3 { font: 600 13px var(--sans); margin: 0 0 4px; }
  .fp-theme__q { font: 600 11px/1.5 var(--mono); margin: 0 0 6px; }
  .fp-theme__why { font: 11px/1.6 var(--mono); color: var(--ink-2); margin: 0 0 9px; }
  .fp-theme__stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 7px; }
  .fp-theme__stats span { font: 10px var(--mono); color: var(--muted); }
  .fp-theme__stats b { font: 600 13px var(--sans); color: var(--ink); }
  .fp-theme__r { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  .fp-theme__r li { display: flex; gap: 7px; align-items: baseline; font: 10px var(--mono); }
  .fp-theme__r code { flex: none; min-width: 10ch; }
  .fp-theme__r span { flex: 1; }
  .fp-theme__r small { color: var(--muted); }

  .fp-board { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; counter-reset: b; }
  .fp-board__row { display: flex; align-items: center; gap: 10px; padding: 3px 0; font: 11px var(--mono); }
  .fp-board__rank { width: 2.5ch; text-align: right; color: var(--muted); font-size: 10px; }
  /* Fixed-width name column: long names truncate instead of pushing the bars
     out of line. overflow lives on the inner span so the hover card isn't clipped. */
  .fp-board__who { position: relative; width: 26ch; flex: none; cursor: default; }
  .fp-board__name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fp-board__who:hover .fp-board__name { text-decoration: underline dotted; }
  .fp-board__bars { display: flex; gap: 2px; flex: 1; align-items: center; }
  .fp-board__bar { height: 9px; border-radius: 2px; display: inline-block; min-width: 3px; }
  .fp-board__n { font-weight: 600; width: 3ch; text-align: right; }
  .fp-board__pop {
    display: none; position: absolute; left: 0; top: 100%; z-index: 40; width: 330px;
    padding: 9px 11px; background: var(--surface); border: 1px solid var(--ink-2);
    border-radius: 4px; box-shadow: 0 8px 22px rgba(0,0,0,.16);
  }
  .fp-board__who:hover .fp-board__pop { display: block; }
  .fp-board__pop b { font: 600 11px var(--sans); }
  .fp-board__pop small { display: block; color: var(--muted); font-size: 10px; margin-bottom: 5px; }
  .fp-board__pop ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .fp-board__pop li { font: 10px/1.4 var(--mono); overflow-wrap: anywhere; }
  .fp-board__t { font-weight: 600; }
  .fp-board__more { color: var(--muted); }
</style>

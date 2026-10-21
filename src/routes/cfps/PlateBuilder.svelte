<script>
  // Plate-map builder: the fullscreen designer's right-hand pane, opposite the
  // contributions rail. You pick compositions on the left and lay them out across
  // four 384-well plates per protein target (sfGFP / PETase / Reteplase).
  //
  // Layout follows the coopetition plate spec exactly (and the autonomous-cfps
  // `Plate` model it validates against):
  //   · 16 rows × 24 columns, array_order="column"
  //   · columns 1-4 are RESERVED for Ginkgo's standards + controls — never filled here
  //   · columns 5-24 are ours: 20 × 16 = 320 wells
  //   · every design runs at replicate_factor 4, so 320 / 4 = 80 unique designs/plate
  // Wells are addressed by SLOT index 0..319 over the fillable region in the same
  // column-major order the model's `coordinates` property produces, so slot i maps
  // 1:1 onto samples[i] on export with no re-ordering.
  //
  // State lives in localStorage (see STORAGE_KEY) as { designIds[], wells[] } per plate —
  // never the design bodies, which are always read fresh from the server props, so a
  // reagent edit upstream can't leave a stale copy baked into someone's plate map.
  import {
    validateReagentList,
    templateFieldForTarget,
    reagentListKey
  } from '$lib/cfpsReagentContract.js';
  import {
    ROWS, COLS, RESERVED_COLS, SLOTS, REPLICATES, PER_PLATE, PLATES_PER_TARGET,
    TARGETS, ROWL, slotCol, slotWell, plateKey, targetOfKey, emptyPlates,
    placementFor, plateJson, addDesignsToPlates, removeDesignsFromPlates,
    pruneMissing, placementOrder, placedIdsOf, targetOf, idsOf, sidOf
  } from './plateMap.js';

  let {
    // Every placeable composition, flattened from the contributions rail:
    // { id, name, proteinTarget, reagentList, author, contributorKey, aiModel, batchId }
    designs = [],
    // The rail item under the cursor, so the plate can pre-light the wells an "add"
    // would fill: { ids: [designId, ...] } | null
    hoverIds = null,
    // Fires with a Set of placed design ids whenever the layout changes, so the rail
    // cards can show add ⇄ remove without reaching into this component's state.
    onPlacedChange = null,
    // paperName → unit for the concentrations carried on each design's `components`.
    componentUnits = {},
    viewerName = ''
  } = $props();

  const STORAGE_KEY = 'cfps.platebuilder.v1';

  // { [plateKey]: [{ designIds: [...], wells: [4 slots] }] } — several identical
  // submissions can share one well as co-contributors.
  let plates = $state(emptyPlates());
  let activeTarget = $state('sfGFP');
  // 'all' shows the whole experimental set — a column of 4 plates per target, 12 at
  // a glance. A target name zooms to just that target's plates, 2×2 and larger.
  let board = $state('all'); // 'all' | one of TARGETS
  let seqCounter = $state(0);
  let notice = $state('');
  let noticeTimer;
  let hydrated = $state(false);

  // The plate each target is currently filling: the first with room. Plates fill in
  // order, so this is shown rather than chosen — there is no "active plate" to set.
  const nextKeys = $derived(
    new Set(
      TARGETS.map((t) =>
        Array.from({ length: PLATES_PER_TARGET }, (_, i) => plateKey(t, i))
          .find((k) => (plates[k]?.length ?? 0) < PER_PLATE)
      ).filter(Boolean)
    )
  );
  const designById = $derived(new Map(designs.map((d) => [d.id, d])));

  // Only PROBLEMS are surfaced, and as an overlay — a confirmation for something you
  // just did and can already see (a cleared plate, a changed count) isn't worth
  // pushing the whole board down the page.
  function flash(msg) {
    notice = msg;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ''), 4000);
  }

  // ── persistence ────────────────────────────────────────────────────────────
  // Entries are revalidated on load: unknown design ids and malformed well lists are
  // dropped rather than trusted, so a hand-edited or stale localStorage value can't
  // put the builder into a state the exporter would choke on.
  function load() {
    if (typeof localStorage === 'undefined') return;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { saved = null; }
    if (!saved || saved.v !== 1 || !saved.plates) { hydrated = true; return; }
    const next = emptyPlates();
    for (const [key, entries] of Object.entries(saved.plates)) {
      if (!(key in next) || !Array.isArray(entries)) continue;
      const used = new Set();
      for (const e of entries) {
        const wells = Array.isArray(e?.wells) ? e.wells.filter((w) => Number.isInteger(w) && w >= 0 && w < SLOTS) : [];
        // Entries used to hold a single `designId`; they hold a contributor list now.
        const ids = [...new Set((Array.isArray(e?.designIds) ? e.designIds : [e?.designId])
          .filter((x) => typeof x === 'string' && x))];
        if (!ids.length || wells.length !== REPLICATES) continue;
        if (wells.some((w) => used.has(w))) continue; // overlapping wells → drop
        wells.forEach((w) => used.add(w));
        next[key].push({
          designIds: ids,
          wells,
          fingerprint: typeof e.fingerprint === 'string' ? e.fingerprint : undefined,
          seq: Number.isFinite(e.seq) ? e.seq : undefined
        });
      }
    }
    // A design placed on one machine can be deleted by its author before the next
    // visit; drop those entries rather than letting them hold wells and fail at export.
    const known = new Set(designs.map((d) => d.id));
    plates = known.size ? pruneMissing(next, known).plates : next;
    seqCounter = Math.max(0, ...Object.values(plates).flat().map((e) => (Number.isFinite(e.seq) ? e.seq + 1 : 0)));
    if (TARGETS.includes(saved.activeTarget)) activeTarget = saved.activeTarget;
    if (saved.board === 'all' || TARGETS.includes(saved.board)) board = saved.board;
    hydrated = true;
  }
  $effect(() => { if (!hydrated) load(); });
  $effect(() => {
    const snapshot = { v: 1, plates, activeTarget, board, seq: seqCounter };
    if (!hydrated || typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* quota — keep working in memory */ }
  });

  // Every design id currently placed anywhere, for the rail's add ⇄ remove state.
  const placedIds = $derived(placedIdsOf(plates));
  $effect(() => { onPlacedChange?.(placedIds); });

  // ── deterministic placement ────────────────────────────────────────────────
  // The hover preview has to light up the SAME wells the add will use, so placement
  // is a pure function of (design, plate, current occupancy) rather than Math.random:
  // a seeded PRNG shuffles the free slots, then we spread the four replicates across
  // distinct columns where we can (guards against a column/edge effect hitting every
  // replicate of one design).
  function occupiedSet(key) {
    const used = new Set();
    for (const e of plates[key] ?? []) for (const w of e.wells) used.add(w);
    return used;
  }

  // ── add / remove ───────────────────────────────────────────────────────────
  // The rules live in plateMap.js (addDesignsToPlates) so they can be tested
  // headlessly — see scripts/check-plate-ops.mjs.
  const addOpts = (keepTogether = false) => ({
    keepTogether,
    seq: seqCounter,
    validate: (d) => {
      const { valid, errors } = validateReagentList(d.reagentList);
      if (!valid) return { valid: false, detail: errors[0] };
      // Export refuses a plate holding a mislabelled design, so refuse it up front.
      const templateField = templateFieldForTarget(d.proteinTarget);
      if (!(Number(d.reagentList?.[templateField]) > 0)) {
        return { valid: false, detail: `template doesn't match ${d.proteinTarget} (expected ${templateField})` };
      }
      return { valid: true };
    },
    fingerprint: (d) => reagentListKey(d.reagentList)
  });

  // Why a design wasn't placed, in words. "Already placed" isn't worth reporting:
  // re-adding a part-placed batch is the normal way to top it up.
  function explain(skip) {
    const who = skip.name || skip.id;
    switch (skip.reason) {
      case 'no_target': return `${who}: no protein target`;
      case 'invalid': return `${who}: ${skip.detail ?? 'invalid reagent list'}`;
      case 'duplicate_reaction': return `${who}: identical reagents to a composition already on every ${skip.target} plate`;
      case 'plates_full': return `${who}: all four ${skip.target} plates are full`;
      default: return who;
    }
  }

  export function addDesigns(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map((id) => designById.get(id)).filter(Boolean);
    // More than one composition at a time is a batch: keep its members together on
    // one plate per target, where there's room for them.
    const res = addDesignsToPlates(plates, list, addOpts(list.length > 1));
    plates = res.plates;
    seqCounter = res.nextSeq;
    const real = res.skipped.filter((x) => x.reason !== 'already_placed');
    if (real.length) {
      flash(real.length === 1 ? explain(real[0]) : `${real.length} not placed — ${explain(real[0])}`);
    }
    return { added: res.added.length, skipped: real };
  }

  // Auto-fill: every composition not yet on a plate, oldest submission first, through
  // the same add rules as a click (merging, validation, plates filling 1 → 4). Tops
  // up the current layout rather than replacing it — clear plates first for a fresh one.
  const byAge = (a, b) =>
    (Date.parse(a.created) || Infinity) - (Date.parse(b.created) || Infinity) || String(a.id).localeCompare(String(b.id));
  const unplaced = $derived(designs.filter((d) => !placedIds.has(d.id)));
  function autoFill() {
    const res = addDesignsToPlates(plates, [...unplaced].sort(byAge), addOpts(false));
    plates = res.plates;
    seqCounter = res.nextSeq;
    const real = res.skipped.filter((x) => x.reason !== 'already_placed');
    if (!real.length) return;
    // A full target is expected once there are more submissions than wells, so say
    // it per target rather than once per composition that didn't fit.
    const full = [...new Set(real.filter((x) => x.reason === 'plates_full').map((x) => x.target))];
    const other = real.filter((x) => x.reason !== 'plates_full');
    const parts = [];
    if (res.added.length) parts.push(`Placed ${res.added.length}`);
    if (full.length) parts.push(`${real.length - other.length} didn't fit (${full.join(', ')} plates full)`);
    if (other.length) parts.push(`${other.length} skipped — ${explain(other[0])}`);
    flash(parts.join(' · '));
  }

  export function removeDesigns(ids) {
    const res = removeDesignsFromPlates(plates, ids);
    plates = res.plates;
    return res.removed;
  }

  function clearPlate(key) {
    plates = { ...plates, [key]: [] };
  }
  // Wipes all 12 plates. The layout only lives in localStorage, so ask first.
  function clearAll() {
    if (!placedIds.size) return;
    if (!confirm(`Remove all ${placedIds.size} placed compositions from every plate?`)) return;
    plates = emptyPlates();
  }
  // Re-roll every placement on a plate (same designs, fresh random wells).
  function shufflePlate(key) {
    const entries = plates[key] ?? [];
    const occupied = new Set();
    const reseeded = [];
    for (const e of entries) {
      const wells = placementFor(`${key}|reshuffle${reseeded.length}`, idsOf(e)[0], occupied);
      if (!wells) { reseeded.push(e); e.wells.forEach((w) => occupied.add(w)); continue; }
      wells.forEach((w) => occupied.add(w));
      reseeded.push({ ...e, wells });
    }
    plates = { ...plates, [key]: reseeded };
  }

  // ── derived views ──────────────────────────────────────────────────────────
  // slot → { designId, ids } for one plate's entries (ids = every contributor).
  function slotMapFor(entries) {
    const map = new Map();
    for (const e of entries) {
      const ids = idsOf(e);
      for (const w of e.wells) map.set(w, { designId: ids[0], ids });
    }
    return map;
  }
  function platesFor(target) {
    return Array.from({ length: PLATES_PER_TARGET }, (_, i) => {
      const key = plateKey(target, i);
      const entries = plates[key] ?? [];
      return {
        key, idx: i, target, entries,
        count: entries.length,
        pct: Math.round((entries.length / PER_PLATE) * 100),
        slotMap: slotMapFor(entries)
      };
    });
  }
  const showAll = $derived(board === 'all');
  const columns = $derived(
    (showAll ? TARGETS : [board]).map((t) => ({
      target: t,
      filled: stats.byTarget[t],
      plates: platesFor(t)
    }))
  );

  // Wells the hovered rail item would fill: { [plateKey]: Set(slots) }. Computed by
  // running the real add against a throwaway copy, so the preview can't drift from
  // what clicking actually does — duplicate and capacity rules included.
  const hoverPreview = $derived.by(() => {
    const ids = hoverIds?.ids ?? [];
    if (!ids.length) return {};
    const list = ids.map((id) => designById.get(id)).filter(Boolean);
    if (!list.length) return {};
    const out = {};
    for (const a of addDesignsToPlates(plates, list, addOpts(list.length > 1)).added) {
      out[a.key] = out[a.key] ?? new Set();
      for (const w of a.wells) out[a.key].add(w);
    }
    return out;
  });

  // What clicking + would actually do: how many new reactions, and which
  // compositions would join an identical reaction already on a plate.
  const hoverPlan = $derived.by(() => {
    const ids = hoverIds?.ids ?? [];
    if (!ids.length) return null;
    const list = ids.map((id) => designById.get(id)).filter(Boolean);
    if (!list.length) return null;
    const res = addDesignsToPlates(plates, list, addOpts(list.length > 1));
    const merges = res.added.filter((a) => a.merged).map((a) => ({
      name: a.name,
      key: a.key,
      into: a.merged.with.map((id) => designById.get(id)?.name).filter(Boolean)
    }));
    return { fresh: res.added.length - merges.length, merges };
  });

  // Designs the hover would place on each target, so a batch spanning targets still
  // reports the ones whose plates aren't on screen in the single-target view.
  const hoverByTarget = $derived.by(() => {
    const out = {};
    for (const [key, set] of Object.entries(hoverPreview)) {
      const t = targetOfKey(key);
      out[t] = (out[t] ?? 0) + set.size / REPLICATES;
    }
    return out;
  });

  // Target accents, mirroring PROTEIN_PALETTE on the page and the rail badges.
  const PROTEIN_LINE = { sfGFP: '#2f8f4e', PETase: '#e07b1a', Reteplase: '#e0402e' };

  // Every placed composition in the order it was added — the running manifest of
  // the whole 960-well set, for checking against a submission by eye.
  const manifest = $derived(
    placementOrder(plates).map((e, i) => {
      const ids = idsOf(e);
      const parts = ids.map((id) => ({ id, d: designById.get(id) }));
      const lead = parts[0]?.d;
      return {
        n: i + 1,
        key: e.key,
        designId: ids[0],
        // Exactly the sample_id the export writes: contributors underscore-joined.
        sampleId: parts.map((x) => (x.d ? sidOf(x.d, x.id) : x.id)).join('_'),
        contributors: ids.length,
        target: lead?.proteinTarget ?? targetOfKey(e.key),
        ai: parts.some((x) => String(x.d?.aiModel || '').trim()),
        missing: parts.some((x) => !x.d),
        wells: e.wells.map(slotWell)
      };
    })
  );
  let showManifest = $state(false);
  let manifestCopied = $state(false);
  // Bare sample_ids, one per line — exactly what gets copied, so a selection drag
  // or the Copy button both yield something you can paste straight into a sheet.
  const manifestText = $derived(manifest.map((m) => m.sampleId).join('\n'));
  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(manifestText);
      manifestCopied = true;
      setTimeout(() => (manifestCopied = false), 1500);
    } catch { /* clipboard blocked — the text is selectable anyway */ }
  }

  // ── concentration coverage ─────────────────────────────────────────────────
  // What range of each reagent the placed set actually explores, and how the
  // compositions are distributed inside it. Concentrations come from each design's
  // `components`, which are final in-reaction values WITH the base buffer's
  // contribution folded in — so K-glutamate reads its true ~1× baseline even in a
  // composition that supplements none of it.
  const BINS = 14;
  function fmtConc(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return v.toExponential(1);
  }
  const coverage = $derived.by(() => {
    const placed = [...placedIds].map((id) => designById.get(id)).filter(Boolean);
    const byReagent = new Map();
    for (const d of placed) {
      for (const [name, v] of Object.entries(d.components ?? {})) {
        if (!Number.isFinite(v) || v <= 0) continue;
        if (!byReagent.has(name)) byReagent.set(name, []);
        byReagent.get(name).push(v);
      }
    }
    const rows = [];
    for (const [name, values] of byReagent) {
      values.sort((a, b) => a - b);
      const min = values[0];
      const max = values[values.length - 1];
      const mid = values[Math.floor(values.length / 2)];
      // One bar per bin; a reagent held at a single value gets a single full bar.
      const bins = new Array(BINS).fill(0);
      if (max > min) {
        for (const v of values) {
          const i = Math.min(BINS - 1, Math.floor(((v - min) / (max - min)) * BINS));
          bins[i] += 1;
        }
      } else {
        bins[Math.floor(BINS / 2)] = values.length;
      }
      const peak = Math.max(...bins);
      rows.push({
        name,
        unit: componentUnits[name] || 'mM',
        n: values.length,
        min, max, mid,
        varies: max > min,
        // Share of the placed set that uses this reagent at all.
        used: placed.length ? values.length / placed.length : 0,
        bars: bins.map((c) => ({ c, h: peak ? c / peak : 0 }))
      });
    }
    // Most-explored first: the reagents the community is actually ranging over.
    rows.sort((a, b) => (b.varies - a.varies) || (b.n - a.n) || a.name.localeCompare(b.name));
    return { rows, placed: placed.length };
  });
  let showAllCoverage = $state(false);
  const COVERAGE_TOP = 8;
  const coverageRows = $derived(showAllCoverage ? coverage.rows : coverage.rows.slice(0, COVERAGE_TOP));

  // ── stats ──────────────────────────────────────────────────────────────────
  // Over everything placed across all 12 plates: how many distinct contributors are
  // represented, and how much of the layout is AI-assisted (a design carries an
  // ai_model when its author built it with an agent).
  const stats = $derived.by(() => {
    const ids = [...placedIds];
    const placed = ids.map((id) => designById.get(id)).filter(Boolean);
    const users = new Set(placed.map((d) => d.contributorKey || d.author).filter(Boolean));
    const ai = placed.filter((d) => String(d.aiModel || '').trim()).length;
    const byTarget = Object.fromEntries(
      TARGETS.map((t) => [
        t,
        Array.from({ length: PLATES_PER_TARGET }, (_, i) => plates[plateKey(t, i)] ?? [])
          .flat()
          .reduce((n, e) => n + idsOf(e).length, 0)
      ])
    );
    const models = new Set(placed.map((d) => String(d.aiModel || '').trim()).filter(Boolean));
    return {
      placed: placed.length,
      capacity: TARGETS.length * PLATES_PER_TARGET * PER_PLATE,
      users: users.size,
      ai,
      aiPct: placed.length ? Math.round((ai / placed.length) * 100) : 0,
      models: [...models].sort(),
      byTarget
    };
  });

  // ── export ─────────────────────────────────────────────────────────────────
  // A plate becomes an autonomous-cfps `Plate`: 320 samples in coordinate order,
  // four per design, each carrying the design's exact nL reagent_list. Only a FULL
  // plate can be exported — the model asserts len(samples) == 320 for column order.
  const buildPlateJson = (key) =>
    plateJson(key, plates[key] ?? [], (id) => designById.get(id), { viewerName });

  // Blocking problems for a plate, in the same terms the pydantic model uses.
  function plateProblems(key) {
    const entries = plates[key] ?? [];
    const [target] = key.split(/-(?=\d+$)/);
    const problems = [];
    if (entries.length !== PER_PLATE) {
      problems.push(`${entries.length}/${PER_PLATE} designs — a plate must be full (${SLOTS} wells) to validate.`);
    }
    const templateField = templateFieldForTarget(target);
    const seenKeys = new Map();
    for (const e of entries) {
      const d = designById.get(idsOf(e)[0]);
      if (!d) { problems.push(`A placed design is no longer available (${idsOf(e)[0]}).`); continue; }
      const { valid, errors } = validateReagentList(d.reagentList);
      if (!valid) problems.push(`${d.name}: ${errors[0]}`);
      if (!(Number(d.reagentList?.[templateField]) > 0)) {
        problems.push(`${d.name}: template doesn't match ${target} (expected ${templateField}).`);
      }
      // Identical reactions merge into one well, so two entries should never share
      // a fingerprint — if they somehow do, the export would be wasteful.
      const rk = reagentListKey(d.reagentList);
      if (seenKeys.has(rk)) problems.push(`${d.name} duplicates ${seenKeys.get(rk)} — identical reagents.`);
      else seenKeys.set(rk, d.name);
    }
    return problems;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportPlate(key) {
    const problems = plateProblems(key);
    if (problems.length) { flash(problems[0]); return; }
    download(`${key}.json`, JSON.stringify(buildPlateJson(key), null, 2));
  }
  // Every full plate as a PlateBatch — the shape the model uses to check a set of
  // plates against the shared reagent inventory.
  function exportAll() {
    const keys = Object.keys(plates).filter((k) => (plates[k]?.length ?? 0) === PER_PLATE && !plateProblems(k).length);
    if (!keys.length) { flash('No complete plates yet — fill one to 80/80 first.'); return; }
    download(
      `cfps_plate_batch_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ plates: keys.map(buildPlateJson) }, null, 2)
    );
  }

  // Hover readout over a well.
  let hoverWell = $state(null); // { key, slot, designId } | null
  const hoverDesign = $derived(hoverWell ? designById.get(hoverWell.designId) : null);
  // Everyone sharing the well under the cursor.
  const hoverShared = $derived((hoverWell?.ids ?? []).map((id) => designById.get(id)).filter(Boolean));
</script>

<div class="pb">
  <div class="pb__hd">
    <div class="seg" role="radiogroup" aria-label="Plates shown">
      <button
        type="button"
        role="radio"
        aria-checked={showAll}
        onclick={() => (board = 'all')}
        title="Show all 12 plates — a column per protein target"
      >All 12</button>
      {#each TARGETS as t (t)}
        <button
          type="button"
          role="radio"
          aria-checked={board === t}
          onclick={() => { board = t; activeTarget = t; }}
          title="Show only the four {t} plates, larger"
        >{t} <span class="pb__segn">{stats.byTarget[t]}</span>{#if hoverByTarget[t]}<span class="pb__segadd" title="{hoverByTarget[t]} would land on {t}">+{hoverByTarget[t]}</span>{/if}</button>
      {/each}
    </div>
    <span class="pb__hint">Click a composition on the left to add it · hover to preview its wells</span>
    <button
      type="button"
      class="btn-bp"
      onclick={autoFill}
      disabled={!unplaced.length}
      title={unplaced.length
        ? `Auto-fill: place the ${unplaced.length} unplaced composition${unplaced.length === 1 ? '' : 's'} oldest submission first, onto the next free plates`
        : 'Every composition is already on a plate'}
    >🪄 Auto-fill</button>
    <button
      type="button"
      class="btn-bp"
      onclick={clearAll}
      disabled={!placedIds.size}
      title={placedIds.size ? 'Remove every composition from all 12 plates' : 'Nothing placed yet'}
    >✕ Clear all</button>
    <button type="button" class="btn-bp" onclick={exportAll} title="Download every complete plate as one PlateBatch JSON">↓ Export all</button>
  </div>

  {#if notice}<p class="pb__notice" role="alert">{notice}</p>{/if}

  <!-- One plate: header controls, the 384-well grid, and its fill bar. Shared by the
       all-12 board and the single-target view, which differ only in CSS density. -->
  {#snippet plateCard(plate)}
    {@const preview = hoverPreview[plate.key]}
    {@const isNext = nextKeys.has(plate.key)}
    <section class="pb-plate" class:is-active={isNext}>
      <header class="pb-plate__hd">
        <span
          class="pb-plate__name"
          class:is-next={isNext}
          title={isNext
            ? `Filling now — new ${plate.target} compositions land here until it is full`
            : plate.key}
        >
          {showAll ? `#${plate.idx + 1}` : plate.key}{#if isNext}<span class="pb-plate__dot" aria-label="filling now">●</span>{/if}
        </span>
        <span class="pb-plate__n">{plate.count}/{PER_PLATE}</span>
        <button type="button" class="cbtn" onclick={() => shufflePlate(plate.key)} disabled={!plate.count} title="Re-randomise where this plate's replicates sit">⤭</button>
        <button type="button" class="cbtn" onclick={() => clearPlate(plate.key)} disabled={!plate.count} title="Remove every composition from this plate">✕</button>
        <button
          type="button"
          class="cbtn"
          onclick={() => exportPlate(plate.key)}
          disabled={plate.count !== PER_PLATE}
          title={plate.count === PER_PLATE ? 'Download this plate as pydantic-ready JSON' : `Fill all ${PER_PLATE} designs first (${PER_PLATE - plate.count} to go)`}
        >↓</button>
      </header>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="pb-grid" role="presentation" onmouseleave={() => (hoverWell = null)}>
        {#each { length: ROWS } as _, r}
          {#each { length: COLS } as _, c}
            {@const col = c + 1}
            {@const reserved = RESERVED_COLS.includes(col)}
            {@const slot = reserved ? -1 : (col - RESERVED_COLS.length - 1) * ROWS + r}
            {@const filled = reserved ? null : plate.slotMap.get(slot)}
            {@const isPreview = !reserved && preview?.has(slot)}
            <div
              class="pb-well"
              class:is-reserved={reserved}
              class:is-filled={!!filled}
              class:is-shared={(filled?.ids?.length ?? 0) > 1}
              class:is-preview={isPreview}
              style={isPreview ? `--pc:${PROTEIN_LINE[plate.target] ?? 'var(--teal)'}` : undefined}
              title={reserved
                ? `${ROWL[r]}${String(col).padStart(2, '0')} · reserved for Ginkgo standards & controls`
                : filled
                  ? `${slotWell(slot)} · ${filled.ids.map((id) => designById.get(id)?.name ?? id).join(' + ')}${filled.ids.length > 1 ? ` · ${filled.ids.length} contributors` : ''}`
                  : `${slotWell(slot)} · empty`}
              onmouseenter={() => (hoverWell = filled ? { key: plate.key, slot, designId: filled.designId, ids: filled.ids } : null)}
            ></div>
          {/each}
        {/each}
      </div>

      <div class="pb-bar" title="{plate.count} of {PER_PLATE} unique designs ({plate.pct}%)">
        <div class="pb-bar__fill" class:is-full={plate.count === PER_PLATE} style="width:{plate.pct}%"></div>
        <span class="pb-bar__label">{plate.pct}%</span>
      </div>
    </section>
  {/snippet}

  <div class="pb__board" class:is-all={showAll}>
    {#each columns as col (col.target)}
      <div class="pb-col">
        {#if showAll}
          <div class="pb-col__hd">
            <span class="pb-col__t" style={`--tc:${PROTEIN_LINE[col.target] ?? 'var(--groove)'}`}>{col.target}</span>
            <span class="pb-col__n">{col.filled}/{PER_PLATE * PLATES_PER_TARGET}</span>
          </div>
        {/if}
        <div class="pb-col__plates">
          {#each col.plates as plate (plate.key)}{@render plateCard(plate)}{/each}
        </div>
      </div>
    {/each}
  </div>

  {#if hoverPlan && (hoverPlan.merges.length || hoverPlan.fresh)}
    <!-- What clicking + would do, before it is clicked. -->
    <p class="pb__plan" role="status">
      {#if hoverPlan.fresh}<span>{hoverPlan.fresh} new reaction{hoverPlan.fresh === 1 ? '' : 's'} · 4 wells each</span>{/if}
      {#each hoverPlan.merges as m}
        <span class="pb__merge">
          ↳ <b>{m.name}</b> builds into <b>{m.into.join(' + ')}</b> on {m.key} — the same reaction, so it shares those wells and is credited as a co-contributor.
        </span>
      {/each}
    </p>
  {:else if hoverDesign}
    <p class="pb__readout">
      <span class="pb__swatch" style="background:{PROTEIN_LINE[hoverDesign.proteinTarget] ?? 'var(--groove)'}"></span>
      <b>{hoverShared.map((d) => d.name).join(' + ')}</b>
      {#if hoverShared.length > 1}<span class="pb__ai">{hoverShared.length} contributors</span>{/if}
      {#if hoverShared.length === 1 && hoverDesign.author}· {hoverDesign.author}{/if}
      {#if hoverShared.length === 1 && hoverDesign.aiModel}· <span class="pb__ai">{hoverDesign.aiModel}</span>{/if}
      · {hoverWell?.key}
    </p>
  {/if}

  <!-- Who and what the layout represents. -->
  <div class="pb-stats">
    <div class="pb-stat">
      <span class="pb-stat__n">{stats.placed}<span class="pb-stat__of">/{stats.capacity}</span></span>
      <span class="pb-stat__k">compositions placed</span>
    </div>
    <div class="pb-stat">
      <span class="pb-stat__n">{stats.users}</span>
      <span class="pb-stat__k">unique contributors</span>
    </div>
    <div class="pb-stat">
      <span class="pb-stat__n">{stats.aiPct}<span class="pb-stat__of">%</span></span>
      <span class="pb-stat__k">AI-assisted ({stats.ai} of {stats.placed})</span>
    </div>
    <div class="pb-stat pb-stat--wide">
      <span class="pb-stat__k">models</span>
      <span class="pb-stat__models">{stats.models.length ? stats.models.join(', ') : '—'}</span>
    </div>
  </div>

  <!-- What the placed set actually explores: for each reagent, the span between its
       lowest and highest final concentration, and where the compositions sit inside
       it. Concentrations include the base buffer's contribution. -->
  {#if coverage.rows.length}
    <section class="pb-cov">
      <header class="pb-cov__hd">
        <span class="pb-stat__k">concentration coverage</span>
        <span class="pb-cov__sub">{coverage.rows.length} reagents across {coverage.placed} composition{coverage.placed === 1 ? '' : 's'}</span>
        {#if coverage.rows.length > COVERAGE_TOP}
          <button type="button" class="cbtn" onclick={() => (showAllCoverage = !showAllCoverage)}>
            {showAllCoverage ? 'Top 8' : `All ${coverage.rows.length}`}
          </button>
        {/if}
      </header>
      <ul class="pb-cov__list">
        {#each coverageRows as r (r.name)}
          <li class="pb-cov__row">
            <span class="pb-cov__name" title={r.name}>{r.name}</span>
            <span class="pb-cov__lo">{fmtConc(r.min)}</span>
            <span
              class="pb-cov__hist"
              class:is-flat={!r.varies}
              title={r.varies
                ? `${r.name}: ${r.n} compositions from ${fmtConc(r.min)} to ${fmtConc(r.max)} ${r.unit} (median ${fmtConc(r.mid)})`
                : `${r.name}: all ${r.n} compositions at ${fmtConc(r.min)} ${r.unit}`}
            >
              {#each r.bars as b, i}
                <span
                  class="pb-cov__bar"
                  style="--h:{Math.max(b.c ? 0.14 : 0, b.h)}"
                  data-n={b.c}
                  title={r.varies
                    ? `${fmtConc(r.min + ((r.max - r.min) * i) / BINS)}–${fmtConc(r.min + ((r.max - r.min) * (i + 1)) / BINS)} ${r.unit}: ${b.c} composition${b.c === 1 ? '' : 's'}`
                    : `${fmtConc(r.min)} ${r.unit}: all ${r.n} compositions`}
                ></span>
              {/each}
            </span>
            <span class="pb-cov__hi">{fmtConc(r.max)}</span>
            <span class="pb-cov__unit">{r.unit}</span>
            <span class="pb-cov__n" title="{r.n} of {coverage.placed} compositions use this reagent">{r.n}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Running manifest: every composition in the order it was placed, which is the
       order it will appear in the export. -->
  {#if manifest.length}
    <section class="pb-man">
      <header class="pb-cov__hd">
        <button type="button" class="pb-man__toggle" aria-expanded={showManifest} onclick={() => (showManifest = !showManifest)}>
          <span class="pb-stat__k">sample ids</span>
          <span class="pb-cov__sub">{manifest.length} of {stats.capacity} placed · in the order added</span>
          <span class="pb-man__chev">{showManifest ? '▾' : '▸'}</span>
        </button>
        {#if showManifest}
          <button type="button" class="cbtn" onclick={copyManifest}>{manifestCopied ? 'Copied ✓' : 'Copy'}</button>
        {/if}
      </header>
      {#if showManifest}
        <pre class="pb-man__pre">{manifestText}</pre>
      {/if}
    </section>
  {/if}
</div>

<style>
  .pb {
    position: relative;
    display: flex; flex-direction: column; gap: 8px; min-height: 0; min-width: 0;
    border: 1px solid var(--hair); border-radius: var(--r, 5px);
    background: var(--surface-2); padding: 9px 10px;
    overflow: auto;
  }
  .pb__hd { display: flex; align-items: center; gap: 9px; flex-wrap: nowrap; flex: 0 0 auto; }
  .pb__segn { opacity: .6; }
  /* Live during a hover: how many of the hovered item's designs land on a target
     you're not currently looking at. */
  .pb__segadd { margin-left: 4px; color: var(--phosphor, #3fb950); }
  .seg > button[aria-checked="true"] .pb__segadd { color: #fff; }
  .pb__hint {
    flex: 1 1 auto; min-width: 0; font: 9.5px/1.4 var(--mono); color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pb__hd .btn-bp { flex: 0 0 auto; }
  .pb__hd .seg { flex: 0 0 auto; }
  /* Floats over the board instead of displacing it. */
  .pb__notice {
    position: absolute; left: 10px; right: 10px; top: 38px; z-index: 5; margin: 0;
    padding: 5px 8px; border-radius: var(--r-sm);
    border: 1px solid #fecdca; background: #fef3f2; color: #b42318;
    font: 10px/1.4 var(--mono);
  }

  /* Board, two densities:
     · all 12  — a column per protein target, four plates stacked, whole set at once
     · one target — its four plates 2×2 and larger, for close work  */
  .pb__board.is-all { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; align-items: start; }
  .pb-col { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .pb-col__hd { display: flex; align-items: baseline; gap: 6px; padding: 0 1px; }
  .pb-col__t {
    font: 600 11px/1 var(--mono); color: var(--ink);
    padding-bottom: 2px; border-bottom: 2px solid var(--tc);
  }
  .pb-col__n { margin-left: auto; font: 9.5px/1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .pb-col__plates { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  /* Single target: its four plates side by side, two per row. */
  .pb__board:not(.is-all) .pb-col__plates {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
  }
  @media (max-width: 1180px) {
    .pb__board:not(.is-all) .pb-col__plates { grid-template-columns: minmax(0, 1fr); }
  }
  /* Twelve plates on one half-screen means tighter chrome: smaller header type and
     no well gaps, so the grids stay square and readable rather than smeared. */
  .is-all .pb-plate { padding: 5px 6px; gap: 4px; }
  .is-all .pb-plate__hd { gap: 3px; }
  .is-all .pb-plate__name { font-size: 9.5px; }
  .is-all .pb-plate__n { font-size: 9px; }
  .is-all .pb-plate__hd .cbtn { padding: 1px 4px; font-size: 9px; }
  .is-all .pb-grid { gap: 0; padding: 2px; }
  /* The hatch is invisible at ~9px wells — flat tint keeps columns 1-4 legible. */
  .is-all .pb-well.is-reserved { background: #dfe5ea; box-shadow: none; }
  .is-all .pb-well.is-filled { box-shadow: none; }
  .is-all .pb-bar { height: 9px; }
  .is-all .pb-bar__label { font-size: 7.5px; }
  /* Below ~1100px the three columns stop being readable — fall back to one. */
  @media (max-width: 1100px) { .pb__board.is-all { grid-template-columns: minmax(0, 1fr); } }

  .pb-plate {
    display: flex; flex-direction: column; gap: 5px; min-width: 0;
    padding: 7px 8px; border: 1px solid var(--hair); border-radius: var(--r-sm);
    background: var(--surface);
  }
  .pb-plate.is-active { border-color: var(--teal); }
  .pb-plate__hd { display: flex; align-items: center; gap: 5px; }
  .pb-plate__name {
    /* No text-transform: the target names are cased deliberately (sfGFP, PETase). */
    font: 500 10.5px/1 var(--mono); letter-spacing: .04em;
    color: var(--ink-2); padding: 2px 0;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .pb-plate__name.is-next { color: var(--teal-ink); }
  .pb-plate__dot { font-size: 7px; color: var(--teal); }
  .pb-plate__n { margin-left: auto; font: 500 10px/1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .pb-plate__hd .cbtn { padding: 2px 5px; font-size: 9.5px; }

  /* The plate itself: 24 columns of square wells, sized to whatever width the pane
     gives us (aspect-ratio keeps them round rather than squashed). */
  .pb-grid {
    display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 1px;
    padding: 3px; border: 1px solid var(--groove); border-radius: 3px; background: var(--recess);
  }
  .pb-well {
    aspect-ratio: 1; min-width: 0; border-radius: 50%; background: #fff;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .07);
  }
  .pb-well.is-reserved { background: repeating-linear-gradient(45deg, #e9edf1 0 2px, #f4f6f8 2px 4px); }
  /* A placed well reads the same neutral grey as the reserved band — the plate is
     "filled here", nothing more — which leaves colour free to mean one thing only. */
  .pb-well.is-filled { background: #dfe5ea; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .06); }
  /* A well several identical submissions share — one reaction, many contributors. */
  .pb-well.is-shared { background: #b9c7d3; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .2); }
  /* Preview: where the hovered composition would land, in its protein's colour
     (sfGFP green / PETase orange / Reteplase red) so it pops off the grey. */
  .pb-well.is-preview {
    background: var(--pc);
    box-shadow: 0 0 0 1.5px var(--pc);
    animation: pb-pulse .9s ease-in-out infinite alternate;
  }
  @keyframes pb-pulse { from { opacity: .55; } to { opacity: 1; } }

  .pb-bar {
    position: relative; height: 11px; border-radius: 6px; overflow: hidden;
    background: var(--recess); border: 1px solid var(--groove);
  }
  .pb-bar__fill { height: 100%; background: var(--teal); transition: width .18s var(--ease, ease); }
  .pb-bar__fill.is-full { background: var(--phosphor, #3fb950); }
  .pb-bar__label {
    position: absolute; inset: 0; display: grid; place-items: center;
    font: 500 8px/1 var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums;
  }

  .pb__plan {
    margin: 0; display: flex; flex-direction: column; gap: 2px;
    font: 10px/1.45 var(--mono); color: var(--ink-2);
  }
  .pb__merge { color: var(--teal-ink); }
  .pb__readout {
    margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    font: 10px/1.4 var(--mono); color: var(--ink-2);
  }
  .pb__swatch { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .pb__ai { color: var(--teal-ink); }

  .pb-stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px;
    padding-top: 8px; border-top: 1px solid var(--hair);
  }
  .pb-stat {
    display: flex; flex-direction: column; gap: 3px;
    padding: 7px 9px; border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--surface);
  }
  .pb-stat__n { font: 600 17px/1 var(--mono); color: var(--ink); font-variant-numeric: tabular-nums; }
  .pb-stat__of { font-size: 11px; color: var(--faint); }
  .pb-stat__k { font: 9px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .pb-stat__models { font: 10px/1.4 var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
  .pb-stat--wide { grid-column: span 2; }
  @media (max-width: 700px) { .pb-stat--wide { grid-column: span 1; } }

  /* ── concentration coverage ─────────────────────────────────────────────── */
  .pb-cov, .pb-man { display: flex; flex-direction: column; gap: 5px; }
  .pb-cov__hd { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .pb-cov__sub { font: 9.5px/1.4 var(--mono); color: var(--faint); }
  .pb-cov__hd .cbtn { margin-left: auto; }
  .pb-cov__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .pb-cov__row {
    display: grid; grid-template-columns: minmax(66px, 1.4fr) 44px minmax(60px, 3fr) 44px 34px 28px;
    align-items: center; gap: 6px;
    font: 9.5px/1 var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums;
    padding: 2px 4px; border-radius: 3px;
  }
  .pb-cov__row:hover { background: var(--surface); }
  .pb-cov__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
  .pb-cov__lo, .pb-cov__hi { color: var(--muted); }
  .pb-cov__hi { text-align: right; }
  .pb-cov__unit, .pb-cov__n { color: var(--faint); }
  .pb-cov__n { text-align: right; }
  /* Histogram: one bar per bin, height = share of the busiest bin. The track shows
     the full span so an empty stretch reads as "nobody tried this range". */
  .pb-cov__hist {
    display: flex; align-items: flex-end; gap: 1px; height: 16px;
    padding: 0 2px; border-bottom: 1px solid var(--groove); background: var(--recess);
    border-radius: 2px;
  }
  .pb-cov__bar {
    flex: 1 1 0; min-width: 0; height: calc(var(--h) * 100%);
    background: var(--teal); border-radius: 1px 1px 0 0;
  }
  .pb-cov__bar[data-n="0"] { background: transparent; }
  .pb-cov__hist.is-flat .pb-cov__bar { background: var(--faint); }

  /* ── sample-id manifest ─────────────────────────────────────────────────── */
  .pb-man__toggle {
    display: flex; align-items: baseline; gap: 8px; cursor: pointer;
    background: transparent; border: 0; padding: 0; text-align: left;
  }
  .pb-man__chev { font-size: 9px; color: var(--muted); }
  /* Nothing but the ids, one per line: select-all and paste gives clean text. */
  .pb-man__pre {
    margin: 0; padding: 7px 9px; max-height: 320px; overflow: auto;
    border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--surface);
    font: 10.5px/1.6 var(--mono); color: var(--ink-2);
    white-space: pre; user-select: text;
  }
</style>

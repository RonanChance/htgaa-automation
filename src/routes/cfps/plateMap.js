// Plate-map geometry, replicate placement and pydantic export, kept out of
// PlateBuilder.svelte so the export can be exercised headlessly against the real
// `autonomous_cfps.models.Plate` (see scripts/check-plate-export.mjs) rather than
// only through the browser.
//
// Everything here mirrors the coopetition plate spec and the pydantic model:
//   · 16 rows × 24 columns, array_order="column"
//   · columns 1-4 RESERVED for Ginkgo's standards + controls, never filled by us
//   · columns 5-24 are ours: 20 × 16 = 320 wells, 80 designs × 4 replicates
// Wells are addressed by SLOT index 0..319 over the fillable region, in the same
// order `Plate.coordinates` enumerates them, so slot i maps onto samples[i].

export const ROWS = 16;
export const COLS = 24;
export const RESERVED_COLS = [1, 2, 3, 4];
export const SLOTS = (COLS - RESERVED_COLS.length) * ROWS; // 320
export const REPLICATES = 4;
export const PER_PLATE = SLOTS / REPLICATES;               // 80
export const PLATES_PER_TARGET = 4;
export const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];
export const ROWL = 'ABCDEFGHIJKLMNOP';

// Plate.protein_target enum values (ProteinTarget in models.py).
export const PROTEIN_TARGET_ENUM = {
  sfGFP: 'sfgfp-jewett-m9134733',
  PETase: 'petase-m9307404',
  Reteplase: 'reteplase-m9307400'
};

export const slotCol = (slot) => RESERVED_COLS.length + 1 + Math.floor(slot / ROWS); // 5..24
export const slotRow = (slot) => slot % ROWS;                                        // 0..15
export const slotWell = (slot) => `${ROWL[slotRow(slot)]}${String(slotCol(slot)).padStart(2, '0')}`;

export const plateKey = (target, i) => `${target}-${i + 1}`;
// "sfGFP-2" → "sfGFP" (targets have no trailing -digits of their own).
export const targetOfKey = (key) => String(key).split(/-(?=\d+$)/)[0];

export const emptyPlates = () =>
  Object.fromEntries(
    TARGETS.flatMap((t) => Array.from({ length: PLATES_PER_TARGET }, (_, i) => [plateKey(t, i), []]))
  );

// ── deterministic placement ─────────────────────────────────────────────────
// The hover preview must light the SAME wells the add will fill, so placement is a
// pure function of (plate, design, free-well count) instead of Math.random.
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two wells touch if they are neighbours in any direction, diagonals included.
export const isAdjacent = (a, b) =>
  Math.abs(slotCol(a) - slotCol(b)) <= 1 && Math.abs(slotRow(a) - slotRow(b)) <= 1;

// Four free slots for `designId` on plate `key`, or null when the plate is full.
// Replicates are spread deliberately: no two may touch (adjacent wells share edge
// effects, evaporation and any dispense error, which is exactly what replicates are
// supposed to average out), and where possible they also sit in distinct columns.
// Constraints are relaxed in order as the plate fills, so a nearly-full plate still
// places rather than failing: distinct columns + no touching → no touching → any.
export function placementFor(key, designId, occupied) {
  const free = [];
  for (let s = 0; s < SLOTS; s++) if (!occupied.has(s)) free.push(s);
  if (free.length < REPLICATES) return null;
  const rnd = mulberry32(hashSeed(`${key}|${designId}|${free.length}`));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const picked = [];
  const cols = new Set();
  const take = (s) => { picked.push(s); cols.add(slotCol(s)); };
  const touchesPicked = (s) => picked.some((p) => isAdjacent(p, s));
  // Pass 1 — the layout we want: spread across columns, nothing touching.
  for (const s of free) {
    if (picked.length === REPLICATES) break;
    if (cols.has(slotCol(s)) || touchesPicked(s)) continue;
    take(s);
  }
  // Pass 2 — crowded plate: give up the column spread, still refuse neighbours.
  if (picked.length < REPLICATES) {
    for (const s of free) {
      if (picked.length === REPLICATES) break;
      if (picked.includes(s) || touchesPicked(s)) continue;
      take(s);
    }
  }
  // Pass 3 — almost no room left: take what is there.
  if (picked.length < REPLICATES) {
    for (const s of free) {
      if (picked.length === REPLICATES) break;
      if (!picked.includes(s)) take(s);
    }
  }
  return picked.sort((a, b) => a - b);
}

// ── export ──────────────────────────────────────────────────────────────────
// Separator for values folded together when several identical submissions share a
// well. One separator for every field, so the merge always reads the same way.
export const MERGE_SEP = ' · ';

// A design's sample_id: its name, made safe for an id, falling back to its record id.
export const sidOf = (design, id) =>
  String(design?.name || id).trim().replace(/\s+/g, '_').slice(0, 80) || String(id);

// One plate → the JSON shape `Plate.model_validate` accepts. `entries` is
// [{ designId, wells }]; `lookup` resolves a design id to
// { name, reagentList, author, aiModel, proteinTarget }.
export function plateJson(key, entries, lookup, { viewerName = '', now = new Date() } = {}) {
  const target = targetOfKey(key);
  const bySlot = new Map();
  const usedSid = new Map();
  for (const e of entries) {
    const contributors = idsOf(e).map((id) => ({ id, design: lookup(id) })).filter((c) => c.design);
    if (!contributors.length) continue;
    const [lead] = contributors;

    // A well shared by several identical submissions carries all of them. Every
    // merged value is DERIVED here from the contributor list, never stored, so
    // removing a contributor from the plate map reverts the sample_id and the
    // metadata exactly — there is nothing to unpick.
    const parts = contributors.map((c) => ({
      sample_id: sidOf(c.design, c.id),
      author: c.design.author || null,
      ai_model: String(c.design.aiModel || '').trim() || null,
      ai_conversation_link: String(c.design.aiConversationLink || '').trim() || null,
      acknowledgements: String(c.design.acknowledgements || '').trim() || null,
      comments: String(c.design.rationale ?? c.design.comments ?? '').trim() || null
    }));
    // sample_id keeps the same shape as a single submission — the contributors'
    // ids in placement order, underscore-joined.
    let sid = parts.map((p) => p.sample_id).join('_').slice(0, 300);
    if (usedSid.has(sid) && usedSid.get(sid) !== e) sid = `${sid}__${String(lead.id).slice(0, 6)}`;
    usedSid.set(sid, e);

    const joined = (field) => {
      const vals = [...new Set(parts.map((p) => p[field]).filter(Boolean))];
      return vals.length ? vals.join(MERGE_SEP) : null;
    };
    // Rationales are prose, so each is attributed when there is more than one.
    const comments = parts.length === 1
      ? parts[0].comments
      : parts.filter((p) => p.comments).map((p) => `${p.sample_id}: ${p.comments}`).join(MERGE_SEP) || null;

    for (const w of e.wells) {
      bySlot.set(w, {
        sample_id: sid,
        sample_type: 'experimental',
        reagent_list: lead.design.reagentList,
        metadata: {
          design_ids: contributors.map((c) => c.id),
          authors: [...new Set(parts.map((p) => p.author).filter(Boolean))],
          ai_model: joined('ai_model'),
          ai_conversation_link: joined('ai_conversation_link'),
          acknowledgements: joined('acknowledgements'),
          comments,
          protein_target: lead.design.proteinTarget || null,
          well: slotWell(w),
          // Authoritative per-contributor record: who proposed this exact reaction,
          // so credit survives however the joined strings above are read.
          contributors: parts
        }
      });
    }
  }
  const samples = [];
  for (let s = 0; s < SLOTS; s++) if (bySlot.has(s)) samples.push(bySlot.get(s));
  return {
    plate_id: `${key}_${now.toISOString().slice(0, 10)}`.replace(/[^A-Za-z0-9_.-]/g, '_'),
    protein_target: PROTEIN_TARGET_ENUM[target] ?? null,
    n_rows: ROWS,
    n_columns: COLS,
    array_order: 'column',
    reserved_columns: RESERVED_COLS,
    replicate_factor: REPLICATES,
    positive_controls: 0,
    // Controls live only in the reserved columns, which we never fill — otherwise
    // the model would require positive_controls_mixed * 4 control samples here.
    positive_controls_mixed: 0,
    samples,
    metadata: {
      source: 'htbaa-plate-builder',
      built_by: viewerName || null,
      built_at: now.toISOString(),
      unique_designs: entries.length,
      contributing_designs: entries.reduce((n, e) => n + idsOf(e).length, 0)
    }
  };
}

// ── add / remove ────────────────────────────────────────────────────────────
// Pure state transitions, kept out of the component so they can be exercised
// headlessly (scripts/check-plate-ops.mjs). `plates` is always treated as
// immutable: callers get a new object back.

export const targetOf = (design) =>
  TARGETS.includes(design?.proteinTarget) ? design.proteinTarget : null;

// Plate keys for a target, always in plate order (1 → 4). Plates fill front to
// back so the set stays predictable: plate 2 is only touched once plate 1 can't
// take a composition (full, or already carrying that exact reaction).
export function plateOrder(target) {
  return Array.from({ length: PLATES_PER_TARGET }, (_, i) => plateKey(target, i));
}

// Free slots on a plate, in designs rather than wells.
const roomOn = (plates, key) => PER_PLATE - (plates[key]?.length ?? 0);

// An entry's contributors. Entries are stored as { designIds: [...] }; older saved
// layouts used a single `designId`, so read through both.
export const idsOf = (entry) =>
  Array.isArray(entry?.designIds) ? entry.designIds : (entry?.designId ? [entry.designId] : []);

// Every design id currently on any plate, across all contributors.
export const placedIdsOf = (plates) =>
  new Set(Object.values(plates).flatMap((entries) => entries.flatMap(idsOf)));

/**
 * Place designs across the plates for their protein targets.
 *
 * Guards, in order, so nothing surfaces only at export time:
 *   · the same design can never be placed twice (deduped within the call too)
 *   · a design with no protein target, or an invalid reagent_list, is refused
 *   · a design whose reagents exactly match one already placed is MERGED into it
 *     rather than given its own wells — the same reaction twice would waste 4 wells
 *     and the pydantic model groups replicates by (sample_id, reagents) anyway. The
 *     merged design becomes a co-contributor: its sample_id, model, chat link,
 *     acknowledgements and rationale are folded into the shared well on export, and
 *     removing it puts everything back (see plateJson — nothing is baked in)
 *   · capacity is judged against the RUNNING state, so a bulk add flows onto the
 *     next plate instead of stopping at the first full one
 *
 * Plates fill in order (1 → 4). With `keepTogether` (how a batch is added) the
 * members sharing a protein target are placed on ONE plate — the first that can
 * hold all of them — so a batch designed to be compared isn't split across plates.
 * If no single plate can take the whole group, it falls back to filling in order.
 *
 * @returns {{plates: object, added: Array, skipped: Array, nextSeq: number}}
 */
export function addDesignsToPlates(plates, designs, {
  validate = () => ({ valid: true }),
  fingerprint = () => null,
  keepTogether = false,
  seq = 0
} = {}) {
  const next = { ...plates };
  const placed = placedIdsOf(next);
  const added = [];
  const skipped = [];
  let nextSeq = seq;

  // Per-target plate chosen for a kept-together group, and how many of that
  // target the call is placing (so we can pick a plate with room for all).
  const groupHome = {};
  if (keepTogether) {
    const wanted = {};
    for (const d of designs) {
      const t = targetOf(d);
      if (t && d?.id && !placed.has(d.id)) wanted[t] = (wanted[t] ?? 0) + 1;
    }
    for (const [t, n] of Object.entries(wanted)) {
      if (n < 2) continue; // a single composition just fills in order
      const home = plateOrder(t).find((k) => roomOn(next, k) >= n);
      if (home) groupHome[t] = home;
    }
  }

  const seen = new Set();
  for (const design of designs) {
    if (!design?.id) continue;
    if (seen.has(design.id)) continue; // same id twice in one call
    seen.add(design.id);

    if (placed.has(design.id)) { skipped.push({ id: design.id, name: design.name, reason: 'already_placed' }); continue; }
    const target = targetOf(design);
    if (!target) { skipped.push({ id: design.id, name: design.name, reason: 'no_target' }); continue; }
    const check = validate(design);
    if (!check.valid) { skipped.push({ id: design.id, name: design.name, reason: 'invalid', detail: check.detail }); continue; }

    const fp = fingerprint(design);
    const order = plateOrder(target);

    // Same reaction already on a plate? Join it as a co-contributor instead of
    // spending another four wells on an identical well.
    if (fp) {
      let mergedInto = null;
      for (const k of order) {
        const i = (next[k] ?? []).findIndex((e) => e.fingerprint === fp);
        if (i < 0) continue;
        const entry = next[k][i];
        next[k] = [...next[k]];
        next[k][i] = { ...entry, designIds: [...idsOf(entry), design.id] };
        mergedInto = { key: k, wells: entry.wells, with: idsOf(entry) };
        break;
      }
      if (mergedInto) {
        placed.add(design.id);
        added.push({
          id: design.id, name: design.name, key: mergedInto.key,
          wells: mergedInto.wells, merged: mergedInto, displaced: null
        });
        continue;
      }
    }

    const fits = (k) => (next[k]?.length ?? 0) < PER_PLATE;
    // A batch keeps its target's members on one plate where it can: the group's
    // home is chosen once, by the first member of that target to be placed.
    const key = (keepTogether && groupHome[target] && fits(groupHome[target]))
      ? groupHome[target]
      : order.find(fits);
    if (keepTogether && key && !groupHome[target]) groupHome[target] = key;
    if (!key) { skipped.push({ id: design.id, name: design.name, reason: 'plates_full', target }); continue; }

    const entries = next[key] ?? [];
    const occupied = new Set(entries.flatMap((e) => e.wells));
    const wells = placementFor(key, design.id, occupied);
    if (!wells) { skipped.push({ id: design.id, name: design.name, reason: 'plates_full', target }); continue; }

    next[key] = [...entries, { designIds: [design.id], wells, fingerprint: fp ?? undefined, seq: nextSeq++ }];
    placed.add(design.id);
    added.push({ id: design.id, name: design.name, key, wells, merged: null, displaced: null });
  }
  return { plates: next, added, skipped, nextSeq };
}

// Drop design ids from every plate. Removing one contributor from a shared well
// leaves the well (and its other contributors) in place; the well is only freed
// when its last contributor goes. Everything a merge added is derived at export
// time, so this is all it takes to undo one.
export function removeDesignsFromPlates(plates, ids) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  const next = {};
  let removed = 0;
  let unmerged = 0;
  for (const [key, entries] of Object.entries(plates)) {
    const kept = [];
    for (const e of entries) {
      const before = idsOf(e);
      const after = before.filter((id) => !set.has(id));
      if (after.length === before.length) { kept.push(e); continue; }
      if (!after.length) { removed += 1; continue; }
      unmerged += before.length - after.length;
      kept.push({ ...e, designIds: after });
    }
    next[key] = kept;
  }
  return { plates: next, removed, unmerged };
}

// Entries whose design no longer exists upstream (deleted by its author after
// being placed) would hold wells hostage and fail only at export — drop them.
export function pruneMissing(plates, knownIds) {
  const next = {};
  const dropped = [];
  for (const [key, entries] of Object.entries(plates)) {
    const kept = [];
    for (const e of entries) {
      const before = idsOf(e);
      const after = before.filter((id) => knownIds.has(id));
      for (const id of before) if (!after.includes(id)) dropped.push({ key, designId: id });
      if (after.length) kept.push({ ...e, designIds: after });
    }
    next[key] = kept;
  }
  return { plates: next, dropped };
}

// Every placed entry in the order it was added, across all plates. Entries saved
// before sequence numbers existed fall back to plate order, which is also their
// insertion order within a plate.
export function placementOrder(plates) {
  const rows = [];
  for (const [key, entries] of Object.entries(plates)) {
    entries.forEach((e, i) => rows.push({ ...e, key, idx: i }));
  }
  return rows.sort((a, b) => {
    const as = Number.isFinite(a.seq) ? a.seq : Infinity;
    const bs = Number.isFinite(b.seq) ? b.seq : Infinity;
    if (as !== bs) return as - bs;
    return a.key === b.key ? a.idx - b.idx : a.key.localeCompare(b.key);
  });
}

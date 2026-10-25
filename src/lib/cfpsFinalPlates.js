// Final plate selection: which submitted compositions make the four plates per
// protein target, and WHY each one did or didn't.
//
// Pure and deterministic — the same submissions and options always give the same
// plates, so the result can be re-derived by anyone and re-run after people edit
// their designs. No randomness, no wall-clock, no network. Placement onto wells
// stays in ./routes/cfps/plateMap.js; this module only CHOOSES.
//
// Every composition comes back with a decision record ({ step, reason, detail })
// and every step below is also published as prose in SELECTION_RULES, so the page
// can show the rule and the outcome side by side.
//
// Goals, in the order the steps enforce them:
//   1. nothing that can't run reaches a plate
//   2. every participant is represented
//   3. the set spans the widest range of reagent levels we can fit
//   4. a batch stays whole (and on one plate) so its arms stay comparable

import { validateReagentList, templateMismatch, reagentListKey } from './cfpsReagentContract.js';
import { evaluateRangeChecks, componentConcentration, tunableFields } from './cfpsRangeChecks.js';

export const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];
export const PLATES_PER_TARGET = 4;
export const DESIGNS_PER_PLATE = 80; // 320 wells / 4 replicates
export const CAPACITY = PLATES_PER_TARGET * DESIGNS_PER_PLATE; // 320 per target

export const DEFAULT_OPTIONS = {
  // Guaranteed slots per participant per target (goal 2). Raising it crowds out
  // coverage; 1 is the floor the coopetition promised.
  perUserFloor: 1,
  // Most slots any one participant can take per target, so a prolific submitter
  // can't fill a plate. null = no cap.
  perUserCap: 12,
  // Biggest batch kept whole. A longer batch is subsetted to this many arms,
  // evenly spaced along the reagent it varies, so the trend survives.
  maxBatchArms: 16,
  // Levels each reagent's observed range is split into for coverage scoring.
  coverageBins: 10,
  // Closest two independent recipes may sit in normalised reagent space. Keeps a
  // composition one 25 nL step from another out of its own wells. Arms of the
  // same batch are exempt — a titration is meant to step in small increments —
  // and the rule is relaxed rather than leave a well empty. 0 disables it.
  minSeparation: 0.05,
  // Composition ids to force in / force out, whatever the scoring says.
  pinned: [],
  excluded: []
};

// The algorithm in prose, rendered on the page next to the results. Keep in step
// with the code below — each `id` matches the `step` on a decision record.
export const SELECTION_RULES = [
  { id: 'eligible', title: 'Remove critical errors',
    bullets: [
      'Out: no ATP-regeneration substrate at all.',
      'Out: a Reteplase design with no DsbC, GSSG or GSH \u2014 it cannot fold its disulfides.',
      'Out: any reagent above 10\u00d7 the highest reference control.',
      'Out: a reagent list that breaks the contract (25 nL grid, 20 \u00b5L total, matching template).',
      'Being off a reference is fine \u2014 that is the experiment, and it never costs a slot.'
    ] },
  { id: 'merge', title: 'Merge identical recipes',
    bullets: [
      'Identical volumes are the same experiment, so they share one group of wells.',
      'Every submitter of that recipe is credited on the plate.'
    ] },
  { id: 'floor', title: 'Guarantee everyone an experiment',
    bullets: [
      'Before anything competes, each participant gets their best single composition placed.',
      '\u201cBest\u201d means it adds the most reagent levels the plates do not have yet \u2014 not how closely it resembles a control.',
      'Everyone with at least one runnable composition is represented.'
    ] },
  { id: 'coverage', title: 'Select widest experimental range',
    bullets: [
      'Each reagent\u2019s tested range is split into ten levels, plus \u201cabsent\u201d.',
      'A composition is the set of levels it occupies \u2014 one per reagent.',
      'Each round takes whatever adds the most unseen levels per well it uses.',
      'A recipe closer than \u03b4 to one already placed is skipped, so one 25 nL step does not buy four wells. Arms of the same batch are exempt.',
      'Remaining ties go to whatever sits furthest from everything already placed.'
    ],
    example: 'A \u201clevel\u201d is one slice of a single reagent\u2019s range. Across the sfGFP submissions the smallest dose of PEP anyone proposed is 50 nL and the largest is 6,600 nL. Cut that span into ten equal bands \u2014 each about 655 nL wide \u2014 and add an eleventh for \u201cno PEP at all\u201d: those eleven are PEP\u2019s levels. A composition dosing 3,000 nL falls in the 5th band. Every reagent gets its own eleven, scaled to its own range, so a reagent dosed in tens of nL is judged as finely as one dosed in thousands. In the table below, PEP reads 11/11: the plates test it at all ten amounts and also test leaving it out. Cysteine reads 8/11, so three of its eleven never get tried.',
    plain: 'Picture a checklist: one row per reagent, ten boxes along each row running from the least anyone dosed to the most, plus a box for \u201cnot used at all\u201d. Every composition ticks exactly one box per row. We repeatedly place whichever composition ticks the most boxes nobody has ticked yet, counting the wells it costs \u2014 so a long batch has to earn its extra wells. Once there is nothing new left to tick, we fall back to picking whatever looks least like the recipes already down, and skip anything that is practically a copy of one.',
    math: [
      { expr: 'level_f(v) = \u230a (v \u2212 min_f) / (max_f \u2212 min_f) \u00d7 10 \u230b',
        note: 'Where a dose sits in that reagent\u2019s tested range, as one of ten steps. min_f and max_f are the smallest and largest amounts anyone dosed of reagent f, so each reagent is scored against its own range rather than against nL. A reagent left out entirely gets an eleventh level, \u201cabsent\u201d \u2014 omitting something is a real condition to test.' },
      { expr: 'gain(x) = | levels(x) \\ covered |',
        note: 'How much composition x actually adds. The backslash is set difference: take the levels x occupies, drop the ones already on the plates, count what is left. A composition whose every level is already covered scores zero however unusual it looks.' },
      { expr: 'score = gain / wells',
        note: 'Value per well, because wells are the scarce thing. One composition costs 4 wells; a six-arm batch costs 24, so it has to bring roughly six times the new levels to be worth the same.' },
      { expr: 'd(x) = min \u2016x\u0302 \u2212 \u015d\u2016\u2082  over every placed \u015d,   x\u0302_f = v_f / max_f',
        note: 'How far x is from the nearest recipe already on the plates. Each recipe is a point whose coordinates are its reagent volumes rescaled to 0\u20131, so a reagent dosed in thousands of nL cannot drown out one dosed in tens. \u2016\u00b7\u2016\u2082 is ordinary straight-line (Euclidean) distance.' },
      { expr: 'admit x only if d(x) \u2265 \u03b4,   ties on score \u2192 largest d(x)',
        note: '\u03b4 is 0.05 by default: a recipe sitting within that of one already placed is passed over, so a single 25 nL change does not earn its own four wells. Arms of the same batch are exempt \u2014 stepping in small increments is exactly what a titration is. \u03b4 is dropped rather than leave a well empty, and the page reports whenever that happens.' }
    ] },
  { id: 'batch', title: 'Keep batches together on a plate',
    bullets: [
      'A batch lands on one plate so its arms can be compared directly.',
      'Over the arm limit, it is trimmed evenly along the reagent it varies.',
      'Both ends of the trend are always kept.'
    ] },
  { id: 'cap', title: 'Cap per person',
    bullets: [
      'A limit per participant per target, so nobody fills a plate on their own.',
      'It yields to the last rule when wells would otherwise sit empty.'
    ] },
  { id: 'topup', title: 'Fill every well',
    bullets: [
      'An empty well is a wasted reaction, so all 320 are always used.',
      'If the cap is blocking the last slots, it lifts \u2014 least-represented participants first.',
      'A target only comes up short if there genuinely are not enough runnable compositions.'
    ] }
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const byIdAsc = (a, b) => String(a).localeCompare(String(b));

// Stable identity for a participant: the hashed subject when present, else the
// display name. Mirrors how the community rail counts contributors.
export const participantOf = (d) =>
  d?.contributorKey || (d?.author ? `name:${String(d.author).toLowerCase()}` : `id:${d?.id}`);

// ── eligibility ─────────────────────────────────────────────────────────────
// Why a composition can't be placed, or null when it can.
export function ineligibleReason(design) {
  const rl = design?.reagentList;
  if (!rl || typeof rl !== 'object') return { reason: 'no reagent list', detail: null };
  const { valid, errors } = validateReagentList(rl);
  if (!valid) return { reason: 'fails the submission contract', detail: errors[0] ?? null };
  if (!TARGETS.includes(design.proteinTarget)) return { reason: 'no protein target', detail: null };
  if (templateMismatch(rl, design.proteinTarget)) {
    return { reason: 'DNA template does not match the target', detail: null };
  }
  const warns = evaluateRangeChecks(rl).flags.filter((f) => f.kind === 'warn');
  if (warns.length) {
    return {
      reason: 'flagged by the range checks',
      detail: warns.map((f) => f.message).join('; ')
    };
  }
  return null;
}

// ── coverage space ──────────────────────────────────────────────────────────
// Each tunable reagent's observed range across the candidates, split into bins.
// A candidate "covers" (reagent, bin) cells; the greedy pass maximises how many
// distinct cells the chosen set holds. Absent (0 nL) is its own cell, because
// leaving a reagent out is a real experimental condition.
export function buildCoverageSpace(candidates, bins) {
  const fields = tunableFields();
  const space = {};
  for (const field of fields) {
    let min = Infinity;
    let max = -Infinity;
    let used = false;
    for (const c of candidates) {
      const nl = num(c.reagentList[field]);
      if (nl <= 0) continue;
      used = true;
      if (nl < min) min = nl;
      if (nl > max) max = nl;
    }
    if (!used) continue;
    space[field] = { min, max, bins: max > min ? bins : 1 };
  }
  return space;
}

// The (reagent, level) pairs one reagent list occupies. These are coverage
// LEVELS in reagent space — not plate wells; a composition occupies one level
// per reagent and always four physical wells.
export function levelsOf(reagentList, space) {
  const levels = new Set();
  for (const [field, s] of Object.entries(space)) {
    const nl = num(reagentList[field]);
    if (nl <= 0) { levels.add(`${field}@none`); continue; }
    const frac = s.max > s.min ? (nl - s.min) / (s.max - s.min) : 0;
    const bin = Math.min(s.bins - 1, Math.max(0, Math.floor(frac * s.bins)));
    levels.add(`${field}@${bin}`);
  }
  return levels;
}

// ── units ───────────────────────────────────────────────────────────────────
// A unit is what gets admitted as a whole: a batch, or one standalone candidate.
function buildUnits(candidates) {
  const byBatch = new Map();
  const units = [];
  for (const c of candidates) {
    const bid = c.batchId && num(c.batchSize) > 1 ? c.batchId : null;
    if (!bid) {
      units.push({ kind: 'single', key: `single:${c.key}`, batchId: null, members: [c] });
      continue;
    }
    if (!byBatch.has(bid)) {
      const u = { kind: 'batch', key: `batch:${bid}`, batchId: bid, members: [] };
      byBatch.set(bid, u);
      units.push(u);
    }
    byBatch.get(bid).members.push(c);
  }
  for (const u of units) {
    u.members.sort((a, b) => num(a.batchIndex) - num(b.batchIndex) || byIdAsc(a.key, b.key));
    // A batch belongs to whoever submitted it; mixed-author batches are credited
    // to the first member's participant for capping purposes.
    u.participant = u.members[0].participant;
    u.created = u.members.map((m) => m.created || '').sort()[0] || '';
  }
  return units;
}

// The reagent a batch varies most (by spread of distinct volumes), used to take
// an evenly spaced subset that preserves both ends of the trend.
export function batchVariedField(members) {
  let best = null;
  for (const field of tunableFields()) {
    const vals = [...new Set(members.map((m) => num(m.reagentList[field])))];
    if (vals.length < 2) continue;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const spread = max > 0 ? (max - min) / max : 0;
    const score = vals.length * spread;
    if (!best || score > best.score) best = { field, score, levels: vals.length };
  }
  return best;
}

// Keep `keep` arms out of `members`, evenly spaced along the varied reagent so
// the ends and the middle of the series all survive.
export function subsetBatch(members, keep) {
  if (keep >= members.length) return { kept: members, field: null };
  const varied = batchVariedField(members);
  const ordered = varied
    ? [...members].sort((a, b) => num(a.reagentList[varied.field]) - num(b.reagentList[varied.field]))
    : members;
  const kept = [];
  for (let i = 0; i < keep; i++) {
    kept.push(ordered[Math.round((i * (ordered.length - 1)) / Math.max(1, keep - 1))]);
  }
  // Rounding can land twice on the same arm; back-fill with the nearest unused.
  const seen = new Set(kept.map((m) => m.key));
  for (const m of ordered) {
    if (kept.length >= keep) break;
    if (!seen.has(m.key)) { kept.push(m); seen.add(m.key); }
  }
  return {
    kept: kept.slice(0, keep).sort((a, b) => num(a.batchIndex) - num(b.batchIndex)),
    field: varied?.field ?? null
  };
}

// ── selection for one target ────────────────────────────────────────────────
function selectTarget(target, designs, opts) {
  const decisions = [];
  const record = (d, status, step, reason, detail = null) =>
    decisions.push({
      id: d.id,
      name: d.name,
      author: d.author ?? null,
      participant: participantOf(d),
      batchId: d.batchId ?? null,
      status,
      step,
      reason,
      detail
    });

  const mine = designs
    .filter((d) => d?.proteinTarget === target)
    .sort((a, b) => String(a.created ?? '').localeCompare(String(b.created ?? '')) || byIdAsc(a.id, b.id));

  const pinned = new Set(opts.pinned);
  const forcedOut = new Set(opts.excluded);

  // Step 1 — eligibility, and the manual exclude list.
  const eligible = [];
  for (const d of mine) {
    if (forcedOut.has(d.id)) { record(d, 'excluded', 'manual', 'excluded by hand'); continue; }
    const bad = ineligibleReason(d);
    if (bad) { record(d, 'excluded', 'eligible', bad.reason, bad.detail); continue; }
    eligible.push(d);
  }

  // Step 2 — merge identical reactions into one candidate with several authors.
  const byFingerprint = new Map();
  const candidates = [];
  for (const d of eligible) {
    const fp = reagentListKey(d.reagentList);
    const existing = byFingerprint.get(fp);
    if (existing) {
      // Recorded later, once we know whether the shared candidate was chosen, so
      // every design ends up with exactly one decision.
      d.__mergedInto = existing.designs[0].name;
      existing.designs.push(d);
      if (pinned.has(d.id)) existing.pinned = true;
      continue;
    }
    const c = {
      key: fp,
      designs: [d],
      reagentList: d.reagentList,
      batchId: d.batchId ?? null,
      batchSize: d.batchSize ?? null,
      batchIndex: d.batchIndex ?? null,
      participant: participantOf(d),
      created: d.created ?? '',
      pinned: pinned.has(d.id)
    };
    byFingerprint.set(fp, c);
    candidates.push(c);
  }

  const space = buildCoverageSpace(candidates, opts.coverageBins);
  for (const c of candidates) c.levels = levelsOf(c.reagentList, space);

  // Normalised recipe vector (each reagent scaled to its own observed max) and
  // the running Euclidean distance from every candidate to the nearest
  // composition already placed. Coverage decides the pick; this breaks the ties,
  // which is what stops two recipes a single 25 nL step apart both getting wells.
  const axes = Object.keys(space);
  const axisMax = Object.fromEntries(axes.map((f) => [f, Math.max(...candidates.map((c) => num(c.reagentList[f])), 0)]));
  for (const c of candidates) {
    c.vec = axes.map((f) => (axisMax[f] > 0 ? num(c.reagentList[f]) / axisMax[f] : 0));
  }
  const l2 = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum);
  };
  const nnDist = new Map(candidates.map((c) => [c.key, Infinity]));
  const notePlaced = (m) => {
    for (const c of candidates) {
      if (c.chosen) continue;
      const d = l2(c.vec, m.vec);
      if (d < nnDist.get(c.key)) nnDist.set(c.key, d);
    }
  };
  // Mean distance of a unit's members from the placed set.
  const spread = (members) =>
    members.reduce((t, m) => t + (nnDist.get(m.key) === Infinity ? 1e3 : nnDist.get(m.key)), 0) / members.length;
  // Is this candidate far enough from what's already down? Arms of a batch that
  // is already (partly) placed are exempt: their whole point is small steps.
  let tooClose = 0;
  const placedBatchIds = () => new Set(chosen.map((c) => c.batchId).filter(Boolean));
  const farEnough = (c, batchesDown) =>
    !(opts.minSeparation > 0) ||
    (c.batchId && batchesDown.has(c.batchId)) ||
    nnDist.get(c.key) >= opts.minSeparation;

  const units = buildUnits(candidates);
  const covered = new Set();
  // level → the first placed composition that reached it, so a composition left
  // out for adding nothing can point at exactly what already covers its ground.
  const levelOwner = new Map();
  const chosen = [];
  const perUser = new Map();
  const subsetted = [];
  let slots = 0;

  const room = () => CAPACITY - slots;
  const userCount = (p) => perUser.get(p) ?? 0;
  const gain = (members) => {
    const fresh = new Set();
    for (const m of members) for (const lv of m.levels) if (!covered.has(lv)) fresh.add(lv);
    return fresh.size;
  };
  const admit = (unit, members, step, reason, detail = null) => {
    for (const m of members) {
      chosen.push({ ...m, unitKey: unit.key, batchId: unit.batchId });
      for (const lv of m.levels) {
        covered.add(lv);
        if (!levelOwner.has(lv)) levelOwner.set(lv, m);
      }
      m.chosen = true;
      notePlaced(m);
      for (const d of m.designs) {
        if (d.__mergedInto) {
          record(d, 'selected', 'merge', `identical to ${d.__mergedInto}`,
            'shares one well group with it; both authors credited');
        } else {
          record(d, 'selected', step, reason, detail);
        }
      }
    }
    slots += members.length;
    perUser.set(unit.participant, userCount(unit.participant) + members.length);
  };

  // Step 3 — pinned compositions first; they bypass scoring but not capacity.
  for (const unit of units) {
    const members = unit.members.filter((m) => m.pinned && !m.chosen);
    if (!members.length) continue;
    const take = members.slice(0, room());
    if (take.length) admit(unit, take, 'manual', 'pinned by hand');
  }

  // Step 4 — one slot per participant: each person's highest-gain candidate.
  if (opts.perUserFloor > 0) {
    const byUser = new Map();
    for (const c of candidates) {
      if (c.chosen) continue;
      if (!byUser.has(c.participant)) byUser.set(c.participant, []);
      byUser.get(c.participant).push(c);
    }
    const users = [...byUser.keys()].sort(byIdAsc);
    for (const p of users) {
      for (let n = userCount(p); n < opts.perUserFloor; n++) {
        if (room() <= 0) break;
        const pool = byUser.get(p).filter((c) => !c.chosen);
        if (!pool.length) break;
        // Highest gain wins; ties go to the earliest submission so it's stable.
        let pick = pool[0];
        let pickGain = gain([pick]);
        for (const c of pool.slice(1)) {
          const g = gain([c]);
          if (g > pickGain ||
              (g === pickGain && (nnDist.get(c.key) > nnDist.get(pick.key) ||
                (nnDist.get(c.key) === nnDist.get(pick.key) && byIdAsc(c.created, pick.created) < 0)))) {
            pick = c;
            pickGain = g;
          }
        }
        const unit = units.find((u) => u.members.includes(pick));
        admit(unit, [pick], 'floor', 'first slot for this participant',
          `adds ${pickGain} reagent levels not yet covered`);
      }
    }
  }

  // Step 5 — greedy coverage over whole units, best gain per slot first.
  for (;;) {
    if (room() <= 0) break;
    let best = null;
    const batchesDown = placedBatchIds();
    for (const unit of units) {
      const left = unit.members.filter((m) => !m.chosen);
      if (!left.length) continue;
      if (opts.perUserCap != null && userCount(unit.participant) >= opts.perUserCap) continue;
      // A standalone recipe sitting on top of one already placed is passed over.
      if (unit.kind === 'single' && !farEnough(left[0], batchesDown)) continue;

      // How many arms we could take: capacity, the arm limit, and the per-user cap.
      let allowed = Math.min(left.length, room(), opts.maxBatchArms);
      if (opts.perUserCap != null) allowed = Math.min(allowed, opts.perUserCap - userCount(unit.participant));
      if (allowed <= 0) continue;
      const take = allowed < left.length ? subsetBatch(left, allowed) : { kept: left, field: null };
      const g = gain(take.kept);
      const score = g / take.kept.length;
      const far = spread(take.kept);
      const better = !best || score > best.score ||
        (score === best.score && (far > best.far ||
          (far === best.far && byIdAsc(unit.created, best.unit.created) < 0)));
      if (better) best = { unit, take, gain: g, score, far };
    }
    if (!best || best.gain <= 0) break;

    const { unit, take } = best;
    const full = unit.members.filter((m) => !m.chosen);
    const partial = take.kept.length < full.length;
    const detail = `adds ${best.gain} reagent levels not yet covered`;
    if (unit.kind === 'batch' && partial) {
      subsetted.push({
        batchId: unit.batchId,
        author: unit.members[0].designs[0].author ?? null,
        kept: take.kept.length,
        of: unit.members.length,
        variedField: take.field,
        reason: opts.perUserCap != null && opts.perUserCap - userCount(unit.participant) < full.length
          ? 'per-participant cap'
          : full.length > opts.maxBatchArms ? 'longer than the arm limit' : 'remaining plate space'
      });
    }
    admit(unit, take.kept, unit.kind === 'batch' ? 'batch' : 'coverage',
      unit.kind === 'batch'
        ? (partial ? `batch kept together (${take.kept.length} of ${unit.members.length} arms)` : 'batch kept together')
        : 'widest coverage',
      detail);
  }

  // Steps 6-7 — fill the plates. Coverage still leads: a composition that brings
  // a reagent level nothing else has goes on before one that brings none, so a
  // leftover is never something the set actually needed. Fairness breaks ties
  // (fewest slots first), then arms that complete a batch already placed. The
  // cap holds for the first pass and lifts for the second, because an empty well
  // is a wasted reaction.
  let capRelaxed = 0;
  for (const pass of ['capped', 'uncapped']) {
    for (;;) {
      if (room() <= 0) break;
      const placedBatches = placedBatchIds();
      const avail = candidates.filter(
        (c) => !c.chosen &&
          (pass === 'uncapped' || opts.perUserCap == null || userCount(c.participant) < opts.perUserCap)
      );
      if (!avail.length) break;
      // Prefer recipes that clear the separation guard; drop it only if that
      // would leave wells empty, and count how often that happened.
      const spaced = avail.filter((c) => farEnough(c, placedBatches));
      const pool = spaced.length ? spaced : avail;
      if (!spaced.length) tooClose += 1;
      let pick = null;
      let pickGain = -1;
      for (const c of pool) {
        const g = gain([c]);
        if (pick === null) { pick = c; pickGain = g; continue; }
        // gain → fairness → distance from what's already placed → submission order
        const better =
          g > pickGain ||
          (g === pickGain && (
            userCount(c.participant) < userCount(pick.participant) ||
            (userCount(c.participant) === userCount(pick.participant) && (
              nnDist.get(c.key) > nnDist.get(pick.key) ||
              (nnDist.get(c.key) === nnDist.get(pick.key) && (
                (placedBatches.has(c.batchId) ? 1 : 0) > (placedBatches.has(pick.batchId) ? 1 : 0) ||
                ((placedBatches.has(c.batchId) ? 1 : 0) === (placedBatches.has(pick.batchId) ? 1 : 0) &&
                  byIdAsc(c.created, pick.created) < 0)
              ))
            ))
          ));
        if (better) { pick = c; pickGain = g; }
      }
      const unit = units.find((u) => u.members.includes(pick));
      if (pass === 'uncapped') capRelaxed += 1;
      admit(unit, [pick], pass === 'uncapped' ? 'topup' : 'fill',
        pickGain > 0 ? 'adds reagent levels nothing else covers'
          : placedBatches.has(pick.batchId) ? 'completes a batch already on the plates'
            : 'fills a well that would otherwise be empty',
        pass === 'uncapped'
          ? `the cap of ${opts.perUserCap} was lifted for the last wells rather than leave them empty`
          : pickGain > 0 ? `adds ${pickGain} new reagent levels` : 'coverage was already complete; slots shared out fewest-first');
    }
  }

  // Everything still standing: say which rule stopped it.
  for (const c of candidates) {
    if (c.chosen) continue;
    // Leftovers are judged against the FINISHED set, not against where the loop
    // happened to stop: the plates filled coverage-first, so anything left over
    // either tests nothing new, or lost a tie to a less-represented participant.
    const fresh = [...c.levels].filter((lv) => !covered.has(lv));
    // Which placed compositions already test this one's ground, biggest overlap
    // first — so "it adds nothing new" can be checked rather than taken on trust.
    const overlap = new Map();
    for (const lv of c.levels) {
      const owner = levelOwner.get(lv);
      if (!owner) continue;
      overlap.set(owner, (overlap.get(owner) ?? 0) + 1);
    }
    const coveredBy = [...overlap.entries()]
      .sort((a, b) => b[1] - a[1] || byIdAsc(a[0].designs[0].id, b[0].designs[0].id))
      .slice(0, 5)
      .map(([m, n]) => ({
        id: m.designs[0].id,
        name: m.designs[0].name,
        author: m.designs[0].author ?? null,
        levels: n
      }));
    const reason = fresh.length === 0
      ? 'every reagent level it tests is already on the plates'
      : `${fresh.length} of its reagent levels are new, but other compositions covered more per well`;
    const detail = fresh.length === 0
      ? `its ${c.levels.size} reagent levels are all covered by compositions already selected`
      : `held back at ${userCount(c.participant)} slots for this participant so less-represented people kept theirs`;
    for (const d of c.designs) {
      const rec = {
        id: d.id, name: d.name, author: d.author ?? null, participant: participantOf(d),
        batchId: d.batchId ?? null, status: 'not-selected', step: 'coverage', reason,
        detail: d.__mergedInto ? `identical to ${d.__mergedInto}, which was also not selected` : detail,
        coveredBy
      };
      decisions.push(rec);
    }
  }

  return {
    target,
    capacity: CAPACITY,
    slotsUsed: slots,
    // > 0 only when there genuinely aren't enough runnable compositions.
    shortfall: CAPACITY - slots,
    capRelaxedFor: capRelaxed,
    // Wells filled with a recipe closer than minSeparation, because nothing
    // further away was left.
    tooCloseFor: tooClose,
    // Closest pair among the chosen recipes, in normalised reagent space — the
    // number the distance tie-break exists to raise.
    minSeparation: (() => {
      let m = Infinity;
      for (let i = 0; i < chosen.length; i++) {
        for (let j = i + 1; j < chosen.length; j++) {
          const d = l2(chosen[i].vec, chosen[j].vec);
          if (d < m) m = d;
        }
      }
      return Number.isFinite(m) ? m : null;
    })(),
    chosen,
    decisions,
    subsetted,
    coverage: summariseCoverage(chosen, space, covered),
    hypotheses: summariseHypotheses(chosen),
    themes: [],
    participants: {
      eligible: new Set(candidates.map((c) => c.participant)).size,
      represented: new Set(chosen.map((c) => c.participant)).size,
      bySlots: [...perUser.entries()].map(([p, n]) => ({ participant: p, slots: n })).sort((a, b) => b.slots - a.slots)
    }
  };
}

// Reagent ranges the selected set actually spans, in delivered units.
function summariseCoverage(chosen, space, covered) {
  const rows = [];
  for (const [field, s] of Object.entries(space)) {
    const used = chosen.map((c) => num(c.reagentList[field]));
    const dosed = used.filter((v) => v > 0);
    const hit = [...covered].filter((k) => k.startsWith(`${field}@`)).length;
    const lo = componentConcentration(field, dosed.length ? Math.min(...dosed) : 0);
    const hi = componentConcentration(field, dosed.length ? Math.max(...dosed) : 0);
    rows.push({
      field,
      dosedIn: dosed.length,
      absentIn: used.length - dosed.length,
      minNl: dosed.length ? Math.min(...dosed) : 0,
      maxNl: dosed.length ? Math.max(...dosed) : 0,
      min: lo?.value ?? null,
      max: hi?.value ?? null,
      unit: lo?.unit ?? '',
      levelsCovered: hit,
      levelsPossible: s.bins + 1
    });
  }
  return rows.sort((a, b) => b.levelsCovered - a.levelsCovered || a.field.localeCompare(b.field));
}

// What the plates are testing, from the batch hypotheses and per-design rationales.
function summariseHypotheses(chosen) {
  const byText = new Map();
  for (const c of chosen) {
    for (const d of c.designs) {
      const text = String(d.experimentHypothesis || d.comments || '').trim();
      if (!text) continue;
      const key = text.slice(0, 400);
      if (!byText.has(key)) {
        byText.set(key, { text: key, authors: new Set(), batchId: d.batchId ?? null, slots: 0 });
      }
      const h = byText.get(key);
      if (d.author) h.authors.add(d.author);
      h.slots += 1;
    }
  }
  return [...byText.values()]
    .map((h) => ({ ...h, authors: [...h.authors].sort() }))
    .sort((a, b) => b.slots - a.slots)
    .slice(0, 60);
}

// ── presentation view ───────────────────────────────────────────────────────
// Three themes the plates can be talked through, for showing the experiment to
// a room rather than reading 60 submitted rationales. The grouping and the
// "why" are written here (they are biology, not data); every number beside them
// is measured from the compositions actually selected.
export const THEMES = [
  {
    key: 'energy',
    title: 'Energy supply and cost',
    question: 'What is the cheapest way to keep ATP regenerating for a full reaction?',
    fields: [
      'pep_mono', 'ribose', 'glucose', 'maltose', 'maltodextrin_17', 'sodium_pyruvate',
      'dilithium_acetyl_phosphate', 'sodium_hexametaphosphate', 'potassium_phosphate_dibasic',
      'potassium_phosphate_monobasic', 'kpo_dibasic_mix', 'kpo_monobasic_mix',
      'atp', 'ctp', 'gtp', 'utp', 'amp', 'cmp', 'gmp', 'ump',
      'adenosine', 'guanosine', 'cytidine', 'uridine', 'thymidine',
      'adenine', 'guanine', 'cytosine', 'uracil', 'thymine', 'nad', 'nicotinamide', 'camp', 'coa'
    ],
    why: 'PEP and the nucleotide triphosphates dominate the price of a reaction. Swapping them for cheaper substrates — ribose, glucose, maltodextrin, the nucleotide monophosphates — only pays off if titer holds up, and phosphate has to stay buffered in a narrow window or yield collapses. These arms test where that trade stops working.'
  },
  {
    key: 'folding',
    title: 'Folding and active protein',
    question: 'What does it take to get protein that actually works, not just protein?',
    fields: [
      'dsbc_ecoli', 'oxidized_glutathione', 'reduced_glutathione', 'cysteine',
      'peg_8000', 'brij_35', 'dmso', 'catalase', 'pyruvate_oxidase'
    ],
    why: 'Yield and activity are not the same measurement. Disulfide bonds need an oxidising environment and an isomerase to reshuffle wrong pairings, and crowding or detergent can keep a hydrophobic protein in solution.',
    byTarget: {
      Reteplase: 'Reteplase carries nine disulfide bonds, so this is the theme that decides whether it folds at all: the DsbC and GSSG/GSH arms are the core of its plates.',
      PETase: 'PETase depends on a single Cys273–Cys289 disulfide for stability, so it needs far less redox support than Reteplase — these arms test how much.',
      sfGFP: 'sfGFP has no disulfides, so these arms mostly ask whether crowding agents and detergents help or simply cost money.'
    }
  },
  {
    key: 'machinery',
    title: 'Transcription and translation machinery',
    question: 'What buffer, salt and amino-acid conditions let the lysate work hardest?',
    fields: [
      'potassium_glutamate', 'magnesium_glutamate', 'ammonium_glutamate', 'hepes_koh',
      'amino_acid_mix_17', 'tyrosine', 'spermidine', 'putrescine', 'folinic_acid',
      'potassium_oxalate', 'oxaloacetic_acid', 'succinic_acid', 'potassium_formate'
    ],
    why: 'Magnesium and potassium set ribosome activity and have sharp optima; HEPES stops the pH crash that kills a long reaction; polyamines such as spermidine stabilise nucleic acids and reliably lift titer for very little money. These arms map those optima.'
  }
];

const THEME_OF = Object.fromEntries(THEMES.flatMap((t) => t.fields.map((f) => [f, t.key])));

// Each theme with live numbers from the selected set: the reagents it spans,
// their ranges, how many compositions move them and how many people proposed it.
export function themeSummary(target, chosen, coverage) {
  const byField = Object.fromEntries(coverage.map((c) => [c.field, c]));
  return THEMES.map((theme) => {
    const reagents = theme.fields
      .map((f) => byField[f])
      .filter(Boolean)
      .sort((a, b) => b.levelsCovered - a.levelsCovered || b.dosedIn - a.dosedIn);
    const people = new Set();
    let compositions = 0;
    for (const c of chosen) {
      const touches = theme.fields.some((f) => num(c.reagentList[f]) > 0);
      if (!touches) continue;
      compositions += 1;
      for (const d of c.designs) people.add(d.author || d.id);
    }
    return {
      key: theme.key,
      title: theme.title,
      question: theme.question,
      why: theme.byTarget?.[target] ? `${theme.why} ${theme.byTarget[target]}` : theme.why,
      reagents: reagents.slice(0, 6),
      reagentCount: reagents.length,
      compositions,
      people: people.size
    };
  });
}

// Who contributed what, for the leaderboard. `ideas` counts distinct reactions
// a person has on the plates (a merged well counts for every submitter).
export function leaderboard(perTarget) {
  const by = new Map();
  for (const [target, r] of Object.entries(perTarget)) {
    for (const c of r.chosen) {
      for (const d of c.designs) {
        const key = d.author || d.id;
        if (!by.has(key)) {
          by.set(key, { author: d.author || 'unknown', ideas: 0, byTarget: {}, batches: new Set(), items: [] });
        }
        const row = by.get(key);
        row.ideas += 1;
        row.byTarget[target] = (row.byTarget[target] ?? 0) + 1;
        if (c.batchId) row.batches.add(c.batchId);
        row.items.push({ id: d.id, name: d.name, target, batchId: c.batchId ?? null, shared: c.designs.length > 1 });
      }
    }
  }
  const submittedBy = new Map();
  for (const r of Object.values(perTarget)) {
    for (const d of r.decisions) {
      const key = d.author || d.id;
      submittedBy.set(key, (submittedBy.get(key) ?? 0) + 1);
    }
  }
  return [...by.values()]
    .map((r) => ({
      ...r,
      batches: r.batches.size,
      submitted: submittedBy.get(r.author) ?? r.ideas,
      items: r.items.sort((a, b) => a.target.localeCompare(b.target) || a.name.localeCompare(b.name))
    }))
    .sort((a, b) => b.ideas - a.ideas || a.author.localeCompare(b.author));
}

/**
 * Choose the final plates for every target.
 *
 * @param {object[]} designs community compositions (loadCommunityDesigns shape)
 * @param {object} options   see DEFAULT_OPTIONS
 * @returns {{ options, perTarget: Record<string, object>, totals: object }}
 */
export function selectFinalPlates(designs = [], options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const perTarget = {};
  for (const t of TARGETS) {
    perTarget[t] = selectTarget(t, designs, opts);
    perTarget[t].themes = themeSummary(t, perTarget[t].chosen, perTarget[t].coverage);
  }
  const totals = {
    submitted: designs.length,
    slotsUsed: TARGETS.reduce((n, t) => n + perTarget[t].slotsUsed, 0),
    capacity: TARGETS.length * CAPACITY,
    participantsRepresented: new Set(
      TARGETS.flatMap((t) => perTarget[t].chosen.map((c) => c.participant))
    ).size,
    participantsEligible: new Set(
      designs.filter((d) => !ineligibleReason(d)).map(participantOf)
    ).size
  };
  return { options: opts, perTarget, totals, leaderboard: leaderboard(perTarget) };
}

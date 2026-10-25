// Advisory reagent range checks — a JS port of the per-well WellFlag checks in
// autonomous-cfps (references.py: evaluate_well_flags + evaluate_well_energy, as
// combined by validate_design). Shared by the browser designer (submit alerts,
// hover indicators) and the submit endpoints (which refuse out-of-range designs
// unless the caller sets ALLOW_OUT_OF_RANGE_FIELD).
//
// The DATA (per-reagent concentration factors, reference concentrations,
// watchlists, energy substrates, the 0.5×–2× band) is generated from the real
// Python by `npm run sync:cfps` into cfpsReagentSpec.generated.json → rangeChecks.
// Parity with the Python is checked by `node tools/check-cfps-range-parity.mjs`,
// which replays recipes whose expected flags the Python itself produced.
//
// The checks, per experimental composition:
//   • energy presence — at least one ATP-regeneration substrate must be dosed.
//   • watchlist — each watchlisted component's total delivered concentration
//     (base-buffer floor included) within a band around the target's references.
//   • energy band — when the dosed energy-substrate set exactly matches a
//     same-target energy reference, each substrate within a band around it.
//   • reference zero (info only) — a reteplase redox extra (DsbC, GSSG, GSH)
//     dosed where the target's standard reference has none.
//
// Two policies:
//   • 'autonomous-cfps' — exactly the Python: watchlist vs the target's STANDARD
//     reference only, energy vs the matched reference, both within 0.5×–2×.
//     Used by the parity test.
//   • 'site' (default; what the designer and submit endpoints enforce) — a
//     deliberate, much looser SITE-ONLY override so alerts mean "this will not
//     work", not "a little off" (2026-10-25): a watchlisted component flags only
//     when it is MISSING (zero; only DsbC / GSSG / GSH can be, everything else
//     has a base-buffer floor) or more than SITE_BAND.high× the highest value
//     across ALL the target's reference controls; a matched energy substrate
//     flags only above SITE_BAND.high× its reference. Low-but-present values
//     never flag. Diverges from validate_design on purpose.

import spec from './cfpsReagentSpec.generated.json';

const RC = spec.rangeChecks;
const COMPONENT_NAMES = Object.keys(RC.components);
const ENERGY = RC.energySubstrates;
const UNEXPECTED_REFERENCE_ZERO = new Set(RC.unexpectedReferenceZero);

// Request flag that lets a submission through despite warn-level flags.
export const ALLOW_OUT_OF_RANGE_FIELD = 'allow_out_of_range';
export const RANGE_BAND = { low: RC.bandLow, high: RC.bandHigh };
// Site policy band: fold distance allowed beyond the reference envelope.
// low 0 = only a missing (zero) component is too low; anything dosed passes the low side.
export const SITE_BAND = { low: 0, high: 10 };

// Python formats with round-half-EVEN on the exact binary value; JS toFixed /
// toExponential round exact ties UP (1.3125 → "1.313" vs Python's "1.312").
// If x (> 0) is an exact tie when rounded to `d` decimals and half-even would
// round down, nudge it one ulp down so JS lands on Python's digit.
function halfEven(x, d) {
  if (!(x > 0) || !Number.isFinite(x)) return x;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (biased) mant |= 1n << 52n;
  const q = (biased || 1) - 1075; // x = mant × 2^q exactly
  // 2·x·10^d as an exact fraction num/den; a tie means it's an odd integer.
  let num = 2n * mant * (q > 0 ? 1n << BigInt(q) : 1n) * (d > 0 ? 10n ** BigInt(d) : 1n);
  const den = (q < 0 ? 1n << BigInt(-q) : 1n) * (d < 0 ? 10n ** BigInt(-d) : 1n);
  if (num % den !== 0n) return x;
  num /= den;
  if (num % 2n === 0n) return x; // not a tie
  const lower = (num - 1n) / 2n;
  return lower % 2n === 0n ? x * (1 - Number.EPSILON) : x;
}

// Python's format(x, '.3f').
function fmtFixed(x, digits) {
  return halfEven(x, digits).toFixed(digits);
}

// Python's format(x, '.4g'): 4 significant figures, trailing zeros stripped,
// exponent form (e.g. 1.5e+04) when the exponent is < -4 or ≥ the precision.
function fmtG(x, precision = 4) {
  if (x === 0) return '0';
  if (!Number.isFinite(x)) return String(x);
  const e0 = Number(Math.abs(x).toExponential(20).split('e')[1]);
  x = Math.sign(x) * halfEven(Math.abs(x), precision - 1 - e0);
  const [mantissa, expStr] = x.toExponential(precision - 1).split('e');
  const exp = Number(expStr);
  if (exp < -4 || exp >= precision) {
    const m = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa;
    const e = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : String(Math.abs(exp));
    return `${m}e${exp < 0 ? '-' : '+'}${e}`;
  }
  const fixed = x.toFixed(Math.max(0, precision - 1 - exp));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

function componentValue(name, volumeNl) {
  const c = RC.components[name];
  return c.floor + c.perNl * (Number(volumeNl) || 0);
}

// Delivered concentration of one reagent field at a dispense volume, in the unit
// autonomous-cfps reports it in (base-buffer floor included). Exported so other
// modules (the final-plate selector) can describe reagent ranges in real units
// rather than nL. Unknown field → null.
export function componentConcentration(field, volumeNl) {
  const c = RC.components[field];
  return c ? { value: c.floor + c.perNl * (Number(volumeNl) || 0), unit: c.unit } : null;
}

// Fields whose concentration is meaningful to compare (excludes the fixed
// backbone: base buffer, lysate, templates, water).
export function tunableFields() {
  return COMPONENT_NAMES.filter(
    (n) => RC.components[n].perNl > 0 && n !== 'nuclease_free_water' && n !== 'base_buffer' && n !== 'lysate'
      && !spec.templateFields.includes(n)
  );
}

function resolveTarget(rl) {
  for (const field of spec.templateFields) {
    if ((Number(rl[field]) || 0) > 0) return spec.templateToProteinTarget[field];
  }
  return null;
}

function positiveEnergySubstrates(recipe) {
  return new Set(ENERGY.filter((s) => (Number(recipe[s]) || 0) > 0));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// nL window that would land a component inside [bandMin, bandMax], snapped to
// the 25 nL grid — the actionable form of a band. null if no volume can reach it.
function nlWindow(name, bandMin, bandMax) {
  const { floor, perNl } = RC.components[name];
  if (!(perNl > 0)) return null;
  const step = spec.stepNl;
  const lo = Math.max(0, Math.ceil(((bandMin - floor) / perNl) / step) * step);
  const hi = Math.floor(((bandMax - floor) / perNl) / step) * step;
  return hi >= lo ? { minNl: lo, maxNl: hi } : null;
}

// b: { bandMin, bandMax, ratio, refValue, reference: { id, name }, check, site }
function bandFlag(name, value, unit, b) {
  const { bandMin, bandMax, ratio, refValue, reference, check } = b;
  const band = `[${fmtG(bandMin)}, ${fmtG(bandMax)}]`;
  const where = `${b.site ? 'site ' : ''}${check === 'energy' ? 'energy reference band' : 'watchlist reference band'}`;
  return {
    component: name,
    kind: 'warn',
    ratio,
    band,
    message: `Delivered ${name} (${fmtG(value)} ${unit}) outside ${where} ${band} (ratio ${fmtFixed(ratio, 3)})`,
    check,
    value,
    unit,
    referenceValue: refValue,
    referenceId: reference.id,
    referenceName: reference.name,
    bandMin,
    bandMax,
    direction: value <= bandMin ? 'low' : 'high',
    suggestedNl: nlWindow(name, bandMin, bandMax)
  };
}

// Strict: [low×, high×] the standard reference, ratio vs that reference.
// Site: [low× the smallest, high× the largest] positive value across ALL the
// target's references; ratio is vs whichever reference the value fell past.
function watchlistBand(name, value, t, standard, policy, band) {
  if (policy === 'autonomous-cfps') {
    const refValue = standard.components[name];
    return {
      bandMin: band.low * refValue, bandMax: band.high * refValue,
      ratio: value / refValue, refValue,
      reference: { id: t.standardRef, name: standard.name }
    };
  }
  let lo = null;
  let hi = null;
  for (const id of new Set([t.standardRef, ...t.energyRefs])) {
    const v = RC.references[id].components[name];
    if (!(v > 0)) continue;
    if (!lo || v < lo.v) lo = { v, id };
    if (!hi || v > hi.v) hi = { v, id };
  }
  const bandMin = band.low * lo.v;
  const bandMax = band.high * hi.v;
  const edge = value < bandMin ? lo : hi;
  return {
    bandMin, bandMax, ratio: value / edge.v, refValue: edge.v,
    reference: { id: edge.id, name: RC.references[edge.id].name }
  };
}

// Mirrors validate_design._flag_concern_key: warn before info, the energy
// presence flag first, then the largest fold-deviation, then component name.
function concernKey(f) {
  const r = f.ratio;
  const deviation = r === 0 ? 1e9 : r != null && r > 0 ? Math.max(r, 1 / r) : 0;
  return [f.kind === 'warn' ? 0 : 1, f.component === 'energy' ? 0 : 1, -deviation, f.component];
}
function compareFlags(a, b) {
  const ka = concernKey(a);
  const kb = concernKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

// reagent_list ({ contract_field: nL }) → { target, flags, warnCount, infoCount }.
// Each flag carries the Python WellFlag keys (component, kind, ratio, band,
// message) plus display extras (check, value, unit, referenceName, bandMin/Max,
// direction, suggestedNl).
// opts.policy: 'site' (default) | 'autonomous-cfps' (see the header).
// opts.band: override the fold band (analysis only).
export function evaluateRangeChecks(reagentList, { policy = 'site', band } = {}) {
  const rl = reagentList && typeof reagentList === 'object' ? reagentList : {};
  const target = resolveTarget(rl);
  const flags = [];
  const site = policy !== 'autonomous-cfps';
  const fold = band ?? (site ? SITE_BAND : RANGE_BAND);
  // site: bandMin is 0, so `<=` flags exactly the missing components
  const outside = (b, value) => value <= b.bandMin || value > b.bandMax;

  if (target && RC.targets[target]) {
    const t = RC.targets[target];
    const ref = RC.references[t.standardRef];
    const reference = { id: t.standardRef, name: ref.name };
    const watch = new Set(t.watchlist);
    for (const name of COMPONENT_NAMES) {
      const meta = RC.components[name];
      const refValue = ref.components[name];
      if (refValue == null || !meta.comparable) continue;
      const value = componentValue(name, rl[name]);
      if (refValue === 0) {
        if (value > 0 && UNEXPECTED_REFERENCE_ZERO.has(name)) {
          flags.push({
            component: name,
            kind: 'info',
            ratio: null,
            band: null,
            message: 'present in design, zero in reference',
            check: 'reference_zero',
            value,
            unit: meta.unit,
            referenceId: reference.id,
            referenceName: reference.name
          });
        }
      } else if (watch.has(name)) {
        const b = watchlistBand(name, value, t, ref, policy, fold);
        // Strict mode compares the ratio exactly as the Python does.
        const out = site ? outside(b, value) : (b.ratio < fold.low || b.ratio > fold.high);
        if (out) flags.push(bandFlag(name, value, meta.unit, { ...b, check: 'watchlist', site }));
      }
    }
  }

  // Energy: the universal presence check (applies even with no target) …
  const dosed = positiveEnergySubstrates(rl);
  if (!dosed.size) {
    flags.push({
      component: 'energy',
      kind: 'warn',
      ratio: null,
      band: null,
      message: 'no added ATP-regeneration substrate',
      check: 'energy_presence'
    });
  } else if (target && RC.targets[target]) {
    // … then a band check against the same-target energy reference whose dosed
    // substrate set exactly matches this design's (no match → no guidance).
    const matchedId = RC.targets[target].energyRefs.find((id) =>
      sameSet(positiveEnergySubstrates(RC.references[id].recipe), dosed)
    );
    if (matchedId) {
      const ref = RC.references[matchedId];
      for (const sub of [...dosed].sort()) {
        const refValue = ref.components[sub];
        if (refValue == null || refValue <= 0) continue;
        const value = componentValue(sub, rl[sub]);
        const ratio = value / refValue;
        if (ratio < fold.low || ratio > fold.high) {
          flags.push(bandFlag(sub, value, RC.components[sub].unit, {
            bandMin: fold.low * refValue, bandMax: fold.high * refValue, ratio, refValue,
            reference: { id: matchedId, name: ref.name }, check: 'energy', site
          }));
        }
      }
    }
  }

  flags.sort(compareFlags);
  const warnCount = flags.filter((f) => f.kind === 'warn').length;
  return { target, flags, warnCount, infoCount: flags.length - warnCount };
}

// One human-readable line per flag, for alerts and tooltips. `labelFor(field)`
// maps a contract field to a display name (defaults to the field itself).
export function describeRangeFlag(f, labelFor = (x) => x) {
  if (f.check === 'energy_presence') {
    return 'No ATP-regeneration substrate (e.g. PEP, ribose, glucose, maltodextrin) — add one.';
  }
  if (f.check === 'reference_zero') {
    return `${labelFor(f.component)} is dosed but the ${f.referenceName} reference has none (informational).`;
  }
  const fold = f.ratio === 0 ? 'none dosed' : `${f.ratio.toFixed(2)}× the ${f.referenceName} reference`;
  const fix = f.suggestedNl
    ? ` Aim for ${f.suggestedNl.minNl}–${f.suggestedNl.maxNl} nL.`
    : f.direction === 'high'
      ? ' The base buffer alone already exceeds this band.'
      : '';
  return `${labelFor(f.component)} far ${f.direction === 'low' ? 'too low' : 'too high'}: ${fmtG(f.value)} ${f.unit} (${fold}; allowed ${fmtG(f.bandMin)}–${fmtG(f.bandMax)} ${f.unit}).${fix}`;
}

// The same flag as a bold name plus short bullets, for the ⚠ hover popover.
export function rangeFlagBullets(f, labelFor = (x) => x) {
  if (f.check === 'energy_presence') {
    return { name: 'ATP regeneration', bullets: ['No energy substrate (PEP, ribose, glucose, maltodextrin)', 'Add one'] };
  }
  // drop a trailing bracketed note: 'DsbC (E. coli, 25.5 kDa)' -> 'DsbC'
  const name = String(labelFor(f.component)).replace(/\s*\([^)]*\)\s*$/, '');
  if (f.check === 'reference_zero') {
    return { name, bullets: [`Dosed, but the ${f.referenceName} reference has none`] };
  }
  if (f.ratio === 0) {
    return { name, bullets: ['Missing: none dosed', `${f.referenceName} uses ${fmtG(f.referenceValue)} ${f.unit}`] };
  }
  const nl = f.suggestedNl ? ` (${f.suggestedNl.minNl ? `${f.suggestedNl.minNl}–` : 'up to '}${f.suggestedNl.maxNl} nL)` : '';
  return {
    name,
    bullets: [
      `Now: ${fmtG(f.value)} ${f.unit} (${f.ratio < 1
          ? `${fmtG(1 / f.ratio, 2)}× below the ${f.referenceName}`
          : `${fmtG(f.ratio, 2)}× the ${f.referenceName}`})`,
      f.bandMin > 0 ? `Range: ${fmtG(f.bandMin)}–${fmtG(f.bandMax)} ${f.unit}${nl}` : `Max: ${fmtG(f.bandMax)} ${f.unit}${nl}`,
      !f.suggestedNl && f.direction === 'high' ? 'Base buffer alone is already above this' : null
    ].filter(Boolean)
  };
}

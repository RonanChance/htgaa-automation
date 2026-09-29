// Shared helpers for the /cfps plate-reader card + modal: viridis colour ramp
// (ported from catalyst-agent-skills ck.js), value formatting, colour scaling,
// and the median signal timecourse.

export const VIRIDIS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

export function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (VIRIDIS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

// Fixed colour scale across the whole run (min→max of every timepoint) so the
// signal visibly grows as you scrub — per-frame renormalization would hide it.
export function computeScale(grids) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of grids ?? []) {
    for (const v of g) {
      if (v == null || Number.isNaN(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { lo: 0, hi: 1 };
  return { lo, hi };
}

export function cellColor(v, scale) {
  if (v == null || Number.isNaN(v)) return 'var(--recess)';
  return ramp((v - scale.lo) / (scale.hi - scale.lo));
}

export function fmtVal(v, kind) {
  if (v == null || Number.isNaN(v)) return '—';
  return kind === 'rfu' ? Math.round(v).toLocaleString() : v.toFixed(2);
}

export function fmtHours(h) {
  if (h == null || Number.isNaN(h)) return '—';
  return `${h.toFixed(2)} h`;
}

function median(arr) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Per-composition ranked "titers" for the modal's ranked-samples chart — the
// interactive twin of the ranked-titer scatter at the end of the assay report.
// Every experimental well is grouped by its composition label; for each group we
// take the endpoint (last-timepoint) signal, blank-subtracted so it reads as
// signal over background, and report the group mean + spread (sample SD, which is
// exactly the report's error bar of mean × CV%/100). Groups are sorted best-first.
// Each entry keeps its member well indices (to highlight the platemap) and the
// shared recipe (to load into the comparison column of the designer table).
//
// The endpoint signal is the one metric available for every target — sfGFP is a
// single endpoint read; PETase / Reteplase are kinetic but their final read is the
// accumulated-product endpoint — so the ranking is consistent across all three.
export function computeRankedTiters(target) {
  if (!target?.grids?.length) return [];
  const endpoint = target.grids[target.grids.length - 1] ?? [];
  const blank = target.blank ?? 0;
  const groups = new Map(); // key -> { label, recipe, wellIdx[], wellNames[], values[] }
  (target.wells ?? []).forEach((w, i) => {
    if (w?.sampleType !== 'experimental' || !w.recipe) return;
    const key = w.label || w.well; // unlabeled experimental wells stand on their own
    let g = groups.get(key);
    if (!g) {
      g = { label: w.label || w.well, recipe: w.recipe, wellIdx: [], wellNames: [], values: [] };
      groups.set(key, g);
    }
    g.wellIdx.push(i);
    g.wellNames.push(w.well);
    const v = endpoint[i];
    if (v != null && !Number.isNaN(v)) g.values.push(v - blank);
  });
  const out = [];
  for (const g of groups.values()) {
    if (!g.values.length) continue;
    const n = g.values.length;
    const mean = g.values.reduce((s, v) => s + v, 0) / n;
    const variance = n > 1 ? g.values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
    const sd = Math.sqrt(variance);
    const cv = mean !== 0 ? (sd / Math.abs(mean)) * 100 : 0;
    out.push({ label: g.label, recipe: g.recipe, wellIdx: g.wellIdx, wellNames: g.wellNames, n, mean, sd, cv });
  }
  out.sort((a, b) => b.mean - a.mean);
  out.forEach((e, i) => (e.rank = i + 1));
  return out;
}

// Median signal vs time — experimental wells vs positive-control wells, with the
// blank as a flat reference. Computed from the shipped grids + per-well types.
export function computeTimecourse(target) {
  if (!target?.grids?.length) return null;
  const expIdx = [];
  const posIdx = [];
  (target.wells ?? []).forEach((w, i) => {
    if (w.sampleType === 'experimental') expIdx.push(i);
    else if (w.sampleType === 'target_control' || w.sampleType === 'positive_control_mixed') posIdx.push(i);
  });
  const experimental = target.grids.map((g) => median(expIdx.map((i) => g[i])));
  const posctrl = target.grids.map((g) => median(posIdx.map((i) => g[i])));
  return {
    hours: target.timepoints ?? [],
    experimental,
    posctrl,
    blank: target.blank ?? 0,
  };
}

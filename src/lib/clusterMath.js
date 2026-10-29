// The maths behind the CFPS Arena clusters, small enough to run in a browser.
//
// A port of the parts of Clinton Monteiro's CFPS Arena model (model.js on the
// week-3 arena page) that decide which designs are "linked": the Gaussian
// process fitted to Ginkgo's 78 control wells, its posterior covariance, and
// the extra shared variance the model gives an ingredient no plate ever ran.
// Shared by the /cfps/clusters-explained data endpoint (to anonymise designs
// into vectors) and the page itself (to recompute links live as you drag).
//
// tools/check-clusters-explained.mjs checks the links this produces against
// the export's own link matrix; the two agree to the export's two decimals.

// ── 1. A recipe becomes a point ──────────────────────────────────────────────

/** nL in the well → concentration in the reagent's stock unit. */
export function concOf(recipeNl, stock, wellNl) {
  const out = {};
  for (const id in recipeNl) {
    const s = stock[id];
    if (s != null && recipeNl[id] > 0) out[id] = (recipeNl[id] / wellNl) * s;
  }
  return out;
}

/** One coordinate: log-compress, then z-score against Ginkgo's plates. */
export const coord = (gp, j, c) => (Math.log1p(Math.max(c || 0, 0) / gp.scale[j]) - gp.mu[j]) / gp.sd[j];
/** Inverse of `coord` — the concentration that sits at coordinate z. */
export const uncoord = (gp, j, z) => gp.scale[j] * Math.expm1(z * gp.sd[j] + gp.mu[j]);

/** The point a recipe occupies in the model's 30-dimensional space. */
export function xOf(gp, conc) {
  const x = new Float64Array(gp.cols.length);
  for (let j = 0; j < gp.cols.length; j++) x[j] = coord(gp, j, conc[gp.cols[j]]);
  return x;
}

export function dist2(a, b) {
  let s = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    s += d * d;
  }
  return s;
}

// ── 2. What the plates measured: a Gaussian process ─────────────────────────

/** The RBF kernel, unscaled: 1 at the same point, falling with distance. */
export const kernel = (gp, d2) => Math.exp(-d2 / (2 * gp.ls * gp.ls));

/**
 * Everything the GP needs about one point, computed once: its kernel against
 * each training well (k) and K⁻¹k (v). Posterior mean, variance and covariance
 * are then all dot products.
 */
export function prep(gp, x) {
  const m = gp.X.length;
  const k = new Float64Array(m);
  for (let i = 0; i < m; i++) k[i] = gp.amp * kernel(gp, dist2(x, gp.X[i]));
  const v = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const row = gp.Kinv[i];
    let s = 0;
    for (let j = 0; j < m; j++) s += row[j] * k[j];
    v[i] = s;
  }
  return { x, k, v };
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Predicted ln-yield and its standard deviation (model.gp). */
export function predict(gp, p) {
  const mean = dot(p.k, gp.alpha);
  const v = Math.max((gp.amp - dot(p.k, p.v)) * gp.yStd * gp.yStd, 1e-6);
  return { lnY: mean * gp.yStd + gp.yMean, sd: Math.sqrt(v) };
}

/**
 * Posterior covariance of two points' prediction errors (model.gpCov), plus
 * the lysate-to-lysate term that also falls off with recipe distance.
 */
export function gpCov(gp, a, b) {
  const kab = kernel(gp, dist2(a.x, b.x));
  const c = (gp.amp * kab - dot(a.k, b.v)) * gp.yStd * gp.yStd + (gp.sigmaLysate || 0) ** 2 * kab;
  return a === b ? Math.max(c, 1e-6) : c;
}

// ── 3. The shared unknown ───────────────────────────────────────────────────

function riskOf(s, target, id, dir) {
  const r = (s.riskReagents || []).find((x) => x.id === id && x.dir === dir && (x.t == null || x.t === target));
  return r && s.riskClasses?.[r.cls] ? { cls: r.cls, ...s.riskClasses[r.cls] } : null;
}

function doseW(stock, s, id, v, lo, hi) {
  if (v < lo) return Math.min(1, (lo - v) / lo);
  const ref = ((stock[id] || 0) * 1e3) / s.wellNl;
  return ref > 0 ? Math.max(0.001, Math.min(1, (v - hi) / ref)) : 1;
}

/**
 * The ingredients this recipe changes beyond anything the plates ran — absent
 * from the GP's columns and outside 0.9×–1.1× of the plates' amounts — each
 * with how far past (w, shared variance) and how likely it is to crash (c).
 */
export function novelDirs(gp, s, stock, target, conc) {
  const inCols = new Set(gp.cols);
  const out = [];
  const keys = new Set([...Object.keys(conc), ...Object.keys(gp.lo)]);
  for (const id of keys) {
    if (inCols.has(id) || id === 'nuclease_free_water' || id === 'cost_usd') continue;
    const v = conc[id] || 0, lo = gp.lo[id] || 0, hi = gp.hi[id] || 0;
    if (!(v < lo * 0.9 - 1e-9 || v > hi * 1.1 + 1e-9)) continue;
    const dir = v < lo * 0.9 ? -1 : 1;
    const R = riskOf(s, target, id, dir);
    const mg = R && R.cls === 'chelator' ? (conc.magnesium_glutamate || 0) + (s.mgBase || 0) : 0;
    const dose = mg > 0 && v >= lo ? Math.max(0.001, Math.min(1, (v - hi) / mg)) : doseW(stock, s, id, v, lo, hi);
    out.push({
      id, dir,
      w: R ? (dose * R.sigma) / s.sigmaNovel : dose,
      c: R ? (dose * R.p) / s.pCollapse : dose
    });
  }
  return out;
}

/** Variance one untested change adds: a spread, plus a chance of collapse. */
export function shockVar(s, w, c) {
  const p = s.pCollapse * c;
  return s.sigmaNovel ** 2 * w * w + p * (1 - p) * s.collapseLn ** 2;
}
/** Covariance two designs share when they make the same untested change. */
export function shockCov(s, wa, wb, ca, cb) {
  const p = s.pCollapse;
  return s.sigmaNovel ** 2 * wa * wb + (p * Math.min(ca, cb) - p * p * ca * cb) * s.collapseLn ** 2;
}

// ── 4. The link ─────────────────────────────────────────────────────────────

/**
 * A design ready for linking: its GP prep, its untested changes, and its total
 * variance. `shockScale` multiplies every untested-reagent variance — the knob
 * the export warns the groups are sensitive to.
 */
export function ready(gp, s, x, nd, shockScale = 1) {
  const p = prep(gp, x);
  let shock = 0;
  for (const u of nd) shock += shockVar(s, u.w, u.c);
  const gpVar = gpCov(gp, p, p);
  return { ...p, nd, gpVar, shock, var: gpVar + shockScale * shock };
}

/**
 * Link between two designs: the correlation of their prediction errors, split
 * into the part from recipe similarity (GP) and the part from untested changes
 * they share. The two parts add up to the link.
 */
export function link(gp, s, a, b, shockScale = 1) {
  if (a === b) return { r: 1, gp: (a.gpVar) / a.var, shared: (shockScale * a.shock) / a.var };
  const g = gpCov(gp, a, b);
  let sh = 0;
  for (const u of a.nd) for (const w of b.nd) {
    if (u.id === w.id && u.dir === w.dir) sh += shockCov(s, u.w, w.w, u.c, w.c);
  }
  sh *= shockScale;
  const den = Math.sqrt(a.var * b.var);
  return { r: (g + sh) / den, gp: g / den, shared: sh / den };
}

/** Full link matrix as a Float32Array (row-major), with the GP-only part. */
export function linkMatrix(gp, s, ds, shockScale = 1) {
  const n = ds.length;
  const R = new Float32Array(n * n);
  const G = new Float32Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b <= a; b++) {
      const l = link(gp, s, ds[a], ds[b], shockScale);
      R[a * n + b] = R[b * n + a] = l.r;
      G[a * n + b] = G[b * n + a] = l.gp;
    }
  }
  return { n, R, G };
}

// ── 5. Grouping: complete linkage ───────────────────────────────────────────

/**
 * Complete-linkage agglomerative clustering on a similarity matrix: two
 * groups join at the similarity of their *weakest* pair, so a group formed at
 * height h has every pair linked ≥ h. Nearest-neighbour chain, O(n²).
 * Returns merges in order of falling height: { a, b, h } over cluster ids,
 * where ids ≥ n are earlier merges (n + merge index), as in scipy.
 */
export function completeLinkage(n, R) {
  // Work in distance 1 − r so "nearest" means "most linked".
  const D = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) D[i] = 1 - R[i];
  const active = new Uint8Array(n).fill(1);
  const label = Array.from({ length: n }, (_, i) => i); // slot → cluster id
  const merges = [];
  const chain = [];
  let left = n;
  while (left > 1) {
    if (!chain.length) chain.push(active.indexOf(1));
    for (;;) {
      const a = chain[chain.length - 1];
      const prev = chain.length > 1 ? chain[chain.length - 2] : -1;
      let best = -1, bd = Infinity;
      for (let k = 0; k < n; k++) {
        if (!active[k] || k === a) continue;
        const d = D[a * n + k];
        // Prefer the previous link on ties, or the chain can cycle.
        if (d < bd || (d === bd && k === prev)) { bd = d; best = k; }
      }
      if (best === prev) {
        chain.pop(); chain.pop();
        // Merge slot `best` into slot `a`; complete linkage keeps the max distance.
        for (let k = 0; k < n; k++) {
          if (!active[k] || k === a || k === best) continue;
          const d = Math.max(D[a * n + k], D[best * n + k]);
          D[a * n + k] = D[k * n + a] = d;
        }
        active[best] = 0;
        merges.push({ a: label[a], b: label[best], h: 1 - bd });
        label[a] = n + merges.length - 1;
        left--;
        break;
      }
      chain.push(best);
    }
  }
  // NN-chain finds merges out of height order; relabel after sorting.
  const order = merges.map((m, i) => i).sort((i, j) => merges[j].h - merges[i].h);
  const remap = new Map();
  const out = [];
  for (const i of order) {
    const m = merges[i];
    const fix = (id) => (id < n ? id : remap.get(id));
    out.push({ a: fix(m.a), b: fix(m.b), h: m.h });
    remap.set(n + i, n + out.length - 1);
  }
  return out;
}

/** Cut the tree at similarity τ: a group label per item (−1 = on its own). */
export function cutTree(n, merges, tau) {
  const parent = Array.from({ length: n + merges.length }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  merges.forEach((m, i) => {
    if (m.h < tau) return;
    parent[find(m.a)] = n + i;
    parent[find(m.b)] = n + i;
  });
  const roots = new Map();
  const size = new Map();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) || 0) + 1);
  return Array.from({ length: n }, (_, i) => {
    const r = find(i);
    if (size.get(r) < 2) return -1;
    if (!roots.has(r)) roots.set(r, roots.size);
    return roots.get(r);
  });
}

/**
 * The export's groups at threshold τ: the complete-linkage cut, except that a
 * "group" whose members are all copies of one recipe isn't a hypothesis — those
 * designs stay on their own. `recipeClass[i]` is the same for identical recipes.
 * At τ = 0.5 this reproduces the export's groups exactly.
 */
export function groupsAt(n, merges, tau, recipeClass) {
  const labels = cutTree(n, merges, tau);
  const classes = new Map();
  labels.forEach((l, i) => {
    if (l < 0) return;
    if (!classes.has(l)) classes.set(l, new Set());
    classes.get(l).add(recipeClass[i]);
  });
  const keep = new Map();
  for (const [l, set] of classes) if (set.size > 1) keep.set(l, keep.size);
  return labels.map((l) => (keep.has(l) ? keep.get(l) : -1));
}

// ── 6. How many experiments, really ─────────────────────────────────────────

/** Participation ratio n² / Σᵢⱼ rᵢⱼ² — "~N independent experiments". */
export function nEff(R, n, idx = null) {
  const ids = idx ?? Array.from({ length: n }, (_, i) => i);
  let s = 0;
  for (const i of ids) for (const j of ids) s += R[i * n + j] ** 2;
  return (ids.length * ids.length) / s;
}

// ── helpers for the figures ─────────────────────────────────────────────────

/** Top-k principal axes of row vectors (power iteration with deflation). */
export function pca(rows, k = 3) {
  const n = rows.length, d = rows[0].length;
  const mean = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  const C = Array.from({ length: d }, () => new Float64Array(d));
  for (const r of rows) {
    for (let i = 0; i < d; i++) {
      const di = r[i] - mean[i];
      for (let j = i; j < d; j++) C[i][j] += (di * (r[j] - mean[j])) / n;
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) C[i][j] = C[j][i];
  let total = 0;
  for (let i = 0; i < d; i++) total += C[i][i];
  const axes = [], explained = [];
  for (let a = 0; a < k; a++) {
    let v = new Float64Array(d).map((_, j) => Math.sin(j * 1.7 + a * 3.1 + 1));
    let lambda = 0;
    for (let it = 0; it < 200; it++) {
      const w = new Float64Array(d);
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) w[i] += C[i][j] * v[j];
      const norm = Math.hypot(...w) || 1;
      lambda = norm;
      v = w.map((x) => x / norm);
    }
    axes.push(v);
    explained.push(total ? lambda / total : 0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] -= lambda * v[i] * v[j];
  }
  const project = (r) => axes.map((v) => {
    let s = 0;
    for (let j = 0; j < d; j++) s += (r[j] - mean[j]) * v[j];
    return s;
  });
  return { axes, explained, mean, project };
}

/** Seeded PRNG so figures look the same on every load. */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Lower Cholesky factor with growing jitter (model.js's cholesky). */
export function cholesky(A) {
  const n = A.length;
  for (let jit = 1e-9; jit < 1; jit *= 100) {
    const L = A.map(() => new Float64Array(n));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j] + (i === j ? jit : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 0) { ok = false; break; }
          L[i][i] = Math.sqrt(s);
        } else L[i][j] = s / L[j][j];
      }
    }
    if (ok) return L;
  }
  return A.map((_, i) => { const z = new Float64Array(n); z[i] = Math.sqrt(Math.max(A[i][i], 0)); return z; });
}

/** Solve A·x = b for a small dense symmetric A via Cholesky. */
export function solve(L, b) {
  const n = b.length, y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}

/** A distinct, dark-background-friendly colour per group index. */
export function groupColor(i, alpha = 1) {
  if (i == null || i < 0) return `rgba(120,128,140,${alpha})`;
  const h = (i * 137.508 + 200) % 360;
  const l = 58 + ((i * 7) % 3) * 7;
  return `hsla(${h.toFixed(1)}, 72%, ${l}%, ${alpha})`;
}

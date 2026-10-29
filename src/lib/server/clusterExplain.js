import { env } from '$env/dynamic/private';
import { clusterSource, nameParts, TARGETS } from '$lib/server/clusterPlan.js';
import { concOf, xOf, novelDirs } from '$lib/clusterMath.js';

// Data for /cfps/clusters-explained: the live cluster export, reduced to what
// the walkthrough draws, with every name and id stripped.
//
// Two sources meet here:
//   · the CFPS Arena export in PocketBase (clusterSource) — the designs, their
//     groups, roles, odds, check runs and sweeps;
//   · the CFPS Arena model's own data.json, published on Clinton's HTGAA page —
//     the Gaussian process fitted to Ginkgo's control wells and the settings for
//     untested reagents. The export doesn't carry the GP, and the page needs it
//     to recompute links live.
// Both are stamped with the build time; when they disagree the page says so.
//
// The model part is public already, so anyone gets it. The design part is
// derived from the submissions and only goes to a signed-in caller: each
// design leaves as a vector — its coordinates in the model's 30-D space and its
// untested changes — plus its group, role and odds. No author, no sample id,
// no recipe.

const ARENA_URL =
  env.CFPS_ARENA_DATA_URL ||
  'https://pages.htgaa.org/2026b/clinton-monteiro/week-3/cfps-arena/data.json';

// Arena data.json is ~1.8 MB and changes only when Clinton rebuilds, so hold
// it for an hour. A failure is never memoised.
const ARENA_TTL = 60 * 60 * 1000;
let arena = null; // { at, promise }

function arenaData() {
  if (arena && Date.now() - arena.at < ARENA_TTL) return arena.promise;
  const promise = fetch(ARENA_URL, { signal: AbortSignal.timeout(20_000) })
    .then((res) => {
      if (!res.ok) throw new Error(`arena data.json returned ${res.status}`);
      return res.json();
    })
    .catch((e) => {
      arena = null;
      throw e;
    });
  arena = { at: Date.now(), promise };
  return promise;
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r2 = (v) => Math.round(v * 100) / 100;

const ROLE = {
  'first run': 'first',
  'check run': 'check',
  'independent run': 'independent',
  'sweep run': 'sweep',
  "follows its group's runs": 'follows'
};

// "<part>|<target>|<build stamps>" → promise, so a new upload or a rebuilt model
// is picked up. Failures are not memoised.
const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) {
    const p = Promise.resolve().then(fn);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

/**
 * The model alone — the GP fitted to Ginkgo's control wells and the wells
 * themselves. All of it is already public on Clinton's arena page, so this part
 * is served to signed-out visitors too.
 */
export async function modelPart(target) {
  if (!TARGETS.includes(target)) return null;
  const A = await arenaData();
  return memo(`model|${target}|${A.generated}`, () => buildModel(target, A));
}

/**
 * Every design as an anonymous vector, with its group, role and odds, plus the
 * groups and sweeps. Derived from the submissions, so callers must gate it.
 */
export async function designPart(target) {
  if (!TARGETS.includes(target)) return null;
  const [src, A] = await Promise.all([clusterSource(), arenaData()]);
  return memo(`designs|${target}|${src.built}|${A.generated}`, () => buildDesigns(target, src, A));
}

function context(target, A) {
  const T = A.targets?.[target.toLowerCase()];
  if (!T) throw new Error(`no ${target} in the arena model`);
  return {
    T,
    s: A.settings,
    gp: { ...T.gp, sigmaLysate: T.sigmaLysate || 0 },
    stock: Object.fromEntries(A.reagents.map((r) => [r.id, r.stockVal])),
    nameOf: Object.fromEntries(A.reagents.map((r) => [r.id, r.name]))
  };
}

function buildModel(target, A) {
  const { T, s, gp, stock, nameOf } = context(target, A);
  const controls = T.conditions.map((c) => ({
    label: c.label,
    lnY: typeof c.lnY === 'number' && Number.isFinite(c.lnY) ? r4(c.lnY) : null,
    alive: !!c.alive,
    x: Array.from(xOf(gp, concOf(c.recipe ?? {}, stock, s.wellNl)), r4)
  }));
  const inc = T.conditions.find((c) => c.label === T.incumbent) ?? T.conditions[0];
  return {
    target,
    modelBuilt: A.generated,
    unit: T.unit,
    incumbent: inc.label,
    strikeLnY: Math.log(T.strikeYield),
    settings: {
      wellNl: s.wellNl,
      sigmaNovel: s.sigmaNovel,
      pCollapse: s.pCollapse,
      collapseLn: s.collapseLn,
      // The assumed shock size and collapse odds per class of untested
      // reagent, and which reagents are in a class (the rest use σN alone).
      riskClasses: s.riskClasses ?? {},
      riskReagents: (s.riskReagents ?? []).map((r) => ({ ...r, name: nameOf[r.id] ?? r.id }))
    },
    gp: {
      cols: gp.cols,
      names: gp.cols.map((c) => nameOf[c] ?? c),
      // nL ↔ concentration for the GP's columns, so sliders can speak nL.
      stock: gp.cols.map((c) => stock[c] ?? 1),
      scale: gp.scale, mu: gp.mu, sd: gp.sd,
      amp: gp.amp, ls: gp.ls, yMean: gp.yMean, yStd: gp.yStd,
      sigmaLysate: gp.sigmaLysate,
      X: gp.X, alpha: gp.alpha, Kinv: gp.Kinv,
      // The plates' range per column (concentration units).
      lo: gp.cols.map((c) => gp.lo?.[c] ?? 0),
      hi: gp.cols.map((c) => gp.hi?.[c] ?? 0)
    },
    incumbentX: Array.from(xOf(gp, concOf(inc.recipe ?? {}, stock, s.wellNl)), r4),
    controls
  };
}

function buildDesigns(target, src, A) {
  const P = src.proteins?.[target];
  if (!P) throw new Error(`no ${target} in the export`);
  const { s, gp, stock, nameOf } = context(target, A);
  // ── designs → anonymous vectors ────────────────────────────────────────
  const index = new Map(P.designs.map((d, i) => [d.id, i]));
  const groupOf = new Map();
  P.groups.forEach((g, gi) => g.designs.forEach((id) => groupOf.set(id, gi)));
  const novelIds = new Set();
  // Identical recipes share a class: a "group" of one repeated recipe isn't a
  // hypothesis, so the grouping rule needs to know (see groupsAt).
  const firstOfRecipe = new Map();
  const designs = P.designs.map((d, i) => {
    const recipeKey = JSON.stringify(Object.entries(d.recipeNl ?? {}).filter(([, v]) => v > 0).sort());
    if (!firstOfRecipe.has(recipeKey)) firstOfRecipe.set(recipeKey, i);
    const conc = concOf(d.recipeNl, stock, s.wellNl);
    const nd = novelDirs(gp, s, stock, target.toLowerCase(), conc);
    nd.forEach((u) => novelIds.add(u.id));
    const vs = d.vsGinkgoPlates ?? {};
    return {
      x: Array.from(xOf(gp, conc), r4),
      nd: nd.map((u) => [u.id, u.dir, r4(u.w), r4(u.c)]),
      g: groupOf.get(d.id) ?? -1,
      role: ROLE[d.round1Role] ?? 'follows',
      p: d.forecast?.pBeat ?? 0,
      // ln cost per gram and its uncertainty, as the export forecast them.
      mu: r4(d.forecast?.lnSpecCost ?? 0),
      sd: r4(d.forecast?.sd ?? 0),
      // [never on a plate, past the range, between levels, within range]
      vs: [vs.neverOnAPlate, vs.pastThePlatesRange, vs.betweenPlateLevels, vs.withinPlatesRange]
        .map((a) => (a ?? []).length),
      rc: firstOfRecipe.get(recipeKey)
    };
  });

  // ── groups ──────────────────────────────────────────────────────────────
  const groups = P.groups.map((g) => {
    const members = g.designs.map((id) => index.get(id)).filter((i) => i != null);
    const ingredients = (g.whatMatters?.ingredients ?? []).slice(0, 8);
    // Amounts of the top two ingredients across the group, so the page can
    // show the check run as "the arm furthest from the first run" on that axis.
    const axes = ingredients.slice(0, 2).map((ing) => ({
      reagent: ing.reagent,
      name: ing.name,
      nl: members.map((i) => P.designs[i].recipeNl?.[ing.reagent] ?? 0)
    }));
    const { label, also } = nameParts(g.name);
    return {
      letter: g.letter,
      name: label,
      also,
      members,
      first: index.get(g.firstRun) ?? members[0],
      checks: (g.checkRuns ?? []).map((c) => ({
        i: index.get(c.id),
        ingredient: c.ingredient,
        nL: c.nL,
        from: c.nLInFirstRun,
        gain: c.newInformation,
        priceOnly: !!c.priceOnly
      })),
      averageLink: g.averageLink,
      weakestLink: g.weakestLink,
      fromUntested: g.linkFromSharedUntested,
      fromSimilar: g.linkFromSimilarRecipes,
      virtualRecipes: g.whatMatters?.virtualRecipes ?? null,
      explains: g.whatMatters?.singleIngredientsExplain ?? null,
      ingredients: ingredients.map((i) => ({
        reagent: i.reagent,
        name: i.name,
        coefficient: i.coefficient,
        strength: i.strength,
        rangeNl: i.rangeNl,
        priceOnly: !!i.priceOnly
      })),
      axes
    };
  });

  // ── sweeps with a predicted curve ──────────────────────────────────────
  const sweeps = (P.sweeps ?? [])
    .filter((sw) => sw.recommended)
    .map((sw) => {
      const first = sw.sweeps?.[0];
      const c = first?.predictedCurve;
      return {
        ingredient: sw.ingredient,
        reagent: sw.reagent,
        priceOnly: !!sw.priceOnly,
        leadsGroups: sw.leadsGroups,
        submitted: sw.sweepsSubmitted,
        platesRangeNl: first?.platesRangeNl ?? null,
        amounts: first?.amountsSubmittedNl ?? [],
        curve: c ? { nL: c.nL.map(r2), y: c.yieldVsGinkgoBest, lo: c.low, hi: c.high } : null,
        toRun: (first?.toRun ?? []).map((t) => ({ nL: t.nL, y: t.predictedYieldVsGinkgoBest, role: ROLE[t.round1Role] ?? t.round1Role }))
      };
    });

  return {
    target,
    built: src.built,
    modelBuilt: A.generated,
    totals: P.totals,
    novelNames: Object.fromEntries([...novelIds].map((id) => [id, nameOf[id] ?? id])),
    designs,
    groups,
    sweeps
  };
}

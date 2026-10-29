<script>
  // A visual walkthrough of how the round-1 plan was chosen: how a composition
  // becomes a point, how the CFPS Arena model's Gaussian process turns points
  // into links, how links become groups, and how groups pick the compositions
  // to test.
  //
  // It plays like a slide deck: one step at a time, text on the left and the
  // chapter's figure on the right, all inside the viewport. ← / → (or the edge
  // zones, or the timeline) move between steps; scrolling down shows the
  // deeper detail for the current step. The figure stays mounted for a whole
  // chapter so it animates from one step to the next. The toy figures run on
  // their own; the real ones run on the live export, recomputed here from the
  // model (src/lib/clusterMath.js). tools/check-clusters-explained.mjs proves
  // the recomputation matches the export: every link to ±0.005, every group
  // exactly.
  import '../blueprint.css';
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { loginHref } from '../loginHref.js';
  import { ready, linkMatrix, completeLinkage, groupsAt, nEff, pca, groupColor, uncoord } from '$lib/clusterMath.js';
  import { ROLE_STYLE, heat } from './colors.js';
  import AxisTransform from './AxisTransform.svelte';
  import Cloud3D from './Cloud3D.svelte';
  import GpToy from './GpToy.svelte';
  import GpSlice from './GpSlice.svelte';
  import SharedUnknown from './SharedUnknown.svelte';
  import LinkHeatmap from './LinkHeatmap.svelte';
  import LinkageToy from './LinkageToy.svelte';
  import GroupCount from './GroupCount.svelte';
  import NeffToy from './NeffToy.svelte';
  import RunPicker from './RunPicker.svelte';
  import LhcDemo from './LhcDemo.svelte';
  import SweepCurve from './SweepCurve.svelte';
  import Budget from './Budget.svelte';
  import Scatter2D from './Scatter2D.svelte';

  let { data } = $props();

  const TARGETS = ['sfGFP', 'PETase', 'Reteplase'];
  const TCOLOR = { sfGFP: 'var(--sfgfp)', PETase: 'var(--petase)', Reteplase: 'var(--reteplase)' };
  let target = $state('sfGFP');

  // ── data ──────────────────────────────────────────────────────────────────
  const responses = {};
  let resp = $state(null);
  let loadErr = $state('');
  $effect(() => {
    const t = target;
    loadErr = '';
    if (responses[t]) { resp = responses[t]; return; }
    resp = null;
    fetch(`/cfps/clusters-explained/data?target=${encodeURIComponent(t)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => { responses[t] = j; if (target === t) resp = j; })
      .catch((e) => { if (target === t) loadErr = e.message; });
  });
  const model = $derived(resp?.model ?? null);
  const D = $derived(resp?.designs ?? null);
  const locked = $derived(resp ? resp.locked : !data.signedIn);
  const gp = $derived(model?.gp ?? null);
  const S = $derived(model?.settings ?? null);

  // ── one reagent for the whole deck ────────────────────────────────────────
  // Picking a reagent in any figure carries it into the others (the axis
  // mapping, the GP slice, the sweep, the check-run axis, the 3-D colouring),
  // so the story keeps its thread. The amount resets to Ginkgo's best when the
  // reagent changes.
  let reagent = $state('magnesium_glutamate');
  let amount = $state(null); // nL, or null for Ginkgo's best
  const setReagent = (id) => { if (id && id !== reagent) { reagent = id; amount = null; } };
  // Compositions are dispensed on a 25 nL grid, so picked amounts snap to it.
  const setAmount = (nl) => (amount = nl == null ? null : Math.round(nl / 25) * 25);
  // The GP figures need one of its 30 columns; a sweep can name another.
  const reagentCol = $derived(gp ? (gp.cols.includes(reagent) ? reagent : gp.cols.includes('magnesium_glutamate') ? 'magnesium_glutamate' : gp.cols[0]) : reagent);
  const reagentName = $derived(gp ? gp.names[gp.cols.indexOf(reagentCol)] : '');
  let colourByReagent = $state(false);
  // a point's amount of the shared reagent, back from its coordinate
  const nlOf = (x) => {
    const j = gp.cols.indexOf(reagentCol);
    return (uncoord(gp, j, x[j]) / gp.stock[j]) * model.settings.wellNl;
  };
  let runGroup = $state(null); // the run picker's group, kept across its steps
  // 3-D cloud or a flat pair of components, shared by every PCA view.
  let view2d = $state(false);
  let pcPair = $state([0, 1]);
  const PC_PAIRS = [[0, 1], [0, 2], [1, 2], [2, 3]];

  // "How to read this graph" notes for the larger figures.
  const HOWTO = {
    cloud: [
      'Each point is one composition. White diamonds are Ginkgo’s measured wells; the rest are class designs.',
      'Points close together use similar amounts across the 30 measured reagents. Each axis blends several reagents, and its caption says how much of the total spread it shows. The rest is hidden, so closeness here is approximate.',
      'Clumps here reflect composition similarity only. The model’s groups (chapter 6) also count untested reagents and what the measured wells already explain, so they don’t always match the clumps.',
      'Switch to 2-D to read one pair of components at a time. PC1 × PC2 shows the most spread.'
    ],
    slice: [
      'The blue line is the predicted yield as one reagent changes, with the rest held at Ginkgo’s best. The band is the 95% range.',
      'The y-axis is a log scale relative to Ginkgo’s best (1×). A flat curve means the reagent barely matters around this composition; a steep one means it matters a lot.',
      'A narrow band means plate data is nearby and the model is confident. A wide band means it is guessing. Ticks along the bottom show the amounts the control wells (white) and designs (blue) use.'
    ],
    linktoy: [
      'Top: measurements, the prediction and plausible curves. Bottom left: one dot per curve, its error at A against its error at B.',
      'Dots along a rising diagonal mean a link near 1: the two errors move together. A round cloud means a link near 0: one tells you nothing about the other.',
      'A falling diagonal (a negative link) can appear when a measurement sits between A and B: a curve pinned there that rises on one side tends to fall on the other.'
    ],
    groups: [
      'The yellow line counts groups at each threshold τ; the purple line counts designs left on their own.',
      'At low τ almost everything links, giving a few large, loose groups. At high τ only near-identical designs group and most are left on their own. The export’s 0.5 is in between: every pair in a group shares at least a quarter of its variance.',
      'In the cloud each colour is a group at the current τ, and grey points are on their own.'
    ],
    runs: [
      'Each point is one design in the chosen group; higher means better odds of beating Ginkgo’s best. The star is the first test, rings are check tests.',
      'In the second step the horizontal position is new information: how much running the design would add beyond the first test. Far right means it asks something the first test can’t answer. Near 0 means its result should follow the first test’s.'
    ],
    sweep: [
      'The blue line is the predicted yield along one ingredient with everything else fixed; the band is the model’s uncertainty.',
      'Dots are submitted compositions that will be tested. If their measured yields land inside the band, the model was right; if not, round 2 corrects the curve.',
      'A flat stretch means the ingredient can be cut back there to save cost without losing yield.'
    ]
  };

  // Every design, ready for linking, and every link — computed here.
  const ds = $derived(
    D && gp ? D.designs.map((d) => ready(gp, S, Float64Array.from(d.x), d.nd.map(([id, dir, w, c]) => ({ id, dir, w, c })))) : null
  );
  const LM = $derived(ds ? linkMatrix(gp, S, ds) : null);
  const merges = $derived(LM ? completeLinkage(LM.n, LM.R) : null);
  const rc = $derived(D ? D.designs.map((d) => d.rc) : null);
  let tau = $state(0.5);
  const labels = $derived(merges ? groupsAt(LM.n, merges, tau, rc) : null);
  const labels05 = $derived(merges ? groupsAt(LM.n, merges, 0.5, rc) : null);
  const effAll = $derived(LM ? nEff(LM.R, LM.n) : null);
  const matches = $derived.by(() => {
    if (!labels05 || !D) return null;
    const sig = (m) => [...m].sort((a, b) => a - b).join(',');
    const mine = new Map();
    labels05.forEach((l, i) => { if (l >= 0) { if (!mine.has(l)) mine.set(l, []); mine.get(l).push(i); } });
    const theirs = new Set(D.groups.map((g) => sig(g.members)));
    return { same: [...mine.values()].filter((m) => theirs.has(sig(m))).length, of: D.groups.length, mine: mine.size };
  });

  // ── the 3-D views ─────────────────────────────────────────────────────────
  let space = $state('measured'); // 'measured' | 'unknowns'
  const basis = $derived.by(() => {
    if (!model) return null;
    const rows = [...model.controls.map((c) => c.x), ...(D ? D.designs.map((d) => d.x) : [])];
    return pca(rows, 4); // four, so the 2-D view can pair any of them
  });
  // The same designs with every untested change as an extra axis: designs that
  // make the same change share a coordinate there, the way they share a shock.
  const basisU = $derived.by(() => {
    if (!model || !D) return null;
    const ids = Object.keys(D.novelNames);
    const lift = (nd) => ids.map((id) => {
      const u = nd.find((v) => v[0] === id);
      return u ? u[1] * u[2] * 4 : 0;
    });
    const rows = [
      ...model.controls.map((c) => [...c.x, ...ids.map(() => 0)]),
      ...D.designs.map((d) => [...d.x, ...lift(d.nd)])
    ];
    return { p: pca(rows, 4), rows };
  });
  const axisCaps = (b) => b ? b.explained.map((e, k) => `PC${k + 1} · ${(e * 100).toFixed(0)}%`) : null;

  function cloudPoints(colorBy) {
    if (!model || !basis) return [];
    const useU = colorBy === 'group' && space === 'unknowns' && basisU;
    const proj = (row, i) => (useU ? basisU.p.project(basisU.rows[i]) : basis.project(row));
    const out = model.controls.map((c, i) => ({
      p: proj(c.x, i), c: '#f4f6f8', s: colorBy === 'group' ? 8 : 14, a: colorBy === 'group' ? 0.35 : 0.95, shape: 1
    }));
    if (!D) return out;
    const nc = model.controls.length;
    // Colour by the shared reagent's coordinate instead (controls and designs alike).
    const jr = colourByReagent && gp ? gp.cols.indexOf(reagentCol) : -1;
    if (jr >= 0) {
      const zs = [...model.controls.map((c) => c.x[jr]), ...D.designs.map((d) => d.x[jr])];
      const lo = Math.min(...zs), hi = Math.max(...zs);
      // start the ramp at a visible blue: "none" must not vanish into the background
      const col = (z) => heat(0.4 + 0.6 * ((z - lo) / (hi - lo || 1)));
      out.forEach((o, i) => (o.c = col(model.controls[i].x[jr])));
      D.designs.forEach((d, i) => out.push({ p: proj(d.x, nc + i), c: col(d.x[jr]), s: 7, a: 0.9, shape: 0 }));
      return out;
    }
    D.designs.forEach((d, i) => {
      let c = '#58c4dd', s = 7, a = 0.85;
      if (colorBy === 'plates') c = d.vs[0] ? '#fc6255' : d.vs[1] ? '#f0ac5f' : '#83c167';
      if (colorBy === 'group') {
        const l = labels[i];
        // colour a group by the export group most of it came from, so colours
        // stay put as τ moves
        c = l >= 0 ? groupColor(groupIndexFor(l)) : '#5d6570';
        s = l >= 0 ? 8 : 5;
        a = l >= 0 ? 0.95 : 0.45;
      }
      out.push({ p: proj(d.x, nc + i), c, s, a, shape: 0 });
    });
    return out;
  }
  // label at τ → a stable colour index (its members' commonest export group)
  const groupIndexFor = (l) => colourOf.get(l) ?? l + 200;
  const colourOf = $derived.by(() => {
    const m = new Map();
    if (!labels || !D) return m;
    const votes = new Map();
    labels.forEach((l, i) => {
      if (l < 0) return;
      const g = D.designs[i].g;
      if (!votes.has(l)) votes.set(l, new Map());
      votes.get(l).set(g, (votes.get(l).get(g) || 0) + 1);
    });
    for (const [l, v] of votes) {
      const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
      m.set(l, best >= 0 ? best : l + 200);
    }
    return m;
  });

  const designLabel = (i) => {
    const d = D?.designs[i];
    if (!d) return null;
    const g = d.g >= 0 ? `group ${D.groups[d.g].letter}` : 'in no group';
    return `design #${i + 1} · ${g}\n${(ROLE_STYLE[d.role] ?? ROLE_STYLE.follows).label} · odds ${(d.p * 100).toFixed(1)}%`;
  };
  function cloudLabel(i) {
    const nc = model?.controls.length ?? 0;
    if (i < nc) {
      const c = model.controls[i];
      return `Ginkgo control well\n${c.label}${colourByReagent && gp ? `\n${reagentName}: ${Math.round(nlOf(c.x))} nL` : ''}`;
    }
    const j = i - nc;
    const base = designLabel(j);
    if (!base) return null;
    const d = D.designs[j];
    const amt = colourByReagent && gp ? `\n${reagentName}: ${Math.round(nlOf(d.x))} nL` : '';
    const vs = d.vs[0] ? `${d.vs[0]} change${d.vs[0] > 1 ? 's' : ''} no plate ran` : d.vs[1] ? `${d.vs[1]} change${d.vs[1] > 1 ? 's' : ''} past the plates' range` : 'within the plates';
    return `${base}\n${vs}${amt}`;
  }

  // ── the deck ──────────────────────────────────────────────────────────────
  // `word` is the timeline's one- or two-word label for the chapter.
  const CHAPTERS = [
    { id: 'start', title: 'How the round-1 plan was chosen', word: 'Start', steps: 1 },
    { id: 'point', title: 'A composition is a point', word: 'Points', steps: 4 },
    { id: 'gp', title: 'Predicting from 78 wells', word: 'Prediction', steps: 4 },
    { id: 'link', title: 'From error bars to links', word: 'Links', steps: 4 },
    { id: 'unknown', title: 'The shared unknown', word: 'Unknowns', steps: 4 },
    { id: 'matrix', title: 'Every link at once', word: 'Link matrix', steps: 3 },
    { id: 'groups', title: 'Drawing the lines', word: 'Grouping', steps: 5 },
    { id: 'neff', title: 'How many experiments, really?', word: 'True count', steps: 2 },
    { id: 'runs', title: 'Choosing what to test', word: 'Choosing tests', steps: 6 },
    { id: 'end', title: 'What round 1 tests', word: 'End', steps: 1 }
  ];
  // first slide index of each chapter
  const START = CHAPTERS.map((_, i) => CHAPTERS.slice(0, i).reduce((a, c) => a + c.steps, 0));
  const SLIDES = CHAPTERS.flatMap((c, ci) =>
    Array.from({ length: c.steps }, (_, s) => ({ ci, s, id: c.steps > 1 ? `${c.id}-${s + 1}` : c.id }))
  );
  const LAST = SLIDES.length - 1;
  const FINAL_CH = CHAPTERS.length - 1;

  let idx = $state(0);
  let dir = $state(1); // which way the text slides in
  const cur = $derived(SLIDES[idx]);
  const ch = $derived(CHAPTERS[cur.ci]);
  const st = $derived(cur.s);
  const key = $derived(`${ch.id}.${st}`);
  let detailsEl = $state(null);

  function go(i) {
    const next = Math.max(0, Math.min(LAST, i));
    if (next === idx) return;
    dir = next > idx ? 1 : -1;
    idx = next;
    // Reading the details of one step and moving on means you want the slide.
    if (window.scrollY > 4) window.scrollTo({ top: 0, behavior: 'smooth' });
    // The hash makes a step linkable and survives a reload.
    replaceState(`#${SLIDES[next].id}`, page.state);
  }
  // Land on the step in the URL, and follow it if someone edits the hash.
  function fromHash() {
    const i = SLIDES.findIndex((sl) => `#${sl.id}` === location.hash);
    if (i >= 0 && i !== idx) { dir = i > idx ? 1 : -1; idx = i; }
  }
  onMount(fromHash);

  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(LAST);
    else return;
    e.preventDefault();
  }
  // A dragged slider keeps focus and would swallow ← / →, so hand focus back
  // once the pointer lets go. Someone who tabs into a slider keeps its keys.
  function onPointerUp() {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.type === 'range') a.blur();
  }

  // ── key terms: hover or focus a dotted word for a plain definition ────────
  const TERMS = {
    controls: ['Ginkgo’s control wells', 'The 78 compositions Ginkgo actually ran and measured. Each changes one ingredient from a published starting composition. They are the only data the model learned from.'],
    log: ['Log-compression', 'Measuring change by ratio instead of difference, so going from 10 to 20 nL counts about as much as going from 100 to 200 nL.'],
    z: ['z-score', 'How far a value is from the average, in standard deviations. Here the average and spread are those of Ginkgo’s control wells.'],
    pc: ['Principal components', 'The directions in which a cloud of points is most spread out. Showing the top three gives the most informative 3-D view of a higher-dimensional cloud.'],
    range: ['The plates’ range', 'The span of amounts of a reagent that Ginkgo’s control wells used. Inside it the model has data; outside it, it has to guess.'],
    extrapolate: ['Extrapolation', 'Predicting beyond the range of the data. The model’s uncertainty grows the further it goes.'],
    untested: ['Never on a Ginkgo plate', 'A reagent no control well varied, so the model has no data on its effect. It can price it, but not predict it.'],
    gp: ['Gaussian process', 'A way to predict a value at a new point from nearby measurements that also reports how sure it is. Closer measurements count for more.'],
    ls: ['Length-scale', 'How far one measurement’s influence reaches. A few length-scales away, a measured well says almost nothing.'],
    kernel: ['Kernel', 'The formula that scores how similar two compositions are: 1 for identical compositions, falling towards 0 as they move apart.'],
    posterior: ['Posterior covariance', 'How much two predictions’ errors tend to move together, once the measurements are taken into account.'],
    link: ['Link', 'The correlation between two designs’ prediction errors, from 0 (unrelated) to 1 (if the model is wrong about one, it is wrong about the other in the same way).'],
    group: ['Group', 'A set of designs the model expects to succeed or fail together: every pair in it is linked at least 0.5. Running one of them tells you a lot about the rest.'],
    student: ['Student reagent composition', 'One participant’s submitted set of reagent amounts for a 20 µL cell-free reaction. The rest of the page also calls these designs.'],
    tested: ['Tested composition', 'A student reagent composition chosen for the round-1 plates and tested in quadruplicate: four replicate wells on one plate. It is not the same as an independent experiment, because linked compositions overlap in what they tell you.'],
    shock: ['Shock', 'An extra random effect the model adds for an untested reagent. Every design that makes the same change shares it.'],
    collapse: ['Collapse', 'The reaction failing outright. For untested reagents the model assumes a chance of yield dropping about 50-fold.'],
    agglom: ['Agglomerative clustering', 'Start with every item on its own and keep merging the two closest groups.'],
    dendrogram: ['Dendrogram', 'A tree of the merges. The height where two branches join shows how linked those two groups were.'],
    single: ['Single linkage', 'Two groups count as close as their closest pair. Prone to chaining.'],
    complete: ['Complete linkage', 'Two groups count as close as their least-linked pair, so every pair inside a group clears the bar.'],
    tau: ['Threshold τ', 'The minimum link every pair in a group must have. The export uses 0.5.'],
    neff: ['Participation ratio', 'A count of how many truly independent experiments a set of correlated ones is worth.'],
    indep: ['Independent experiments', 'How many truly separate questions a set of designs answers, counted with the participation ratio. Linked designs overlap, so a few hundred designs can be worth only a few dozen unlinked ones. It measures information, not wells.'],
    first: ['First test', 'The group’s design with the best odds. It tests what the whole group has in common.'],
    odds: ['Odds', 'The model’s chance that a design beats Ginkgo’s best composition through every screen of the competition.'],
    newinfo: ['New information', 'The share of a design’s uncertainty the first test can’t explain: 1 − r².'],
    virtual: ['Virtual compositions', 'Made-up compositions spread across a group’s amounts, used to ask the model which ingredients matter.'],
    cpg: ['Cost per gram', 'Composition cost divided by predicted yield. Every ranking here uses it.'],
    regression: ['Regression', 'A fit that estimates how much each ingredient moves a prediction, holding the others fixed.'],
    lhc: ['Latin hypercube', 'A sampling plan that cuts each ingredient’s range into equal slices and uses each slice once, for even coverage with few points.'],
    check: ['Check test', 'A second design from a group, chosen because it differs most in the ingredient the model thinks matters.'],
    independent: ['Independent test', 'A design in no group: nothing else on the plates predicts it.'],
    sweep: ['Sweep test', 'One of a submitted series that varies a single ingredient, tested together to measure that ingredient’s curve.'],
    kmeans: ['k-means', 'A common clustering method that splits points into a chosen number (k) of groups around centres. It needs k up front and allows loose groups.']
  };
  const TIP_W = 300;
  let tip = $state(null);
  function showTip(ev, k) {
    const r = ev.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - TIP_W - 8));
    const above = r.bottom + 150 > window.innerHeight;
    tip = { k, left, top: above ? r.top - 8 : r.bottom + 8, above };
  }
  const hideTip = () => (tip = null);
  // Moving to another step drops any open definition.
  $effect(() => { key; tip = null; });

  // Steps with something under "more on this step".
  const DETAILS = new Set([
    'start.0', 'point.0', 'point.1', 'point.2', 'point.3', 'gp.0', 'gp.1', 'gp.2', 'gp.3',
    'link.0', 'link.1', 'link.2', 'link.3', 'unknown.0', 'unknown.1', 'unknown.2', 'unknown.3',
    'matrix.0', 'matrix.1', 'matrix.2', 'groups.0', 'groups.1', 'groups.2', 'groups.3', 'groups.4',
    'neff.0', 'neff.1', 'runs.0', 'runs.1', 'runs.2', 'runs.3', 'runs.4', 'end.0'
  ]);

  const ptsPlain = $derived(cloudPoints('plain'));
  const ptsPlates = $derived(cloudPoints('plates'));
  const ptsGroups = $derived(labels ? cloudPoints('group') : []);
  const redCount = $derived(D ? D.designs.filter((d) => d.vs[0]).length : null);
  const orangeCount = $derived(D ? D.designs.filter((d) => !d.vs[0] && d.vs[1]).length : null);
  const untestedGroups = $derived(D ? D.groups.filter((g) => g.fromUntested > g.fromSimilar).length : null);
  const groupA = $derived(D?.groups[0] ?? null);
  const fmt = (v, d = 1) => (v == null ? '…' : Number(v).toFixed(d));
  const N = $derived(D?.designs.length ?? null);
  const pcTotal = $derived(basis ? basis.explained.reduce((a, b) => a + b, 0) : null);
</script>

<svelte:head>
  <title>How the round-1 plan was chosen · CFPS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

<svelte:window onkeydown={onKey} onpointerup={onPointerUp} onhashchange={fromHash} />

{#snippet signIn(what)}
  <div class="lockcard">
    <b>Sign in to see {what}</b>
    <p>It is derived from every participant’s submission, so it is for signed-in participants.
      Names and compositions never reach this page either way.</p>
    {#if data.kcConfigured}<a class="cx-btn" href={loginHref(page.url)}>Sign in</a>{/if}
  </div>
{/snippet}

{#snippet t(k, label)}<button type="button" class="term"
  onmouseenter={(ev) => showTip(ev, k)} onmouseleave={hideTip}
  onfocus={(ev) => showTip(ev, k)} onblur={hideTip}>{label}</button>{/snippet}

{#snippet viewControls()}
  {#if D && gp}
    <div class="fig-controls">
      <div class="cx-seg" role="group" aria-label="3-D or 2-D view">
        <button type="button" class:is-on={!view2d} onclick={() => (view2d = false)}>3-D</button>
        <button type="button" class:is-on={view2d} onclick={() => (view2d = true)}>2-D</button>
      </div>
      {#if view2d}
        <div class="cx-seg" role="group" aria-label="Which two components">
          {#each PC_PAIRS as pr}
            <button type="button" class:is-on={pcPair[0] === pr[0] && pcPair[1] === pr[1]}
              onclick={() => (pcPair = pr)}>PC{pr[0] + 1} × PC{pr[1] + 1}</button>
          {/each}
        </div>
      {/if}
      <div class="cx-seg" role="group" aria-label="How to colour the points">
        <button type="button" class:is-on={!colourByReagent} onclick={() => (colourByReagent = false)}>{cur.ci === 6 ? 'by group' : st >= 3 ? 'by plates' : 'plain'}</button>
        <button type="button" class:is-on={colourByReagent} onclick={() => (colourByReagent = true)}>by reagent</button>
      </div>
      {#if colourByReagent}
        <select value={reagentCol} onchange={(e) => setReagent(e.currentTarget.value)} aria-label="Reagent to colour by">
          {#each gp.cols as c, i}<option value={c}>{gp.names[i]}</option>{/each}
        </select>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet spaceView(points, caps, height)}
  {#if view2d && D}
    <Scatter2D {points} pair={pcPair} label={cloudLabel} axes={caps} {height} />
  {:else}
    <Cloud3D {points} label={cloudLabel} axes={caps} {height} />
  {/if}
{/snippet}

{#snippet howTo(k)}
  <details class="howread">
    <summary>How to read this graph</summary>
    <ul>{#each HOWTO[k] as line}<li>{line}</li>{/each}</ul>
  </details>
{/snippet}

{#snippet loadingCard()}
  <div class="lockcard">{#if loadErr}<b>Couldn’t load the data</b><p>{loadErr}</p>{:else}<p class="pulse">loading the model…</p>{/if}</div>
{/snippet}

<div class="cfps-page cx">
  <header class="cx-bar">
    <a class="cx-back" href="/cfps/clusters">← Round-1 planner</a>
    <nav class="cx-tabs" aria-label="Protein target">
      {#each TARGETS as t}
        <button type="button" class:is-on={target === t} style={target === t ? `--tc:${TCOLOR[t]}` : ''}
          onclick={() => (target = t)}>{t}</button>
      {/each}
    </nav>
    <span class="cx-status">
      {#if loadErr}<span class="err">{loadErr}</span>
      {:else if !resp}loading…
      {:else if matches}recomputed here: {matches.same}/{matches.of} groups match the export
      {:else if locked}<a href={loginHref(page.url)}>sign in</a> for the real designs{/if}
    </span>
  </header>

  <div class="deck">
    <button type="button" class="edge edge--l" disabled={idx === 0} aria-label="Previous step" onclick={() => go(idx - 1)}><span>‹</span></button>
    <button type="button" class="edge edge--r" disabled={idx === LAST} aria-label="Next step" onclick={() => go(idx + 1)}><span>›</span></button>

    <div class="stage">
      <!-- ═══════════════════════════ the words ═══════════════════════════ -->
      <div class="stage-text">
        {#key key}
          <div class="slide" class:cover={cur.ci === 0} in:fly={{ x: 44 * dir, duration: 380, easing: cubicOut }}>
            {#if cur.ci > 0 && cur.ci < FINAL_CH}
              <p class="eyebrow"><span class="num">{cur.ci}</span>{ch.title}<span class="of">{st + 1} / {ch.steps}</span></p>
            {/if}

            {#if key === 'start.0'}
              <p class="kicker">CFPS round 1 · a visual walkthrough</p>
              <h1>How {N ?? 'hundreds of'} student reagent compositions became {D?.totals.runsInAll ?? 'a plate of'} tested compositions</h1>
              <p class="lede">
                Students submitted more {target} reagent compositions than there are wells, and none had been tested yet.
                The CFPS Arena model chose which ones to test. This walkthrough shows how, one picture at a time:
                {@render t('student', 'student reagent compositions')} become points, points get
                <em class="c-blue">{@render t('link', 'links')}</em>, links form
                <em class="c-yellow">{@render t('group', 'groups')}</em>, and groups become
                <em class="c-teal">{@render t('tested', 'tested compositions')}</em>.
              </p>
              {#if D}
                <div class="hero-stats">
                  <div><b>{N}</b><span>{@render t('student', 'student compositions')}</span></div>
                  <div><b>{D.groups.length}</b><span>{@render t('group', 'groups')}</span></div>
                  <div><b>~{fmt(effAll)}</b><span>{@render t('indep', 'independent experiments')}</span></div>
                  <div><b>{D.totals.runsInAll}</b><span>{@render t('tested', 'tested compositions')}</span></div>
                </div>
              {/if}
              {#if resp && model && D && model.modelBuilt !== D.built}
                <p class="warnline">The model on Clinton’s page ({new Date(model.modelBuilt).toLocaleString()}) is a different
                  build from the export ({new Date(D.built).toLocaleString()}), so links recomputed here may drift from the export.</p>
              {/if}
              <button type="button" class="cx-btn begin" onclick={() => go(1)}>Begin →</button>
              <p class="howto">Step with <kbd>←</kbd> <kbd>→</kbd>, the screen edges or the timeline. Hover a
                <span class="dotted">dotted word</span> for a definition. Scroll down on any step for more detail.</p>

            <!-- 1 · A composition is a point -->
            {:else if key === 'point.0'}
              <p>Every {@render t('student', 'student reagent composition')} is a list of amounts in a 20 µL well: so many
                nanolitres of magnesium glutamate, so many of PEP, and so on. Take one reagent and each design becomes a position on a number line.</p>
              <p>With two reagents it’s a point on a plane, with three a point in space. The model uses <b>30</b>
                reagents, the ones {@render t('controls', 'Ginkgo’s control plates')} varied.</p>
            {:else if key === 'point.1'}
              <p>Nanolitres are a poor ruler. Adding 50 nL of spermidine to a composition that has none is a big change;
                adding 50 nL to 5,000 nL of PEP barely registers. So the model {@render t('log', 'log-compresses')} each
                amount, then expresses it as a {@render t('z', 'z-score')}: how far it sits from Ginkgo’s typical amount,
                in units of how much the plates varied it.</p>
              <math display="block">
                <msub><mi>x</mi><mi>j</mi></msub><mo>=</mo>
                <mfrac>
                  <mrow><mi>ln</mi><mo>(</mo><mn>1</mn><mo>+</mo><msub><mi>c</mi><mi>j</mi></msub><mo>/</mo><msub><mi>s</mi><mi>j</mi></msub><mo>)</mo><mo>−</mo><msub><mi>μ</mi><mi>j</mi></msub></mrow>
                  <msub><mi>σ</mi><mi>j</mi></msub>
                </mfrac>
              </math>
              <p>The grey guides are evenly spaced in nanolitres; they bunch up as they pass through the log. Click or
                drag on any line to move the amount.</p>
            {:else if key === 'point.2'}
              <p>Doing this for all 30 reagents puts each design at a point in 30-dimensional space. To look at it, the
                view is turned to the three directions where the points spread most, the
                {@render t('pc', 'principal components')}. Drag to rotate, or switch to 2-D to compare any two of the
                first four components side by side.</p>
              <p><span class="c-white">◆ White diamonds</span> are {@render t('controls', 'Ginkgo’s 78 control wells')},
                the only compositions with a measured yield. <span class="c-blue">● Blue dots</span> are the class’s designs.</p>
            {:else if key === 'point.3'}
              <p>The control wells sit close together, because each one changes a single ingredient from a published
                starting composition. The class’s designs spread much further. Colour shows how each design compares with
                what the plates ran:</p>
              <ul class="keys">
                <li><span class="c-green">green</span>: every change stays within {@render t('range', 'the plates’ range')}.</li>
                <li><span class="c-gold">orange</span>: it pushes a measured reagent past that range
                  {#if orangeCount != null}({orangeCount} designs){/if}, so the model has to {@render t('extrapolate', 'extrapolate')}.</li>
                <li><span class="c-red">red</span>: it uses a reagent {@render t('untested', 'never on a Ginkgo plate')}
                  {#if redCount != null}({redCount} designs){/if}. These reagents aren’t among the 30 axes; chapter 4
                  covers how the model handles them.</li>
              </ul>

            <!-- 2 · Predicting from 78 wells -->
            {:else if key === 'gp.0'}
              <p>To predict a new composition, the model looks at how close it is to each measured well. Nearby wells count
                for a lot and distant ones for little. This kind of model is a {@render t('gp', 'Gaussian process')}.</p>
              <p>The plot shows the idea with one reagent. White dots are measurements, the
                <span class="c-blue">blue line</span> is the prediction, and the shaded band is where the true value
                probably lies. Click anywhere to add a measurement, or drag one.</p>
            {:else if key === 'gp.1'}
              <p>How far one measurement’s influence reaches is set by the {@render t('ls', 'length-scale')} ℓ, part of
                the {@render t('kernel', 'kernel')}, the formula that scores how close two compositions are:</p>
              <math display="block">
                <mi>k</mi><mo stretchy="false">(</mo><mi>x</mi><mo>,</mo><msup><mi>x</mi><mo>′</mo></msup><mo stretchy="false">)</mo><mo>=</mo>
                <mi>a</mi><mo>·</mo><mi>exp</mi><mo>(</mo><mo>−</mo>
                <mfrac><msup><mrow><mo>‖</mo><mi>x</mi><mo>−</mo><msup><mi>x</mi><mo>′</mo></msup><mo>‖</mo></mrow><mn>2</mn></msup><mrow><mn>2</mn><msup><mi>ℓ</mi><mn>2</mn></msup></mrow></mfrac>
                <mo>)</mo>
              </math>
              <p>A small ℓ gives a wiggly curve that loses confidence quickly between points. A large ℓ gives a smooth
                curve that stays confident far from data. The real model fitted ℓ from the plates{#if gp}:
                <b class="c-yellow">ℓ = {gp.ls.toFixed(2)}</b> for {target}{/if}.</p>
            {:else if key === 'gp.2'}
              <p>The prediction and its uncertainty both come from short formulas. <i>y</i> holds the measured yields,
                <i>K</i> the kernel between every pair of wells, and <i>k<sub>x</sub></i> the kernel from a new composition to
                each well:</p>
              <math display="block">
                <mi>μ</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo>
                <msubsup><mi>k</mi><mi>x</mi><mi>⊤</mi></msubsup><msup><mi>K</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mi>y</mi>
                <mspace width="1.5em" />
                <msup><mi>σ</mi><mn>2</mn></msup><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo><mi>a</mi><mo>−</mo>
                <msubsup><mi>k</mi><mi>x</mi><mi>⊤</mi></msubsup><msup><mi>K</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><msub><mi>k</mi><mi>x</mi></msub>
              </math>
              <p>The variance starts at <i>a</i>, which means no information, and each nearby measurement reduces it.
                That’s why the band narrows at the dots and widens between them.</p>
            {:else if key === 'gp.3'}
              <p>This is a slice through the real {target} model. It starts from Ginkgo’s best composition, holds 29 reagents
                fixed and varies one.</p>
              <p>Inside the <span class="c-green">green</span> range the plates have data and the band stays narrow.
                Past it, the band widens because the model is {@render t('extrapolate', 'extrapolating')}. Click or drag on
                the plot to move along the curve, and try other reagents. Your choice carries through the rest of the
                walkthrough.</p>

            <!-- 3 · From error bars to links -->
            {:else if key === 'link.0'}
              <p>The band shows how unsure the model is about one design. Planning needs a different question:
                <b>if the model is wrong about design A, is it also wrong about design B?</b></p>
              <p>To see this, draw several curves the model considers plausible. Each
                <span class="c-teal">teal curve</span> passes close to the measurements, and the model can’t tell which
                one is true.</p>
            {:else if key === 'link.1'}
              <p>Place two probes, <span class="c-blue">A</span> and <span class="c-gold">B</span>. For each curve,
                record how far it is from the mean at A and at B, and plot that pair as a dot.</p>
              <p>Drag B towards A and the dots line up on a diagonal: a curve that runs high at A also runs high at B.
                Move them apart, or click between them to add a measurement, and the dots spread into a round cloud.</p>
            {:else if key === 'link.2'}
              <p>The slope of that cloud is the {@render t('posterior', 'posterior covariance')}. Scaled to run between 0
                and 1, it becomes the {@render t('link', 'link')}, which the whole plan is built from:</p>
              <math display="block">
                <msub><mi>Σ</mi><mrow><mi>A</mi><mi>B</mi></mrow></msub><mo>=</mo>
                <mi>k</mi><mo stretchy="false">(</mo><mi>A</mi><mo>,</mo><mi>B</mi><mo stretchy="false">)</mo><mo>−</mo>
                <msubsup><mi>k</mi><mi>A</mi><mi>⊤</mi></msubsup><msup><mi>K</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><msub><mi>k</mi><mi>B</mi></msub>
                <mspace width="1.5em" />
                <msub><mi>r</mi><mrow><mi>A</mi><mi>B</mi></mrow></msub><mo>=</mo>
                <mfrac><msub><mi>Σ</mi><mrow><mi>A</mi><mi>B</mi></mrow></msub><msqrt><msub><mi>Σ</mi><mrow><mi>A</mi><mi>A</mi></mrow></msub><msub><mi>Σ</mi><mrow><mi>B</mi><mi>B</mi></mrow></msub></msqrt></mfrac>
              </math>
            {:else if key === 'link.3'}
              <p>Testing one design tells you about every design linked to it. At r<sub>AB</sub> = 0.9, testing A tells
                you most of what testing B would. At r<sub>AB</sub> = 0, B is a separate question and needs its own well.</p>
              <p>The model computes this for every pair of designs, across all 30 reagents, plus one extra term covered
                in the next chapter.</p>

            <!-- 4 · The shared unknown -->
            {:else if key === 'unknown.0'}
              <p>Some reagents, such as PEG-8000, maltodextrin, DsbC and glutathione, were
                {@render t('untested', 'never on a Ginkgo plate')}. They aren’t among the 30 axes, so the Gaussian
                process can’t see them. Two designs that both add PEG-8000 but differ in everything else look
                <i>unrelated</i> to it.</p>
              <p>These two designs come from one group. The <span class="c-blue">blue</span> bar is all the link the GP
                finds between them.</p>
            {:else if key === 'unknown.1'}
              <p>To account for this, the model adds a {@render t('shock', 'shock')} for each untested change: a random
                effect shared by every design that makes the same change. Its spread is σ<sub>N</sub>, scaled by how far
                past the plates the dose goes (<i>w</i>), and there is a chance <i>p</i> that the reaction
                {@render t('collapse', 'collapses')} to about 1/50 of the yield:</p>
              <math display="block">
                <msubsup><mi>Σ</mi><mrow><mi>A</mi><mi>B</mi></mrow><mtext>shared</mtext></msubsup><mo>=</mo>
                <munder><mo>∑</mo><mi>u</mi></munder>
                <msubsup><mi>σ</mi><mi>N</mi><mn>2</mn></msubsup><msub><mi>w</mi><mi>A</mi></msub><msub><mi>w</mi><mi>B</mi></msub>
                <mo>+</mo><mo>(</mo><mi>p</mi><mo>·</mo><mi>min</mi><mo stretchy="false">(</mo><msub><mi>c</mi><mi>A</mi></msub><mo>,</mo><msub><mi>c</mi><mi>B</mi></msub><mo stretchy="false">)</mo><mo>−</mo><msup><mi>p</mi><mn>2</mn></msup><msub><mi>c</mi><mi>A</mi></msub><msub><mi>c</mi><mi>B</mi></msub><mo>)</mo><msup><mi>J</mi><mn>2</mn></msup>
              </math>
              <p>The link is the <span class="c-blue">GP covariance</span> plus this <span class="c-red">shared
                covariance</span>, divided by the same total, so the two parts add up.</p>
            {:else if key === 'unknown.2'}
              <p>This shared term is what holds the group together. If the untested change hurts {target}, these designs
                are likely to fail <i>together</i>, however different the rest of their compositions are.</p>
              <p>Take the shared change away from B and the link drops back to the composition-only part. The two small
                heatmaps show the same designs without and with the shared term.</p>
            {:else if key === 'unknown.3'}
              <p>σ<sub>N</sub> and <i>p</i> were never measured. They are <b>assumptions</b>, set by the type of
                reagent: an established additive gets a smaller shock than a magnesium chelator.</p>
              <p>The dial scales all untested-reagent variance. Each change recomputes every link and regroups the
                designs, which shows how much the groups depend on these assumptions.</p>

            <!-- 5 · Every link at once -->
            {:else if key === 'matrix.0'}
              <p>Computing the link for every pair gives a table with one row and one column per design.
                {#if N}For {target} that’s {N} × {N} = {(N * N).toLocaleString()} links, all computed in your browser.{/if}</p>
              <p>In random order the table looks like noise: a bright diagonal, where each design links fully with
                itself, and scattered bright specks.</p>
            {:else if key === 'matrix.1'}
              <p>Reorder the rows and columns so linked designs sit next to each other. The numbers are the same, but
                <b>blocks</b> appear along the diagonal.</p>
              <p>Each bright block is a set of designs the model expects to succeed or fail together. Hover any pixel to
                see the pair.</p>
            {:else if key === 'matrix.2'}
              <p>The buttons split the link into its two parts. <span class="c-blue">Composition similarity</span> is high for
                designs that are close across the 30 measured reagents. <span class="c-red">Shared unknown</span> is high
                for designs that make the same untested change, even when their compositions are far apart.</p>
              <p>The blocks are the groups. The next chapter decides exactly where their edges go.</p>

            <!-- 6 · Drawing the lines -->
            {:else if key === 'groups.0'}
              <p>Start with every design on its own. Find the two most-linked groups, merge them, and repeat. This is
                {@render t('agglom', 'agglomerative clustering')}, and the {@render t('dendrogram', 'dendrogram')} on the
                right records the height of each merge.</p>
              <p>The toy uses plain distance as the link so you can see it. Step through the merges with ▶.</p>
            {:else if key === 'groups.1'}
              <p>Measuring the link between two <i>groups</i> needs a rule. {@render t('single', 'Single linkage')} uses
                their strongest pair. In the chain along the bottom each point links to its neighbour, so the whole
                chain becomes one group even though its two ends are unrelated.</p>
            {:else if key === 'groups.2'}
              <p>{@render t('complete', 'Complete linkage')} uses the <i>weakest</i> pair instead:</p>
              <math display="block">
                <mtext>link</mtext><mo stretchy="false">(</mo><mi>G</mi><mo>,</mo><mi>H</mi><mo stretchy="false">)</mo><mo>=</mo>
                <munder><mi>min</mi><mrow><mi>a</mi><mo>∈</mo><mi>G</mi><mo>,</mo><mi>b</mi><mo>∈</mo><mi>H</mi></mrow></munder>
                <msub><mi>r</mi><mrow><mi>a</mi><mi>b</mi></mrow></msub>
              </math>
              <p>Cutting the tree at {@render t('tau', 'τ = 0.5')} means every pair inside every group is linked at least
                0.5, so a group is a set of designs expected to move together rather than a chain. Drag the τ line to
                move the cut.</p>
            {:else if key === 'groups.3'}
              <p>The export adds one more rule. Some participants submitted identical compositions. Copies of one composition link
                at exactly 1 and would always form a group, but that is the same experiment twice rather than a
                hypothesis. So a group must contain at least two <i>different</i> compositions.</p>
            {:else if key === 'groups.4'}
              <p>The same algorithm, run in your browser on all {N ?? ''} {target} designs,
                {#if matches}finds <b class="c-yellow">{matches.mine}</b> groups at τ = 0.5.
                  <b>{matches.same} of the export’s {matches.of}</b> match member for member.{:else}reproduces the export’s groups.{/if}</p>
              <p>Click or drag across the chart to change τ and watch groups split or merge. In the 3-D view, adding the
                untested reagents as axes pulls together designs that share an unknown.</p>

            <!-- 7 · How many experiments -->
            {:else if key === 'neff.0'}
              <p>If no design were linked to another, {N ?? 'n'} designs would be {N ?? 'n'} separate experiments. If they
                were all perfectly linked, they would be one experiment repeated. The export measures where they fall
                with the {@render t('neff', 'participation ratio')}:</p>
              <math display="block">
                <msub><mi>n</mi><mtext>eff</mtext></msub><mo>=</mo>
                <mfrac><msup><mi>n</mi><mn>2</mn></msup><mrow><munder><mo>∑</mo><mrow><mi>i</mi><mo>,</mo><mi>j</mi></mrow></munder><msubsup><mi>r</mi><mrow><mi>i</mi><mi>j</mi></mrow><mn>2</mn></msubsup></mrow></mfrac>
                <mspace width="1.5em" /><mtext>all linked at ρ: </mtext>
                <mfrac><mi>n</mi><mrow><mn>1</mn><mo>+</mo><mo>(</mo><mi>n</mi><mo>−</mo><mn>1</mn><mo>)</mo><msup><mi>ρ</mi><mn>2</mn></msup></mrow></mfrac>
              </math>
              <p>Try different values of n and ρ. Even moderate links reduce the count quickly when there are many
                designs.</p>
            {:else if key === 'neff.1'}
              <p>For {target}: <b class="c-yellow">{N ?? '…'} designs are worth about {fmt(effAll)} independent
                experiments</b>, the same figure the export reports.
                {#if groupA}Group {groupA.letter}’s {groupA.members.length} designs count as about
                  {fmt(LM ? nEff(LM.R, LM.n, groupA.members) : null)}.{/if}</p>
              <p>This is why the plan tests groups rather than every design: one test per group captures most of what the
                group can show. Hover a group’s bar to see what it contains.</p>

            <!-- 8 · Choosing what to test -->
            {:else if key === 'runs.0'}
              <p>Each group gets a <b class="c-yellow">{@render t('first', 'first test')}</b>: the member with the best
                {@render t('odds', 'odds')} of beating Ginkgo’s best. The odds come from simulating the design through the
                competition’s screens thousands of times, using its predicted cost per gram and uncertainty.</p>
              <p>The first test tests what the whole group has in common. If it fails, the rest of the group probably
                would too.</p>
            {:else if key === 'runs.1'}
              <p>A second test from the same group only adds what the first test can’t predict. If its link to the first
                test is r, the first test accounts for r² of its uncertainty, and the rest is
                {@render t('newinfo', 'new information')}:</p>
              <math display="block">
                <mtext>new information</mtext><mo>=</mo><mn>1</mn><mo>−</mo><msubsup><mi>r</mi><mrow><mtext>first</mtext><mo>,</mo><mi>d</mi></mrow><mn>2</mn></msubsup>
              </math>
              <p>A design linked at 0.86 adds 26%. Designs close to 0% <span class="c-dim">follow their group’s
                tests</span>: their result is expected to come along with the first test’s.</p>
            {:else if key === 'runs.2'}
              <p>To choose among the rest, the model asks which ingredients matter <i>within</i> the group. It generates
                {D?.groups.find((g) => g.virtualRecipes)?.virtualRecipes ?? 160} or more
                {@render t('virtual', 'virtual compositions')} across the amounts the group’s designs use, predicts each one’s
                {@render t('cpg', 'cost per gram')}, and fits a {@render t('regression', 'regression')} on the ingredients.</p>
              <p>The virtual compositions come from a {@render t('lhc', 'Latin hypercube')}: each ingredient’s range is cut
                into slices and every slice is used once. Random points, for comparison, leave gaps.</p>
            {:else if key === 'runs.3'}
              <p>The regression ranks ingredients by how much they move the predicted cost per gram. For the top one or
                two, the <b class="c-teal">{@render t('check', 'check test')}</b> is the member whose amount differs <i>most</i> from the first
                test’s. Click an ingredient to follow it through the walkthrough; groups marked ★ in the list feature
                the reagent you’ve chosen.</p>
              <p>If the check test comes out as predicted, the group is behaving as modelled. If it doesn’t, that
                ingredient matters more or less than the model assumes.</p>
            {:else if key === 'runs.4'}
              <p>Two more kinds of test fill the plan. <b class="c-purple">{@render t('independent', 'Independent tests')}</b> are designs in no
                group, so nothing else on the plates predicts them.</p>
              <p><b class="c-gold">{@render t('sweep', 'Sweep tests')}</b> are submitted series that change one ingredient and nothing else. Tested
                together, they turn the model’s predicted curve into a measured one, and those measurements feed the
                round-2 model. Click or drag on the plot to read the curve.</p>
            {:else if key === 'runs.5'}
              <p>First tests, check tests, independents and sweeps together make up the plan.</p>
              <p>The <a href="/cfps/clusters">round-1 planner</a> starts from this plan. There you can change how deeply
                each group is tested and export the plates.</p>

            {:else if key === 'end.0'}
              <h2 class="end-h">What round 1 tests</h2>
              <p>Everything in this walkthrough is a <i>prediction</i> made before any class design was tested. Round 1
                checks it: whether each group really moves together (first test against check tests), whether the shared
                bets pay off, what the price-only reagents do, and whether the measured sweeps follow the predicted
                curves.</p>
              <p>Where results differ, they go back into the Gaussian process, and the next model improves.</p>
              <a class="cx-btn" href="/cfps/clusters">Open the round-1 planner →</a>
            {/if}
          </div>
        {/key}
        {#if DETAILS.has(key)}
          <button type="button" class="more" onclick={() => detailsEl?.scrollIntoView({ behavior: 'smooth' })}>{key === 'start.0' ? '↓ the approach at a glance' : '↓ more on this step'}</button>
        {/if}
      </div>

      <!-- ═══════════════════════════ the figure ═══════════════════════════ -->
      <div class="stage-fig">
        {#key cur.ci}
          <div class="fig-in" in:fade={{ duration: 260 }}>
            {#if !model && cur.ci !== 3 && cur.ci !== 6 && cur.ci !== 7}
              {@render loadingCard()}
            {:else if cur.ci === 0}
              <Cloud3D points={D ? ptsGroups : ptsPlain} label={cloudLabel} axes={null} height="clamp(280px, calc(100dvh - 260px), 620px)" />
              <p class="fig-note">{D ? `Every ${target} design in the model’s space, coloured by its group. Drag to rotate.` : 'Ginkgo’s control wells in the model’s space. Sign in to add the class’s designs.'}</p>
            {:else if cur.ci === 1}
              <div class:gone={st >= 2}><AxisTransform {model} designs={D?.designs ?? null} step={st}
                reagent={reagentCol} {amount} {setReagent} {setAmount} /></div>
              <div class:gone={st < 2}>
                {@render viewControls()}
                {@render spaceView(st >= 3 ? ptsPlates : ptsPlain, axisCaps(basis), 'clamp(220px, calc(100dvh - 350px), 600px)')}
                {#if !D}{@render signIn('the class’s designs in this space')}{/if}
                <ul class="fig-legend">
                  <li><i class="sw" style="background:var(--white)"></i>Ginkgo control well</li>
                  {#if D && colourByReagent}<li><i class="sw sw--ramp"></i>{reagentName}: less → more</li>
                  {:else if D && st < 3}<li><i class="sw" style="background:var(--blue)"></i>class design</li>{/if}
                  {#if D && st >= 3 && !colourByReagent}
                    <li><i class="sw" style="background:var(--green)"></i>within the plates</li>
                    <li><i class="sw" style="background:var(--gold)"></i>past the range</li>
                    <li><i class="sw" style="background:var(--red)"></i>never on a plate</li>
                  {/if}
                </ul>
                {@render howTo('cloud')}
              </div>
            {:else if cur.ci === 2}
              <div class:gone={st >= 3}><GpToy mode="fit" /></div>
              <div class:gone={st < 3}><GpSlice {model} designs={D?.designs ?? null}
                reagent={reagentCol} {amount} {setReagent} {setAmount} />{@render howTo('slice')}</div>
            {:else if cur.ci === 3}
              <GpToy mode={st === 0 ? 'samples' : 'link'} />
              {#if st >= 1}{@render howTo('linktoy')}{/if}
            {:else if cur.ci === 4}
              {#if !D}{@render signIn('this chapter on the real designs')}
              {:else if ds}<SharedUnknown {model} data={D} {ds} step={st} />{/if}
            {:else if cur.ci === 5}
              {#if !D}{@render signIn('the real link matrix')}
              {:else if LM}
                <LinkHeatmap n={LM.n} R={LM.R} G={LM.G} groupOf={D.designs.map((d) => d.g)} groups={D.groups}
                  sorted={st >= 1} labelFor={designLabel} eff={effAll} {target} />
              {/if}
            {:else if cur.ci === 6}
              <div class:gone={st >= 4}><LinkageToy step={st} /></div>
              <div class:gone={st < 4}>
                {#if !model}{@render loadingCard()}
                {:else if !D}{@render signIn('the real grouping')}
                {:else if merges}
                  <GroupCount n={LM.n} {merges} {rc} bind:tau exportGroups={D.groups.length} />
                  <div class="fig-controls">
                    <div class="cx-seg" role="group" aria-label="Which space to draw">
                      <button type="button" class:is-on={space === 'measured'} onclick={() => (space = 'measured')}>30 measured reagents</button>
                      <button type="button" class:is-on={space === 'unknowns'} onclick={() => (space = 'unknowns')}>+ untested reagents as axes</button>
                    </div>
                  </div>
                  {@render viewControls()}
                  {@render spaceView(ptsGroups, axisCaps(space === 'unknowns' ? basisU?.p : basis), 'clamp(190px, calc(100dvh - 600px), 420px)')}
                  {@render howTo('groups')}
                {/if}
              </div>
            {:else if cur.ci === 7}
              <NeffToy R={LM?.R ?? null} n={LM?.n ?? 0} groups={D?.groups ?? null} step={st} />
              {#if st >= 1 && !D}{@render signIn('the real count')}{/if}
            {:else if cur.ci === 8}
              {#if st === 2}<LhcDemo />
              {:else if !D}{@render signIn('this chapter on the real designs')}
              {:else if st <= 1 && ds}<RunPicker {model} data={D} {ds} view={st === 0 ? 'odds' : 'info'} bind:pick={runGroup} reagent={reagentCol} {setReagent} />{@render howTo('runs')}
              {:else if st === 3 && ds}<RunPicker {model} data={D} {ds} view="checks" bind:pick={runGroup} reagent={reagentCol} {setReagent} />
              {:else if st === 4}<SweepCurve sweeps={D.sweeps} {reagent} {setReagent} />{@render howTo('sweep')}
              {:else if st >= 5}<Budget totals={D.totals} {target} />
              {/if}
            {:else if cur.ci === FINAL_CH}
              {#if D}<Budget totals={D.totals} {target} />{:else}{@render signIn('the round-1 tally')}{/if}
            {/if}
          </div>
        {/key}
      </div>
    </div>

    <!-- ═══════════════════════════ the timeline ═══════════════════════════ -->
    <nav class="tl" aria-label="Steps">
      <button type="button" class="tl-btn" disabled={idx === 0} aria-label="Previous step" onclick={() => go(idx - 1)}>←</button>
      <div class="tl-track">
        {#each CHAPTERS as c, ci}
          <div class="tl-ch" class:on={ci === cur.ci} style="flex:{c.steps}">
            <span class="tl-lbl" title={c.title}>{#if ci > 0 && ci < FINAL_CH}<i>{ci}</i>{/if}{c.word}</span>
            <div class="tl-dots">
              {#each Array(c.steps) as _, s}
                {@const i = START[ci] + s}
                <button type="button" class="tl-dot" class:done={i < idx} class:cur={i === idx}
                  aria-label="{c.title}, step {s + 1}" aria-current={i === idx ? 'step' : undefined}
                  onclick={() => go(i)}></button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <span class="tl-count">{idx + 1} / {SLIDES.length}</span>
      <button type="button" class="tl-btn" disabled={idx === LAST} aria-label="Next step" onclick={() => go(idx + 1)}>→</button>
    </nav>
  </div>

  {#if tip}
    <div class="tip" class:above={tip.above} role="tooltip" style="left:{tip.left}px; top:{tip.top}px; width:{TIP_W}px">
      <b>{TERMS[tip.k][0]}</b>
      <p>{TERMS[tip.k][1]}</p>
    </div>
  {/if}

  <!-- ═══════════════════════ more on this step ═══════════════════════ -->
  <section class="details" bind:this={detailsEl}>
    {#if DETAILS.has(key)}
      <p class="d-eyebrow">More on · {cur.ci > 0 && cur.ci < FINAL_CH ? `${cur.ci}. ${ch.title} · step ${st + 1}` : ch.title}</p>

      {#if key === 'start.0'}
        <!-- the whole method on one card, with what each step is chosen over -->
        <div class="approach">
          <h3>The approach at a glance</h3>
          <div class="ap-row ap-head"><span></span><span>what the model uses</span><span>why, rather than the usual alternative</span></div>
          <div class="ap-row">
            <b>1 Represent</b>
            <span>{@render t('log', 'log-scaled')} {@render t('z', 'z-scores')} of the 30 reagents Ginkgo varied</span>
            <span>puts every reagent on the same footing, so no single one dominates distances</span>
          </div>
          <div class="ap-row">
            <b>2 Predict</b>
            <span>{@render t('gp', 'Gaussian process')} with an RBF {@render t('kernel', 'kernel')}, fitted to 78 control wells</span>
            <span>gives predictions <i>and</i> calibrated uncertainty from very little data; a linear fit or random forest gives no reliable error bars</span>
          </div>
          <div class="ap-row">
            <b>3 Relate</b>
            <span>{@render t('link', 'link')} = correlation of prediction errors, plus a shared {@render t('shock', 'shock')} for untested reagents</span>
            <span>asks whether one result predicts another; plain composition distance ignores the measured wells and can’t see untested reagents</span>
          </div>
          <div class="ap-row">
            <b>4 Group</b>
            <span>{@render t('complete', 'complete-linkage')} {@render t('agglom', 'hierarchical clustering')}, cut at link 0.5</span>
            <span>no need to pick the number of groups (as {@render t('kmeans', 'k-means')} does), and every pair in a group clears the bar, so no chains</span>
          </div>
          <div class="ap-row">
            <b>5 Choose</b>
            <span>{@render t('first', 'first test')} per group, {@render t('check', 'check tests')} by {@render t('newinfo', 'new information')}, plus independents and sweeps</span>
            <span>spends wells on separate questions instead of re-testing designs that would succeed or fail together</span>
          </div>
        </div>
        <h3>How to read this</h3>
        <p>Each chapter has a few steps. The text on the left explains what the figure on the right shows, and the
          figure responds to clicks, drags and hovers. It stays in place while you step through a chapter, so you can
          see it change from one step to the next.</p>
        <p>The reagent you pick in one figure carries through to the others, so you can follow one ingredient from the
          first chapter to the last.</p>
        <p>The protein tabs at the top switch every real-data figure between sfGFP, PETase and reteplase. The three
          differ: most reteplase groups rest on one untested change (the redox and folding package), while most sfGFP
          groups are held together by similar compositions.</p>
        <h3>Where the numbers come from</h3>
        <p>The model and the export are Clinton Monteiro’s CFPS Arena. This page recomputes the links and groups in
          your browser from the model rather than copying them, and compares the result with the export: links agree to
          the export’s two decimals and groups agree member for member.
          {#if D && model}Export built {new Date(D.built).toLocaleString()}; model built {new Date(model.modelBuilt).toLocaleString()}.{/if}</p>

      {:else if key === 'point.0'}
        <h3>The 30 axes</h3>
        <p>These are the reagents Ginkgo’s control plates varied, so they are the only ones the model can learn an
          effect for:</p>
        {#if gp}<p class="taglist">{#each gp.names as nm}<span>{nm}</span>{/each}</p>{/if}
        <p>Everything else in a composition (lysate, buffer, template) is fixed, and reagents the plates never varied get
          handled separately, in chapter 4.</p>
      {:else if key === 'point.1'}
        <h3>What c, s, μ and σ are</h3>
        <p><i>c</i> is the reagent’s concentration in the well: nL ÷ 20,000 nL × the stock concentration.
          <i>s</i> is a per-reagent scale that sets where the log starts to bite. Below <i>s</i> the transform is
          nearly linear, above it nearly logarithmic.</p>
        <p><i>μ</i> and <i>σ</i> are the mean and standard deviation of ln(1 + c/s) over Ginkgo’s 78 control wells,
          so on every axis the controls sit at mean 0 with spread 1. A design at <i>x</i> = +2 uses two plate-spreads
          more than a typical control.</p>
        <p>Putting every reagent in the same units is what lets the model measure distance across all 30 at once.
          A reagent the plates barely varied gets a small σ, so the same nanolitre change counts for more on its axis.</p>
      {:else if key === 'point.2'}
        <h3>What the 3-D view does and doesn’t show</h3>
        <p>The three axes are the principal components of every point here (designs and controls together): the
          directions of greatest spread in the 30-D space. Their captions give the share of the total spread each one
          holds{#if pcTotal != null}, {Math.round(pcTotal * 100)}% for the three together{/if}.</p>
        <p>So distances in the picture are only roughly right. Two points that look close may differ along the
          dimensions you can’t see. The model always works in the full 30 dimensions.</p>
        <p>The 2-D view plots one pair at a time. PC1 × PC2 holds the most spread; PC3 × PC4 shows structure the first
          two hide, such as designs that look alike on PC1 and PC2 but differ in a less common reagent.</p>
      {:else if key === 'point.3'}
        <h3>How the colours are decided</h3>
        <p>The export compares each design with Ginkgo’s best composition and counts only changes of 1.4× or more. Each
          change is then checked against what the plates ran:</p>
        <ul class="keys">
          <li><span class="c-red">never on a plate</span>: a reagent outside the 30 axes, used outside 0.9×–1.1× of
            anything the plates had. The model can price it but can’t predict it, and it is the only kind of change
            that can crash a design in the model.</li>
          <li><span class="c-gold">past the plates’ range</span>: one of the 30 reagents, pushed beyond the amounts
            the plates ran. The GP extrapolates, so its uncertainty grows, but that doubt belongs to this design alone.</li>
          <li><span class="c-green">within</span>: inside what the plates ran (the export also has “between the plates’
            levels”, interpolated, which is counted as green here).</li>
        </ul>

      {:else if key === 'gp.0'}
        <h3>What a Gaussian process assumes</h3>
        <p>Before seeing any data, a GP treats yield as a smooth surface over composition space: the yields of two compositions
          are correlated, more strongly the closer the compositions are. Measured wells fix the surface near them. The result,
          the posterior, is a best guess (the mean) plus a spread showing how uncertain that guess is.</p>
        <p>The real model predicts ln(yield), standardised, from the 78 control wells.{#if gp} Its prior variance is
          a = {gp.amp.toFixed(2)} (in standardised units) and its length-scale ℓ = {gp.ls.toFixed(2)}.{/if}</p>
      {:else if key === 'gp.1'}
        <h3>What ℓ means in composition terms</h3>
        <p>Distance here is Euclidean across all 30 z-scored axes. Two compositions ℓ apart still share
          e<sup>−½</sup> ≈ 61% of their prior covariance; 2ℓ apart, about 14%; 3ℓ apart, about 1%.</p>
        <p>The three proteins learned different length-scales because their yields respond differently to composition
          changes. A shorter ℓ means the landscape changes faster, so each measured well informs a smaller
          neighbourhood.</p>
      {:else if key === 'gp.2'}
        <h3>Differences from the toy</h3>
        <p>The toy adds a little measurement noise to <i>K</i>’s diagonal so it can be inverted. The real model ships
          <i>K</i>⁻¹ precomputed for its 78 wells, so each prediction takes a few dot products.</p>
        <p>The real covariance also carries a lysate term, σ<sub>L</sub>²·k(A,B), for batch-to-batch lysate
          variation{#if gp} (σ<sub>L</sub> = {gp.sigmaLysate.toFixed(2)} for {target}){/if}. It fades with composition
          distance like the rest.</p>
      {:else if key === 'gp.3'}
        <h3>Reading the slice</h3>
        <p>The y-axis is predicted yield as a multiple of Ginkgo’s best measured yield, on a log scale; the band is ±2σ.
          The prediction for Ginkgo’s own best composition can differ from 1× because the GP smooths over replicate noise.</p>
        <p>A slice holds the other 29 reagents at Ginkgo’s best. Along a slice from a different starting composition the
          curve can look different, because the GP allows reagents to interact.</p>

      {:else if key === 'link.0'}
        <h3>How the curves are drawn</h3>
        <p>Each curve is a sample from the posterior: the mean plus <i>L</i>·<i>z</i>, where <i>L</i> is the Cholesky
          factor of the posterior covariance over a grid and <i>z</i> is a vector of random normals. The animation
          moves between two fixed draws, <i>z</i>₁cos t + <i>z</i>₂sin t, which is also a valid sample at every frame.</p>
      {:else if key === 'link.1'}
        <h3>What the scatter shows</h3>
        <p>The faint dots are 260 independent draws of the two errors at A and B; the bright ones are the curves on
          screen. The shape of the cloud is the 2 × 2 posterior covariance of A and B. Its tilt is the correlation.</p>
      {:else if key === 'link.2'}
        <h3>Reading the formula</h3>
        <p>The first term, k(A, B), says nearby compositions share their uncertainty. The second takes away the part the
          measurements already explain, which is why a well between A and B makes them less linked.</p>
        <p>Dividing by √(Σ<sub>AA</sub>Σ<sub>BB</sub>) turns a covariance into a correlation, so a link is comparable
          between designs the model is very sure about and designs it isn’t.</p>
      {:else if key === 'link.3'}
        <h3>Why not use distance?</h3>
        <p>Measured wells change how linked two designs are. Two designs the same distance apart can be strongly linked
          in a region with no data and weakly linked next to a measurement that explains both. Whether one test predicts
          another depends on the correlation, not the distance.</p>

      {:else if key === 'unknown.0'}
        <h3>Reagents the {target} model can’t see</h3>
        {#if D}<p class="taglist">{#each Object.values(D.novelNames) as nm}<span>{nm}</span>{/each}</p>
          <p>These appear in at least one design outside anything the plates ran. Removing a reagent that every plate
            had also counts, which is why reteplase designs that drop DsbC or glutathione appear as untested.</p>
        {:else}<p>Sign in to list the untested reagents in this protein’s designs.</p>{/if}
      {:else if key === 'unknown.1'}
        <h3>The assumed numbers</h3>
        {#if S}
          <p>σ<sub>N</sub> = {S.sigmaNovel} in ln-yield. Collapse multiplies yield by e<sup>J</sup> with
            J = {S.collapseLn.toFixed(2)} (about 1/50), with base odds p = {S.pCollapse} at full dose.
            <i>w</i> and <i>c</i> are dose weights from 0 to 1: how far past the plates’ amounts the design goes,
            relative to the reagent’s stock.</p>
          {#if S.riskReagents?.length}
            <p>Some reagents belong to a risk class that sets their own spread and collapse odds instead:</p>
            <table class="dtab">
              <thead><tr><th>class</th><th>spread σ</th><th>collapse p</th><th>reagents</th></tr></thead>
              <tbody>
                {#each Object.entries(S.riskClasses) as [cls, rcl]}
                  <tr>
                    <td>{rcl.label ?? cls}</td><td>{rcl.sigma}</td><td>{rcl.p}</td>
                    <td>{S.riskReagents.filter((r) => r.cls === cls).map((r) => `${r.name} ${r.dir > 0 ? '↑' : '↓'}${r.t ? ` (${r.t})` : ''}`).join(', ')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/if}
        <p>Only changes both designs make in the <i>same direction</i> are shared. A design’s own unshared untested
          changes still add to its variance, which <i>lowers</i> its link with everyone else.</p>
      {:else if key === 'unknown.2'}
        <h3>How common this is</h3>
        {#if untestedGroups != null}
          <p>For {target}, {untestedGroups} of {D.groups.length} groups get more of their link from a shared untested
            change than from similar compositions.</p>
        {/if}
        <p>In those groups, the first test tests the shared change for every design at once. Groups held together by
          similar compositions tell you less if they behave alike, because the model already expected that.</p>
      {:else if key === 'unknown.3'}
        <h3>What the dial changes</h3>
        <p>It multiplies both parts of every shock (the spread and the collapse term) by the same factor, in each
          design’s variance and in every shared covariance. Then it recomputes all the links and reruns the grouping.</p>
        <p>At ×0 the untested reagents drop out of the model and the groups that depended on them dissolve. Turned up,
          those groups take in more designs. Reteplase changes most, because most of its groups rest on an untested
          change.</p>

      {:else if key === 'matrix.0'}
        <h3>Reading the matrix</h3>
        <p>Row <i>i</i>, column <i>j</i> is the link between designs <i>i</i> and <i>j</i>. It is symmetric, and the
          diagonal is 1. Identical compositions also link at 1, so they show up as bright pixels wherever they fall.</p>
      {:else if key === 'matrix.1'}
        <h3>The order</h3>
        <p>Groups appear in the export’s order, each starting with its first test. Designs in no group come last, so
          the bottom-right corner is dark: those designs aren’t strongly linked to anything.</p>
        <p>Bright patches off the diagonal are pairs of groups that would largely move together even though they are
          separate. Two groups can be close on average while one pair between them falls below 0.5.</p>
      {:else if key === 'matrix.2'}
        <h3>Why the split matters</h3>
        <p>The two parts mean different things for planning. A group held together by composition similarity is close to
          what the plates already measured. A group held together by a shared unknown is an open question that its
          first test can answer.</p>

      {:else if key === 'groups.0'}
        <h3>How it is computed here</h3>
        <p>On the real data this page uses the nearest-neighbour-chain algorithm on distance 1 − r. It takes about
          n² steps instead of n³ and, for complete linkage, gives the same tree as merging greedily.</p>
      {:else if key === 'groups.1'}
        <h3>Why chaining is a problem</h3>
        <p>A chain of designs, each linked to the next, can connect compositions that have nothing in common. As one group,
          its first test would be treated as speaking for designs it doesn’t predict.</p>
      {:else if key === 'groups.2'}
        <h3>Why 0.5</h3>
        <p>It is the export’s threshold. With every pair linked at least 0.5, any one design in a group explains at
          least a quarter (0.5²) of the variance of every other, enough for a first test to represent the group.</p>
      {:else if key === 'groups.3'}
        <h3>Where the rule came from</h3>
        <p>Plain complete linkage at 0.5 finds a few more groups than the export lists, and each extra one consists of
          identical copies of a single composition. Dropping those reproduces the export. Those designs stay independent, and
          the planner credits every co-submitter of the composition on the plate.</p>
      {:else if key === 'groups.4'}
        <h3>How this is checked</h3>
        <p><code>npm run check:clusters-explained</code> rebuilds every link and group for all three proteins from the
          downloaded export and fails if they don’t match. The status line at the top of the page runs the same
          comparison in your browser.</p>
        <p>The “untested reagents as axes” view adds one axis per untested reagent, holding each design’s dose weight
          for it. The shared shock is a dot product along those axes, so designs that share an unknown sit closer
          together in that view.</p>

      {:else if key === 'neff.0'}
        <h3>Where the formula comes from</h3>
        <p>The participation ratio is (Σλ)² / Σλ² over the eigenvalues λ of the link matrix. Because the diagonal is
          all 1s, Σλ = n, and Σλ² = Σ<sub>ij</sub> r<sub>ij</sub>². It estimates how many independent directions the
          designs spread in, sometimes called the effective rank.</p>
      {:else if key === 'neff.1'}
        <h3>Reading the bars</h3>
        <p>Blue is a group’s size, yellow what its designs are worth together. Large groups of near-copies count as
          little more than one experiment. A group worth 2 or more contains more variety, so its check tests add more.</p>

      {:else if key === 'runs.0'}
        <h3>How the odds are simulated</h3>
        <p>For each design the model runs 4,000 simulated paths. In each, the design’s true ln(cost per gram) is drawn
          around its prediction (with collapse jumps for untested reagents). It must pass a 384-well screen and a
          96-well screen, each measured with replicate noise, then beat Ginkgo’s best at scale. The odds are the share of
          paths that win.</p>
      {:else if key === 'runs.1'}
        <h3>Why r²</h3>
        <p>In a joint Gaussian, knowing one value lets you predict r² of the other’s variance. The rest, 1 − r², is
          what only running it would show. The figure recomputes this for every member from the model, and the
          numbers match the export’s.</p>
      {:else if key === 'runs.2'}
        <h3>The second regression</h3>
        <p>The virtual compositions span the range of amounts the group’s own designs use. Their predicted ln(cost per gram)
          is regressed on the ingredient amounts, giving standardised coefficients from −1 to 1. The r² of that fit is
          the “single ingredients account for” figure: low means the ingredients act in combination.</p>
        <p>This regression uses the model’s own predictions, not lab data. Round 1 tests it.</p>
      {:else if key === 'runs.3'}
        <h3>Strength labels and price-only reagents</h3>
        <p>|coefficient| ≥ 0.5 is strong, ≥ 0.25 moderate, ≥ 0.1 weak, below that negligible. For a price-only
          reagent (one the plates held constant) the model can only price it, so its check test is the first measurement
          of what it does to yield.</p>
      {:else if key === 'runs.4'}
        <h3>Which sweeps are recommended</h3>
        <p>An ingredient gets a recommended sweep if it leads what matters in two or more groups, or if it is price-only
          and leads any. The sweep on the best background is tested, plus a second background where one was submitted. If the
          two curves agree, the curve can be expected to hold in other compositions too.</p>

      {:else if key === 'end.0'}
        <h3>Credits</h3>
        <p>Model and export by <b>Clinton Monteiro</b>:
          <a href="https://pages.htgaa.org/2026b/clinton-monteiro/week-4.5/cfps-clusters/index.html" target="_blank" rel="noopener">CFPS Clusters</a>
          and the <a href="https://pages.htgaa.org/2026b/clinton-monteiro/week-3/cfps-arena/index.html" target="_blank" rel="noopener">CFPS Arena</a>.
          This page recomputes the links and groups from that model in your browser.</p>
      {/if}

      <button type="button" class="back-up" onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑ back to the step</button>
    {/if}
  </section>
</div>

<style>
  /* 3Blue1Brown-ish: near-black ground, a few saturated accents that always
     mean the same thing — blue for the GP / composition similarity, red for the
     untested, yellow for the thing to look at, teal for samples and checks. */
  .cx {
    --bg: #0e1014; --fig: #0b0d11; --fig-2: #141820; --line: #262c35;
    --text: #e4e7eb; --dim: #a3abb5; --faint: #66707c; --white: #f4f6f8;
    --blue: #58c4dd; --yellow: #ffd866; --green: #83c167; --red: #fc6255;
    --gold: #f0ac5f; --teal: #5cd0b3; --purple: #a87cd8;
    --bar-h: 49px;
    background: var(--bg); color: var(--text); min-height: 100vh;
    font: 16px/1.65 var(--sans);
  }
  .cx :global(math) { font-size: 1.12em; color: var(--text); }
  .cx :global(math[display='block']) { margin: 14px 0; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }

  .cx-bar {
    position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 16px;
    height: var(--bar-h); box-sizing: border-box; padding: 0 22px;
    background: rgba(14, 16, 20, .94); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
  }
  .cx-back { font: 11px var(--mono); color: var(--dim); text-decoration: none; }
  .cx-back:hover { color: var(--text); }
  .cx-tabs { display: flex; gap: 6px; }
  .cx-tabs button {
    font: 600 12px var(--sans); padding: 5px 12px; border-radius: 4px; cursor: pointer;
    background: transparent; color: var(--dim); border: 1px solid var(--line);
  }
  .cx-tabs button.is-on { color: var(--text); border-color: var(--tc); box-shadow: inset 0 -2px 0 var(--tc); }
  .cx-status { margin-left: auto; font: 11px var(--mono); color: var(--faint); }
  .cx-status a { color: var(--blue); }
  .cx-status .err { color: var(--red); }

  /* ── the deck: exactly one screen ────────────────────────────────────── */
  .deck { position: relative; height: calc(100vh - var(--bar-h)); height: calc(100dvh - var(--bar-h)); display: flex; flex-direction: column; }
  .stage {
    flex: 1; min-height: 0; width: 100%; max-width: 1500px; margin: 0 auto; box-sizing: border-box;
    display: grid; grid-template-columns: minmax(300px, 0.8fr) minmax(0, 1.25fr); grid-template-rows: minmax(0, 1fr); gap: 40px;
    padding: 22px 80px 14px;
  }
  .stage-text { position: relative; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; padding-right: 6px; }
  /* auto margins centre the slide without clipping it when it's tall */
  .slide { margin-block: auto; font-size: 17px; }
  .slide p { margin: 0 0 14px; }
  .slide a { color: var(--blue); }
  .eyebrow { display: flex; align-items: center; gap: 0; font: 600 14px var(--sans); color: var(--dim); margin: 0 0 22px !important; }
  .eyebrow .of { margin-left: auto; font: 11px var(--mono); color: var(--faint); }
  .num {
    display: inline-grid; place-items: center; width: 30px; height: 30px; margin-right: 12px; flex: none;
    border: 1px solid var(--line); border-radius: 50%; font: 600 13px var(--mono); color: var(--yellow);
  }
  .more {
    position: sticky; bottom: 0; align-self: flex-start; margin-top: 8px; padding: 6px 0 2px;
    background: linear-gradient(transparent, var(--bg) 40%); border: 0; cursor: pointer;
    font: 11px var(--mono); color: var(--faint);
  }
  .more:hover { color: var(--yellow); }

  .stage-fig {
    min-height: 0; max-height: 100%; align-self: center; overflow: auto; position: relative; z-index: 1;
    background: var(--fig); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px;
  }
  .gone { display: none; }

  /* cover slide */
  .kicker { font: 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--faint); margin: 0 0 14px !important; }
  .cover h1 { font: 600 clamp(26px, 2.7vw, 40px)/1.12 var(--sans); margin: 0 0 16px; letter-spacing: -0.01em; }
  .lede { font-size: 17px; color: var(--dim); }
  .lede em { font-style: normal; font-weight: 600; }
  /* one row of four; long labels wrap under their number instead of pushing a stat to a new row */
  .hero-stats { display: grid; grid-template-columns: repeat(4, minmax(0, auto)); justify-content: start; gap: 26px; margin: 22px 0 24px; }
  .hero-stats b { display: block; font: 600 30px var(--mono); color: var(--text); }
  .hero-stats span { display: block; max-width: 12ch; font: 10.5px/1.5 var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: .08em; }
  .warnline { font: 12px var(--mono); color: var(--gold); }
  .begin { margin-top: 4px; }
  .howto { font: 12px var(--mono); color: var(--faint); margin-top: 16px !important; }
  .end-h { font: 600 30px var(--sans); margin: 0 0 16px; }
  kbd {
    font: 11px var(--mono); padding: 1px 6px; border: 1px solid var(--line); border-bottom-width: 2px;
    border-radius: 4px; color: var(--text); background: var(--fig-2);
  }

  /* left / right edge zones */
  .edge {
    position: absolute; top: 0; bottom: 58px; width: 64px; z-index: 6; border: 0; padding: 0; cursor: pointer;
    background: transparent; color: transparent; font: 300 44px/1 var(--sans); transition: background .2s, color .2s;
  }
  .edge--l { left: 0; }
  .edge--r { right: 0; }
  .edge:hover:not(:disabled) { color: var(--yellow); }
  .edge--l:hover:not(:disabled) { background: linear-gradient(90deg, rgba(255, 216, 102, .07), transparent); }
  .edge--r:hover:not(:disabled) { background: linear-gradient(270deg, rgba(255, 216, 102, .07), transparent); }
  .edge:disabled { cursor: default; }
  .edge:focus-visible { outline: none; color: var(--yellow); }

  /* timeline */
  .tl {
    display: flex; align-items: center; gap: 14px; height: 58px; box-sizing: border-box;
    padding: 0 22px; border-top: 1px solid var(--line); background: var(--bg); position: relative; z-index: 7;
  }
  .tl-track { flex: 1; display: flex; gap: 8px; min-width: 0; }
  .tl-ch { min-width: 34px; display: flex; flex-direction: column; gap: 3px; }
  .tl-lbl { font: 10.5px var(--sans); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tl-lbl i { font: 600 10px var(--mono); font-style: normal; margin-right: 5px; color: var(--dim); }
  .tl-ch.on .tl-lbl i { color: var(--yellow); }
  .tl-ch.on .tl-lbl { color: var(--text); }
  .tl-dots { display: flex; gap: 3px; }
  .tl-dot {
    flex: 1; height: 16px; padding: 5px 0; border: 0; cursor: pointer; background: var(--line);
    background-clip: content-box; border-radius: 3px; transition: background-color .25s;
  }
  .tl-dot:hover { background-color: var(--faint); }
  .tl-dot.done { background-color: #3d4552; }
  .tl-dot.cur { background-color: var(--yellow); }
  .tl-count { font: 11px var(--mono); color: var(--dim); white-space: nowrap; }
  .tl-btn {
    font: 14px var(--mono); width: 34px; height: 30px; border-radius: 5px; cursor: pointer;
    background: var(--fig-2); color: var(--text); border: 1px solid var(--line);
  }
  .tl-btn:hover:not(:disabled) { border-color: var(--yellow); color: var(--yellow); }
  .tl-btn:disabled { opacity: .3; cursor: default; }

  /* ── more on this step ───────────────────────────────────────────────── */
  .details {
    max-width: 860px; margin: 0 auto; padding: 48px 26px 18vh; min-height: 40vh; box-sizing: border-box;
    color: var(--dim); font-size: 15.5px;
  }
  .d-eyebrow { font: 11px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin: 0 0 6px; }
  .details h3 { font: 600 19px var(--sans); color: var(--text); margin: 22px 0 8px; }
  .details p { margin: 0 0 12px; }
  .details a { color: var(--blue); }
  .details code { font: 13px var(--mono); color: var(--text); }
  .keys { padding-left: 18px; list-style: disc; margin: 0; }
  .keys li { margin: 0 0 6px; }
  .taglist { display: flex; flex-wrap: wrap; gap: 5px; }
  .taglist span { font: 11.5px var(--mono); padding: 2px 7px; border: 1px solid var(--line); border-radius: 3px; color: var(--text); }
  .dtab { width: 100%; border-collapse: collapse; font: 12px var(--mono); margin: 4px 0 14px; }
  .dtab th { text-align: left; color: var(--faint); font-weight: 400; border-bottom: 1px solid var(--line); padding: 5px 8px; }
  .dtab td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; color: var(--text); }
  .back-up { margin-top: 18px; background: none; border: 0; cursor: pointer; font: 11px var(--mono); color: var(--faint); padding: 0; }
  .back-up:hover { color: var(--yellow); }

  /* cover: the method on one card */
  .approach { margin: 4px 0 26px; }
  .ap-row {
    display: grid; grid-template-columns: 104px 1fr 1.15fr; gap: 16px; padding: 8px 0;
    border-bottom: 1px solid #1c2129; font: 14px/1.5 var(--sans); color: var(--dim);
  }
  .ap-row:last-child { border-bottom: 0; }
  .ap-row b { font: 600 12.5px var(--mono); color: var(--text); white-space: nowrap; }
  .ap-row > span:nth-child(2) { color: var(--text); }
  .ap-head { font: 10px var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: .06em; padding-top: 0; }
  .ap-head > span:nth-child(2) { color: var(--faint); }

  /* "how to read this graph" */
  .howread { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 6px; }
  .howread summary { cursor: pointer; font: 11px var(--mono); color: var(--faint); list-style: none; }
  .howread summary::before { content: '? '; color: var(--yellow); }
  .howread summary:hover { color: var(--yellow); }
  .howread[open] summary { color: var(--text); margin-bottom: 4px; }
  .howread ul { margin: 0; padding-left: 18px; list-style: disc; font: 12.5px/1.5 var(--sans); color: var(--dim); }
  .howread li { margin: 0 0 4px; }

  /* key terms */
  .term {
    font: inherit; color: inherit; text-align: inherit; background: none; border: 0; padding: 0; cursor: help;
    border-bottom: 1px dotted var(--faint);
  }
  .term:hover, .term:focus-visible { color: var(--yellow); border-bottom-color: var(--yellow); outline: none; }
  .dotted { border-bottom: 1px dotted var(--faint); }
  .tip {
    position: fixed; z-index: 60; pointer-events: none; padding: 10px 12px; border-radius: 6px;
    background: #171b22; border: 1px solid #343b46; box-shadow: 0 10px 30px rgba(0, 0, 0, .5);
  }
  .tip.above { transform: translateY(-100%); }
  .tip b { display: block; font: 600 13px var(--sans); color: var(--yellow); margin-bottom: 3px; }
  .tip p { margin: 0; font: 13px/1.5 var(--sans); color: var(--text); }

  .c-blue { color: var(--blue); } .c-yellow { color: var(--yellow); } .c-green { color: var(--green); }
  .c-red { color: var(--red); } .c-gold { color: var(--gold); } .c-teal { color: var(--teal); }
  .c-white { color: var(--white); } .c-purple { color: var(--purple); } .c-dim { color: var(--faint); }

  .lockcard {
    margin: 14px 0; padding: 18px; border: 1px dashed var(--line); border-radius: 6px; text-align: center;
    background: var(--fig-2);
  }
  .lockcard b { display: block; font: 600 14px var(--sans); margin-bottom: 6px; }
  .lockcard p { font: 13px/1.5 var(--sans); color: var(--dim); margin: 0 auto 12px; max-width: 46ch; }
  .pulse { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .4; } }
  .cx-btn {
    display: inline-block; font: 600 13px var(--sans); padding: 8px 16px; border-radius: 5px; border: 0; cursor: pointer;
    background: var(--yellow); color: #14161a; text-decoration: none;
  }
  .cx-btn:hover { filter: brightness(1.08); }

  /* ── shared by the figure components ─────────────────────────────────── */
  .cx :global(.fig-controls) {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 10px;
    font: 12px var(--sans); color: var(--dim);
  }
  .cx :global(.fig-controls label) { display: flex; align-items: center; gap: 8px; }
  .cx :global(.fig-controls label.grow) { flex: 1; min-width: 200px; }
  .cx :global(.fig-controls input[type='range']) { flex: 1; accent-color: var(--yellow); min-width: 90px; }
  .cx :global(.fig-controls select) {
    font: 12px var(--mono); background: var(--fig-2); color: var(--text); border: 1px solid var(--line);
    border-radius: 4px; padding: 4px 6px; max-width: 100%; min-width: 0; flex: 1;
  }
  .cx :global(.fig-controls b), .cx :global(.fig-readout b) { font: 600 12px var(--mono); color: var(--text); }
  .cx :global(.y) { color: var(--yellow) !important; }
  .cx :global(.fig-btn), .cx :global(.cx-seg button) {
    font: 11.5px var(--mono); padding: 4px 9px; border-radius: 4px; cursor: pointer;
    background: var(--fig-2); color: var(--dim); border: 1px solid var(--line);
  }
  .cx :global(.fig-btn:hover:not(:disabled)), .cx :global(.cx-seg button:hover) { color: var(--text); border-color: var(--faint); }
  .cx :global(.fig-btn:disabled) { opacity: .35; cursor: default; }
  .cx :global(.fig-btn.is-on) { color: var(--red); border-color: var(--red); }
  .cx :global(.cx-seg) { display: inline-flex; }
  .cx :global(.cx-seg button) { border-radius: 0; margin-left: -1px; }
  .cx :global(.cx-seg button:first-child) { border-radius: 4px 0 0 4px; margin-left: 0; }
  .cx :global(.cx-seg button:last-child) { border-radius: 0 4px 4px 0; }
  .cx :global(.cx-seg button.is-on) { color: var(--bg); background: var(--yellow); border-color: var(--yellow); }
  .cx :global(.fig-svg) { width: 100%; height: auto; display: block; user-select: none; touch-action: none; }
  .cx :global(.fig-legend) {
    list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 0; padding: 0;
    font: 11px var(--mono); color: var(--dim);
  }
  .cx :global(.fig-legend li) { display: flex; align-items: center; gap: 6px; }
  .cx :global(.sw) { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .cx :global(.sw--ramp) { width: 26px; background: linear-gradient(90deg, rgb(38,104,137), rgb(92,208,179), rgb(255,216,102)); }
  .cx :global(.sw--band) { background: var(--green); opacity: .35; }
  .cx :global(.sw--dash) { background: repeating-linear-gradient(90deg, var(--white) 0 3px, transparent 3px 6px); height: 2px; }
  .cx :global(.fig-readout) {
    display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 8px; font: 12px var(--mono); color: var(--dim);
  }
  .cx :global(.fig-readout .sw) { margin-right: 6px; vertical-align: -1px; }
  .cx :global(.fig-note) { font: 12px/1.5 var(--sans); color: var(--faint); margin: 8px 0 0; }

  /* Short laptop screens: tighten the type so a step still fits in one view. */
  @media (max-height: 800px) and (min-width: 901px) {
    .slide { font-size: 15.5px; }
    .cover h1 { font-size: clamp(22px, 2.5vw, 32px); margin-bottom: 10px; }
    .lede { font-size: 14.5px; line-height: 1.55; }
    .howto { margin-top: 10px !important; }
    .hero-stats { margin: 14px 0 16px; gap: 22px; }
    .hero-stats b { font-size: 24px; }
    .stage { padding-top: 14px; }
  }

  /* Small screens can't hold text and figure side by side in one screen, so
     the slide stacks and the page scrolls; the timeline stays pinned. */
  @media (max-width: 900px) {
    .deck { height: auto; min-height: calc(100dvh - var(--bar-h)); }
    .stage { grid-template-columns: 1fr; grid-template-rows: auto; gap: 16px; padding: 16px 18px 12px; }
    .stage-text, .stage-fig { overflow: visible; max-height: none; }
    .edge { display: none; }
    .tl { position: sticky; bottom: 0; padding: 0 12px; gap: 8px; }
    .tl-lbl { display: none; }
    .cx-bar { flex-wrap: wrap; gap: 8px; height: auto; padding: 8px 14px; }
    .cx-status { margin-left: 0; width: 100%; }
  }
</style>

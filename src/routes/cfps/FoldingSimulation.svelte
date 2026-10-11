<script>
  // Educational, scrubbable folding simulation for the three CFPS targets.
  //
  // It is deliberately a *stylised* depiction of the folding HIERARCHY
  // (primary → secondary → tertiary → disulfide → native), not a physics MD
  // run: the end state uses the real native CA coordinates from each PDB and the
  // real disulfide connectivity from the SSBOND records, while the extended
  // "string" start state and the morph between them are schematic so a person can
  // actually read what happens at each step. Same three.js backbone + cartoon
  // approach as AsciiProteins.svelte / ProteinViewer, so it sits in the page's
  // existing aesthetic.
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';

  let {
    height = '420px',
    structures = [
      { key: 'sfgfp',     name: 'sfGFP',     pdb: 'https://files.rcsb.org/download/2B3P.pdb', accent: '#2f8f4e', glow: '#37e27a', sites: [65, 66, 67] },
      { key: 'petase',    name: 'PETase',    pdb: 'https://files.rcsb.org/download/4CG1.pdb', accent: '#e08a1e', glow: '#ff9d2e', sites: [130, 176, 208] },
      { key: 'reteplase', name: 'Reteplase', pdb: 'https://files.rcsb.org/download/1RTF.pdb', accent: '#cc3b2e', glow: '#ff4a3a', sites: [57, 102, 195] }
    ]
  } = $props();

  // ---- the five narrated stages (shared timeline, t in [0,1]) --------------
  // `range` = [t0,t1) over the slider. `general` is protein-agnostic; the
  // protein-specific line lives in DETAIL below, keyed by [stage][protein].
  const STAGES = [
    { key: 'primary',   title: '1 · Primary structure',        range: [0.00, 0.14],
      general: 'The ribosome reads the mRNA codon by codon and links amino acids into one long chain, N-terminus to C-terminus. Right now it is only a sequence — a “string of beads” — with no 3-D shape.' },
    { key: 'secondary', title: '2 · Secondary structure',      range: [0.14, 0.40],
      general: 'Backbone hydrogen bonds pull short local stretches into repeating motifs — α-helices and β-strands. These form fast and locally, long before the whole chain has its final shape.' },
    { key: 'tertiary',  title: '3 · Tertiary fold',            range: [0.40, 0.72],
      general: 'Water drives the greasy, hydrophobic side chains together into a buried core. That collapse packs the helices and strands into a single compact 3-D shape — the tertiary fold.' },
    { key: 'disulfide', title: '4 · Disulfide bonds',          range: [0.72, 0.90],
      general: 'In an oxidizing environment, pairs of cysteines are joined by covalent S–S “staples” (shown in gold). They lock the fold in place — and they are the main thing that separates an easy CFPS target from a hard one.' },
    { key: 'native',    title: '5 · Native, functional protein', range: [0.90, 1.00],
      general: 'The chain reaches its native state: the active site (or chromophore) is assembled and the protein can do its job. This is the form the assay measures.' }
  ];

  // Protein-specific line for each stage. Kept short so the three read side by side.
  const DETAIL = {
    sfgfp: {
      primary:   '240 aa — a superfolder GFP variant engineered to fold fast and robustly.',
      secondary: 'Eleven β-strands plus a short central helix begin to take shape.',
      tertiary:  'The strands wrap into GFP’s signature 11-stranded β-barrel with the helix threaded up the middle.',
      disulfide: 'No disulfide bonds — two free cysteines only. sfGFP folds happily in the reducing cytoplasm, which is why it expresses so easily in standard CFPS.',
      native:    'The sealed barrel lets its chromophore (Thr65-Tyr66-Gly67) mature with O₂ and glow green — read directly in-plate.'
    },
    petase: {
      primary:   '309 aa cutinase (TfCut2) — one chain, one domain.',
      secondary: 'A central β-sheet and flanking α-helices form: the classic α/β-hydrolase layout.',
      tertiary:  'Sheet and helices pack into the α/β-hydrolase globule, positioning the Ser-His-Asp triad.',
      disulfide: 'One disulfide bond (Cys241–Cys259 here) staples the fold near the active site. It needs an oxidizing environment, but a single bond is within reach of standard CFPS.',
      native:    'The folded enzyme presents its Ser-His-Asp triad and hydrolyses ester bonds (PET → monomers), read as pNP release at OD 405 nm.'
    },
    reteplase: {
      primary:   '~399 aa thrombolytic — a truncated t-PA (kringle-2 + serine-protease domains).',
      secondary: 'The protease domain builds two β-barrels of strands joined by loops and short helices.',
      tertiary:  'The strands pack into the chymotrypsin-like protease fold (the structure shown resolves this domain).',
      disulfide: 'Reteplase has nine disulfide bonds across its two domains — the real challenge. The protease domain alone is cross-linked by five S–S staples (shown). Forming them needs oxidizing CFPS (DSB lysate, DTT-free, IAM) and staged incubation (30 °C → 4 °C → warm).',
      native:    'The folded protease exposes its Ser-His-Asp triad and cleaves its peptide substrate (IPR-AMC) — the clot-busting activity readout.'
    }
  };

  // ---- rendering constants -------------------------------------------------
  const R0 = 10;            // every fold normalised to this bounding radius (world units)
  const TUBE_R = 0.66;      // (legacy) nominal tube radius
  const SUB = 3;            // spline samples per residue
  const RING = 12;          // vertices around each cross-section
  // cartoon cross-section profile — half-width W (across the ribbon) × half-thickness T (through it)
  const COIL_R = 0.42;      // thin round coil / loop
  const HELIX_W = 1.65, HELIX_T = 0.5;   // flat helical ribbon
  const STRAND_W = 1.45, STRAND_T = 0.34; // flat β-strand
  const ARROW_W = 2.35;     // β-strand arrowhead max half-width (tapers to a point)
  const ARROW_LEN = 2 * SUB; // arrowhead length in centre points (~2 residues)
  const FOV = 32;
  const TILT = 0.3;         // fixed X tilt so the fold reads in 3-D
  const SPIN = 0.0032;      // idle spin (rad / 16.7 ms)
  const EXT_H = 2.3 * R0;   // height of the extended "string" state
  const EXT_WAVES = 7;      // squiggles in the extended chain
  const DSB_GOLD = new THREE.Color('#e8b24a');
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  // ---- amino-acid chemistry (for the x-ray residue view) -------------------
  const AA1 = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G', HIS:'H', ILE:'I',
                LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V' };
  // class index → 0 non-polar · 1 polar · 2 acidic(−) · 3 basic(+) · 4 cysteine (S–S former)
  const AA_CLASS = { ALA:0, VAL:0, LEU:0, ILE:0, MET:0, PHE:0, TRP:0, PRO:0, GLY:0,
                     SER:1, THR:1, TYR:1, ASN:1, GLN:1,
                     ASP:2, GLU:2, LYS:3, ARG:3, HIS:3, CYS:4 };
  const AA_HEX = ['#b7ab90', '#3f9fb0', '#d9534f', '#4a7fd9', '#e8b24a'];
  const AA_COLOR_OBJ = AA_HEX.map((c) => new THREE.Color(c));
  const AA_LEGEND = [['non-polar', AA_HEX[0]], ['polar', AA_HEX[1]], ['acidic −', AA_HEX[2]], ['basic +', AA_HEX[3]], ['cysteine', AA_HEX[4]]];
  const CYS_CLASS = 4;

  // ---- reactive UI state ---------------------------------------------------
  let container = $state(null);
  let sceneEl = $state(null);
  let boxW = $state(0);
  let boxH = $state(0);
  let timeline = $state(0);        // 0..1000 (slider)
  let playing = $state(false);
  let ready = $state(false);
  let failed = $state(false);
  let labels = $state([]);         // [{ name, accent, xPct, ss }] caption per fold
  let ssCounts = $state({ sfgfp: 0, petase: 0, reteplase: 0 }); // disulfides actually drawn
  let xray = $state(false);        // reveal per-residue beads + bond/site labels
  let reduceMotion = false;

  const t = $derived(timeline / 1000);
  const stageIndex = $derived.by(() => {
    const v = timeline / 1000;
    for (let i = STAGES.length - 1; i >= 0; i--) if (v >= STAGES[i].range[0]) return i;
    return 0;
  });
  const stage = $derived(STAGES[stageIndex]);
  // Live disulfide tally per protein at the current time (for the detail cards).
  const liveSS = $derived.by(() => {
    const prog = disulfideProgress(timeline / 1000);
    const out = {};
    for (const s of structures) {
      const n = ssCounts[s.key] || 0;
      let k = 0;
      for (let j = 0; j < n; j++) if (prog > (j + 0.5) / n) k++;
      out[s.key] = { k, n };
    }
    return out;
  });

  // ---- non-reactive render state ------------------------------------------
  let renderer, scene, camera, stageGroup;
  let proteins = [];               // see buildProtein()
  let rafId = null, running = false, last = 0;
  let renderT = 0;                 // latest t the GL loop should draw
  let lastBuiltT = -1;             // skip rebuilding tubes when t hasn't moved
  let dragging = false, dragLX = 0, dragLY = 0;

  // scratch objects reused every frame (no per-frame allocation in the hot path)
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3();
  const _axis = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3();
  const _prevT = new THREE.Vector3();
  const _col = new THREE.Color();
  const _white = new THREE.Color('#ffffff');
  const _black = new THREE.Color('#000000');
  const _UP = new THREE.Vector3(0, 1, 0);
  const _m2 = new THREE.Matrix4(); // per-instance bead transform

  // ---- easing / stage math (pure) -----------------------------------------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  // how far the geometry has collapsed from extended → native
  function foldAmount(v) {
    if (v <= 0.14) return 0;
    if (v <= 0.40) return smooth((v - 0.14) / 0.26) * 0.45;
    if (v <= 0.72) return 0.45 + smooth((v - 0.40) / 0.32) * 0.55;
    return 1;
  }
  const ssAmount = (v) => smooth((v - 0.14) / 0.26);          // 0 → 1 across the SS stage
  const disulfideProgress = (v) => clamp01((v - 0.72) / 0.18); // 0 → 1 across the DSB stage
  const matureAmount = (v) => smooth((v - 0.90) / 0.10);       // 0 → 1 across the native stage

  // =========================================================================
  onMount(async () => {
    reduceMotion = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, (boxW || 1) / (boxH || 1), 1, 6000);
    camera.position.set(0, 0, 220);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(0.5, 1.0, 2.0);
    scene.add(key);

    stageGroup = new THREE.Group();
    scene.add(stageGroup);

    let texts;
    try {
      texts = await Promise.all(structures.map((s) => fetch(s.pdb).then((r) => r.text())));
    } catch {
      failed = true;
      return;
    }

    const counts = { ...ssCounts };
    for (let i = 0; i < structures.length; i++) {
      const parsed = parseChain(texts[i]);
      if (parsed.ca.length < 4) continue;
      const p = buildProtein(parsed, structures[i]);
      proteins.push(p);
      counts[structures[i].key] = p.disulfides.length;
    }
    if (!proteins.length) { failed = true; return; }
    ssCounts = counts;

    layoutSlots();
    resize();

    ready = true;
    running = true;
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  });

  onDestroy(() => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    for (const p of proteins) {
      p.tubeGeo?.dispose(); p.tubeMat?.dispose();
      p.beads?.geometry.dispose(); p.beads?.material.dispose();
      for (const d of p.disulfides) { d.mesh.geometry.dispose(); d.mesh.material.dispose(); d.label?.material.map?.dispose(); d.label?.material.dispose(); }
      for (const g of p.siteGlows) { g.geometry.dispose(); g.material.dispose(); }
      for (const l of p.siteLabels) { l.material.map?.dispose(); l.material.dispose(); }
    }
    renderer?.dispose();
  });

  // ---- PDB → longest chain: CA path, secondary structure, disulfide pairs ---
  function parseChain(text) {
    const lines = text.split('\n');

    const helix = [], sheet = [], ssbonds = [];
    for (const line of lines) {
      if (line.startsWith('HELIX')) {
        const lo = parseInt(line.slice(21, 25)), hi = parseInt(line.slice(33, 37));
        if (Number.isFinite(lo) && Number.isFinite(hi)) helix.push({ chain: line[19], lo, hi });
      } else if (line.startsWith('SHEET')) {
        const lo = parseInt(line.slice(22, 26)), hi = parseInt(line.slice(33, 37));
        if (Number.isFinite(lo) && Number.isFinite(hi)) sheet.push({ chain: line[21], lo, hi });
      } else if (line.startsWith('SSBOND')) {
        const c1 = line[15], r1 = parseInt(line.slice(17, 21));
        const c2 = line[29], r2 = parseInt(line.slice(31, 35));
        if (Number.isFinite(r1) && Number.isFinite(r2)) ssbonds.push({ c1, r1, c2, r2 });
      }
    }

    const chains = new Map();
    let order = 0;
    for (const line of lines) {
      if (line.startsWith('ENDMDL')) break;
      if (!line.startsWith('ATOM')) continue;
      if (line.slice(12, 16).trim() !== 'CA') continue;
      const alt = line[16];
      if (alt !== ' ' && alt !== 'A') continue;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const ch = line[21];
      const seq = parseInt(line.slice(22, 26));
      const resName = line.slice(17, 20).trim();
      if (!chains.has(ch)) chains.set(ch, []);
      chains.get(ch).push({ ca: new THREE.Vector3(x, y, z), seq, resName, order: order++ });
    }

    let bestCh = null, bestLen = 0;
    for (const [ch, arr] of chains) if (arr.length > bestLen) { bestLen = arr.length; bestCh = ch; }
    if (bestCh == null) return { ca: [], ss: new Uint8Array(0), disulfides: [] };

    const residues = chains.get(bestCh).sort((a, b) => a.order - b.order);
    const ca = residues.map((r) => r.ca);
    const seqs = residues.map((r) => r.seq);
    const res1 = residues.map((r) => AA1[r.resName] || 'X');
    const resClass = new Uint8Array(residues.length);
    residues.forEach((r, i) => { resClass[i] = AA_CLASS[r.resName] ?? 0; });
    const seqToIdx = new Map();
    residues.forEach((r, i) => { if (!seqToIdx.has(r.seq)) seqToIdx.set(r.seq, i); });

    const ss = new Uint8Array(residues.length);
    for (let i = 0; i < residues.length; i++) {
      const rs = residues[i].seq;
      if (helix.some((h) => h.chain === bestCh && rs >= h.lo && rs <= h.hi)) ss[i] = 1;
      else if (sheet.some((s) => s.chain === bestCh && rs >= s.lo && rs <= s.hi)) ss[i] = 2;
    }

    // keep only disulfides whose BOTH cysteines live in the rendered chain
    const disulfides = [];
    for (const b of ssbonds) {
      if (b.c1 !== bestCh || b.c2 !== bestCh) continue;
      const a = seqToIdx.get(b.r1), c = seqToIdx.get(b.r2);
      if (a != null && c != null) disulfides.push([a, c]);
    }
    disulfides.sort((x, y) => (x[0] + x[1]) - (y[0] + y[1]));

    return { ca, ss, disulfides, seqToIdx, seqs, res1, resClass };
  }

  // a small camera-facing text pill (canvas sprite) for x-ray labels
  function makeLabelSprite(text, hex) {
    const fs = 44, padX = 11, padY = 7, r = 13;
    const cvs = document.createElement('canvas');
    const font = `600 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    let ctx = cvs.getContext('2d');
    ctx.font = font;
    cvs.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
    cvs.height = fs + padY * 2;
    ctx = cvs.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(cvs.width, 0, cvs.width, cvs.height, r);
    ctx.arcTo(cvs.width, cvs.height, 0, cvs.height, r);
    ctx.arcTo(0, cvs.height, 0, 0, r);
    ctx.arcTo(0, 0, cvs.width, 0, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(17,19,23,0.86)';
    ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = hex; ctx.stroke();
    ctx.fillStyle = hex;
    ctx.fillText(text, padX, cvs.height / 2 + 1);
    const tex = new THREE.CanvasTexture(cvs);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    const sp = new THREE.Sprite(mat);
    const SC = 0.02;
    sp.scale.set(cvs.width * SC, cvs.height * SC, 1);
    sp.renderOrder = 20;
    sp.visible = false;
    return sp;
  }

  // ---- build one protein: native + extended coords, tube buffers, bonds -----
  function buildProtein(parsed, cfg) {
    const { ca, ss, disulfides, seqToIdx, seqs, res1, resClass } = parsed;
    const n = ca.length;

    // native: centre, then scale to a common bounding radius
    const centroid = new THREE.Vector3();
    for (const p of ca) centroid.add(p);
    centroid.multiplyScalar(1 / n);
    let maxR = 0;
    for (const p of ca) { p.sub(centroid); const d = p.length(); if (d > maxR) maxR = d; }
    const k = R0 / (maxR || 1);
    const native = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { native[i * 3] = ca[i].x * k; native[i * 3 + 1] = ca[i].y * k; native[i * 3 + 2] = ca[i].z * k; }

    // extended: a tall vertical squiggle (schematic "unfolded string")
    const extended = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const w = n > 1 ? i / (n - 1) : 0.5;
      extended[i * 3]     = 0.42 * R0 * Math.sin(w * Math.PI * EXT_WAVES);
      extended[i * 3 + 1] = (w - 0.5) * EXT_H;
      extended[i * 3 + 2] = 0.30 * R0 * Math.cos(w * Math.PI * EXT_WAVES * 1.3);
    }

    // tube topology (constant): index buffer + per-centre residue/SS/glow maps
    const S = (n - 1) * SUB + 1;
    const index = new Uint32Array((S - 1) * RING * 6);
    let w = 0;
    for (let s = 0; s < S - 1; s++) {
      for (let kk = 0; kk < RING; kk++) {
        const k2 = (kk + 1) % RING;
        const a0 = s * RING + kk, a1 = s * RING + k2;
        const b0 = (s + 1) * RING + kk, b1 = (s + 1) * RING + k2;
        index[w++] = a0; index[w++] = b0; index[w++] = a1;
        index[w++] = a1; index[w++] = b0; index[w++] = b1;
      }
    }
    const centerSS = new Uint8Array(S);
    for (let s = 0; s < S; s++) centerSS[s] = ss[Math.min(n - 1, Math.round(s / SUB))] || 0;

    // static cartoon cross-section profile per centre: ribbons for helix/strand, thin tube for coil
    const secW = new Float32Array(S), secT = new Float32Array(S);
    for (let s = 0; s < S; s++) {
      const q = centerSS[s];
      if (q === 1)      { secW[s] = HELIX_W;  secT[s] = HELIX_T; }
      else if (q === 2) { secW[s] = STRAND_W; secT[s] = STRAND_T; }
      else              { secW[s] = COIL_R;   secT[s] = COIL_R; }
    }
    // β-strand arrowheads: widen then taper the last ~2 residues of each strand run to a point
    for (let s = 0; s < S; ) {
      if (centerSS[s] === 2) {
        let e = s; while (e < S && centerSS[e] === 2) e++;
        const end = e - 1, head = Math.max(s, end - ARROW_LEN + 1);
        for (let k = head; k <= end; k++) {
          const f = end > head ? (k - head) / (end - head) : 1;
          secW[k] = ARROW_W * (1 - f) + 0.1 * f;
        }
        s = e;
      } else s++;
    }
    // light smoothing so secondary-structure boundaries don't read as lumps
    for (let pass = 0; pass < 2; pass++) {
      const w0 = secW.slice(), t0 = secT.slice();
      for (let s = 1; s < S - 1; s++) {
        secW[s] = (w0[s - 1] + 2 * w0[s] + w0[s + 1]) * 0.25;
        secT[s] = (t0[s - 1] + 2 * t0[s] + t0[s + 1]) * 0.25;
      }
    }

    // per-centre proximity to the nearest catalytic/chromophore site (native space)
    const siteIdx = (cfg.sites || []).map((rs) => seqToIdx?.get(rs)).filter((i) => i != null);
    const centerGlow = new Float32Array(S);
    const sigma = 0.22 * R0, inv2s2 = 1 / (2 * sigma * sigma);
    for (let s = 0; s < S; s++) {
      const ri = Math.min(n - 1, Math.round(s / SUB));
      let dmin = Infinity;
      for (const si of siteIdx) {
        const dx = native[ri * 3] - native[si * 3];
        const dy = native[ri * 3 + 1] - native[si * 3 + 1];
        const dz = native[ri * 3 + 2] - native[si * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < dmin) dmin = d;
      }
      centerGlow[s] = siteIdx.length ? Math.exp(-dmin * inv2s2) : 0;
    }

    const pos = new Float32Array(S * RING * 3);
    const nor = new Float32Array(S * RING * 3);
    const col = new Float32Array(S * RING * 3);
    const tubeGeo = new THREE.BufferGeometry();
    tubeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    tubeGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tubeGeo.setIndex(new THREE.BufferAttribute(index, 1));
    const tubeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0, emissive: 0x0a0a0a, side: THREE.DoubleSide });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    tubeMesh.frustumCulled = false; // always centred & in frame — skip per-frame bounding math

    const group = new THREE.Group();
    group.rotation.x = TILT;
    group.add(tubeMesh);

    // disulfide "staples": a slim gold cylinder per bond, plus an x-ray label naming the two cysteines
    const disulfideMeshes = disulfides.map(([a, c], j) => {
      const g = new THREE.CylinderGeometry(0.42, 0.42, 1, 6);
      const m = new THREE.MeshStandardMaterial({ color: DSB_GOLD.clone(), emissive: DSB_GOLD.clone(), emissiveIntensity: 0.0, roughness: 0.35, metalness: 0.4, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      group.add(mesh);
      const label = makeLabelSprite(`C${seqs[a]}–C${seqs[c]}`, '#f0c15a');
      group.add(label);
      return { a, c, formFrac: (j + 0.5) / disulfides.length, mesh, label };
    });

    // x-ray: one bead per residue, coloured by amino-acid class (hidden unless x-ray is on)
    const beadGeo = new THREE.SphereGeometry(1, 10, 8);
    const beadMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    const beads = new THREE.InstancedMesh(beadGeo, beadMat, n);
    beads.frustumCulled = false;
    beads.visible = false;
    for (let i = 0; i < n; i++) beads.setColorAt(i, AA_COLOR_OBJ[resClass[i]]);
    if (beads.instanceColor) beads.instanceColor.needsUpdate = true;
    group.add(beads);

    // x-ray: labels for the catalytic/chromophore residues
    const siteLabels = siteIdx.map((si) => {
      const lab = makeLabelSprite(`${res1[si] || '?'}${seqs[si]}`, cfg.glow);
      group.add(lab);
      return lab;
    });

    // catalytic-site / chromophore glow spheres (fade in at the native stage)
    const siteGlows = siteIdx.map((si) => {
      const g = new THREE.SphereGeometry(1.7, 16, 12);
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.glow), transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    });

    stageGroup.add(group);

    return {
      key: cfg.key, name: cfg.name, accent: new THREE.Color(cfg.accent), glow: new THREE.Color(cfg.glow),
      n, S, native, extended, centerSS, centerGlow, siteIdx, secW, secT,
      group, tubeMesh, tubeGeo, tubeMat, pos, nor, col,
      cur: new Float32Array(n * 3), centers: new Float32Array(S * 3),
      disulfides: disulfideMeshes, siteGlows, slotX: 0, radius: R0,
      resClass, beads, siteLabels
    };
  }

  // Catmull-Rom (one component) — p1..p2 segment, p0/p3 the neighbours.
  function cr(p0, p1, p2, p3, tt) {
    const t2 = tt * tt, t3 = t2 * tt;
    return 0.5 * ((2 * p1) + (-p0 + p2) * tt + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  // rebuild one protein's tube + bonds for the current time
  function updateProtein(p, now) {
    const { n, S, native, extended, cur, centers, pos, nor, col, centerSS, centerGlow, accent, glow, secW, secT } = p;
    const fa = foldAmount(renderT);
    const ssA = ssAmount(renderT);
    const matA = matureAmount(renderT);

    // 1) current CA positions: extended → native, with a gentle N→C stagger
    const STAGGER = 0.12;
    for (let i = 0; i < n; i++) {
      const w = n > 1 ? i / (n - 1) : 0;
      const f = smooth(clamp01(fa * (1 + STAGGER) - STAGGER * w));
      const o = i * 3;
      cur[o]     = extended[o]     + (native[o]     - extended[o])     * f;
      cur[o + 1] = extended[o + 1] + (native[o + 1] - extended[o + 1]) * f;
      cur[o + 2] = extended[o + 2] + (native[o + 2] - extended[o + 2]) * f;
    }

    // 2) smooth the backbone into centre points (Catmull-Rom, SUB per residue)
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(n - 1, i + 2) * 3;
      for (let j = 0; j < SUB; j++) {
        const tt = j / SUB, c = s * 3;
        centers[c]     = cr(cur[i0], cur[i1], cur[i2], cur[i3], tt);
        centers[c + 1] = cr(cur[i0 + 1], cur[i1 + 1], cur[i2 + 1], cur[i3 + 1], tt);
        centers[c + 2] = cr(cur[i0 + 2], cur[i1 + 2], cur[i2 + 2], cur[i3 + 2], tt);
        s++;
      }
    }
    centers[s * 3] = cur[(n - 1) * 3]; centers[s * 3 + 1] = cur[(n - 1) * 3 + 1]; centers[s * 3 + 2] = cur[(n - 1) * 3 + 2];

    // 3) parallel-transport a frame along the centres, emit a ring at each
    _n.set(0, 0, 0); // running normal
    let havePrev = false;
    for (let si = 0; si < S; si++) {
      const c = si * 3;
      // tangent via central difference
      const a = Math.max(0, si - 1) * 3, b = Math.min(S - 1, si + 1) * 3;
      _t.set(centers[b] - centers[a], centers[b + 1] - centers[a + 1], centers[b + 2] - centers[a + 2]);
      if (_t.lengthSq() < 1e-9) _t.set(0, 1, 0); else _t.normalize();

      if (!havePrev) {
        // seed a normal perpendicular to the first tangent
        _n.set(1, 0, 0);
        if (Math.abs(_t.x) > 0.9) _n.set(0, 1, 0);
        _n.addScaledVector(_t, -_n.dot(_t)).normalize();
        havePrev = true;
      } else {
        // rotate the previous normal by the twist between the two tangents
        _axis.copy(_prevT).cross(_t);
        const sl = _axis.length();
        if (sl > 1e-6) {
          _axis.multiplyScalar(1 / sl);
          const ang = Math.atan2(sl, _prevT.dot(_t));
          _q.setFromAxisAngle(_axis, ang);
          _n.applyQuaternion(_q);
        }
        _n.addScaledVector(_t, -_n.dot(_t));
        if (_n.lengthSq() < 1e-9) { _n.set(1, 0, 0); _n.addScaledVector(_t, -_n.dot(_t)); }
        _n.normalize();
      }
      _prevT.copy(_t);
      _u.copy(_t).cross(_n).normalize(); // binormal

      // colour this cross-section: accent, tinted by SS; brightened near the site at maturity
      const ssv = centerSS[si];
      _col.copy(accent);
      if (ssv === 1) _col.lerp(_white, 0.22 * ssA);        // helix → lighter
      else if (ssv === 2) _col.lerp(_black, 0.20 * ssA);   // strand → darker
      const gl = centerGlow[si] * matA;
      if (gl > 0.001) _col.lerp(glow, Math.min(0.85, gl));

      // elliptical cartoon cross-section — broad along _n, thin along _u; shape emerges as SS forms
      const sw = COIL_R + (secW[si] - COIL_R) * ssA; // half-width across the ribbon
      const st = COIL_R + (secT[si] - COIL_R) * ssA; // half-thickness through it
      for (let kk = 0; kk < RING; kk++) {
        const th = (kk / RING) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const vp = (si * RING + kk) * 3;
        const ex = sw * cs, ey = st * sn;
        pos[vp]     = centers[c]     + ex * _n.x + ey * _u.x;
        pos[vp + 1] = centers[c + 1] + ex * _n.y + ey * _u.y;
        pos[vp + 2] = centers[c + 2] + ex * _n.z + ey * _u.z;
        // ellipse outward normal (gradient): cos/sw along _n, sin/st along _u
        let gn = cs / sw, gu = sn / st;
        const gl = Math.hypot(gn, gu) || 1; gn /= gl; gu /= gl;
        const nx = gn * _n.x + gu * _u.x, ny = gn * _n.y + gu * _u.y, nz = gn * _n.z + gu * _u.z;
        nor[vp] = nx; nor[vp + 1] = ny; nor[vp + 2] = nz;
        col[vp] = _col.r; col[vp + 1] = _col.g; col[vp + 2] = _col.b;
      }
    }
    p.tubeGeo.attributes.position.needsUpdate = true;
    p.tubeGeo.attributes.normal.needsUpdate = true;
    p.tubeGeo.attributes.color.needsUpdate = true;

    // 4) disulfide staples: snap in across the DSB stage, with a gold flash
    const prog = disulfideProgress(renderT);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
    for (const d of p.disulfides) {
      const appear = clamp01((prog - d.formFrac) / 0.12);
      if (appear <= 0.001) { d.mesh.visible = false; continue; }
      d.mesh.visible = true;
      _a.set(cur[d.a * 3], cur[d.a * 3 + 1], cur[d.a * 3 + 2]);
      _b.set(cur[d.c * 3], cur[d.c * 3 + 1], cur[d.c * 3 + 2]);
      _m.copy(_a).add(_b).multiplyScalar(0.5);
      _c.copy(_b).sub(_a);
      const len = Math.max(0.001, _c.length());
      d.mesh.position.copy(_m);
      d.mesh.scale.set(appear, len, appear);
      _c.normalize();
      d.mesh.quaternion.setFromUnitVectors(_UP, _c);
      d.mesh.material.opacity = appear;
      const flash = Math.max(0, 1 - Math.abs(prog - d.formFrac) / 0.1); // bright right as it forms
      d.mesh.material.emissiveIntensity = 0.25 + 0.9 * flash + 0.25 * pulse;
    }

    // 5) site glow spheres at the native stage
    for (let gi = 0; gi < p.siteGlows.length; gi++) {
      const si = p.siteIdx[gi];
      const sm = p.siteGlows[gi];
      const op = matA * (0.45 + 0.4 * pulse);
      if (op <= 0.01) { sm.visible = false; continue; }
      sm.visible = true;
      sm.position.set(cur[si * 3], cur[si * 3 + 1], cur[si * 3 + 2]);
      sm.material.opacity = Math.min(0.9, op);
      const sc = 1 + 0.15 * pulse;
      sm.scale.setScalar(sc);
    }

    // 6) x-ray overlay: residue beads + covalent-bond / active-site labels
    if (xray) {
      p.tubeMat.transparent = true; p.tubeMat.opacity = 0.16; // ghost the ribbon
      p.beads.visible = true;
      for (let i = 0; i < n; i++) {
        const rad = p.resClass[i] === CYS_CLASS ? 0.95 : 0.52; // cysteines pop out
        _m2.makeScale(rad, rad, rad);
        _m2.setPosition(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]);
        p.beads.setMatrixAt(i, _m2);
      }
      p.beads.instanceMatrix.needsUpdate = true;

      for (const d of p.disulfides) {
        const app = clamp01((prog - d.formFrac) / 0.12); // label appears as the bond forms
        if (app > 0.05) {
          d.label.visible = true;
          d.label.material.opacity = Math.min(1, app);
          d.label.position.set(
            (cur[d.a * 3]     + cur[d.c * 3])     * 0.5,
            (cur[d.a * 3 + 1] + cur[d.c * 3 + 1]) * 0.5 + 1.4,
            (cur[d.a * 3 + 2] + cur[d.c * 3 + 2]) * 0.5
          );
        } else d.label.visible = false;
      }

      for (let gi = 0; gi < p.siteLabels.length; gi++) {
        const si = p.siteIdx[gi];
        const lab = p.siteLabels[gi];
        lab.visible = true;
        lab.material.opacity = 1;
        lab.position.set(cur[si * 3], cur[si * 3 + 1] + 1.4, cur[si * 3 + 2]);
      }
    } else {
      p.tubeMat.transparent = false; p.tubeMat.opacity = 1;
      p.beads.visible = false;
      for (const d of p.disulfides) d.label.visible = false;
      for (const lab of p.siteLabels) lab.visible = false;
    }
  }

  // lay the three folds out in a row, centred on the origin
  function layoutSlots() {
    const nP = proteins.length;
    const slotW = 2 * R0 * 1.12;
    const gap = 0.5 * R0;
    const total = slotW * nP + gap * (nP - 1);
    let cursor = -total / 2;
    for (const p of proteins) {
      p.slotX = cursor + slotW / 2;
      p.group.position.x = p.slotX;
      cursor += slotW + gap;
    }
    layoutWidth = total;
  }
  let layoutWidth = 0;

  function frameCamera() {
    if (!camera || !boxW || !boxH || !layoutWidth) return;
    camera.aspect = boxW / boxH;
    const margin = 0.6 * R0;
    const halfW = layoutWidth / 2 + margin;
    const halfH = EXT_H / 2 + margin; // the extended string is the tallest state
    const tanV = Math.tan((FOV / 2) * Math.PI / 180);
    const distV = halfH / tanV;
    const distH = halfW / (tanV * camera.aspect);
    const dist = Math.max(distV, distH) * 1.04;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(1, dist - 3 * R0);
    camera.far = dist + 3 * R0;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    computeLabels();
  }

  function computeLabels() {
    labels = proteins.map((p) => {
      _a.set(p.slotX, -EXT_H / 2 - 0.1 * R0, 0).project(camera);
      return { name: p.name, key: p.key, accent: '#' + p.accent.getHexString(), xPct: (_a.x * 0.5 + 0.5) * 100 };
    });
  }

  function loop(now) {
    if (!running) return;
    const dt = now - last; last = now;
    const fr = dt / 16.67;

    // autoplay advances the slider
    if (playing && !reduceMotion) {
      let next = timeline + fr * 3.2; // ~5 s end-to-end
      if (next >= 1000) { next = 1000; playing = false; }
      timeline = next;
    }
    renderT = timeline / 1000;

    // idle spin (each fold turns in place)
    if (!dragging && !reduceMotion) for (const p of proteins) p.group.rotation.y += SPIN * fr;

    if (boxW && boxH) {
      const moved = Math.abs(renderT - lastBuiltT) > 1e-4;
      // rebuild geometry only when the timeline moved OR a glow/flash is animating
      const animating = !reduceMotion && (matureAmount(renderT) > 0.01 || (disulfideProgress(renderT) > 0 && disulfideProgress(renderT) < 1));
      if (moved || animating || lastBuiltT < 0) {
        for (const p of proteins) updateProtein(p, now);
        lastBuiltT = renderT;
      }
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(loop);
  }

  function resize() {
    if (!renderer || !boxW || !boxH) return;
    renderer.setSize(boxW, boxH, true);
    frameCamera();
  }

  $effect(() => { boxW; boxH; resize(); });

  // ---- interactions --------------------------------------------------------
  function togglePlay() {
    if (reduceMotion) return;
    if (!playing && timeline >= 1000) timeline = 0; // replay from the start
    playing = !playing;
  }
  function jumpToStage(i) {
    playing = false;
    timeline = Math.round(STAGES[i].range[0] * 1000);
  }
  function onScrub() { playing = false; }
  function toggleXray() { xray = !xray; lastBuiltT = -1; } // force one rebuild so beads/labels update even when paused

  function onPointerDown(e) {
    dragging = true; dragLX = e.clientX; dragLY = e.clientY;
    sceneEl?.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragLX, dy = e.clientY - dragLY;
    dragLX = e.clientX; dragLY = e.clientY;
    for (const p of proteins) {
      p.group.rotation.y += dx * 0.01;
      p.group.rotation.x = Math.max(-1.3, Math.min(1.3, p.group.rotation.x + dy * 0.01));
    }
  }
  function onPointerUp(e) {
    dragging = false;
    try { sceneEl?.releasePointerCapture?.(e.pointerId); } catch {}
  }
</script>

<div class="fold">
  <div
    bind:this={sceneEl}
    bind:clientWidth={boxW}
    bind:clientHeight={boxH}
    class="fold-scene"
    class:fold-scene--drag={dragging}
    style="height:{height};"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <div bind:this={container} class="fold-gl"></div>
    {#each labels as l}
      <div class="fold-cap" style="left:{l.xPct}%;color:{l.accent};">
        {l.name}
        {#if liveSS[l.key]?.n}
          <span class="fold-cap__ss">S–S {liveSS[l.key].k}/{liveSS[l.key].n}</span>
        {/if}
      </div>
    {/each}
    {#if ready}
      <button
        type="button"
        class="fold-xray"
        class:on={xray}
        aria-pressed={xray}
        title="Reveal every residue as a bead coloured by chemistry, and label the cysteines that form each disulfide bond"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={toggleXray}
      >
        <span class="fold-xray__ic" aria-hidden="true">{xray ? '◉' : '◌'}</span>{xray ? 'X-ray on' : 'X-ray'}
      </button>
    {/if}
    {#if !ready && !failed}<div class="fold-msg">loading structures…</div>{/if}
    {#if failed}<div class="fold-msg">could not load structures</div>{/if}
  </div>

  {#if xray}
    <div class="fold-legend">
      <span class="fold-legend__t">residues</span>
      {#each AA_LEGEND as item}
        <span class="fold-legend__i"><span class="fold-legend__sw" style="background:{item[1]};"></span>{item[0]}</span>
      {/each}
      <span class="fold-legend__i fold-legend__i--bond"><span class="fold-legend__bar"></span>gold staple + label = covalent S–S bond</span>
    </div>
  {/if}

  <!-- transport: play/pause + scrubber -->
  <div class="fold-transport">
    <button type="button" class="fold-play" onclick={togglePlay} disabled={reduceMotion} aria-label={playing ? 'Pause' : 'Play'}>
      {playing ? '⏸' : (timeline >= 1000 ? '↻' : '▶')}
    </button>
    <input
      class="fold-range"
      type="range" min="0" max="1000" step="1"
      bind:value={timeline}
      oninput={onScrub}
      aria-label="Folding progress"
    />
    <span class="fold-pct">{Math.round(t * 100)}%</span>
  </div>

  <!-- stage rail: five clickable steps, current highlighted -->
  <div class="fold-rail">
    {#each STAGES as s, i}
      {#if i > 0}<span class="fold-rail__conn" aria-hidden="true">›</span>{/if}
      <button
        type="button"
        class="fold-rail__step"
        class:on={i === stageIndex}
        aria-current={i === stageIndex}
        onclick={() => jumpToStage(i)}
      >{s.title}</button>
    {/each}
  </div>

  <!-- what's happening now -->
  <p class="fold-general">{stage.general}</p>
  <div class="fold-3col">
    {#each structures as s}
      <div class="fold-note" style="--accent:{s.accent};">
        <div class="fold-note__hd">
          {s.name}
          {#if stage.key === 'disulfide' || stage.key === 'native'}
            {#if liveSS[s.key]?.n}
              <span class="fold-note__ss">{liveSS[s.key].k}/{liveSS[s.key].n} S–S</span>
            {:else}
              <span class="fold-note__ss fold-note__ss--none">0 S–S</span>
            {/if}
          {/if}
        </div>
        <div class="fold-note__bd">{DETAIL[s.key]?.[stage.key] ?? ''}</div>
      </div>
    {/each}
  </div>

  <p class="fold-foot">
    A stylised view of the folding <em>hierarchy</em>, not a molecular-dynamics run: the native
    shape uses each structure's real PDB coordinates (2B3P · 4CG1 · 1RTF) and the disulfide
    staples use the real SSBOND connectivity, while the extended “string” start and the morph
    between them are schematic so each step stays readable. Toggle <em>X-ray</em> to see every
    residue as a bead coloured by amino-acid chemistry — cysteines in gold — with the bonded
    pairs labelled by residue number (e.g. C241–C259). Drag a fold to rotate it.
  </p>
</div>

<style>
  .fold { display: flex; flex-direction: column; gap: 10px; }

  .fold-scene {
    position: relative;
    width: 100%;
    border-radius: var(--r-sm);
    background: var(--recess);
    border: 1px solid var(--hair);
    overflow: hidden;
    cursor: grab;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .fold-scene--drag { cursor: grabbing; }
  .fold-gl { position: absolute; inset: 0; }
  .fold-cap {
    position: absolute;
    bottom: 8px;
    transform: translateX(-50%);
    white-space: nowrap;
    text-align: center;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font: 10px var(--mono);
    pointer-events: none;
  }
  .fold-cap__ss {
    display: block;
    margin-top: 2px;
    letter-spacing: 0.08em;
    text-transform: none;
    font-size: 9px;
    color: #e8b24a;
  }
  .fold-msg {
    position: absolute; inset: 0; display: grid; place-items: center;
    font: 11px var(--mono); letter-spacing: 0.18em; color: var(--muted);
  }

  /* x-ray toggle (overlaid in the scene corner) */
  .fold-xray {
    position: absolute; top: 8px; right: 8px; z-index: 2;
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--groove); border-radius: 999px;
    background: var(--surface-2); color: var(--muted);
    font: 10px var(--mono); letter-spacing: 0.1em; text-transform: uppercase;
    padding: 4px 11px; cursor: pointer;
    transition: color .12s, border-color .12s, background .12s;
  }
  .fold-xray:hover { color: var(--ink-2); border-color: var(--teal); background: var(--surface); }
  .fold-xray.on { color: var(--ink); border-color: var(--teal); background: var(--teal-wash); }
  .fold-xray__ic { font-size: 11px; line-height: 1; }

  /* x-ray residue legend */
  .fold-legend {
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px 13px;
    padding: 7px 11px; border: 1px solid var(--hair); border-radius: var(--r-sm);
    background: var(--surface-2); font: 10px var(--mono); color: var(--ink-2);
  }
  .fold-legend__t { color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }
  .fold-legend__i { display: inline-flex; align-items: center; gap: 5px; }
  .fold-legend__sw { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .fold-legend__bar { width: 15px; height: 3px; border-radius: 2px; background: #e8b24a; display: inline-block; }
  .fold-legend__i--bond { color: var(--muted); }

  /* transport */
  .fold-transport { display: flex; align-items: center; gap: 10px; }
  .fold-play {
    flex: none;
    width: 30px; height: 30px;
    display: grid; place-items: center;
    border: 1px solid var(--groove); border-radius: var(--r-sm);
    background: var(--surface-2); color: var(--ink-2);
    font: 12px var(--mono); cursor: pointer; line-height: 1;
    transition: color .12s, border-color .12s, background .12s;
  }
  .fold-play:hover:not(:disabled) { color: var(--ink); border-color: var(--teal); background: var(--surface); }
  .fold-play:disabled { opacity: .4; cursor: not-allowed; }
  .fold-range { flex: 1; accent-color: var(--teal); cursor: pointer; height: 4px; }
  .fold-pct { flex: none; width: 40px; text-align: right; font: 11px var(--mono); color: var(--muted); }

  /* stage rail */
  .fold-rail { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
  .fold-rail__conn { color: var(--faint); font: 12px var(--mono); }
  .fold-rail__step {
    border: 1px solid var(--hair); border-radius: var(--r-sm);
    background: var(--surface-2); color: var(--muted);
    font: 10px var(--mono); padding: 4px 8px; cursor: pointer;
    transition: color .12s, border-color .12s, background .12s;
  }
  .fold-rail__step:hover { color: var(--ink-2); border-color: var(--groove); }
  .fold-rail__step.on {
    color: var(--ink); border-color: var(--teal);
    background: var(--teal-wash); font-weight: 600;
  }

  .fold-general {
    margin: 2px 0 0;
    padding: 8px 11px;
    border: 1px solid var(--hair);
    border-left: 2px solid var(--teal);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font: 11px/1.55 var(--mono);
    color: var(--ink-2);
  }

  .fold-3col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; align-items: stretch; }
  @media (max-width: 820px) { .fold-3col { grid-template-columns: 1fr; } }
  .fold-note {
    background: var(--surface-2);
    border: 1px solid var(--hair);
    border-top: 2px solid var(--accent);
    border-radius: var(--r-sm);
    padding: 8px 10px;
  }
  .fold-note__hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    font: 12px var(--sans); color: var(--accent); margin-bottom: 5px;
  }
  .fold-note__ss {
    font: 9.5px var(--mono); letter-spacing: 0.04em;
    color: #b07d1c; background: #f6ecd4; border-radius: 999px; padding: 1px 7px;
  }
  .fold-note__ss--none { color: var(--muted); background: var(--recess); }
  .fold-note__bd { font: 10.5px/1.5 var(--mono); color: var(--ink-2); }

  .fold-foot { margin: 2px 0 0; font: 9.5px/1.5 var(--mono); color: var(--faint); }
  .fold-foot em { font-style: normal; color: var(--muted); font-weight: 600; }
</style>

<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';

  let {
    height = '300px',
    radius = '0px',
    gap = 0.5,            // spacing between proteins, as a fraction of the largest radius
    spin = 0.006,         // radians / frame (@60fps) around Y
    tilt = 0.35,          // fixed X tilt so the fold reads in 3D
    glyphSize = 1.9,      // world size (Å) of each ascii character quad
    depthBias = 1.9,      // how far (Å) glyphs sit in front of the ribbon surface
    background = '#000',
    color = '#fff',
    structures = [
      { name: 'sfGFP',     pdb: 'https://files.rcsb.org/download/2B3P.pdb' },
      { name: 'PETase',    pdb: 'https://files.rcsb.org/download/4CG1.pdb' },
      { name: 'Reteplase', pdb: 'https://files.rcsb.org/download/1RTF.pdb' }
    ]
  } = $props();

  // the visible alphabet: amino-acid one-letter codes
  const CHARS = 'ACDEFGHIKLMNPQRSTVWY';
  const REVEAL_RES = 256;                 // resolution of the reveal field along the chain
  const FOV = 34;
  const SUB = 6;                          // spline samples per residue
  const RING = 12;                        // vertices around each cross-section
  // cartoon cross-section, in Å: thin round coils, flat helix / sheet ribbons, tapered arrows
  const COIL_R = 0.34;                    // coil tube radius
  const HELIX_W = 1.15, HELIX_T = 0.30;   // helix ribbon half-width / half-thickness
  const SHEET_W = 1.15, SHEET_T = 0.22;   // strand ribbon half-width / half-thickness
  const ARROW_W = 1.95, TIP = 0.06;       // arrowhead base half-width / tip half-width
  const SCRAMBLE_MS = 500;                 // fast-flicker "decode" window after a glyph appears
  const FLICKER_FAST = 45;                 // glyph-change interval while decoding (ms)
  const FLICKER_SLOW = 190;                // glyph-change interval once settled (still live)
  // whole-structure breathe: the ENTIRE fold cross-fades to amino-acid letters and back
  const REVEAL_HOLD_FOLD = 1300;           // dwell fully folded (ms)
  const REVEAL_FADE = 1200;                // fold <-> letters cross-fade (ms)
  const REVEAL_HOLD_LETTERS = 1700;        // dwell fully in amino-acid letters (ms)
  const REVEAL_PERIOD = REVEAL_HOLD_FOLD + REVEAL_FADE + REVEAL_HOLD_LETTERS + REVEAL_FADE;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  let container = $state(null);
  let boxW = $state(0);
  let boxH = $state(0);
  let labels = $state([]);  // [{ name, xPct }] — one caption under each protein
  let ready = $state(false);
  let failed = $state(false);

  let renderer, scene, camera, stage, atlasTex, revealTex;
  let proteins = [];        // each: { name, group, ribbonGeo, glyphGeo, glyphCenters, glyphTs, count, radius, slotX, prevReveal, onset, zbuf }
  let rafId = null, running = false;
  let last = 0;

  // layout of the proteins across the scene (Å), filled in by layoutSlots()
  let layoutWidth = 0, layoutHalfH = 0, maxR = 0;

  // reveal field (shared; uniform along the chain — every fold breathes together)
  const revealF = new Float32Array(REVEAL_RES);
  const revealData = new Uint8Array(REVEAL_RES);
  let revealT0 = 0;         // time origin of the fold<->letters cycle

  const _v = new THREE.Vector3();

  // one shared, per-frame pulse [0..1] that makes every catalytic-site glow "breathe"
  const glowPulse = { value: 0 };

  // ---- cursor disturbance: the cursor stirs the folds into a stochastic scatter
  // that regathers on its own — deliberately NOT a radial dome. done in screen
  // space (NDC) in the vertex shaders so ribbon + glyphs deform together
  // regardless of each fold's own spin. shared uniform objects so a single
  // per-frame update drives every material. runs even under prefers-reduced-
  // motion — it's a direct response to the cursor, like the always-on spin.
  const PUSH_RADIUS = 0.6;                   // NDC reach of the cursor's disturbance
  const PUSH_GLYPH = 0.15;                    // glyph scatter distance (NDC)
  const PUSH_RIBBON = 0.085;                  // ribbon billow distance — gentle, coherent
  const pointerUniform = { value: new THREE.Vector2(0, 0) }; // eased cursor in NDC
  const pointerActive = { value: 0 };        // eased 0..1 presence (drives the settle-back)
  const aspectUniform = { value: 1 };        // boxW/boxH so the reach stays circular
  const timeUniform = { value: 0 };          // seconds — drives the turbulent churn
  let pointerTargetX = 0, pointerTargetY = 0; // latest raw cursor NDC
  let pointerActiveTarget = 0;               // 1 while hovering, 0 once the cursor leaves
  let sceneEl = $state(null);

  // ---- click-drag to rotate: grab the fold nearest the cursor and turn it by
  // hand; a flick leaves a little momentum that decays back into the idle spin.
  // a plain click (no movement) still falls through to the fold's UniProt link.
  const DRAG_SENS = 0.01;                     // radians of rotation per pixel dragged
  const TILT_MIN = -1.4, TILT_MAX = 1.4;      // clamp pitch so a fold can't flip over
  const clampTilt = (x) => Math.max(TILT_MIN, Math.min(TILT_MAX, x));
  let dragging = $state(false);               // true while a fold is being turned by drag
  let dragProtein = null;                     // the fold currently under the hand
  let dragLastX = 0, dragLastY = 0;           // previous pointer position (client px)
  let dragMoved = false;                      // moved far enough to be a drag (suppresses the click)

  // Two flavours of disturbance so it reads as an organic scatter, not a lens:
  //  · glyphs — each character is an independent particle: a fuzzy per-glyph
  //    influence radius, a staggered activation threshold (so they pop out and
  //    drift back on their own clocks, never in lockstep) and its OWN randomly
  //    turning heading, only faintly biased outward — so the letters scatter
  //    turbulently and regather stochastically rather than doming outward.
  //  · ribbon — a continuous tube can't shatter per-vertex, so it billows along a
  //    smooth, slowly-churning turbulent field (coherent, but still non-radial).
  // `POS` = clip-space position to nudge; `SEED` = a vec3 object-space seed.

  // Dave Hoskins hash → three independent [0,1) randoms from a vec3 (glyphs only).
  const HASH33_GLSL = `
    vec3 hash33(vec3 p3) {
      p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yxz + 33.33);
      return fract((p3.xxy + p3.yxx) * p3.zyx);
    }`;

  function glyphScatterGLSL(POS, strengthConst, SEED) {
    return `
      if (uPointerActive > 0.001) {
        vec2 ndc = ${POS}.xy / ${POS}.w;
        vec2 dc = vec2((ndc.x - uPointer.x) * uAspect, ndc.y - uPointer.y);
        float dist = length(dc);
        vec3 rnd = hash33(${SEED} * 1.7 + 3.1);            // stable per-glyph randoms
        float radius = uPushRadius * (0.5 + 1.0 * rnd.x);  // fuzzy, per-glyph edge
        float prox = 1.0 - smoothstep(0.0, radius, dist);
        if (prox > 0.001) {
          float thr = 0.55 * rnd.y;                         // staggered pop-out AND return
          float drive = smoothstep(thr, thr + 0.45, uPointerActive) * prox;
          float base = rnd.z * 6.2831853;
          float ang = base + uTime * (0.2 + 0.7 * rnd.x) + sin(uTime * 0.8 + base) * 1.1;
          vec2 rdir = vec2(cos(ang), sin(ang));             // its own turning heading
          vec2 away = dist > 1e-4 ? dc / dist : rdir;
          vec2 dir = normalize(mix(rdir, away, 0.22));      // only faintly outward
          float mag = (0.4 + 1.2 * rnd.x) * ${strengthConst};
          vec2 pushC = dir * drive * mag;
          ${POS}.xy += vec2(pushC.x / uAspect, pushC.y) * ${POS}.w;
        }
      }`;
  }

  function ribbonBillowGLSL(POS, strengthConst, SEED) {
    return `
      if (uPointerActive > 0.001) {
        vec2 ndc = ${POS}.xy / ${POS}.w;
        vec2 dc = vec2((ndc.x - uPointer.x) * uAspect, ndc.y - uPointer.y);
        float dist = length(dc);
        float prox = 1.0 - smoothstep(0.0, uPushRadius, dist);
        if (prox > 0.001) {
          vec3 sp = ${SEED} * 0.5 + vec3(uTime * 0.4);
          float nx = sin(sp.x + sp.y * 1.3) + sin(sp.z * 1.1 - sp.x * 0.7);
          float ny = sin(sp.y * 1.2 + sp.z * 0.9) + sin(sp.x * 0.8 - sp.z * 1.4);
          vec2 flow = vec2(nx, ny) * 0.5;                    // coherent turbulent heading
          float drive = smoothstep(0.0, 0.55, uPointerActive) * prox;
          vec2 pushC = flow * drive * ${strengthConst};
          ${POS}.xy += vec2(pushC.x / uAspect, pushC.y) * ${POS}.w;
        }
      }`;
  }

  function handlePointerMove(e) {
    if (!sceneEl) return;
    if (dragging && dragProtein) {
      const dx = e.clientX - dragLastX;
      const dy = e.clientY - dragLastY;
      dragLastX = e.clientX; dragLastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      const velY = dx * DRAG_SENS;             // horizontal drag → yaw
      const velX = dy * DRAG_SENS;             // vertical drag → pitch
      dragProtein.group.rotation.y += velY;
      dragProtein.group.rotation.x = clampTilt(dragProtein.group.rotation.x + velX);
      dragProtein.dragVelY = velY;             // remember last-move spin, for release momentum
      dragProtein.dragVelX = velX;
      return;                                   // grabbing: rotate only, no scatter
    }
    const r = sceneEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pointerTargetX = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerTargetY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointerActiveTarget = 1;
  }

  function handlePointerLeave() {
    pointerActiveTarget = 0;
  }

  // pick the fold nearest the cursor's X (the triad sits in a horizontal row)
  function pickProtein(clientX) {
    if (!sceneEl || !proteins.length || !labels.length) return null;
    const r = sceneEl.getBoundingClientRect();
    if (!r.width) return null;
    const px = ((clientX - r.left) / r.width) * 100;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < proteins.length; i++) {
      const l = labels[i];
      if (!l) continue;
      if (px >= l.leftPct && px <= l.leftPct + l.widthPct) return proteins[i];
      const d = Math.abs(px - l.xPct);
      if (d < bestDist) { bestDist = d; best = proteins[i]; }
    }
    return best;
  }

  function handlePointerDown(e) {
    const p = pickProtein(e.clientX);
    if (!p) return;
    dragging = true;
    dragProtein = p;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    dragMoved = false;
    p.dragVelY = 0; p.dragVelX = 0;            // cancel any leftover momentum
    pointerActiveTarget = 0;                    // let the scatter settle while rotating
    sceneEl.setPointerCapture?.(e.pointerId);   // keep tracking even past the edge
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    dragProtein = null;                          // its dragVel lingers → momentum in loop()
    try { sceneEl?.releasePointerCapture?.(e.pointerId); } catch {}
  }

  // a drag ends with a click event on the fold's UniProt link — cancel it so the
  // rotation gesture doesn't navigate away. a plain click (no drag) falls through.
  function handleClickCapture(e) {
    if (dragMoved) { e.preventDefault(); e.stopPropagation(); dragMoved = false; }
  }

  onMount(async () => {
    const structs = structures;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(new THREE.Color(background), 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, (boxW || 1) / (boxH || 1), 1, 4000);
    camera.position.set(0, 0, 120);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x0c0c0c, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 4.5);
    key.position.set(0.4, 1.0, 2.5);
    scene.add(key);

    stage = new THREE.Group();
    scene.add(stage);

    atlasTex = buildAtlas(CHARS);
    revealTex = new THREE.DataTexture(revealData, REVEAL_RES, 1, THREE.RedFormat, THREE.UnsignedByteType);
    revealTex.minFilter = THREE.LinearFilter;
    revealTex.magFilter = THREE.LinearFilter;
    revealTex.needsUpdate = true;

    let pdbTexts;
    try {
      pdbTexts = await Promise.all(structs.map((s) => fetch(s.pdb).then((r) => r.text())));
    } catch (e) {
      failed = true;
      return;
    }

    // parse + centre every fold first, and measure each one's size
    const parsed = [];
    for (let i = 0; i < structs.length; i++) {
      const res = parseChain(pdbTexts[i]);
      if (res.ca.length < 4) continue;
      centerResidues(res);
      const radius = boundingRadius(res.ca);
      const hi = computeHighlight(res, structs[i].sites, radius);
      parsed.push({ res, name: structs[i].name, url: structs[i].url, radius, color: structs[i].color, glow: structs[i].glow, hi });
    }
    if (!parsed.length) { failed = true; return; }

    // normalise all folds to a common size so they read as equal on screen
    // (ribbon width + glyph size stay constant → consistent "line weight" across the triad)
    const targetR = parsed.reduce((s, p) => s + p.radius, 0) / parsed.length;
    for (const p of parsed) {
      const k = targetR / p.radius;
      if (Math.abs(k - 1) > 1e-3) scaleResidues(p.res, k);
      const pr = buildProtein(p.res, p.name, p.color, p.glow, p.hi);
      pr.url = p.url;   // optional: makes the caption a link to e.g. a UniProt page
      proteins.push(pr);
    }

    layoutSlots();   // place the proteins side by side and add them to the scene
    resize();        // size the renderer + frame the camera to fit the whole row

    ready = true;
    running = true;
    last = performance.now();
    revealT0 = last;
    rafId = requestAnimationFrame(loop);
  });

  // ---- PDB -> longest chain: CA + carbonyl O + secondary structure ---------
  // (real Å coordinates; the cartoon widths above are also in Å)
  function parseChain(text) {
    const lines = text.split('\n');

    // secondary-structure ranges straight from the HELIX / SHEET records
    const helix = [], sheet = [];
    for (const line of lines) {
      if (line.startsWith('HELIX')) {
        const lo = parseInt(line.slice(21, 25)), hi = parseInt(line.slice(33, 37));
        if (Number.isFinite(lo) && Number.isFinite(hi)) helix.push({ chain: line[19], lo, hi });
      } else if (line.startsWith('SHEET')) {
        const lo = parseInt(line.slice(22, 26)), hi = parseInt(line.slice(33, 37));
        if (Number.isFinite(lo) && Number.isFinite(hi)) sheet.push({ chain: line[21], lo, hi });
      }
    }

    // per-chain ordered residues (CA drives the path, O sets the ribbon's flat orientation)
    const chains = new Map();
    let order = 0;
    for (const line of lines) {
      if (line.startsWith('ENDMDL')) break;
      if (!line.startsWith('ATOM')) continue;
      const atom = line.slice(12, 16).trim();
      if (atom !== 'CA' && atom !== 'O') continue;
      const alt = line[16];
      if (alt !== ' ' && alt !== 'A') continue;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const ch = line[21];
      const seq = parseInt(line.slice(22, 26));
      const key = seq + (line[26] === ' ' ? '' : line[26]); // resSeq + insertion code
      if (!chains.has(ch)) chains.set(ch, new Map());
      const resmap = chains.get(ch);
      let r = resmap.get(key);
      if (!r) { r = { ca: null, o: null, seq, order: order++ }; resmap.set(key, r); }
      if (atom === 'CA') r.ca = new THREE.Vector3(x, y, z);
      else r.o = new THREE.Vector3(x, y, z);
    }

    // longest chain, counted by residues that actually have a CA
    let bestCh = null, bestLen = 0;
    for (const [ch, resmap] of chains) {
      let len = 0;
      for (const r of resmap.values()) if (r.ca) len++;
      if (len > bestLen) { bestLen = len; bestCh = ch; }
    }
    if (bestCh == null) return { ca: [], o: [], ss: new Uint8Array(0), seq: [] };

    const residues = [...chains.get(bestCh).values()]
      .filter((r) => r.ca)
      .sort((a, b) => a.order - b.order);

    const ca = residues.map((r) => r.ca);
    const o = residues.map((r) => r.o);
    const seq = residues.map((r) => r.seq);   // resSeq per residue, for locating catalytic sites
    const ss = new Uint8Array(residues.length); // 0 coil, 1 helix, 2 strand
    for (let i = 0; i < residues.length; i++) {
      const rseq = residues[i].seq;
      if (helix.some((h) => h.chain === bestCh && rseq >= h.lo && rseq <= h.hi)) ss[i] = 1;
      else if (sheet.some((s) => s.chain === bestCh && rseq >= s.lo && rseq <= s.hi)) ss[i] = 2;
    }
    return { ca, o, ss, seq };
  }

  // per-residue catalytic-site "highlight" [0..1]: a smooth 3D blob centred on the
  // requested catalytic residues (by resSeq), falling off with distance so the glow
  // reads as the active-site pocket. Returns all-zeros when no sites are requested.
  function computeHighlight(res, sites, radius) {
    const n = res.ca.length;
    const hi = new Float32Array(n);
    if (!n || !Array.isArray(sites) || !sites.length) return hi;

    // anchor at the CA of each catalytic residue that we actually parsed
    const anchors = [];
    if (res.seq) {
      for (const s of sites) {
        const idx = res.seq.indexOf(s);
        if (idx >= 0 && res.ca[idx]) anchors.push(res.ca[idx]);
      }
    }
    // fallback: the fold centre (folds are centred at the origin). For barrel folds
    // like GFP — whose chromophore is a HETATM the ATOM-only parser skips — the
    // centre lands right on the active site, so the glow still finds the right spot.
    if (!anchors.length) anchors.push(new THREE.Vector3(0, 0, 0));

    const sigma = Math.max(1e-3, 0.26 * (radius || 1));
    const inv2s2 = 1 / (2 * sigma * sigma);
    for (let i = 0; i < n; i++) {
      let dmin = Infinity;
      for (const a of anchors) { const d = res.ca[i].distanceTo(a); if (d < dmin) dmin = d; }
      const v = Math.exp(-(dmin * dmin) * inv2s2);
      hi[i] = v < 0.02 ? 0 : v;
    }
    return hi;
  }

  // center at origin (keep real Å scale)
  function centerResidues(res) {
    const box = new THREE.Box3().setFromPoints(res.ca);
    const c = box.getCenter(new THREE.Vector3());
    for (const p of res.ca) p.sub(c);
    for (const p of res.o) if (p) p.sub(c);
    return res;
  }

  // bounding radius of a (already-centred) CA path — our size metric for normalising
  function boundingRadius(ca) {
    let r = 0;
    for (const p of ca) { const d = p.length(); if (d > r) r = d; }
    return r || 1;
  }

  // uniform scale about the origin — normalises every fold to a shared size
  function scaleResidues(res, k) {
    for (const p of res.ca) p.multiplyScalar(k);
    for (const p of res.o) if (p) p.multiplyScalar(k);
  }

  // per-residue ribbon frame: tangent + a "right" vector from the carbonyl O so the
  // flat faces of helices and strands lie in their real peptide planes
  function computeFrames(ca, o) {
    const n = ca.length;
    const T = new Array(n), R = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = ca[Math.max(0, i - 1)], next = ca[Math.min(n - 1, i + 1)];
      T[i] = new THREE.Vector3().subVectors(next, prev).normalize();
      let r = null;
      if (o[i]) {
        const co = new THREE.Vector3().subVectors(o[i], ca[i]);
        co.addScaledVector(T[i], -co.dot(T[i])); // component perpendicular to the tangent
        if (co.lengthSq() > 1e-6) r = co.normalize();
      }
      R[i] = r;
    }
    // fill any gaps with an arbitrary perpendicular
    for (let i = 0; i < n; i++) {
      if (!R[i]) {
        const t = T[i];
        const ax = Math.abs(t.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        R[i] = new THREE.Vector3().crossVectors(t, ax).normalize();
      }
    }
    // carbonyls flip ~180° along strands; keep successive frames on the same side
    for (let i = 1; i < n; i++) if (R[i].dot(R[i - 1]) < 0) R[i].multiplyScalar(-1);
    // smooth, then re-orthogonalise against the tangent
    for (let pass = 0; pass < 2; pass++) {
      const Rs = R.map((v) => v.clone());
      for (let i = 1; i < n - 1; i++) {
        Rs[i].copy(R[i - 1]).add(R[i]).add(R[i]).add(R[i + 1]);
        if (Rs[i].lengthSq() < 1e-6) Rs[i].copy(R[i]); else Rs[i].normalize();
      }
      for (let i = 0; i < n; i++) {
        Rs[i].addScaledVector(T[i], -Rs[i].dot(T[i]));
        if (Rs[i].lengthSq() < 1e-6) Rs[i].copy(R[i]); else Rs[i].normalize();
        R[i] = Rs[i];
      }
    }
    return { T, R };
  }

  // per-residue half-width across the ribbon, with strand arrowheads
  function residueWidths(ss) {
    const n = ss.length;
    const A = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ss[i] === 1) A[i] = HELIX_W;
      else if (ss[i] === 2) A[i] = SHEET_W;
      else A[i] = COIL_R;
    }
    // last residue of a strand tapers to a point, the one before is the wide base
    for (let i = 0; i < n; i++) {
      if (ss[i] === 2 && (i === n - 1 || ss[i + 1] !== 2)) {
        A[i] = TIP;
        if (i - 1 >= 0 && ss[i - 1] === 2) A[i - 1] = ARROW_W;
      }
    }
    return A;
  }

  // extrude an SS-dependent cross-section along the smoothed backbone:
  // round for coils, flat & wide for helices/strands, tapering to a point at each arrowhead
  function buildCartoon(curve, R, A, ss, H) {
    const n = ss.length;
    // per-residue half-thickness (b); the half-width (a) comes in as A
    const B = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ss[i] === 1) B[i] = HELIX_T;
      else if (ss[i] === 2) B[i] = SHEET_T;
      else B[i] = COIL_R;
    }

    const S = (n - 1) * SUB + 1;
    const pos = new Float32Array(S * RING * 3);
    const nor = new Float32Array(S * RING * 3);
    const aT = new Float32Array(S * RING);
    const aHi = new Float32Array(S * RING);    // per-vertex catalytic-site glow

    const P = new THREE.Vector3(), T = new THREE.Vector3();
    const Rv = new THREE.Vector3(), Uv = new THREE.Vector3(), nrm = new THREE.Vector3();

    for (let s = 0; s < S; s++) {
      const u = s / (S - 1);
      const fu = u * (n - 1);
      let i = Math.floor(fu); if (i > n - 2) i = n - 2; if (i < 0) i = 0;
      const f = fu - i;

      P.copy(curve.getPoint(u));
      T.copy(curve.getTangent(u)).normalize();
      Rv.copy(R[i]).lerp(R[i + 1], f);
      Uv.copy(T).cross(Rv).normalize();  // U = T x R
      Rv.copy(Uv).cross(T).normalize();  // R = U x T  (orthonormal against the real tangent)

      const a = A[i] + (A[i + 1] - A[i]) * f;
      const b = B[i] + (B[i + 1] - B[i]) * f;
      const hi = H ? (H[i] + (H[i + 1] - H[i]) * f) : 0;

      for (let k = 0; k < RING; k++) {
        const th = (k / RING) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        const p = (s * RING + k) * 3;
        pos[p]     = P.x + cs * a * Rv.x + sn * b * Uv.x;
        pos[p + 1] = P.y + cs * a * Rv.y + sn * b * Uv.y;
        pos[p + 2] = P.z + cs * a * Rv.z + sn * b * Uv.z;
        // outward normal of the ellipse: (cos/a) R + (sin/b) U
        nrm.set(0, 0, 0).addScaledVector(Rv, cs / a).addScaledVector(Uv, sn / b).normalize();
        nor[p] = nrm.x; nor[p + 1] = nrm.y; nor[p + 2] = nrm.z;
        aT[s * RING + k] = u;
        aHi[s * RING + k] = hi;
      }
    }

    const index = new Uint32Array((S - 1) * RING * 6);
    let w = 0;
    for (let s = 0; s < S - 1; s++) {
      for (let k = 0; k < RING; k++) {
        const k2 = (k + 1) % RING;
        const a0 = s * RING + k, a1 = s * RING + k2;
        const b0 = (s + 1) * RING + k, b1 = (s + 1) * RING + k2;
        index[w++] = a0; index[w++] = b0; index[w++] = a1;
        index[w++] = a1; index[w++] = b0; index[w++] = b1;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setAttribute('aHi', new THREE.BufferAttribute(aHi, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  // a 2D field of glyph centres over the ribbon: dense rows along the backbone,
  // a few columns across the local ribbon width, so a revealed patch reads as code
  function buildGlyphField(curve, R, A) {
    const n = A.length;
    const L = Math.max(1, curve.getLength());
    const step = glyphSize * 0.9;                 // ~one character spacing (Å)
    const rows = Math.max(24, Math.round(L / step));
    const centers = [];
    const ts = [];
    const P = new THREE.Vector3(), T = new THREE.Vector3();
    const Rv = new THREE.Vector3(), Uv = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const u = rows > 1 ? r / (rows - 1) : 0;
      const fu = u * (n - 1);
      let i = Math.floor(fu); if (i > n - 2) i = n - 2; if (i < 0) i = 0;
      const f = fu - i;
      P.copy(curve.getPoint(u));
      T.copy(curve.getTangent(u)).normalize();
      Rv.copy(R[i]).lerp(R[i + 1], f);
      Uv.copy(T).cross(Rv).normalize();
      Rv.copy(Uv).cross(T).normalize();           // orthonormal "right" across the ribbon
      const a = A[i] + (A[i + 1] - A[i]) * f;      // local half-width
      const cols = Math.max(1, Math.min(3, Math.round((2 * a) / (step * 0.72))));
      for (let c = 0; c < cols; c++) {
        const d = cols === 1 ? 0 : (c / (cols - 1) - 0.5) * (2 * a) * 0.8;
        centers.push(new THREE.Vector3(P.x + d * Rv.x, P.y + d * Rv.y, P.z + d * Rv.z));
        ts.push(u);
      }
    }
    return { centers, ts: Float32Array.from(ts) };
  }

  // ---- build one protein: SS cartoon ribbon + a 2D ascii field on the same fold
  // each fold gets its own ribbon + glyph material so it can carry its own colour
  function buildProtein(res, name, colorHex = color, glowHex, hi) {
    const { ca, o, ss } = res;
    const glow = glowHex || colorHex;
    const H = hi && hi.length === ca.length ? hi : null;

    const curve = new THREE.CatmullRomCurve3(ca, false, 'centripetal', 0.5);
    const frames = computeFrames(ca, o);
    const A = residueWidths(ss);

    const ribbonMat = makeRibbonMaterial(colorHex, glow);
    const glyphMat = makeGlyphMaterial(colorHex, glow);

    const geo = buildCartoon(curve, frames.R, A, ss, H);
    const ribbonMesh = new THREE.Mesh(geo, ribbonMat);
    ribbonMesh.renderOrder = 0;

    const { centers, ts } = buildGlyphField(curve, frames.R, A);
    const count = centers.length;
    // sample the per-residue highlight at each glyph's position along the chain
    const glyphHi = new Float32Array(count);
    if (H) {
      const nres = ca.length;
      for (let g = 0; g < count; g++) {
        const fu = ts[g] * (nres - 1);
        let i = Math.floor(fu); if (i > nres - 2) i = nres - 2; if (i < 0) i = 0;
        glyphHi[g] = H[i] + (H[i + 1] - H[i]) * (fu - i);
      }
    }
    const glyphGeo = buildGlyphGeo(centers, glyphHi);
    const glyphMesh = new THREE.Mesh(glyphGeo, glyphMat);
    glyphMesh.renderOrder = 1;
    glyphMesh.frustumCulled = false;

    const group = new THREE.Group();
    group.rotation.x = tilt;            // fixed tilt so the fold reads in 3D
    group.add(ribbonMesh, glyphMesh);   // content is centred on the group's origin

    return {
      name, group, ribbonGeo: geo, glyphGeo, ribbonMat, glyphMat,
      glyphCenters: centers, glyphTs: ts, count,
      radius: geo.boundingSphere.radius, slotX: 0,
      prevReveal: new Float32Array(count),
      onset: new Float32Array(count).fill(-1),
      zbuf: new Float32Array(count),
      dragVelY: 0, dragVelX: 0            // leftover spin from a drag flick
    };
  }

  // a quad per glyph; billboarded in the shader, so the characters live in the 3D fold
  function buildGlyphGeo(centers, glyphHi) {
    const n = centers.length;
    const CORNER = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const aCenter = new Float32Array(n * 4 * 3);
    const aCorner = new Float32Array(n * 4 * 2);
    const aUv = new Float32Array(n * 4 * 2);
    const aGlyph = new Float32Array(n * 4);
    const aReveal = new Float32Array(n * 4);
    const aDim = new Float32Array(n * 4).fill(1); // per-glyph brightness (depth cue)
    const aHi = new Float32Array(n * 4);          // per-glyph catalytic-site glow
    const index = new Uint32Array(n * 6);
    for (let g = 0; g < n; g++) {
      const c = centers[g];
      const h = glyphHi ? glyphHi[g] : 0;
      for (let v = 0; v < 4; v++) {
        const i = g * 4 + v;
        aCenter[i * 3] = c.x; aCenter[i * 3 + 1] = c.y; aCenter[i * 3 + 2] = c.z;
        aCorner[i * 2] = CORNER[v][0]; aCorner[i * 2 + 1] = CORNER[v][1];
        aUv[i * 2] = UV[v][0]; aUv[i * 2 + 1] = UV[v][1];
        aHi[i] = h;
      }
      const o = g * 4, e = g * 6;
      index[e] = o; index[e + 1] = o + 1; index[e + 2] = o + 2;
      index[e + 3] = o; index[e + 4] = o + 2; index[e + 5] = o + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 2));
    geo.setAttribute('aUv', new THREE.BufferAttribute(aUv, 2));
    geo.setAttribute('aGlyph', new THREE.BufferAttribute(aGlyph, 1));
    geo.setAttribute('aReveal', new THREE.BufferAttribute(aReveal, 1));
    geo.setAttribute('aDim', new THREE.BufferAttribute(aDim, 1));
    geo.setAttribute('aHi', new THREE.BufferAttribute(aHi, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    return geo;
  }

  // ---- materials ----------------------------------------------------------
  // shaded ribbon that DISSOLVES exactly where the reveal field is high
  function makeRibbonMaterial(colorHex = color, glowHex = colorHex) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.5, metalness: 0.0, emissive: 0x121212, side: THREE.DoubleSide });
    // opaque ribbon; where the reveal field is high the ribbon fades cleanly to black
    // (no dither), handing that stretch of the fold over to the decoding ascii glyphs.
    // the catalytic site (aHi) is tinted toward the glow colour and breathes via uPulse.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uReveal = { value: revealTex };
      shader.uniforms.uGlow = { value: new THREE.Color(glowHex) };
      shader.uniforms.uPulse = glowPulse;
      shader.uniforms.uPointer = pointerUniform;
      shader.uniforms.uPointerActive = pointerActive;
      shader.uniforms.uAspect = aspectUniform;
      shader.uniforms.uPushRadius = { value: PUSH_RADIUS };
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader =
        'attribute float aT;\nattribute float aHi;\nvarying float vT;\nvarying float vHi;\n' +
        'uniform vec2 uPointer;\nuniform float uPointerActive;\nuniform float uAspect;\nuniform float uPushRadius;\nuniform float uTime;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vT = aT;\n  vHi = aHi;'
      );
      // cursor disturbance: billow the ribbon along a coherent turbulent field in
      // screen space after projection (seeded by the vertex's object-space position)
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n' + ribbonBillowGLSL('gl_Position', PUSH_RIBBON.toFixed(4), 'position')
      );
      shader.fragmentShader = 'uniform sampler2D uReveal;\nuniform vec3 uGlow;\nuniform float uPulse;\nvarying float vT;\nvarying float vHi;\nfloat dimF;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n' +
        '  float rv = texture2D(uReveal, vec2(vT, 0.5)).r;\n' +
        '  dimF = 1.0 - smoothstep(0.22, 0.72, rv);\n' +
        '  if (dimF < 0.02) discard;'   // fully decoded: the ribbon is gone here
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n' +
        '  float _hi = clamp(vHi, 0.0, 1.0);\n' +
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlow, _hi * (0.6 + 0.4 * uPulse));\n' +
        '  gl_FragColor.rgb += uGlow * _hi * uPulse * 0.5;\n' +
        '  gl_FragColor.rgb *= dimF;'
      );
    };
    return mat;
  }

  // the ascii replica: billboarded characters that APPEAR exactly where the tube dissolves
  function makeGlyphMaterial(colorHex = color, glowHex = colorHex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlasTex },
        uCharCount: { value: CHARS.length },
        uColor: { value: new THREE.Color(colorHex) },
        uGlow: { value: new THREE.Color(glowHex) },
        uPulse: glowPulse,
        uSize: { value: glyphSize },
        uOpacity: { value: 1 },
        uDepthBias: { value: depthBias },
        uPointer: pointerUniform,
        uPointerActive: pointerActive,
        uAspect: aspectUniform,
        uPushRadius: { value: PUSH_RADIUS },
        uTime: timeUniform
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 aCenter;
        attribute vec2 aCorner;
        attribute vec2 aUv;
        attribute float aGlyph;
        attribute float aReveal;
        attribute float aDim;
        attribute float aHi;
        varying vec2 vUv;
        varying float vGlyph;
        varying float vReveal;
        varying float vDim;
        varying float vHi;
        uniform float uSize;
        uniform float uDepthBias;
        uniform vec2 uPointer;
        uniform float uPointerActive;
        uniform float uAspect;
        uniform float uPushRadius;
        uniform float uTime;
        ${HASH33_GLSL}
        void main() {
          vUv = aUv; vGlyph = aGlyph; vReveal = aReveal; vDim = aDim; vHi = aHi;
          vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
          mv.xy += aCorner * uSize;   // billboard: face the camera
          mv.z += uDepthBias;         // sit just in front of the tube surface
          gl_Position = projectionMatrix * mv;
          ${glyphScatterGLSL('gl_Position', PUSH_GLYPH.toFixed(4), 'aCenter')}
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uAtlas;
        uniform float uCharCount;
        uniform vec3 uColor;
        uniform vec3 uGlow;
        uniform float uPulse;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vGlyph;
        varying float vReveal;
        varying float vDim;
        varying float vHi;
        void main() {
          if (vReveal <= 0.02) discard;
          float g = floor(vGlyph + 0.5);
          vec2 uv = vec2((g + vUv.x) / uCharCount, vUv.y);
          vec4 tex = texture2D(uAtlas, uv);
          float a = tex.a * smoothstep(0.10, 0.34, clamp(vReveal, 0.0, 1.0)) * uOpacity * vDim;
          if (a < 0.02) discard;
          float hi = clamp(vHi, 0.0, 1.0);
          vec3 col = mix(uColor, uGlow, hi * (0.7 + 0.3 * uPulse));
          col += uGlow * hi * uPulse * 0.5;
          gl_FragColor = vec4(col, a);
        }
      `
    });
  }

  function buildAtlas(chars) {
    const cell = 64;
    const cv = document.createElement('canvas');
    cv.width = cell * chars.length;
    cv.height = cell;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold ${Math.floor(cell * 0.82)}px 'Courier New', ui-monospace, monospace`;
    for (let i = 0; i < chars.length; i++) c.fillText(chars[i], i * cell + cell / 2, cell / 2 + cell * 0.04);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // ---- reveal field: the whole fold cross-fades to amino-acid letters and back --
  // one global value drives every point along the chain, so the ENTIRE protein
  // dissolves into letters together (hold), then reassembles into the ribbon (hold)
  function updateReveal(now) {
    const gr = globalReveal(now - revealT0);
    revealF.fill(gr);
    revealData.fill(Math.round(Math.min(1, Math.max(0, gr)) * 255));
    revealTex.needsUpdate = true;
  }

  // 0 = fully folded ribbon, 1 = fully amino-acid letters, smooth holds at each end
  function globalReveal(elapsed) {
    const p = ((elapsed % REVEAL_PERIOD) + REVEAL_PERIOD) % REVEAL_PERIOD;
    if (p < REVEAL_HOLD_FOLD) return 0;                                  // folded
    let t = p - REVEAL_HOLD_FOLD;
    if (t < REVEAL_FADE) { const x = t / REVEAL_FADE; return x * x * (3 - 2 * x); }   // fold -> letters
    t -= REVEAL_FADE;
    if (t < REVEAL_HOLD_LETTERS) return 1;                              // full amino-acid
    t -= REVEAL_HOLD_LETTERS;
    const x = t / REVEAL_FADE; return 1 - x * x * (3 - 2 * x);          // letters -> fold
  }

  // per-frame, per protein: which glyphs are exposed and the decode animation each plays.
  // amino-acid letters never lock — a fast flicker on appearance eases into an
  // ongoing slower shimmer, so every revealed patch keeps "decoding" live
  function updateGlyphs(p, now) {
    const { glyphGeo, glyphCenters, glyphTs, count, prevReveal, onset, zbuf, group } = p;
    const aReveal = glyphGeo.attributes.aReveal.array;
    const aGlyph = glyphGeo.attributes.aGlyph.array;
    const aDim = glyphGeo.attributes.aDim.array;
    const wm = group.matrixWorld;
    const vm = camera.matrixWorldInverse;

    let zmin = Infinity, zmax = -Infinity;
    for (let g = 0; g < count; g++) {
      _v.copy(glyphCenters[g]).applyMatrix4(wm).applyMatrix4(vm);
      zbuf[g] = _v.z;
      if (_v.z < zmin) zmin = _v.z;
      if (_v.z > zmax) zmax = _v.z;
    }
    const zr = Math.max(1e-4, zmax - zmin);
    const N = CHARS.length;

    for (let g = 0; g < count; g++) {
      const idx = Math.min(REVEAL_RES - 1, Math.round(glyphTs[g] * (REVEAL_RES - 1)));
      const rv = revealF[idx];
      const shown = rv > 0.02;

      if (shown && prevReveal[g] <= 0.02) onset[g] = now; // just appeared: restart the decode
      else if (!shown) onset[g] = -1;
      prevReveal[g] = rv;

      // fast flicker for the first SCRAMBLE_MS, then an ongoing (never-frozen) shimmer
      const age = onset[g] >= 0 ? now - onset[g] : 0;
      const period = age < SCRAMBLE_MS ? FLICKER_FAST : FLICKER_SLOW + (g % 6) * 30;
      const tick = Math.floor((now + ((g * 53) % 500)) / period);
      const h = Math.sin(g * 12.9898 + tick * 78.233) * 43758.5453;
      const ch = Math.min(N - 1, Math.floor((h - Math.floor(h)) * N));

      // nearer glyphs read a touch brighter, giving the patch depth
      const nearNorm = (zbuf[g] - zmin) / zr; // 1 near, 0 far
      const dim = 0.5 + 0.5 * nearNorm;

      const o = g * 4;
      for (let v = 0; v < 4; v++) { aReveal[o + v] = rv; aGlyph[o + v] = ch; aDim[o + v] = dim; }
    }
    glyphGeo.attributes.aReveal.needsUpdate = true;
    glyphGeo.attributes.aGlyph.needsUpdate = true;
    glyphGeo.attributes.aDim.needsUpdate = true;
  }

  // lay the proteins out in a row, centred on the origin, each in its own group;
  // every fold gets an equal slot (they're normalised to one size) so the triad is balanced
  function layoutSlots() {
    const n = proteins.length;
    maxR = 0;
    for (const p of proteins) if (p.radius > maxR) maxR = p.radius;
    const slotW = 2 * maxR;                         // equal slot for every fold
    const g = gap * maxR;                           // spacing between neighbours (Å)
    const total = slotW * n + g * (n - 1);

    let cursor = -total / 2;
    for (const p of proteins) {
      p.slotX = cursor + maxR;                      // centre each fold in its slot
      p.group.position.x = p.slotX;
      stage.add(p.group);
      cursor += slotW + g;
    }
    layoutWidth = total;
    layoutHalfH = maxR;
  }

  // pull the camera back far enough that the whole row fits, in width and in height
  function frameCamera() {
    if (!camera || !boxW || !boxH || !layoutWidth) return;
    camera.aspect = boxW / boxH;
    const m = glyphSize;                            // small Å margin around the row
    const halfW = layoutWidth / 2 + m;
    const halfH = layoutHalfH + m;
    const tanV = Math.tan((FOV / 2) * Math.PI / 180);
    const distV = halfH / tanV;
    const distH = halfW / (tanV * camera.aspect);   // fov is vertical, so scale by aspect
    // on large (laptop/desktop) viewports the row fills the frame and feels too big;
    // ease it down a little there. narrow (mobile) viewports keep the full size.
    const wide = Math.min(1, Math.max(0, (boxW - 560) / (1200 - 560)));
    const fill = 1 - 0.20 * wide;                    // 1.00 on mobile → 0.80 on desktop
    const dist = (Math.max(distV, distH) * 1.06) / fill;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    const pad = (maxR + glyphSize) * 1.5;           // proteins are centred at z=0
    camera.near = Math.max(1, dist - pad);
    camera.far = dist + pad;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    computeLabels();
  }

  // project each slot centre to screen space so its caption sits under it
  function computeLabels() {
    const toPct = (x) => {
      _v.set(x, 0, 0).project(camera);
      return (_v.x * 0.5 + 0.5) * 100;
    };
    labels = proteins.map((p) => {
      // Project the slot's centre (for the caption) and its left/right edges
      // (for a transparent click target over the whole fold).
      const cx = toPct(p.slotX);
      const lx = toPct(p.slotX - maxR);
      const rx = toPct(p.slotX + maxR);
      return {
        name: p.name,
        url: p.url,
        xPct: cx,
        leftPct: Math.min(lx, rx),
        widthPct: Math.abs(rx - lx)
      };
    });
  }

  function loop(now) {
    if (!running) return;
    const dt = now - last; last = now;

    const s = spin * (dt / 16.67);
    const fr = dt / 16.67;
    for (const p of proteins) {
      if (dragging && p === dragProtein) continue;        // hand-controlled: leave it be
      p.group.rotation.y += s;                            // idle spin on its own axis
      if (p.dragVelY || p.dragVelX) {                     // release momentum, decaying to rest
        p.group.rotation.y += p.dragVelY * fr;
        p.group.rotation.x = clampTilt(p.group.rotation.x + p.dragVelX * fr);
        const decay = Math.pow(0.92, fr);
        p.dragVelY *= decay; p.dragVelX *= decay;
        if (Math.abs(p.dragVelY) < 1e-4) p.dragVelY = 0;
        if (Math.abs(p.dragVelX) < 1e-4) p.dragVelX = 0;
      }
    }

    glowPulse.value = 0.5 + 0.5 * Math.sin(now * 0.005);  // ~1.3s breathing of the active-site glow
    timeUniform.value = now * 0.001;                       // seconds, drives the deform churn

    // track the pointer, then ease the disturbance: quick to stir up, slow to
    // regather. the slow release lets each glyph's own activation threshold pull
    // it home at a staggered time, so the scatter settles back stochastically
    // rather than snapping together in lockstep.
    const posE = Math.min(1, dt / 70);
    pointerUniform.value.x += (pointerTargetX - pointerUniform.value.x) * posE;
    pointerUniform.value.y += (pointerTargetY - pointerUniform.value.y) * posE;
    const rising = pointerActiveTarget > pointerActive.value;
    const actE = Math.min(1, dt / (rising ? 120 : 340));
    pointerActive.value += (pointerActiveTarget - pointerActive.value) * actE;

    updateReveal(now);

    if (boxW && boxH) {
      stage.updateWorldMatrix(true, true);
      camera.updateMatrixWorld();
      for (const p of proteins) updateGlyphs(p, now);
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(loop);
  }

  function resize() {
    if (!renderer || !boxW || !boxH) return;
    renderer.setSize(boxW, boxH, true);
    aspectUniform.value = boxW / boxH;   // keep the cursor-repulsion falloff circular
    frameCamera();
  }

  $effect(() => {
    boxW; boxH;
    resize();
  });

  onDestroy(() => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    for (const p of proteins) {
      p.ribbonGeo.dispose(); p.glyphGeo.dispose();
      p.ribbonMat?.dispose(); p.glyphMat?.dispose();
    }
    atlasTex?.dispose();
    revealTex?.dispose();
    renderer?.dispose();
  });
</script>

<div
  bind:this={sceneEl}
  bind:clientWidth={boxW}
  bind:clientHeight={boxH}
  class="ap-scene"
  onpointermove={handlePointerMove}
  onpointerleave={handlePointerLeave}
  onpointerdown={handlePointerDown}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onclickcapture={handleClickCapture}
  style="height:{height}; border-radius:{radius}; background:{background}; color:{color};"
>
  <div bind:this={container} class="ap-gl"></div>
  {#each labels as l}
    {#if l.url}
      <a
        class="ap-hit"
        style="left:{l.leftPct}%; width:{l.widthPct}%;"
        href={l.url}
        target="_blank"
        rel="noreferrer"
        aria-label="{l.name} on UniProt"
      ></a>
    {/if}
  {/each}
  {#each labels as l}
    {#if l.url}
      <a class="ap-caption ap-caption--link" style="left:{l.xPct}%;" href={l.url} target="_blank" rel="noreferrer">{l.name}</a>
    {:else}
      <div class="ap-caption" style="left:{l.xPct}%;">{l.name}</div>
    {/if}
  {/each}
  {#if !ready && !failed}<div class="ap-loading">loading structures…</div>{/if}
  {#if failed}<div class="ap-loading">could not load structures</div>{/if}
</div>

<style>
  .ap-scene {
    position: relative;
    width: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;              /* folds still rotate on drag, but no grab-hand cursor */
    touch-action: pan-y;          /* let vertical page scroll pass; drag rotates */
  }
  .ap-gl {
    position: absolute;
    inset: 0;
  }
  /* Transparent click target over each fold, linking to its UniProt entry.
     Stops above the caption row so the caption link stays independently
     clickable. */
  .ap-hit {
    position: absolute;
    top: 0;
    bottom: 26px;
    z-index: 3;
    cursor: pointer;
    pointer-events: auto;
    touch-action: pan-y;
  }
  .ap-caption {
    position: absolute;
    bottom: 8px;
    z-index: 2;
    transform: translateX(-50%);
    white-space: nowrap;
    text-align: center;
    letter-spacing: 0.35em;
    padding-left: 0.35em;   /* balance the trailing letter-spacing so it centres */
    text-transform: uppercase;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: inherit;
    pointer-events: none;
  }
  /* When a caption carries a url it becomes a clickable link (e.g. UniProt). */
  a.ap-caption--link {
    pointer-events: auto;
    cursor: pointer;
    text-decoration: none;
    transition: opacity 0.15s ease;
  }
  a.ap-caption--link:hover {
    opacity: 0.7;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .ap-loading {
    position: absolute;
    z-index: 2;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.2em;
    opacity: 0.6;
  }
</style>

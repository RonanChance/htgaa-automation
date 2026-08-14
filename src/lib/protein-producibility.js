import { HYDROPATHY } from './protein-catalog.js';

// Dipeptide instability weights (Guruprasad et al. 1990). Missing pairs default to 1.
// Compressed table; only nonzero entries matter for the final divide.
const DIWV = {
    W: { W: 1.0,  C: 1.0,  M: 24.68, H: 24.68, Y: 1.0,  F: 1.0,  Q: 1.0,  N: 13.34, I: 1.0,  R: 1.0,  D: 1.0,  P: 1.0,  T: -14.03, K: 1.0,  E: 1.0,  V: -7.49, S: 1.0,  G: -9.37, A: -14.03, L: 13.34 },
    C: { W: 24.68, C: 1.0,  M: 33.60, H: 33.60, Y: 1.0,  F: 1.0,  Q: -6.54, N: 1.0,  I: 1.0,  R: 1.0,  D: 20.26, P: 20.26, T: 33.60, K: 1.0,  E: 1.0,  V: -6.54, S: 1.0,  G: 1.0,  A: 1.0,  L: 20.26 },
    M: { W: 1.0,  C: 1.0,  M: -1.88, H: 58.28, Y: 24.68, F: 1.0,  Q: -6.54, N: 1.0,  I: 1.0,  R: -6.54, D: 1.0,  P: 44.94, T: -1.88, K: 1.0,  E: 1.0,  V: 1.0,  S: 1.0,  G: 1.0,  A: 13.34, L: 1.0 },
    H: { W: -1.88, C: 1.0,  M: 1.0,  H: 1.0,  Y: 44.94, F: -9.37, Q: 1.0,  N: 24.68, I: 44.94, R: 1.0,  D: 1.0,  P: -1.88, T: -6.54, K: 24.68, E: 1.0,  V: 1.0,  S: 1.0,  G: -9.37, A: 1.0,  L: 1.0 },
    Y: { W: -9.37, C: 1.0,  M: 44.94, H: 13.34, Y: 13.34, F: 1.0,  Q: 1.0,  N: 1.0,  I: 1.0,  R: -15.91, D: 24.68, P: 13.34, T: -7.49, K: 1.0,  E: -6.54, V: 1.0,  S: 1.0,  G: -7.49, A: 24.68, L: 1.0 },
    F: { W: 1.0,  C: 1.0,  M: 1.0,  H: 1.0,  Y: 33.60, F: 1.0,  Q: 1.0,  N: 1.0,  I: 1.0,  R: 1.0,  D: 13.34, P: 20.26, T: 1.0,  K: -14.03, E: 1.0,  V: 1.0,  S: 1.0,  G: 1.0,  A: 1.0,  L: 1.0 },
    Q: { W: 1.0,  C: -6.54, M: 1.0,  H: 1.0,  Y: -6.54, F: -6.54, Q: 20.26, N: 1.0,  I: 1.0,  R: 1.0,  D: 20.26, P: 20.26, T: 1.0,  K: 1.0,  E: 20.26, V: -6.54, S: 44.94, G: 1.0,  A: 1.0,  L: 1.0 },
    N: { W: -9.37, C: -1.88, M: 1.0,  H: 1.0,  Y: 1.0,  F: -14.03, Q: -6.54, N: 1.0,  I: 44.94, R: 1.0,  D: 1.0,  P: -1.88, T: -7.49, K: 24.68, E: 1.0,  V: 1.0,  S: 1.0,  G: -14.03, A: 1.0,  L: 1.0 },
    I: { W: 1.0,  C: 1.0,  M: 1.0,  H: 13.34, Y: 1.0,  F: 1.0,  Q: 1.0,  N: 1.0,  I: 1.0,  R: 1.0,  D: 1.0,  P: -1.88, T: 1.0,  K: -7.49, E: 44.94, V: -7.49, S: 1.0,  G: 1.0,  A: 1.0,  L: 20.26 },
    R: { W: 58.28, C: 1.0,  M: 1.0,  H: 20.26, Y: -6.54, F: 1.0,  Q: 20.26, N: 13.34, I: 1.0,  R: 58.28, D: 1.0,  P: 20.26, T: 1.0,  K: 1.0,  E: 1.0,  V: 1.0,  S: 44.94, G: -7.49, A: 1.0,  L: 1.0 },
    D: { W: 1.0,  C: 1.0,  M: 1.0,  H: 1.0,  Y: 1.0,  F: -6.54, Q: 1.0,  N: 1.0,  I: 1.0,  R: -6.54, D: 1.0,  P: 1.0,  T: -14.03, K: -7.49, E: 1.0,  V: 1.0,  S: -20.26, G: 1.0,  A: 1.0,  L: 1.0 },
    P: { W: -1.88, C: -6.54, M: -6.54, H: 1.0,  Y: 1.0,  F: 20.26, Q: 20.26, N: 1.0,  I: 1.0,  R: -6.54, D: -6.54, P: 20.26, T: 1.0,  K: 1.0,  E: 18.38, V: 20.26, S: 20.26, G: 1.0,  A: 20.26, L: 1.0 },
    T: { W: -14.03, C: 1.0,  M: 1.0,  H: 1.0,  Y: 1.0,  F: 13.34, Q: -6.54, N: -14.03, I: 1.0,  R: 1.0,  D: 1.0,  P: 1.0,  T: 1.0,  K: 1.0,  E: 20.26, V: 1.0,  S: 1.0,  G: -7.49, A: 1.0,  L: 1.0 },
    K: { W: 1.0,  C: 1.0,  M: 33.60, H: 1.0,  Y: 1.0,  F: 1.0,  Q: 24.64, N: 1.0,  I: -7.49, R: 33.60, D: 1.0,  P: -6.54, T: 1.0,  K: 1.0,  E: 1.0,  V: -7.49, S: 1.0,  G: -7.49, A: 1.0,  L: -7.49 },
    E: { W: -14.03, C: 44.94, M: 1.0,  H: -6.54, Y: 1.0,  F: 1.0,  Q: 20.26, N: 1.0,  I: 20.26, R: 1.0,  D: 20.26, P: 20.26, T: 1.0,  K: 1.0,  E: 33.60, V: 1.0,  S: 20.26, G: 1.0,  A: 1.0,  L: 1.0 },
    V: { W: 1.0,  C: 1.0,  M: 1.0,  H: 1.0,  Y: -6.54, F: 1.0,  Q: 1.0,  N: 1.0,  I: 1.0,  R: 1.0,  D: -14.03, P: 20.26, T: -7.49, K: -1.88, E: 1.0,  V: 1.0,  S: 1.0,  G: -7.49, A: 1.0,  L: 1.0 },
    S: { W: 1.0,  C: 33.60, M: 1.0,  H: 1.0,  Y: 1.0,  F: 1.0,  Q: 20.26, N: 1.0,  I: 1.0,  R: 20.26, D: 1.0,  P: 44.94, T: 1.0,  K: 20.26, E: 20.26, V: 1.0,  S: 20.26, G: 1.0,  A: 1.0,  L: 1.0 },
    G: { W: 13.34, C: 1.0,  M: 1.0,  H: 1.0,  Y: -7.49, F: 1.0,  Q: 1.0,  N: -7.49, I: -7.49, R: 1.0,  D: 1.0,  P: 1.0,  T: -7.49, K: -7.49, E: -6.54, V: 1.0,  S: 1.0,  G: 13.34, A: -7.49, L: 1.0 },
    A: { W: 1.0,  C: 44.94, M: 1.0,  H: -7.49, Y: 1.0,  F: 1.0,  Q: 1.0,  N: 1.0,  I: 1.0,  R: 1.0,  D: -7.49, P: 20.26, T: 1.0,  K: 1.0,  E: 1.0,  V: 1.0,  S: 1.0,  G: 1.0,  A: 1.0,  L: 1.0 },
    L: { W: 24.68, C: 1.0,  M: 1.0,  H: 1.0,  Y: 1.0,  F: 1.0,  Q: 33.60, N: 1.0,  I: 1.0,  R: 20.26, D: 1.0,  P: 20.26, T: 1.0,  K: -7.49, E: 1.0,  V: 1.0,  S: 1.0,  G: 1.0,  A: 1.0,  L: 1.0 }
};

export function computeGravy(seq) {
    if (!seq.length) return 0;
    let sum = 0;
    let n = 0;
    for (const aa of seq) {
        if (aa in HYDROPATHY) { sum += HYDROPATHY[aa]; n += 1; }
    }
    return n ? sum / n : 0;
}

export function countCys(seq) {
    let n = 0;
    for (const aa of seq) if (aa === 'C') n += 1;
    return n;
}

// Rare-codon proxy for E. coli: Arg (AGA/AGG), Ile (AUA), Leu (CUA) are the
// classically depleted tRNAs. We approximate by density of R+I+L above a base
// rate. Real answer needs the DNA sequence; this is a rough heuristic.
export function rareCodonProxy(seq) {
    if (!seq.length) return 0;
    let n = 0;
    for (const aa of seq) if (aa === 'R' || aa === 'I' || aa === 'L') n += 1;
    return n / seq.length;
}

export function instabilityIndex(seq) {
    if (seq.length < 2) return 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < seq.length - 1; i += 1) {
        const a = seq[i];
        const b = seq[i + 1];
        const w = DIWV[a]?.[b];
        if (w !== undefined) { sum += w; n += 1; }
    }
    return n ? (10 / seq.length) * sum : 0;
}

// Each factor 0..20; sum is the 0..100 producibility score. Higher = easier.
export function producibilityScore(seq) {
    const s = (seq || '').toUpperCase().replace(/[^A-Z]/g, '');
    const len = s.length;
    const gravy = computeGravy(s);
    const cys = countCys(s);
    const rare = rareCodonProxy(s);
    const inst = instabilityIndex(s);

    // Length: ideal 80–350 aa. Penalize outside.
    let lenScore;
    if (len === 0) lenScore = 0;
    else if (len < 80) lenScore = Math.max(0, 20 - (80 - len) * 0.2);
    else if (len <= 350) lenScore = 20;
    else if (len <= 600) lenScore = Math.max(0, 20 - (len - 350) * 0.03);
    else lenScore = Math.max(0, 12 - (len - 600) * 0.02);

    // Cys: E. coli cytoplasm is reducing (DsbA/B in periplasm only). Even Cys
    // count often survives; odd/many Cys are trouble.
    const cysScore = Math.max(0, 20 - Math.max(0, cys - 2) * 3);

    // GRAVY: sweet spot around -0.5 (soluble). Very positive = aggregation.
    let gravyScore;
    if (gravy <= -1.5) gravyScore = Math.max(0, 20 - (-1.5 - gravy) * 8);
    else if (gravy <= 0) gravyScore = 20;
    else gravyScore = Math.max(0, 20 - gravy * 12);

    // Rare-codon proxy: penalize above 0.22 R+I+L density.
    let rareScore;
    if (rare <= 0.22) rareScore = 20;
    else rareScore = Math.max(0, 20 - (rare - 0.22) * 100);

    // Instability index: <40 = stable (Guruprasad); >40 = predicted unstable.
    let instScore;
    if (inst <= 40) instScore = 20;
    else instScore = Math.max(0, 20 - (inst - 40) * 0.4);

    const score = Math.round(lenScore + cysScore + gravyScore + rareScore + instScore);

    return {
        score,
        factors: [
            { label: 'Length',   value: len,               score: Math.round(lenScore),   fmt: `${len}` },
            { label: 'GRAVY',    value: gravy,             score: Math.round(gravyScore), fmt: gravy.toFixed(2) },
            { label: 'Cys',      value: cys,               score: Math.round(cysScore),   fmt: `${cys}` },
            { label: 'Rare R+I+L', value: rare,            score: Math.round(rareScore),  fmt: `${(rare * 100).toFixed(0)}%` },
            { label: 'Instab.',  value: inst,              score: Math.round(instScore),  fmt: inst.toFixed(0) }
        ]
    };
}

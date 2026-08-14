#!/usr/bin/env node
// Build script: fetch FPbase → derive lineage → compute 3D layout →
// write static/starfield.json for the /starfield route.
//
// Run: `node scripts/build-starfield-data.mjs`
// Output: `static/starfield.json` (~500 KB)
//
// Deterministic: seeded PRNG (mulberry32) means same input → identical output.
// Node 18+ required (native fetch).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LINEAGE_ANCHORS, ANCHOR_POSITIONS, SUN_SLUGS } from '../src/lib/starfield-lineage.js';

const SEED = 42;
const FPBASE_URL = 'https://www.fpbase.org/api/proteins/?format=json';
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'starfield.json');

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(SEED);

// ---------- wavelength → sRGB (Bruton 1996) ----------
// Approximates the CIE 1931 spectral locus for visible light 380–780 nm.
function wavelengthToRGB(nm) {
    if (nm == null) return [0.5, 0.5, 0.5];
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440)      { r = -(nm - 440) / 60; g = 0; b = 1; }
    else if (nm >= 440 && nm < 490) { r = 0; g = (nm - 440) / 50; b = 1; }
    else if (nm >= 490 && nm < 510) { r = 0; g = 1; b = -(nm - 510) / 20; }
    else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1; b = 0; }
    else if (nm >= 580 && nm < 645) { r = 1; g = -(nm - 645) / 65; b = 0; }
    else if (nm >= 645 && nm <= 780) { r = 1; g = 0; b = 0; }
    // Attenuate at edges of visible range
    let factor = 1;
    if (nm >= 380 && nm < 420) factor = 0.3 + 0.7 * (nm - 380) / 40;
    else if (nm >= 700 && nm <= 780) factor = 0.3 + 0.7 * (780 - nm) / 80;
    const gamma = 0.8;
    return [
        Math.pow(r * factor, gamma),
        Math.pow(g * factor, gamma),
        Math.pow(b * factor, gamma)
    ];
}

// ---------- k-mer Jaccard similarity ----------
function kmerSet(seq, k = 4) {
    const s = new Set();
    if (!seq || seq.length < k) return s;
    for (let i = 0; i <= seq.length - k; i++) s.add(seq.slice(i, i + k));
    return s;
}
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    const smaller = a.size < b.size ? a : b;
    const larger = a.size < b.size ? b : a;
    for (const v of smaller) if (larger.has(v)) inter++;
    return inter / (a.size + b.size - inter);
}

// ---------- fetch + normalize FPbase records ----------
async function loadFPbase() {
    const res = await fetch(FPBASE_URL);
    if (!res.ok) throw new Error(`FPbase HTTP ${res.status}`);
    const raw = await res.json();
    const out = [];
    for (const p of raw) {
        if (!p.seq || !p.states || !p.states.length) continue;
        const defaultState = p.states.find((s) => s.em_max && !s.is_dark) || p.states[0];
        if (!defaultState || !defaultState.em_max) continue;
        out.push({
            slug: p.slug,
            name: p.name,
            seq: p.seq,
            pdb: Array.isArray(p.pdb) ? p.pdb : [],
            agg: p.agg || '',
            switchType: p.switch_type || 'b',
            emMax: defaultState.em_max,
            exMax: defaultState.ex_max,
            brightness: defaultState.brightness,
            qy: defaultState.qy,
            extCoeff: defaultState.ext_coeff
        });
    }
    return out;
}

// ---------- assign lineage: curated first, similarity fallback ----------
function assignLineage(proteins) {
    console.log('  precomputing k-mer sets…');
    const kmers = new Map();
    for (const p of proteins) kmers.set(p.slug, kmerSet(p.seq, 4));

    const bySlug = new Map(proteins.map((p) => [p.slug, p]));
    let curated = 0, similar = 0, orphan = 0;

    for (const p of proteins) {
        // 1. Curated
        if (LINEAGE_ANCHORS[p.slug] && bySlug.has(LINEAGE_ANCHORS[p.slug])) {
            p.parent = LINEAGE_ANCHORS[p.slug];
            p.lineageSource = 'curated';
            curated++;
            continue;
        }
        // 2. Similarity fallback: highest-Jaccard neighbor with brightness ≥ this * 0.7
        const mine = kmers.get(p.slug);
        const myBrightness = p.brightness ?? 0;
        let bestSim = 0, bestSlug = null;
        for (const q of proteins) {
            if (q.slug === p.slug) continue;
            const theirBright = q.brightness ?? 0;
            if (theirBright < myBrightness * 0.7) continue;
            const sim = jaccard(mine, kmers.get(q.slug));
            if (sim > bestSim) { bestSim = sim; bestSlug = q.slug; }
        }
        if (bestSim >= 0.35) {
            p.parent = bestSlug;
            p.lineageSource = 'similarity';
            similar++;
        } else {
            p.parent = null;
            p.lineageSource = 'orphan';
            orphan++;
        }
    }
    console.log(`  lineage: ${curated} curated, ${similar} similarity, ${orphan} orphan`);
}

// ---------- force-directed 3D layout (Fruchterman-Reingold style) ----------
// Per-iteration displacement calculated from all forces, then applied with
// cooling. No persistent velocity — that leads to runaway acceleration.
// Anchors are pinned (displacement zeroed).
function computeLayout(proteins) {
    console.log('  initializing positions…');
    for (const p of proteins) {
        if (ANCHOR_POSITIONS[p.slug]) {
            const a = ANCHOR_POSITIONS[p.slug];
            p.x = a.x; p.y = a.y; p.z = a.z;
            p.anchored = true;
        } else {
            // Jitter around parent if known and parent has a position, else random shell
            const parent = p.parent ? proteins.find((q) => q.slug === p.parent) : null;
            const seedX = parent && ANCHOR_POSITIONS[parent.slug] ? ANCHOR_POSITIONS[parent.slug].x : 0;
            const seedY = parent && ANCHOR_POSITIONS[parent.slug] ? ANCHOR_POSITIONS[parent.slug].y : 0;
            const seedZ = parent && ANCHOR_POSITIONS[parent.slug] ? ANCHOR_POSITIONS[parent.slug].z : 0;
            p.x = seedX + (rand() - 0.5) * 40;
            p.y = seedY + (rand() - 0.5) * 30;
            p.z = seedZ + (rand() - 0.5) * 40;
            p.anchored = false;
        }
    }

    const bySlug = new Map(proteins.map((p) => [p.slug, p]));
    const N = proteins.length;

    // Force constants
    const iterations = 200;
    const kRepel = 30.0;            // Coulomb constant
    const repelCutoff = 12;         // ignore pairs farther than this
    const kSpring = 0.5;            // Hooke stiffness for parent-child
    const springLen = 4.0;          // natural length
    const kGravity = 0.008;         // gentle pull to origin (prevents drift)
    const maxDisp = 4.0;            // per-iteration displacement cap

    console.log(`  running force sim (${iterations} iterations, N=${N})…`);

    const dispX = new Float32Array(N);
    const dispY = new Float32Array(N);
    const dispZ = new Float32Array(N);

    for (let iter = 0; iter < iterations; iter++) {
        const t = iter / iterations;
        // Cooling: displacement magnitude cap shrinks over time so late iters settle
        const temperature = maxDisp * (1 - t) + 0.15 * t;

        dispX.fill(0); dispY.fill(0); dispZ.fill(0);

        // Repulsion (only local pairs — cutoff makes O(N²) tractable at ~5ms/iter)
        for (let i = 0; i < N; i++) {
            const a = proteins[i];
            for (let j = i + 1; j < N; j++) {
                const b = proteins[j];
                let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > repelCutoff * repelCutoff) continue;
                let d = Math.sqrt(d2);
                if (d < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; dz = rand() - 0.5; d = 1; }
                const f = kRepel / (d * d);
                const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
                dispX[i] += fx; dispY[i] += fy; dispZ[i] += fz;
                dispX[j] -= fx; dispY[j] -= fy; dispZ[j] -= fz;
            }
        }

        // Parent-child spring (attractive, snaps to natural length)
        for (let i = 0; i < N; i++) {
            const p = proteins[i];
            if (!p.parent) continue;
            const q = bySlug.get(p.parent);
            if (!q) continue;
            const j = proteins.indexOf(q);
            const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
            const f = kSpring * (d - springLen);           // attracts if too far, repels if too close
            const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
            dispX[i] += fx; dispY[i] += fy; dispZ[i] += fz;
            // Parents feel half the pull (they're the "sun")
            dispX[j] -= fx * 0.5; dispY[j] -= fy * 0.5; dispZ[j] -= fz * 0.5;
        }

        // Gentle central gravity (keeps cloud bounded)
        for (let i = 0; i < N; i++) {
            const p = proteins[i];
            dispX[i] -= p.x * kGravity;
            dispY[i] -= p.y * kGravity;
            dispZ[i] -= p.z * kGravity;
        }

        // Integrate with temperature cap; anchors held in place
        for (let i = 0; i < N; i++) {
            const p = proteins[i];
            if (p.anchored) continue;
            const dx = dispX[i], dy = dispY[i], dz = dispZ[i];
            const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dLen < 0.0001) continue;
            const cap = Math.min(dLen, temperature);
            p.x += (dx / dLen) * cap;
            p.y += (dy / dLen) * cap;
            p.z += (dz / dLen) * cap;
        }
    }

    // Report final bounds (no rescaling — anchor positions define our scale)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of proteins) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    console.log(`  final bounds: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}]  Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}]  Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
}

// ---------- edge geometry: straight lines, one per parent→child pair ----------
function buildEdgeGeometry(proteins) {
    const bySlug = new Map(proteins.map((p) => [p.slug, p]));
    const edges = [];
    for (const p of proteins) {
        if (!p.parent) continue;
        const q = bySlug.get(p.parent);
        if (!q) continue;
        edges.push([p, q]);
    }
    // LineSegments consumes vertex pairs: [start, end, start, end, ...]
    const positions = new Float32Array(edges.length * 2 * 3);
    const alphas = new Float32Array(edges.length * 2);
    let pi = 0, ai = 0;
    for (const [child, parent] of edges) {
        positions[pi++] = child.x; positions[pi++] = child.y; positions[pi++] = child.z;
        positions[pi++] = parent.x; positions[pi++] = parent.y; positions[pi++] = parent.z;
        alphas[ai++] = 0.22;
        alphas[ai++] = 0.22;
    }
    return { positions, alphas, edgeCount: edges.length };
}

// ---------- Float32Array → base64 (for compact JSON transport) ----------
function f32ToBase64(arr) {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    return buf.toString('base64');
}

// ---------- main ----------
async function main() {
    console.log('Fetching FPbase…');
    const proteins = await loadFPbase();
    console.log(`  ${proteins.length} FPs with sequence + emission wavelength`);

    console.log('Assigning lineage…');
    assignLineage(proteins);

    console.log('Computing wavelength colors…');
    for (const p of proteins) p.color = wavelengthToRGB(p.emMax);

    console.log('Running 3D force layout…');
    computeLayout(proteins);

    console.log('Building edge geometry…');
    const { positions, alphas, edgeCount } = buildEdgeGeometry(proteins);
    console.log(`  ${edgeCount} lineage edges → ${positions.length / 3} vertices`);

    // Final node payload (strip internal fields)
    const nodes = proteins.map((p) => ({
        slug: p.slug,
        name: p.name,
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        z: +p.z.toFixed(3),
        color: p.color.map((c) => +c.toFixed(3)),
        brightness: p.brightness,
        emMax: p.emMax,
        exMax: p.exMax,
        qy: p.qy,
        extCoeff: p.extCoeff,
        agg: p.agg,
        switchType: p.switchType,
        pdb: p.pdb,
        parent: p.parent,
        lineageSource: p.lineageSource,
        isSun: SUN_SLUGS.has(p.slug)
    }));

    const output = {
        generated: new Date().toISOString(),
        seed: SEED,
        source: 'FPbase API (https://www.fpbase.org/api/proteins/)',
        nodeCount: nodes.length,
        edgeCount,
        nodes,
        edgePositions: f32ToBase64(positions),
        edgeAlphas: f32ToBase64(alphas)
    };

    writeFileSync(OUTPUT, JSON.stringify(output));
    const kb = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1);
    console.log(`\n✓ Wrote ${OUTPUT} (${kb} KB)`);
    console.log(`  ${nodes.length} nodes, ${edgeCount} edges`);
}

main().catch((err) => {
    console.error('BUILD FAILED:', err);
    process.exit(1);
});

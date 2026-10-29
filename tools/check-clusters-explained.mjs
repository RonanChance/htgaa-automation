#!/usr/bin/env node
/**
 * Check src/lib/clusterMath.js against the CFPS Arena export.
 *
 * /cfps/clusters-explained recomputes every link in the browser from the
 * Gaussian process instead of shipping the export's link matrix. This script
 * makes sure that is honest: it rebuilds each protein's full link matrix from
 * the recipes and compares it with the matrix the exporter wrote
 * (clusters.json → tips[t].C, rounded to two decimals).
 *
 *   npm run clusters:fetch -- --pb        # once, to get data/cfps-clusters/
 *   node tools/check-clusters-explained.mjs [--arena=<data.json path or URL>]
 */

import fs from 'node:fs';
import {
  concOf, xOf, novelDirs, ready, linkMatrix, nEff, completeLinkage, groupsAt, dist2
} from '../src/lib/clusterMath.js';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const DIR = arg('dir', 'data/cfps-clusters');
const ARENA = arg('arena', 'https://pages.htgaa.org/2026b/clinton-monteiro/week-3/cfps-arena/data.json');

const A = ARENA.startsWith('http')
  ? await (await fetch(ARENA)).json()
  : JSON.parse(fs.readFileSync(ARENA, 'utf8'));
const designsFile = JSON.parse(fs.readFileSync(`${DIR}/clusters_designs.json`, 'utf8'));
const clusters = JSON.parse(fs.readFileSync(`${DIR}/clusters.json`, 'utf8'));

console.log(`export built ${designsFile.built} · arena model ${A.generated}`);
if (designsFile.built !== A.generated) console.log('  ! different builds — expect some drift');

const stock = Object.fromEntries(A.reagents.map((r) => [r.id, r.stockVal]));
let failed = false;

for (const [key, prot] of [['sfgfp', 'sfGFP'], ['petase', 'PETase'], ['reteplase', 'Reteplase']]) {
  const T = A.targets[key];
  const gp = { ...T.gp, sigmaLysate: T.sigmaLysate || 0 };
  const P = designsFile.proteins[prot];
  const tip = clusters.tips[key];

  // tips are ordered by name ("Author · id prefix"), the designs file by id.
  const byPrefix = new Map(P.designs.map((d) => [d.id.slice(0, 6), d]));
  const ordered = tip.names.map((n) => byPrefix.get(n.split(' · ').pop()));
  if (ordered.some((d) => !d)) throw new Error(`${prot}: could not align tips to designs`);

  const ds = ordered.map((d) => {
    const conc = concOf(d.recipeNl, stock, A.settings.wellNl);
    return ready(gp, A.settings, xOf(gp, conc), novelDirs(gp, A.settings, stock, key, conc));
  });
  const { n, R } = linkMatrix(gp, A.settings, ds);

  let maxErr = 0, worst = null, over = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const e = Math.abs(R[i * n + j] - tip.C[i][j]);
    if (e > maxErr) { maxErr = e; worst = [i, j, R[i * n + j], tip.C[i][j]]; }
    if (e > 0.0051) over++;
  }

  // The GP's training rows should be exactly Ginkgo's conditions, transformed.
  let ctrlErr = 0;
  T.conditions.forEach((c, i) => {
    const x = xOf(gp, concOf(c.recipe ?? {}, stock, A.settings.wellNl));
    ctrlErr = Math.max(ctrlErr, Math.min(...gp.X.map((row) => dist2(x, row))));
  });

  // Groups: complete linkage at 0.5, minus groups of one repeated recipe.
  const recipeKey = (d) => JSON.stringify(Object.entries(d.recipeNl).filter(([, v]) => v > 0).sort());
  const firstOf = new Map();
  const recipeClass = ordered.map((d, i) => {
    const k = recipeKey(d);
    if (!firstOf.has(k)) firstOf.set(k, i);
    return firstOf.get(k);
  });
  const merges = completeLinkage(n, R);
  const labels = groupsAt(n, merges, 0.5, recipeClass);
  const mine = new Map();
  labels.forEach((l, i) => { if (l >= 0) { if (!mine.has(l)) mine.set(l, []); mine.get(l).push(i); } });
  const sig = (m) => [...m].sort((a, b) => a - b).join(',');
  const theirs = new Set(tip.K.map((g) => sig(g.m)));
  const same = [...mine.values()].filter((m) => theirs.has(sig(m))).length;
  const groupsOk = same === tip.K.length && mine.size === tip.K.length;

  const ok = over === 0 && groupsOk;
  failed ||= !ok;
  console.log(`\n${prot}: ${n} designs`);
  console.log(`  links  max |Δ| ${maxErr.toFixed(4)} vs export (${over} pairs beyond rounding) ${over ? '✗' : '✓'}`);
  if (over) console.log('  worst', worst);
  console.log(`  groups ${mine.size} rebuilt, ${same} identical to the export's ${tip.K.length} ${groupsOk ? '✓' : '✗'}`);
  console.log(`  controls → nearest GP row, max squared distance ${ctrlErr.toExponential(2)}`);
  console.log(`  ~${nEff(R, n).toFixed(1)} independent experiments`);
}

process.exit(failed ? 1 : 0);

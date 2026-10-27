#!/usr/bin/env node
// Keep ginkgo-artworks in step with the autonomous-cfps pydantic model.
//
// Two things are synced from one extraction:
//   1. The validation CONTRACT (field names, 25 nL grid, 20 µL total, template
//      rules) is written to src/lib/cfpsReagentSpec.generated.json, which the app
//      imports. This is committed and ships on the next deploy (validation logic
//      stays reviewable in git).
//   2. The per-reagent COSTS are pushed straight into the live PocketBase
//      cfps_reagent_groups record (costPerMl <- model cost_ginkgo), so cost
//      changes are near-instant on the running site with no rebuild.
//
// Usage:
//   node tools/sync-cfps.mjs            # dry run: regen JSON, print the PB cost diff
//   node tools/sync-cfps.mjs --apply    # also write the costs to live PocketBase
//   node tools/sync-cfps.mjs --no-pb    # only regenerate the committed JSON
//   node tools/sync-cfps.mjs --cost-field=cost   # sync `cost` instead of cost_ginkgo
//
// Requires: uv on PATH, an autonomous-cfps checkout (AUTONOMOUS_CFPS_PATH, default
// ../autonomous-cfps), and PB_EMAIL / PB_PASSWORD (from env or the repo .env).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { REAGENT_ID_TO_PYDANTIC } from '../src/lib/cfpsReagentIdMap.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_OUT = path.join(REPO_ROOT, 'src/lib/cfpsReagentSpec.generated.json');
// Range-check parity fixtures (recipes + the flags the real autonomous-cfps code
// raises). Test-only, so they live outside src/ and never reach the bundle.
const FIXTURES_OUT = path.join(REPO_ROOT, 'tools/fixtures/cfps-range-checks.fixtures.json');
const EXTRACTOR = path.join(REPO_ROOT, 'tools/extract_cfps_spec.py');
const BACKUP_DIR = path.join(REPO_ROOT, 'scripts/pb-backups');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NO_PB = args.includes('--no-pb');
const COST_FIELD = (args.find((a) => a.startsWith('--cost-field=')) || '').split('=')[1] || 'cost_ginkgo';

const AUTONOMOUS_CFPS_PATH = process.env.AUTONOMOUS_CFPS_PATH || path.resolve(REPO_ROOT, '..', 'autonomous-cfps');
const PB_URL = process.env.PB_URL || 'https://db.rcdonovan.com';
const COLLECTION = process.env.CFPS_COLLECTION_REAGENT_GROUPS || 'cfps_reagent_groups';
const RECORD_ID = process.env.CFPS_REAGENT_GROUPS_RECORD_ID || 't7a97pyfs8lx67w';

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;

// Minimal .env loader (KEY=VALUE lines). Never logs values. Only fills vars that
// aren't already set in the environment. Enough to pick up PB creds locally.
function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// 1. Extract the spec from the pydantic model and write the committed JSON.
function regenerateSpec() {
  if (!fs.existsSync(EXTRACTOR)) throw new Error(`Extractor not found: ${EXTRACTOR}`);
  if (!fs.existsSync(AUTONOMOUS_CFPS_PATH)) {
    throw new Error(
      `autonomous-cfps checkout not found at ${AUTONOMOUS_CFPS_PATH}. Set AUTONOMOUS_CFPS_PATH.`
    );
  }
  console.log(`• Extracting spec from ${AUTONOMOUS_CFPS_PATH} …`);
  const stdout = execFileSync(
    'uv',
    ['run', '--project', AUTONOMOUS_CFPS_PATH, 'python', EXTRACTOR],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  const spec = JSON.parse(stdout); // parse to validate before writing
  // Costs stay in PocketBase only: strip them before writing the committed file
  // (it is imported by the browser bundle). The full spec, costs included, is
  // returned in memory for the PB cost diff below.
  const { rangeCheckFixtures, ...rest } = spec;
  fs.writeFileSync(SPEC_OUT, JSON.stringify(contractOnly(rest), null, 2) + '\n');
  if (rangeCheckFixtures) {
    fs.mkdirSync(path.dirname(FIXTURES_OUT), { recursive: true });
    fs.writeFileSync(FIXTURES_OUT, JSON.stringify(rangeCheckFixtures, null, 2) + '\n');
    console.log(`  wrote ${path.relative(REPO_ROOT, FIXTURES_OUT)} — ${rangeCheckFixtures.length} range-check fixtures`);
  }
  console.log(
    `  wrote ${path.relative(REPO_ROOT, SPEC_OUT)} — ${spec.fieldCount} fields, source ${
      (spec.sourceCommit || 'unknown').slice(0, 8)
    }`
  );
  return spec;
}

// Drop every cost field from the spec, keeping keys sorted so the committed file
// has stable, review-friendly diffs.
function contractOnly(spec) {
  const fields = {};
  for (const name of Object.keys(spec.fields).sort()) {
    const { cost, cost_ginkgo, ...rest } = spec.fields[name];
    fields[name] = rest;
  }
  return { ...spec, fields };
}

// 2. Diff model costs against the live PB reagent-groups record.
function computeCostDiff(spec, flatReagents) {
  const changes = [];
  const untouched = [];
  let same = 0;
  for (const r of flatReagents) {
    const field = REAGENT_ID_TO_PYDANTIC[r.id] || r.id;
    const modelField = spec.fields[field];
    const modelCost = modelField ? modelField[COST_FIELD] : undefined;
    if (modelCost == null) {
      untouched.push(r.id);
      continue;
    }
    const cur = Number(r.costPerMl);
    const next = round6(modelCost);
    if (cur !== next) changes.push({ id: r.id, field, from: cur, to: next, ref: r });
    else same += 1;
  }
  return { changes, untouched, same };
}

async function main() {
  loadDotEnv();

  const spec = regenerateSpec();

  if (NO_PB) {
    console.log('• --no-pb: skipping PocketBase cost sync.');
    return;
  }

  if (!process.env.PB_EMAIL || !process.env.PB_PASSWORD) {
    throw new Error('PB_EMAIL / PB_PASSWORD not set (env or .env) — needed for the PocketBase cost sync.');
  }

  const pb = new PocketBase(PB_URL);
  await pb.collection('_superusers').authWithPassword(process.env.PB_EMAIL, process.env.PB_PASSWORD);
  const record = await pb.collection(COLLECTION).getOne(RECORD_ID);

  const reagentsWasString = typeof record.reagents === 'string';
  const reagents = reagentsWasString ? JSON.parse(record.reagents) : record.reagents;
  if (!Array.isArray(reagents)) throw new Error('Unexpected shape: record.reagents is not an array of groups.');
  const flat = reagents.flatMap((g) => g.reagents || g.items || []);

  const { changes, untouched, same } = computeCostDiff(spec, flat);

  console.log(`\n• Cost sync (costPerMl ← model ${COST_FIELD}) against ${COLLECTION}/${RECORD_ID}`);
  for (const c of changes) {
    console.log(`    ${c.id.padEnd(48)} ${String(c.from).padStart(12)} → ${c.to}`);
  }
  console.log(
    `\n  ${changes.length} change(s), ${same} already-matching, ${untouched.length} PB reagent(s) not in model (left untouched).`
  );
  if (untouched.length) console.log(`  untouched: ${untouched.join(', ')}`);

  if (!changes.length) {
    console.log('\n✓ PocketBase costs already match the model. Nothing to write.');
    return;
  }

  if (!APPLY) {
    console.log('\n(dry run) — re-run with --apply to write these costs to live PocketBase.');
    return;
  }

  // Back up the current record before mutating live data.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `${COLLECTION}-${RECORD_ID}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(record, null, 2) + '\n');
  console.log(`\n• Backed up current record → ${path.relative(REPO_ROOT, backupPath)}`);

  // Apply in place (each change.ref is a live object inside `reagents`).
  for (const c of changes) c.ref.costPerMl = c.to;
  await pb.collection(COLLECTION).update(RECORD_ID, {
    reagents: reagentsWasString ? JSON.stringify(reagents) : reagents
  });
  console.log(`✓ Applied ${changes.length} cost update(s) to live PocketBase.`);
}

main().catch((err) => {
  console.error('\n✗ sync-cfps failed:', err?.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * CFPS cluster data: fetch it for analysis, publish it, or refresh it end-to-end.
 *
 * The cluster export names every coopetition design with its author, sample_id,
 * recipe and model forecast, so it is deliberately NOT in this repo (public) and
 * NOT in static/ (world-readable). It lives as gzipped attachments on the
 * superuser-only `cfps_cluster_data` PocketBase collection, and reaches the
 * browser through /cfps/clusters-data/<file>, which checks the Keycloak session.
 *
 * This script is the way in and out of that store.
 *
 *   # analysts: pull the data to ./data/cfps-clusters/ and start poking at it
 *   npm run clusters:fetch -- --token=$CFPS_TOKEN
 *
 *   # publish a new export you have on disk
 *   npm run clusters:publish -- --dir=<export dir> --apply
 *
 *   # run the CFPS Arena exporter, then publish what it produced
 *   npm run clusters:refresh -- --arena=../cfps-arena --apply
 *
 * Add --help to any of them.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const SITE = process.env.CFPS_SITE || 'https://coopetition.htgaa.org';
const PB_URL = process.env.PB_URL || 'https://db.rcdonovan.com';
const COLLECTION = 'cfps_cluster_data';
const OUT_DIR_DEFAULT = 'data/cfps-clusters';

// What the exporter produces → how it is stored and served.
//   key      the `key` field on the PocketBase record
//   src      the exporter's filename
//   served   the name the website serves it under
//   gzipped  true when the exporter already gzipped it
const FILES = [
  { key: 'clusters', src: 'clusters.json.gz', served: 'clusters.json.gz', gzipped: true },
  { key: 'designs', src: 'clusters_designs.json', served: 'clusters_designs.json', gzipped: false }
];

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || '';
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

function usage(code = 0) {
  console.log(`
cfps-clusters — fetch / publish / refresh the CFPS Arena cluster export

  fetch      download the data for local analysis
             --token=<agent token>   a CFPS agent token (Participate → Agent on
                                     the site). Easiest option: no PocketBase
                                     credentials needed.
             --pb                    use PB_EMAIL / PB_PASSWORD instead
             --out=<dir>             default ${OUT_DIR_DEFAULT}
             --raw                   keep the gzip, don't unpack

  publish    upload an export to PocketBase
             --dir=<dir>             where clusters.json.gz + clusters_designs.json are
             --apply                 actually write (default is a dry run)

  refresh    run the exporter, then publish what it produced
             --arena=<dir>           CFPS Arena checkout (or env CFPS_ARENA_DIR)
             --cmd="..."             override the export command
             --apply                 actually write

Env: CFPS_SITE (${SITE}), PB_URL, PB_EMAIL, PB_PASSWORD, CFPS_ARENA_DIR, CFPS_TOKEN
`);
  process.exit(code);
}
if (!cmd || has('help')) usage(cmd ? 0 : 1);

// ── shared ──────────────────────────────────────────────────────────────────
async function pbClient() {
  const { default: PocketBase } = await import('pocketbase');
  const email = process.env.PB_EMAIL;
  const password = process.env.PB_PASSWORD;
  if (!email || !password) {
    throw new Error('PB_EMAIL / PB_PASSWORD are not set (try `node --env-file=.env …`).');
  }
  const pb = new PocketBase(PB_URL);
  await pb.collection('_superusers').authWithPassword(email, password);
  return pb;
}

// ── fetch ───────────────────────────────────────────────────────────────────
// Default route is the website with an agent token, because that is the one
// credential a participant already has. --pb is the fallback for maintainers.
async function fetchViaSite(token, outDir, raw) {
  for (const f of FILES) {
    const url = `${SITE}/cfps/clusters-data/${f.served}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      throw new Error(`401 from ${url} — the token is missing, expired, or not a CFPS agent token.`);
    }
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    // The endpoint sends designs with Content-Encoding: gzip (fetch inflates it)
    // and clusters.json.gz as raw gzip bytes.
    let body = Buffer.from(await res.arrayBuffer());
    body = writeOne(f, body, outDir, raw);
  }
}

async function fetchViaPb(outDir, raw) {
  const pb = await pbClient();
  const token = await pb.files.getToken();
  for (const f of FILES) {
    const rec = await pb.collection(COLLECTION).getFirstListItem(pb.filter('key = {:k}', { k: f.key }));
    const res = await fetch(pb.files.getURL(rec, rec.file, { token }));
    if (!res.ok) throw new Error(`${res.status} fetching ${f.key} from PocketBase`);
    writeOne(f, Buffer.from(await res.arrayBuffer()), outDir, raw);
  }
}

// Always leave usable files on disk: anything gzipped is unpacked unless --raw.
function writeOne(f, body, outDir, raw) {
  fs.mkdirSync(outDir, { recursive: true });
  const isGz = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
  const unpack = isGz && !raw;
  const name = unpack ? f.served.replace(/\.gz$/, '') : f.served;
  const out = unpack ? zlib.gunzipSync(body) : body;
  fs.writeFileSync(path.join(outDir, name), out);
  console.log(`  ${path.join(outDir, name)}  ${mb(out.length)}${unpack ? '  (unpacked)' : ''}`);
  return out;
}

// ── publish ─────────────────────────────────────────────────────────────────
async function publish(dir, apply) {
  const pb = apply ? await pbClient() : null;
  let collection = pb ? await pb.collections.getOne(COLLECTION).catch(() => null) : null;
  if (pb && !collection) {
    collection = await pb.collections.create({
      name: COLLECTION,
      type: 'base',
      fields: [
        { name: 'key', type: 'text', required: true },
        { name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 33_554_432 }
      ],
      indexes: [`CREATE UNIQUE INDEX idx_${COLLECTION}_key ON ${COLLECTION} (key)`]
    });
    console.log(`• created collection ${COLLECTION}`);
  }

  for (const f of FILES) {
    // Accept either the packed or unpacked name, so a round-tripped fetch can be
    // re-published without renaming anything.
    const candidates = [f.src, f.src.replace(/\.gz$/, ''), `${f.src}.gz`];
    const found = candidates.map((c) => path.resolve(dir, c)).find((p) => fs.existsSync(p));
    if (!found) {
      console.error(`✗ ${f.key}: none of ${candidates.join(', ')} in ${dir}`);
      process.exitCode = 1;
      continue;
    }
    const raw = fs.readFileSync(found);
    const isGz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const body = isGz ? raw : zlib.gzipSync(raw, { level: 9 });
    console.log(`• ${f.key}: ${path.basename(found)} ${mb(raw.length)} → stored ${mb(body.length)}`);
    if (!apply) continue;

    const form = new FormData();
    form.append('key', f.key);
    form.append('file', new Blob([body], { type: 'application/gzip' }), `${f.key}.json.gz`);
    const existing = await pb
      .collection(COLLECTION)
      .getFirstListItem(pb.filter('key = {:k}', { k: f.key }))
      .catch(() => null);
    const rec = existing
      ? await pb.collection(COLLECTION).update(existing.id, form)
      : await pb.collection(COLLECTION).create(form);
    console.log(`  ${existing ? 'updated' : 'created'} ${rec.id} ✓`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
try {
  if (cmd === 'fetch') {
    const outDir = flag('out', OUT_DIR_DEFAULT);
    const token = flag('token', process.env.CFPS_TOKEN);
    console.log(`• fetching cluster data → ${outDir}`);
    if (has('pb') || !token) {
      if (!token && !has('pb')) console.log('  (no --token; falling back to PocketBase credentials)');
      await fetchViaPb(outDir, has('raw'));
    } else {
      await fetchViaSite(token, outDir, has('raw'));
    }
    const sample = path.resolve(outDir, 'clusters_designs.json');
    const rel = path.relative(process.cwd(), sample);
    const ref = rel.startsWith('..') ? sample : `./${rel}`;
    console.log('\nDone. Start here:\n' +
      `  node -e "const d=require('${ref}');` +
      ` console.log(Object.keys(d.proteins), d.proteins.sfGFP.designs.length)"`);
  } else if (cmd === 'publish') {
    const dir = flag('dir');
    if (!dir) usage(1);
    await publish(dir, has('apply'));
    console.log(has('apply') ? '\nDone.' : '\nDry run — add --apply to write.');
  } else if (cmd === 'refresh') {
    const arena = flag('arena', process.env.CFPS_ARENA_DIR);
    if (!arena) {
      console.error('refresh needs --arena=<CFPS Arena checkout> (or CFPS_ARENA_DIR).');
      process.exit(1);
    }
    const command = flag('cmd', 'node export_clusters.js --web --ronan');
    console.log(`• running: ${command}\n  in ${arena}`);
    execFileSync(process.env.SHELL || '/bin/sh', ['-c', command], { cwd: arena, stdio: 'inherit' });
    const dir = flag('dir', arena);
    await publish(dir, has('apply'));
    console.log(has('apply') ? '\nRefreshed.' : '\nDry run — add --apply to write.');
  } else {
    usage(1);
  }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}

import { pbAdmin } from '$lib/server/pb.js';
import { json } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { CFPS_BASE } from '$lib/site.js';
import { reagentListKey } from '$lib/cfpsReagentContract.js';
import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import {
  LIMITS,
  validateSample,
  costForReagentList,
  submissionContract
} from '$lib/server/designSubmission.js';

// Reagent-supplement compositions from the Cell-Free Reaction Designer (and AI
// agents acting for a user) are written to the same PocketBase collection as the
// older publish flow (cfps_designs), in the autonomous-cfps CFPSReagentList shape
// ({ sample_id, sample_type, reagent_list, metadata }). createRule is null on the
// collection, so the write must go through the superuser-authed admin client.
//
// Every rule (reagent_list contract, protein_target ↔ template, required
// hypothesis, field limits, batch shape) lives in $lib/server/designSubmission.js
// and is checked here as the last line of defense — the browser runs the same
// reagent_list check, but nothing trusts the client. Rejections come back as
// { success:false, error, errors:[{ sample_index, sample_id, field, message }] }
// so an agent can fix exactly what's wrong.
const COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';
const HELP = 'GET /cfps/submit-design returns the full contract (reagent fields, volume rules, metadata, batch shape) with example payloads.';

// Round a monetary value to two decimal places (cents). Non-finite → 0.
function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function rejection(errors, status = 400, extra = {}) {
  const lines = errors.map((e) =>
    `${e.sample_index ? `Sample ${e.sample_index}${e.sample_id ? ` (${e.sample_id})` : ''}: ` : ''}${e.message}`
  );
  return json(
    {
      success: false,
      error: `${errors.length} problem${errors.length === 1 ? '' : 's'} found — ${lines.join(' ')}`,
      errors,
      help: HELP,
      ...extra
    },
    { status }
  );
}

// GET → the submission contract (signed-in only, like everything community-side).
export const GET = async (event) => {
  const kcUser = await requestUser(event);
  if (!kcUser) return json({ error: 'Sign in (or send an agent token) to read the submission contract.' }, { status: 401 });
  return json(submissionContract(CFPS_BASE));
};

// POST, one of:
//   { sample: {...}, totalCostUsd?, costPerMlReaction?, dry_run?, allow_duplicate? }  one composition
//   { samples: [{...}, ...], experiment_hypothesis, batch_id?, dry_run? } a batch (atomic)
// → { success:true, id } | { success:true, ids:[...], batch_id } | { success:true, dry_run:true, ... }
export const POST = async (event) => {
  const { request } = event;
  try {
    // Composition submission is Keycloak-gated: only signed-in users may write.
    const kcUser = await requestUser(event);
    if (!kcUser) {
      return json({ success: false, error: 'Sign in to submit a composition (agents: send Authorization: Bearer <agent token>).' }, { status: 401 });
    }

    let body;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') {
      return rejection([{ field: 'body', message: 'Send a JSON body: { "sample": {...} } for one composition or { "samples": [...], "experiment_hypothesis": "..." } for a batch.' }]);
    }
    const dryRun = body.dry_run === true;
    const isBatch = Array.isArray(body.samples);
    if (!isBatch && body.sample === undefined) {
      return rejection([{ field: 'sample', message: 'Missing composition: send { "sample": {...} } (or { "samples": [...] } for a batch).' }]);
    }

    const samples = isBatch ? body.samples : [body.sample];
    const errors = [];
    const warnings = [];

    // ── batch-level rules ─────────────────────────────────────────────────────
    let batchId = '';
    let experimentHypothesis = '';
    if (isBatch) {
      if (samples.length < LIMITS.batchMin) {
        errors.push({ field: 'samples', message: `A batch needs at least ${LIMITS.batchMin} samples — send a single composition as { "sample": {...} } instead.` });
      } else if (samples.length > LIMITS.batchMax) {
        errors.push({ field: 'samples', message: `A batch can hold at most ${LIMITS.batchMax} samples (got ${samples.length}) — split it into several batches.` });
      }
      experimentHypothesis = typeof body.experiment_hypothesis === 'string' ? body.experiment_hypothesis.trim() : '';
      if (!experimentHypothesis) {
        errors.push({ field: 'experiment_hypothesis', message: 'experiment_hypothesis is required for a batch — say what the batch as a whole tests.' });
      } else if (experimentHypothesis.length > LIMITS.experimentHypothesis) {
        errors.push({ field: 'experiment_hypothesis', message: `experiment_hypothesis is ${experimentHypothesis.length} characters; the limit is ${LIMITS.experimentHypothesis}.` });
      }
      batchId = typeof body.batch_id === 'string' ? body.batch_id.trim() : '';
      if (batchId.length > LIMITS.batchId) {
        errors.push({ field: 'batch_id', message: `batch_id is over ${LIMITS.batchId} characters.` });
      }
    }

    // ── per-sample rules ──────────────────────────────────────────────────────
    // Agents must have the user's explicit OK before publishing a conversation link.
    const requireLinkApproval = kcUser.via === 'agent';
    samples.forEach((sample, i) => {
      const res = validateSample(sample, { requireLinkApproval });
      const sid = typeof sample?.sample_id === 'string' ? sample.sample_id.trim() : '';
      for (const e of res.errors) errors.push(isBatch ? { sample_index: i + 1, sample_id: sid || undefined, ...e } : e);
      for (const w of res.warnings) warnings.push(isBatch ? `Sample ${i + 1}: ${w}` : w);
    });

    // sample_ids must be unique within the request…
    const ids = samples.map((s) => (typeof s?.sample_id === 'string' ? s.sample_id.trim() : ''));
    const seen = new Map();
    ids.forEach((sid, i) => {
      if (!sid) return;
      if (seen.has(sid)) {
        errors.push({ sample_index: i + 1, sample_id: sid, field: 'sample_id', message: `sample_id "${sid}" is used twice in this batch (also sample ${seen.get(sid)}) — each needs a unique id.` });
      } else seen.set(sid, i + 1);
    });
    if (errors.length) return rejection(errors, 400, warnings.length ? { warnings } : {});

    const pb = await pbAdmin();

    // …and across everything already submitted.
    const unique = [...seen.keys()];
    const filter = unique.map((_, i) => `title = {:t${i}}`).join(' || ');
    const params = Object.fromEntries(unique.map((t, i) => [`t${i}`, t]));
    const taken = await pb.collection(COLLECTION).getFullList({ filter: pb.filter(filter, params), fields: 'title' });
    if (taken.length) {
      const takenSet = new Set(taken.map((r) => r.title));
      return rejection(
        ids
          .map((sid, i) => (takenSet.has(sid) ? { ...(isBatch ? { sample_index: i + 1 } : {}), sample_id: sid, field: 'sample_id', message: `A composition with sample_id "${sid}" already exists — give it a unique id.` } : null))
          .filter(Boolean),
        409
      );
    }

    // Identical reactions. A composition whose reagent_list exactly matches one
    // that's already been submitted adds no new information, so a single submission
    // is held back (409) with a pointer to star the original instead — resend with
    // "allow_duplicate": true to submit a copy anyway. Batches are never blocked:
    // duplicates (against existing records or within the batch) come back as warnings.
    const existing = await pb.collection(COLLECTION).getFullList({ fields: 'id,title,author,author_sub,design_json' });
    const byKey = new Map();
    for (const r of existing) {
      let dj = r.design_json;
      if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
      const key = reagentListKey(dj?.reagent_list);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({
        id: r.id,
        sample_id: r.title,
        author: String(r.author || '').trim() || null,
        mine: !!kcUser.sub && String(r.author_sub || '') === String(kcUser.sub)
      });
    }
    const keys = samples.map((s) => reagentListKey(s.reagent_list));
    const duplicates = keys
      .map((key, i) => ({ sample_index: i + 1, sample_id: ids[i], duplicate_of: byKey.get(key) ?? [] }))
      .filter((d) => d.duplicate_of.length);
    const describe = (m) => (m.mine ? `your earlier composition "${m.sample_id}" (id ${m.id})` : `"${m.sample_id}" by ${m.author || 'another participant'} (id ${m.id})`);
    for (const d of duplicates) {
      const others = d.duplicate_of.filter((m) => !m.mine);
      warnings.push(
        `${isBatch ? `Sample ${d.sample_index} (${d.sample_id}) ` : 'This composition '}is identical to ${d.duplicate_of.map(describe).join(', ')}.` +
        (others.length ? ` Consider starring ${others.length === 1 ? 'it' : 'them'} instead (POST /cfps/stars).` : '')
      );
    }
    if (isBatch) {
      const firstByKey = new Map();
      keys.forEach((key, i) => {
        if (firstByKey.has(key)) warnings.push(`Samples ${firstByKey.get(key)} and ${i + 1} in this batch are identical.`);
        else firstByKey.set(key, i + 1);
      });
    }
    if (!isBatch && duplicates.length && body.allow_duplicate !== true && !dryRun) {
      const matches = duplicates[0].duplicate_of;
      const others = matches.filter((m) => !m.mine);
      return json({
        success: false,
        error: `This exact composition was already submitted as ${matches.map(describe).join(', ')}. ` +
          (others.length ? `Star it instead (POST /cfps/stars { "action": "star", "ids": [${others.map((m) => `"${m.id}"`).join(', ')}] }), or r` : 'R') +
          'esend with "allow_duplicate": true to submit your own copy anyway.',
        duplicate_of: matches
      }, { status: 409 });
    }

    // Costs: the designer sends its own figures for a single composition; agents
    // (and batches) are priced server-side from the PocketBase reagent catalog.
    const needCatalog = isBatch || !Number.isFinite(Number(body.totalCostUsd)) || body.totalCostUsd == null;
    const reagentGroups = needCatalog ? (await loadCfpsReagentGroups(null)).reagentGroups : null;
    const costFor = (s) => {
      if (!needCatalog) return { total: Number(body.totalCostUsd), perMl: Number(body.costPerMlReaction) };
      const total = costForReagentList(s.reagent_list, reagentGroups);
      return { total, perMl: total * 50 }; // 20 µL reaction → ×50 per mL
    };

    if (isBatch && !batchId) batchId = ids[0].replace(/_\d+$/, '') || ids[0];

    if (dryRun) {
      return json({
        success: true,
        dry_run: true,
        message: `Valid — ${samples.length} composition${samples.length === 1 ? '' : 's'} would be submitted. Re-send without "dry_run" to save.`,
        ...(isBatch ? { batch_id: batchId } : {}),
        ...(duplicates.length ? { duplicates } : {}),
        ...(!isBatch && duplicates.length ? { note: 'Submitting this for real needs "allow_duplicate": true (or star the original instead).' } : {}),
        ...(warnings.length ? { warnings } : {})
      });
    }

    const created = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const metadata = { ...(s.metadata || {}) };
      if (isBatch) {
        // Same grouping keys the designer stamps: the community rail and My
        // Compositions collapse these sibling records into one batch card. The
        // group-level hypothesis is stored once, on batch_index 1.
        metadata.batch_id = batchId;
        metadata.batch_size = samples.length;
        metadata.batch_index = i + 1;
        if (i === 0) metadata.experiment_hypothesis = experimentHypothesis;
        else delete metadata.experiment_hypothesis;
      }
      const sample = { ...s, sample_id: ids[i], metadata };
      const totalNl = Object.values(s.reagent_list).reduce((sum, v) => sum + (Number(v) || 0), 0);
      const cost = costFor(s);
      try {
        const record = await pb.collection(COLLECTION).create({
          title: ids[i],
          author: (kcUser.name || String(body.author || metadata.acknowledgements || '')).trim(),
          // Stable per-user identity (Keycloak subject). Names aren't unique, so this
          // is what ownership checks and "My Compositions" filtering prefer.
          author_sub: String(kcUser.sub || '').trim() || null,
          // 'user' (submitted in the browser) or 'agent' (an AI agent's bearer token).
          submitted_via: kcUser.via === 'agent' ? 'agent' : 'user',
          rationale: String(metadata.comments || '').trim() || null,
          design_json: sample,
          total_volume_nl: totalNl,
          total_cost_usd: round2(cost.total),
          cost_per_ml_reaction: round2(cost.perMl)
        });
        created.push(record.id);
      } catch (e) {
        // Validation passed, so this is a backend failure mid-batch: report exactly
        // what landed so the caller can retry only the rest.
        return json({
          success: false,
          error: `Saved ${created.length} of ${samples.length} before sample ${i + 1} (${ids[i]}) failed: ${e?.message || 'write error'}. Retry the remaining samples with the same batch_id.`,
          ids: created,
          ...(isBatch ? { batch_id: batchId } : {})
        }, { status: 500 });
      }
    }

    return json({
      success: true,
      ...(isBatch ? { ids: created, batch_id: batchId } : { id: created[0] }),
      ...(duplicates.length ? { duplicates } : {}),
      ...(warnings.length ? { warnings } : {})
    });
  } catch (error) {
    return json(
      { success: false, error: error?.message || 'Unable to submit composition.' },
      { status: 500 }
    );
  }
};

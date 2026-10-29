import { json, error } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { pbAdmin } from '$lib/server/pb.js';
import { clusterSource, recipeClasses } from '$lib/server/clusterPlan.js';
import { validateReagentList } from '$lib/cfpsReagentContract.js';
import {
  PLATES_PER_TARGET, PER_PLATE, SLOTS, REPLICATES,
  plateKey, plateJson, placementFor, slotWell
} from '../../plateMap.js';

// POST { target, designIds[] } -> a PlateBatch the lab can run.
//
// Recipes live only on the server (see clusterData), so the browser sends ids
// and gets back finished plates. Same plateJson/placementFor the plate builder
// uses, so the output validates against the real pydantic model.

// The cluster export carries only the author's name, but the plate's metadata
// has room for the whole credit record, so read the rest back from the live
// submissions. A conversation link publishes someone's chat, so it ships only
// with consent: typed in the browser by the author, or sent by an agent with
// ai_conversation_link_user_approved (see designSubmission.js).
async function creditFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const pb = await pbAdmin();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const filter = chunk.map((id) => pb.filter('id = {:id}', { id })).join(' || ');
    const recs = await pb.collection('cfps_designs').getFullList({
      filter, fields: 'id,author,rationale,submitted_via,design_json'
    });
    for (const rec of recs) {
      let dj = rec.design_json;
      if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
      const m = (dj && typeof dj === 'object' && dj.metadata) || {};
      const approved = m.ai_conversation_link_user_approved === true || rec.submitted_via !== 'agent';
      out.set(rec.id, {
        aiModel: String(m.ai_model ?? '').trim(),
        aiConversationLink: approved ? String(m.ai_conversation_link ?? '').trim() : '',
        acknowledgements: String(m.acknowledgements ?? '').trim(),
        comments: String(m.comments ?? rec.rationale ?? '').trim()
      });
    }
  }
  return out;
}

export async function POST(event) {
  const user = await requestUser(event);
  if (!user) throw error(401, 'Sign in to export plates.');

  const body = await event.request.json().catch(() => null);
  const target = String(body?.target ?? '');
  const ids = Array.isArray(body?.designIds) ? body.designIds.map(String) : [];
  if (!ids.length) throw error(400, 'No designs selected.');

  const src = await clusterSource();
  const protein = src.proteins?.[target];
  if (!protein) throw error(400, `Unknown target "${target}".`);

  const byId = new Map(protein.designs.map((d) => [d.id, d]));
  const picked = [];
  const skipped = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) { skipped.push({ id, reason: 'not in this target' }); continue; }
    // Never ship a plate the model would reject at the bench.
    const { valid, errors } = validateReagentList(d.recipeNl);
    if (!valid) { skipped.push({ id, name: d.sampleId, reason: errors[0] }); continue; }
    picked.push(d);
  }
  const capacity = PLATES_PER_TARGET * PER_PLATE;
  const over = picked.length > capacity ? picked.length - capacity : 0;
  const fit = picked.slice(0, capacity);

  // Everyone who submitted this exact recipe shares the well, so they all land
  // in the sample's contributors[] rather than one of them being dropped.
  const { membersOf } = recipeClasses(protein.designs);
  const coSubmitters = new Map(fit.map((d) => {
    const all = membersOf(d.id);
    return [d.id, (all.length ? all : [d]).map((m) => m.id)];
  }));
  const credit = await creditFor([...new Set([...coSubmitters.values()].flat())]);
  const merged = [...coSubmitters.values()].reduce((n, c) => n + c.length - 1, 0);

  const design = (d, recipe) => ({
    name: d.sampleId, reagentList: recipe, author: d.author, proteinTarget: target,
    ...credit.get(d.id),
    // whatItTries is the model's one-line reading; the author's own words win.
    rationale: credit.get(d.id)?.comments || d.whatItTries
  });
  const byDesignId = new Map(protein.designs.map((d) => [d.id, d]));
  const lookup = new Map();
  for (const d of fit) {
    for (const id of coSubmitters.get(d.id)) {
      const m = byDesignId.get(id);
      // Every co-submitter is credited against the representative's recipe —
      // they are byte-identical, which is what put them in the same class.
      if (m) lookup.set(id, design(m, d.recipeNl));
    }
  }

  const plates = [];
  for (let i = 0; i < PLATES_PER_TARGET; i++) {
    const chunk = fit.slice(i * PER_PLATE, (i + 1) * PER_PLATE);
    if (!chunk.length) break;
    const occupied = new Set();
    const entries = [];
    for (const d of chunk) {
      const wells = placementFor(plateKey(target, i), d.id, occupied);
      if (!wells) break;
      for (const w of wells) occupied.add(w);
      entries.push({ designIds: coSubmitters.get(d.id) ?? [d.id], wells });
    }
    const plate = plateJson(plateKey(target, i), entries, (id) => lookup.get(id), {
      viewerName: user.name ?? ''
    });
    // Pad the tail so each plate carries the 320 samples the model requires.
    for (let s = 0; s < SLOTS; s++) {
      if (!occupied.has(s)) {
        plate.samples.push({ sample_id: 'empty', sample_type: 'empty', reagent_list: null, metadata: { well: slotWell(s) } });
      }
    }
    plate.metadata = { ...plate.metadata, source: 'htbaa-cluster-planner', protein_target: target };
    plates.push(plate);
  }

  return json({
    batch: { plates },
    summary: {
      target,
      requested: ids.length,
      placed: fit.length,
      wells: fit.length * REPLICATES,
      plates: plates.length,
      authors: new Set([...lookup.values()].map((d) => d.author).filter(Boolean)).size,
      // Identical recipes from different people, sharing one well and credited together.
      coSubmitted: merged,
      overCapacity: over,
      skipped
    }
  });
}

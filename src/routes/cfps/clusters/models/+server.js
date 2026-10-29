import { json, error } from '@sveltejs/kit';
import { requestUser } from '$lib/server/auth.js';
import { isClusterAdmin, adminDenialReason } from '$lib/server/clusterAdmin.js';
import { clearClusterCache } from '$lib/server/clusterData.js';
import { clearPlanCache } from '$lib/server/clusterPlan.js';
import { listModels, activateModel, deleteModel } from '$lib/server/clusterModels.js';

// The uploaded versions of the cluster model, and which one the planner reads.
// Switching and deleting change what every signed-in participant sees, so both
// are allowlist-only; listing is too, since the labels name the export.
async function admin(event) {
  const user = await requestUser(event);
  if (!user) throw error(401, 'Sign in first.');
  // GET this endpoint in a browser to find out why the picker isn't showing.
  if (!isClusterAdmin(user)) throw error(403, adminDenialReason(user));
  return user;
}

export async function GET(event) {
  await admin(event);
  return json({ models: await listModels() });
}

export async function POST(event) {
  await admin(event);
  const { id } = (await event.request.json().catch(() => ({}))) ?? {};
  if (!id) throw error(400, 'Which version? Send { id }.');
  const out = await activateModel(String(id));
  if (!out) throw error(404, 'No such version.');
  clearClusterCache();
  clearPlanCache();
  return json({ ok: true, active: out, models: await listModels() });
}

export async function DELETE(event) {
  await admin(event);
  const { id } = (await event.request.json().catch(() => ({}))) ?? {};
  if (!id) throw error(400, 'Which version? Send { id }.');
  // Deleting the live version would leave nothing selected, so switch first.
  const models = await listModels();
  if (models.find((m) => m.id === String(id))?.active) {
    throw error(409, 'That version is live — switch to another one first.');
  }
  if (!(await deleteModel(String(id)))) throw error(400, 'The published copy cannot be deleted here.');
  return json({ ok: true, models: await listModels() });
}

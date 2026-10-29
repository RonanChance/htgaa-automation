import { readSession, KC_COOKIE } from '$lib/server/session.js';
import { isConfigured as kcIsConfigured } from '$lib/server/keycloak.js';
import { clusterPlan } from '$lib/server/clusterPlan.js';
import { isClusterAdmin } from '$lib/server/clusterAdmin.js';
import { listModels } from '$lib/server/clusterModels.js';

// Login gate for /cfps/clusters, matching /cfps/analysis.
//
// The plan is built server-side and trimmed (see clusterPlan) so recipes never
// reach the browser — the export endpoint reads those separately. The raw
// arena view is still available to signed-in users through the gated
// /cfps/clusters-data endpoints.
export async function load({ cookies }) {
  const kcUser = readSession(cookies.get(KC_COOKIE));
  if (!kcUser) return { locked: true, kcConfigured: kcIsConfigured() };
  // Only an allowlisted account sees the upload control (see clusterAdmin.js);
  // the endpoint re-checks, so this is presentation, not the gate.
  const canUpload = isClusterAdmin(kcUser);
  const base = {
    locked: false,
    kcUser: { name: kcUser.name },
    canUpload,
    // The version list names the export, so it is admin-only like the upload.
    models: canUpload ? await listModels().catch(() => []) : []
  };
  try {
    return { ...base, plan: await clusterPlan() };
  } catch (error) {
    console.error('Failed to build the cluster plan:', error);
    return { ...base, plan: null };
  }
}

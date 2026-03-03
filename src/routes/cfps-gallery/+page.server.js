import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');
const DESIGNS_COLLECTION = process.env.CFPS_COLLECTION || 'cfps_designs';

function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractStoredDesign(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.design_json && typeof record.design_json === 'object') return record.design_json;
  if (record.design && typeof record.design === 'object') return record.design;
  if (record.payload && typeof record.payload === 'object') return record.payload;
  if (typeof record.content === 'string') {
    const parsed = parseMaybeJson(record.content);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

export async function load() {
  try {
    await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

    const list = await pb.collection(DESIGNS_COLLECTION).getList(1, 100, { sort: '-created' });
    const designs = (list.items || []).map((item) => {
      const design = extractStoredDesign(item) || {};
      const reagents = Array.isArray(design.reagents)
        ? design.reagents.map((r) => ({
            id: String(r?.id ?? ''),
            name: String(r?.name ?? r?.id ?? 'Unknown'),
            volumeNl: Number(r?.volumeNl) || 0
          }))
        : [];

      return {
        id: item.id,
        title: item.title || `CFPS-${item.id}`,
        author: item.author || null,
        rationale: item.rationale || null,
        created: item.created,
        totalVolumeNl: Number(design.totalVolumeNl ?? item.total_volume_nl) || 0,
        totalCostUsd: Number(design.totalCostUsd ?? item.total_cost_usd) || 0,
        costPerMlReaction: Number(design.costPerMlReaction ?? item.cost_per_ml_reaction) || 0,
        reagents
      };
    });

    return { success: true, designs };
  } catch (error) {
    console.error('Failed to load CFPS designs for gallery:', error);
    return { success: false, designs: [] };
  }
}

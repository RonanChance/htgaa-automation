import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

function buildVolumeSignature(design) {
  if (!design || typeof design !== 'object') return null;

  const reagents = Array.isArray(design.reagents)
    ? design.reagents
        .map((r) => ({
          id: r?.id ?? null,
          volumeNl: Number(r?.volumeNl) || 0
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    : [];

  return JSON.stringify(reagents);
}

function extractStoredDesign(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.design_json && typeof record.design_json === 'object') return record.design_json;
  if (record.design && typeof record.design === 'object') return record.design;
  if (record.payload && typeof record.payload === 'object') return record.payload;
  if (typeof record.content === 'string') {
    try {
      const parsed = JSON.parse(record.content);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export const POST = async ({ request }) => {
  try {
    const { title, author, design } = await request.json();

    await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

    const collection = process.env.CFPS_COLLECTION || 'cfps_designs';
    const safeTitle = title?.trim() || `CFPS-${new Date().toISOString()}`;
    const incomingSignature = buildVolumeSignature(design);

    if (incomingSignature) {
      const perPage = 200;
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const batch = await pb.collection(collection).getList(page, perPage, {
          sort: '-created'
        });

        for (const item of batch.items || []) {
          const storedDesign = extractStoredDesign(item);
          const storedSignature = buildVolumeSignature(storedDesign);
          if (storedSignature && storedSignature === incomingSignature) {
            return new Response(
              JSON.stringify({ success: true, duplicate: true, duplicate_of: item.id }),
              {
                headers: { 'Content-Type': 'application/json' }
              }
            );
          }
        }

        hasMore = page * perPage < (batch.totalItems || 0);
        page += 1;
      }
    }

    const payloadCandidates = [
      {
        title: safeTitle,
        author: author || null,
        design_json: design,
        total_volume_nl: design?.totalVolumeNl,
        total_cost_usd: design?.totalCostUsd,
        cost_per_ml_reaction: design?.costPerMlReaction
      },
      {
        title: safeTitle,
        author: author || null,
        design
      },
      {
        title: safeTitle,
        author: author || null,
        payload: design
      },
      {
        title: safeTitle,
        author: author || null,
        content: JSON.stringify(design)
      }
    ];

    let created;
    let lastError;

    for (const payload of payloadCandidates) {
      try {
        created = await pb.collection(collection).create(payload);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!created) {
      throw lastError || new Error('Unable to save CFPS design in PocketBase.');
    }

    return new Response(JSON.stringify({ success: true, id: created.id, duplicate: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        duplicate: false,
        error: error?.message || 'Unable to save CFPS design.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

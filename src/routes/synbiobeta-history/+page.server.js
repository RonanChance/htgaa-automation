import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
  PLACE_BOARD_ID,
  PLACE_PIXELS_SYNBIOBETA_COLLECTION
} from '$lib/place.js';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

export async function load() {
  try {
    await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

    const placements = await pb.collection(PLACE_PIXELS_SYNBIOBETA_COLLECTION).getFullList({
      sort: '+created',
      filter: `board_id="${PLACE_BOARD_ID}"`,
      fields: 'id,point_key,color,action,created,username'
    });

    return {
      placements: (placements || []).map((record) => ({
        id: record.id,
        point_key: String(record.point_key || ''),
        color: record.color ? String(record.color) : null,
        action: record.action === 'erase' ? 'erase' : 'place',
        created: record.created || '',
        username: String(record?.username || '').trim()
      }))
    };
  } catch (error) {
    console.error('Failed to load synbiobeta history:', error);
    return {
      placements: []
    };
  }
}

import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
    PLACE_BOARD_ID,
    PLACE_PIXELS_COLLECTION,
    PLACE_STATE_COLLECTION
} from '$lib/place.js';

const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");
const ERASE_CONTRIBUTION_KEY = '__erase__';

export const POST = async ({ request }) => {
    const { boardId } = await request.json();
    const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;

    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        const stateRecords = await pb.collection(PLACE_STATE_COLLECTION).getFullList({
            sort: 'point_key',
            filter: `board_id="${normalizedBoardId}"`
        });
        const point_colors = {};
        const point_usernames = {};

        for (const record of stateRecords) {
            if (!record?.point_key || !record?.color) continue;
            const pointKey = String(record.point_key);
            point_colors[pointKey] = String(record.color);

            const lastUsername = String(record?.last_username || '').trim();
            if (lastUsername) {
                point_usernames[pointKey] = lastUsername;
            }
        }

        const latestPlacement = await pb.collection(PLACE_PIXELS_COLLECTION).getList(1, 1, {
            sort: '-created',
            filter: `board_id="${normalizedBoardId}"`
        });
        const latestRecord = latestPlacement.items[0] || null;

        const placementRecords = await pb.collection(PLACE_PIXELS_COLLECTION).getFullList({
            sort: '+created',
            filter: `board_id="${normalizedBoardId}"`,
            fields: 'username,color,action'
        });
        const contributionMap = new Map();

        for (const record of placementRecords) {
            const username = String(record?.username || '').trim();
            const action = String(record?.action || '').trim();
            const color = action === 'erase'
                ? ERASE_CONTRIBUTION_KEY
                : String(record?.color || '').trim();
            if (!username || !color) continue;

            const existing = contributionMap.get(username) || {
                username,
                total: 0,
                colors: {}
            };

            existing.total += 1;
            existing.colors[color] = (Number(existing.colors[color]) || 0) + 1;
            contributionMap.set(username, existing);
        }

        const contribution_rows = Array.from(contributionMap.values()).sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            return a.username.localeCompare(b.username);
        });

        return new Response(JSON.stringify({
            success: true,
            record: {
                id: latestRecord?.id || '',
                created: latestRecord?.created || '',
                point_colors,
                point_usernames,
                contribution_rows
            }
        }));
    } catch (error) {
        console.log('Place load failed', error);
        return new Response(JSON.stringify({ success: false, record: null }));
    }
};

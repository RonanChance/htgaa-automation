import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
    PLACE_BOARD_ID,
    PLACE_PIXELS_COLLECTION,
    PLACE_STATE_COLLECTION,
    PLACE_WELL_CLAIMS_COLLECTION
} from '$lib/place.js';

const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");
const ERASE_CONTRIBUTION_KEY = '__erase__';

export const POST = async ({ request }) => {
    const {
        boardId,
        historyStep,
        includeFullContributionRows,
        inviteId,
        pixelsCollection,
        stateCollection
    } = await request.json();
    const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;
    const normalizedInviteId = String(inviteId || '').trim();
    const normalizedPixelsCollection = String(pixelsCollection || PLACE_PIXELS_COLLECTION).trim() || PLACE_PIXELS_COLLECTION;
    const normalizedStateCollection = String(stateCollection || PLACE_STATE_COLLECTION).trim() || PLACE_STATE_COLLECTION;
    const normalizedHistoryStep = Number(historyStep);
    const hasHistoryStep = Number.isInteger(normalizedHistoryStep) && normalizedHistoryStep >= 0;
    const shouldUseFullContributionRows = includeFullContributionRows === true;

    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        const point_colors = {};
        const point_usernames = {};
        const contributionMap = new Map();
        const claims = [];
        const my_claims = {};
        let latestRecord = null;

        if (hasHistoryStep) {
            const placementRecords = await pb.collection(normalizedPixelsCollection).getFullList({
                sort: '+created',
                filter: `board_id="${normalizedBoardId}"`,
                fields: 'id,point_key,color,action,username,created'
            });
            const visiblePlacements = placementRecords.slice(0, normalizedHistoryStep);
            latestRecord = visiblePlacements.at(-1) || null;

            for (const record of visiblePlacements) {
                const pointKey = String(record?.point_key || '').trim();
                const action = String(record?.action || '').trim();
                const color = action === 'erase'
                    ? null
                    : String(record?.color || '').trim();
                const username = String(record?.username || '').trim();

                if (pointKey) {
                    if (color) {
                        point_colors[pointKey] = color;
                        if (username) {
                            point_usernames[pointKey] = username;
                        } else {
                            delete point_usernames[pointKey];
                        }
                    } else {
                        delete point_colors[pointKey];
                        delete point_usernames[pointKey];
                    }
                }

                const contributionColor = action === 'erase'
                    ? ERASE_CONTRIBUTION_KEY
                    : color;
                if (!username || !contributionColor) continue;

                const existing = contributionMap.get(username) || {
                    username,
                    total: 0,
                    colors: {}
                };

                existing.total += 1;
                existing.colors[contributionColor] = (Number(existing.colors[contributionColor]) || 0) + 1;
                contributionMap.set(username, existing);
            }

            if (shouldUseFullContributionRows) {
                contributionMap.clear();

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
            }
        } else {
            const stateRecords = await pb.collection(normalizedStateCollection).getFullList({
                sort: 'point_key',
                filter: `board_id="${normalizedBoardId}"`
            });

            for (const record of stateRecords) {
                if (!record?.point_key || !record?.color) continue;
                const pointKey = String(record.point_key);
                point_colors[pointKey] = String(record.color);

                const lastUsername = String(record?.last_username || '').trim();
                if (lastUsername) {
                    point_usernames[pointKey] = lastUsername;
                }
            }

            const latestPlacement = await pb.collection(normalizedPixelsCollection).getList(1, 1, {
                sort: '-created',
                filter: `board_id="${normalizedBoardId}"`
            });
            latestRecord = latestPlacement.items[0] || null;

            const placementRecords = await pb.collection(normalizedPixelsCollection).getFullList({
                sort: '+created',
                filter: `board_id="${normalizedBoardId}"`,
                fields: 'username,color,action'
            });

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
        }

        const contribution_rows = Array.from(contributionMap.values()).sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            return a.username.localeCompare(b.username);
        });

        const claimRecords = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
            sort: '-updated,-created',
            filter: `board_id="${normalizedBoardId}"`,
            fields: 'id,point_key,plate_id,x,y,well_label,claim_slot,invite_id,username,reagents,created,updated'
        }).catch((error) => {
            if (error?.status === 404) return [];
            throw error;
        });

        const seenInviteSlots = new Set();
        const seenPoints = new Set();

        for (const record of claimRecords) {
            const claim = {
                id: String(record?.id || ''),
                point_key: String(record?.point_key || '').trim(),
                plate_id: String(record?.plate_id || '').trim(),
                x: Number(record?.x),
                y: Number(record?.y),
                well_label: String(record?.well_label || '').trim(),
                claim_slot: Number(record?.claim_slot),
                username: String(record?.username || '').trim(),
                reagents: Array.isArray(record?.reagents) ? record.reagents : []
            };

            if (!claim.point_key || !Number.isInteger(claim.claim_slot)) continue;
            const inviteKey = `${String(record?.invite_id || '').trim()}::${claim.claim_slot}`;
            if (seenInviteSlots.has(inviteKey)) continue;
            if (seenPoints.has(claim.point_key)) continue;

            seenInviteSlots.add(inviteKey);
            seenPoints.add(claim.point_key);
            claims.push(claim);

            if (normalizedInviteId && String(record?.invite_id || '').trim() === normalizedInviteId) {
                my_claims[String(claim.claim_slot)] = claim;
            }
        }

        return new Response(JSON.stringify({
            success: true,
            record: {
                id: latestRecord?.id || '',
                created: latestRecord?.created || '',
                point_colors,
                point_usernames,
                contribution_rows,
                claims,
                my_claims
            }
        }));
    } catch (error) {
        console.log('Place load failed', error);
        return new Response(JSON.stringify({ success: false, record: null }));
    }
};

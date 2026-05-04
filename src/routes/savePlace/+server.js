import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
    PLACE_BOARD_ID,
    PLACE_INVITES_COLLECTION
    ,
    PLACE_PIXELS_COLLECTION,
    PLACE_STATE_COLLECTION
} from '$lib/place.js';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

function contributorNameFromInvite(invite) {
    return (
        String(
            invite?.username ||
            invite?.name ||
            invite?.author ||
            invite?.handle ||
            invite?.email ||
            invite?.id ||
            ''
        ).trim()
    );
}

export const POST = async ({ request }) => {
    const {
        boardId,
        inviteId,
        placement,
        pixelsCollection,
        stateCollection
    } = await request.json();

    const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;
    const normalizedInviteId = String(inviteId || '').trim();
    const normalizedPixelsCollection = String(pixelsCollection || PLACE_PIXELS_COLLECTION).trim() || PLACE_PIXELS_COLLECTION;
    const normalizedStateCollection = String(stateCollection || PLACE_STATE_COLLECTION).trim() || PLACE_STATE_COLLECTION;
    if (!normalizedInviteId) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Missing invite ID.'
        }), { status: 400 });
    }

    const pointKey = String(placement?.point_key || '').trim();
    const plateId = String(placement?.plate_id || '').trim();
    const color = placement?.action === 'erase' ? null : String(placement?.color || '').trim();
    const action = placement?.action === 'erase' ? 'erase' : 'place';
    const x = Number(placement?.x);
    const y = Number(placement?.y);

    if (!pointKey || !plateId || !Number.isFinite(x) || !Number.isFinite(y)) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Missing placement coordinates.'
        }), { status: 400 });
    }

    if (action === 'place' && !color) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Missing placement color.'
        }), { status: 400 });
    }

    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        const invite = await pb.collection(PLACE_INVITES_COLLECTION).getOne(normalizedInviteId);
        const author = contributorNameFromInvite(invite);

        if (!author) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invite record is missing a username.'
            }), { status: 400 });
        }

        const existingState = await pb.collection(normalizedStateCollection).getFirstListItem(
            `board_id="${normalizedBoardId}" && point_key="${pointKey}"`
        ).catch((error) => {
            if (error?.status === 404) return null;
            throw error;
        });
        const existingColor = existingState?.color ? String(existingState.color) : null;

        if ((existingColor || null) === (color || null)) {
            return new Response(JSON.stringify({
                success: true,
                duplicate: true,
                id: existingState?.id || '',
                username: author
            }));
        }

        const placementEntry = await pb.collection(normalizedPixelsCollection).create({
            board_id: normalizedBoardId,
            invite_id: normalizedInviteId,
            username: author,
            plate_id: plateId,
            x,
            y,
            point_key: pointKey,
            color,
            action
        });

        if (action === 'erase') {
            if (existingState?.id) {
                await pb.collection(normalizedStateCollection).delete(existingState.id);
            }
        } else {
            const statePayload = {
                board_id: normalizedBoardId,
                point_key: pointKey,
                plate_id: plateId,
                x,
                y,
                color,
                last_invite_id: normalizedInviteId,
                last_username: author
            };

            if (existingState?.id) {
                await pb.collection(normalizedStateCollection).update(existingState.id, statePayload);
            } else {
                await pb.collection(normalizedStateCollection).create(statePayload);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            id: placementEntry.id,
            duplicate: false,
            username: author
        }));
    } catch (error) {
        console.log('Place publish failed', error);

        const status = error?.status === 404 ? 403 : 500;
        const message = status === 403
            ? 'Invalid invite link.'
            : 'Unable to publish place update.';

        return new Response(JSON.stringify({
            success: false,
            error: message
        }), { status });
    }
};

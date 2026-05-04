import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
    PLACE_BOARD_ID,
    PLACE_INVITES_COLLECTION,
    PLACE_WELL_CLAIMS_COLLECTION
} from '$lib/place.js';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

async function contributorNameFromInvite(inviteId) {
    const invite = await pb.collection(PLACE_INVITES_COLLECTION).getOne(inviteId);
    return String(
        invite?.username ||
        invite?.name ||
        invite?.author ||
        invite?.handle ||
        invite?.email ||
        invite?.id ||
        ''
    ).trim();
}

export const POST = async ({ request }) => {
    const { boardId, inviteId, claimSlot, claimId, pointKey } = await request.json();

    const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;
    const normalizedInviteId = String(inviteId || '').trim();
    const normalizedClaimSlot = Number(claimSlot);
    const normalizedClaimId = String(claimId || '').trim();
    const normalizedPointKey = String(pointKey || '').trim();

    if (!normalizedInviteId) {
        return new Response(JSON.stringify({ success: false, error: 'Missing invite ID.' }), { status: 400 });
    }

    if (!Number.isInteger(normalizedClaimSlot) || normalizedClaimSlot < 0 || normalizedClaimSlot > 7) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid claim slot.' }), { status: 400 });
    }

    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        const username = await contributorNameFromInvite(normalizedInviteId);
        if (!username) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invite record is missing a username.'
            }), { status: 400 });
        }

        const claims = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
            sort: '-updated,-created',
            filter: `board_id="${normalizedBoardId}" && invite_id="${normalizedInviteId}" && claim_slot=${normalizedClaimSlot}`,
            fields: 'id,point_key,claim_slot,invite_id'
        }).catch((error) => {
            if (error?.status === 404) return [];
            throw error;
        });

        const pointClaims = normalizedPointKey
            ? await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
                sort: '-updated,-created',
                filter: `board_id="${normalizedBoardId}" && point_key="${normalizedPointKey}"`,
                fields: 'id,point_key,claim_slot,invite_id'
            }).catch((error) => {
                if (error?.status === 404) return [];
                throw error;
            })
            : [];

        const exactClaim = normalizedClaimId
            ? await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getOne(normalizedClaimId, {
                fields: 'id,point_key,claim_slot,invite_id,board_id'
            }).catch((error) => {
                if (error?.status === 404) return null;
                throw error;
            })
            : null;

        const claimMap = new Map();
        for (const claim of [...claims, ...pointClaims, ...(exactClaim ? [exactClaim] : [])]) {
            const claimRecordId = String(claim?.id || '').trim();
            if (!claimRecordId) continue;
            if (String(claim?.board_id || normalizedBoardId).trim() !== normalizedBoardId) continue;
            claimMap.set(claimRecordId, claim);
        }

        const deletedClaimIds = [];
        const deletedPointKeys = [];
        const failedClaimIds = [];

        for (const claim of claimMap.values()) {
            const claimId = String(claim?.id || '').trim();
            if (!claimId) continue;

            const pointKey = String(claim?.point_key || '').trim();
            const claimInviteId = String(claim?.invite_id || '').trim();
            const claimSlotValue = Number(claim?.claim_slot);
            const matchesCurrentInvite = claimInviteId === normalizedInviteId;
            const matchesCurrentSlot = Number.isInteger(claimSlotValue) && claimSlotValue === normalizedClaimSlot;
            const matchesCurrentPoint = normalizedPointKey && pointKey === normalizedPointKey;
            const matchesCurrentClaim = normalizedClaimId && claimId === normalizedClaimId;

            if (!matchesCurrentInvite && !matchesCurrentSlot && !matchesCurrentPoint && !matchesCurrentClaim) {
                continue;
            }

            try {
                await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).delete(claimId);
                deletedClaimIds.push(claimId);
                deletedPointKeys.push(pointKey);
            } catch {
                failedClaimIds.push(claimId);
            }
        }

        if (failedClaimIds.length > 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Unable to fully remove one or more well assignments.',
                failed_claim_ids: failedClaimIds
            }), { status: 500 });
        }

        return new Response(JSON.stringify({
            success: true,
            username,
            claim_slot: normalizedClaimSlot,
            deleted_claim_ids: deletedClaimIds,
            deleted_point_keys: deletedPointKeys.filter(Boolean)
        }));
    } catch (error) {
        console.log('Delete place well claim failed', error);
        const status = error?.status === 404 ? 403 : 500;
        const message = status === 403
            ? 'Invalid invite link.'
            : 'Unable to delete well assignment.';

        return new Response(JSON.stringify({
            success: false,
            error: message
        }), { status });
    }
};

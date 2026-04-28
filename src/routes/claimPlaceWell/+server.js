import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import {
    PLACE_BOARD_ID,
    PLACE_INVITES_COLLECTION,
    PLACE_WELL_CLAIMS_COLLECTION
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

async function latestClaimForInviteSlot(boardId, inviteId, claimSlot) {
    const normalizedBoardId = String(boardId || '').trim();
    const normalizedInviteId = String(inviteId || '').trim();
    const normalizedClaimSlot = Number(claimSlot);
    if (!normalizedBoardId || !normalizedInviteId || !Number.isInteger(normalizedClaimSlot)) {
        return null;
    }

    const claims = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
        sort: '-updated,-created',
        filter: `board_id="${normalizedBoardId}" && invite_id="${normalizedInviteId}" && claim_slot=${normalizedClaimSlot}`,
        fields: 'id,point_key,claim_slot'
    }).catch((error) => {
        if (error?.status === 404) return [];
        throw error;
    });

    return claims[0] || null;
}

export const POST = async ({ request }) => {
    const { boardId, inviteId, claimSlot, pointKey, plateId, x, y, wellLabel } = await request.json();

    const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;
    const normalizedInviteId = String(inviteId || '').trim();
    const normalizedPointKey = String(pointKey || '').trim();
    const normalizedPlateId = String(plateId || '').trim();
    const normalizedWellLabel = String(wellLabel || '').trim();
    const normalizedClaimSlot = Number(claimSlot);

    if (!normalizedInviteId) {
        return new Response(JSON.stringify({ success: false, error: 'Missing invite ID.' }), { status: 400 });
    }

    if (!normalizedPointKey || !normalizedPlateId || !Number.isFinite(x) || !Number.isFinite(y)) {
        return new Response(JSON.stringify({ success: false, error: 'Missing well coordinates.' }), { status: 400 });
    }

    if (!Number.isInteger(normalizedClaimSlot) || normalizedClaimSlot < 0 || normalizedClaimSlot > 7) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid claim slot.' }), { status: 400 });
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

        const existingPointClaims = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
            sort: '-updated,-created',
            filter: `board_id="${normalizedBoardId}" && point_key="${normalizedPointKey}"`,
            fields: 'id,invite_id,claim_slot'
        }).catch((error) => {
            if (error?.status === 404) return [];
            throw error;
        });

        const existingSlotClaims = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
            sort: '-updated,-created',
            filter: `board_id="${normalizedBoardId}" && invite_id="${normalizedInviteId}" && claim_slot=${normalizedClaimSlot}`,
            fields: 'id,point_key,claim_slot'
        }).catch((error) => {
            if (error?.status === 404) return [];
            throw error;
        });

        const stalePointClaimIds = new Set();
        const activePointClaims = [];

        for (const claim of existingPointClaims) {
            const claimId = String(claim?.id || '').trim();
            const claimInviteId = String(claim?.invite_id || '').trim();
            const claimSlotValue = Number(claim?.claim_slot);
            if (!claimId || !claimInviteId || !Number.isInteger(claimSlotValue)) continue;

            const latestForSlot = await latestClaimForInviteSlot(normalizedBoardId, claimInviteId, claimSlotValue);
            if (!latestForSlot?.id || String(latestForSlot.id).trim() !== claimId) {
                stalePointClaimIds.add(claimId);
                continue;
            }

            activePointClaims.push(claim);
        }

        for (const staleId of stalePointClaimIds) {
            await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).delete(staleId).catch(() => {});
        }

        const existingPointClaim = activePointClaims[0] || null;
        const canonicalSlotClaim = existingSlotClaims[0] || null;

        const isSameClaim =
            existingPointClaim?.id &&
            canonicalSlotClaim?.id &&
            existingPointClaim.id === canonicalSlotClaim.id;

        if (existingPointClaim?.id && !isSameClaim) {
            return new Response(JSON.stringify({
                success: false,
                conflict: true,
                error: 'That well has already been claimed.'
            }), { status: 409 });
        }

        const payload = {
            board_id: normalizedBoardId,
            point_key: normalizedPointKey,
            plate_id: normalizedPlateId,
            x: Number(x),
            y: Number(y),
            well_label: normalizedWellLabel,
            invite_id: normalizedInviteId,
            username: author,
            claim_slot: normalizedClaimSlot
        };

        let record;
        if (canonicalSlotClaim?.id) {
            record = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).update(canonicalSlotClaim.id, payload);
        } else {
            record = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).create(payload);
        }

        const inviteClaims = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getFullList({
            sort: '-updated,-created',
            filter: `board_id="${normalizedBoardId}" && invite_id="${normalizedInviteId}"`,
            fields: 'id,point_key,claim_slot'
        }).catch((error) => {
            if (error?.status === 404) return [];
            throw error;
        });

        const canonicalRecordId = String(record?.id || '').trim();
        const staleClaimIds = new Set();

        for (const claim of inviteClaims) {
            const claimId = String(claim?.id || '').trim();
            const claimPointKey = String(claim?.point_key || '').trim();
            const claimSlotValue = Number(claim?.claim_slot);
            if (!claimId || !Number.isInteger(claimSlotValue)) continue;

            if (claimId === canonicalRecordId) {
                continue;
            }

            if (claimSlotValue === normalizedClaimSlot || claimPointKey === normalizedPointKey) {
                staleClaimIds.add(claimId);
                continue;
            }
        }

        for (const claim of activePointClaims) {
            const claimId = String(claim?.id || '').trim();
            const claimInviteId = String(claim?.invite_id || '').trim();
            const claimSlotValue = Number(claim?.claim_slot);
            if (!claimId || claimId === canonicalRecordId) continue;

            if (claimInviteId === normalizedInviteId && claimSlotValue === normalizedClaimSlot) {
                staleClaimIds.add(claimId);
                continue;
            }

            if (claimInviteId !== normalizedInviteId) {
                staleClaimIds.add(claimId);
            }
        }

        for (const staleId of staleClaimIds) {
            await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).delete(staleId).catch(() => {});
        }

        return new Response(JSON.stringify({
            success: true,
            claim: {
                id: record.id,
                claim_slot: normalizedClaimSlot,
                point_key: normalizedPointKey,
                plate_id: normalizedPlateId,
                x: Number(x),
                y: Number(y),
                well_label: normalizedWellLabel
            }
        }));
    } catch (error) {
        console.log('Place well claim failed', error);
        const status = error?.status === 404 ? 403 : 500;
        const message = status === 403
            ? 'Invalid invite link.'
            : 'Unable to claim well.';

        return new Response(JSON.stringify({
            success: false,
            error: message
        }), { status });
    }
};

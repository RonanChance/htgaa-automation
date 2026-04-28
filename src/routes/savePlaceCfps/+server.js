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

export const POST = async ({ request }) => {
    try {
        const { boardId, inviteId, submission } = await request.json();
        const normalizedBoardId = String(boardId || PLACE_BOARD_ID).trim() || PLACE_BOARD_ID;
        const normalizedInviteId = String(inviteId || '').trim();

        if (!normalizedInviteId) {
            return new Response(JSON.stringify({ success: false, error: 'Missing invite ID.' }), { status: 400 });
        }

        if (!submission || !Array.isArray(submission?.variants) || submission.variants.length === 0) {
            return new Response(JSON.stringify({ success: false, error: 'No selected well compositions to publish.' }), { status: 400 });
        }

        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

        const invite = await pb.collection(PLACE_INVITES_COLLECTION).getOne(normalizedInviteId);
        const author = contributorNameFromInvite(invite);

        if (!author) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invite record is missing a username.'
            }), { status: 400 });
        }

        const variants = submission.variants
            .filter((variant) => variant?.claim?.id)
            .map((variant) => ({
                claimId: String(variant.claim.id || '').trim(),
                pointKey: String(variant.claim.point_key || '').trim(),
                slot: Number(variant.slot),
                reagents: Array.isArray(variant?.design?.supplement_json)
                    ? variant.design.supplement_json
                    : []
            }))
            .filter((variant) => variant.claimId);

        if (variants.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'No claimed wells were available to publish.'
            }), { status: 400 });
        }

        const updatedClaimIds = [];

        for (const variant of variants) {
            const existingClaim = await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).getOne(variant.claimId, {
                fields: 'id,board_id,invite_id,point_key,claim_slot'
            }).catch((error) => {
                if (error?.status === 404) return null;
                throw error;
            });

            if (!existingClaim) {
                continue;
            }

            if (
                String(existingClaim.board_id || '').trim() !== normalizedBoardId ||
                String(existingClaim.invite_id || '').trim() !== normalizedInviteId
            ) {
                continue;
            }

            await pb.collection(PLACE_WELL_CLAIMS_COLLECTION).update(variant.claimId, {
                reagents: variant.reagents
            });
            updatedClaimIds.push(variant.claimId);
        }

        if (updatedClaimIds.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'No matching claimed wells were available to update.'
            }), { status: 400 });
        }

        return new Response(JSON.stringify({
            success: true,
            claimIds: updatedClaimIds,
            updatedCount: updatedClaimIds.length,
            username: author
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.log('Place CFPS publish failed', error);
        return new Response(JSON.stringify({
            success: false,
            error: error?.message || 'Unable to publish selected CFPS compositions.'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

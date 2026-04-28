import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import { PLACE_INVITES_COLLECTION } from '$lib/place.js';

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
    const { id } = await request.json();
    const inviteId = String(id || '').trim();

    if (!inviteId) {
        return new Response(JSON.stringify({ success: false, valid: false, username: '' }), {
            status: 400
        });
    }

    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
        const invite = await pb.collection(PLACE_INVITES_COLLECTION).getOne(inviteId);
        const username = contributorNameFromInvite(invite);

        return new Response(JSON.stringify({
            success: true,
            valid: true,
            username,
            inviteId: invite.id
        }));
    } catch (error) {
        console.log('Place invite verification failed', error);
        return new Response(JSON.stringify({ success: true, valid: false, username: '' }), {
            status: 404
        });
    }
};

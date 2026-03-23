import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase("https://opentrons-art-pb.rcdonovan.com");

export const POST = async ({ request }) => {
    let { id } = await request.json();
    let record;
    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
        record = await pb.collection('sbs_designs_official').getOne(id);
    } catch (err) {
        if (err.status === 404) {
            try {
                record = await pb.collection('sbs_designs').getOne(id);
            } catch (err2) {
                if (err2.status === 404) {
                    record = await pb.collection('designs').getOne(id);
                } else {
                    return new Response(JSON.stringify({success: false}))
                }
            }
        } else {
            return new Response(JSON.stringify({success: false}))
        }
    }
    return new Response(JSON.stringify({ success: true, record }));
};

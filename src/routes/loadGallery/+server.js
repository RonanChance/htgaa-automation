import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase("https://db.rcdonovan.com");

export const POST = async ({ request }) => {
    let { record_load_iteration, filter } = await request.json();
    let start = record_load_iteration * 10;
    let end = start + 500;
    let records;
    try {
        await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
        if (filter === 0) {
            records = await pb.collection('designs').getList(start, end, { sort: '-created', filter: 'demo=false' });
        } else if (filter === 1){
            records = await pb.collection('designs').getList(start, end, { sort: '-created', filter: 'verified=true'});
        } else if (filter === 3) {
            records = await pb.collection('sbs_designs').getList(start, end, { sort: '-created' });
        } else {
            records = await pb.collection('designs').getList(start, end, { sort: '-created', filter: 'demo=false' });
        }
        
        return new Response(JSON.stringify({ success: true, records: records.items }));
    } catch (e) {
        console.log('Record request failed', e);
        return new Response(JSON.stringify({success: false}))
    }
};
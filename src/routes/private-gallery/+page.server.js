import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

function toItems(records, source) {
  return (records || []).map((r) => ({
    ...r,
    _source: source
  }));
}

export async function load({ url }) {
  const key = url.searchParams.get('key') || '';

  // Hidden unless the private key matches.
  const accessKey = env.PRIVATE_GALLERY_KEY || '';
  if (!accessKey || key !== accessKey) {
    throw error(404, 'Not found');
  }

  await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

  const [official, regular] = await Promise.all([
    pb.collection('sbs_designs_official').getList(1, 500, { sort: '-created' }),
    pb.collection('sbs_designs').getList(1, 500, { sort: '-created' })
  ]);

  const records = [
    ...toItems(official.items, 'official'),
    ...toItems(regular.items, 'regular')
  ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  return { records };
}

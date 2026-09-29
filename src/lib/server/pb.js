import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

// Single hardcoded instance URL (matches the rest of the app).
export const PB_URL = 'https://opentrons-art-pb.rcdonovan.com';

// Superuser-authenticated PocketBase client. Uses the `_superusers` auth
// collection route (the legacy /api/admins route 404s on this instance).
export async function pbAdmin() {
  const pb = new PocketBase(PB_URL);
  await pb.collection('_superusers').authWithPassword(PB_EMAIL, PB_PASSWORD);
  return pb;
}

import { loadCfpsReagentGroups } from '$lib/server/loadCfpsReagentGroups.js';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';
import { fail, redirect } from '@sveltejs/kit';
import { createHash } from 'crypto';
import PocketBase from 'pocketbase';

const COOKIE = 'cfps_auth';
const PB_URL = 'https://opentrons-art-pb.rcdonovan.com';
function tokenFor(password) {
  return createHash('sha256').update('cfps:' + password).digest('hex');
}

async function fetchPassword() {
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
  const record = await pb.collection('cfps_login').getOne('3yddrq278814c1d');
  return record.cfps_password ?? null;
}

export async function load({ url, cookies }) {
  const password = await fetchPassword();
  if (!password) return { authenticated: false, error: 'No password configured in PocketBase.' };

  const authenticated = cookies.get(COOKIE) === tokenFor(password);
  if (!authenticated) return { authenticated: false };

  const data = await loadCfpsReagentGroups(url);
  return { authenticated: true, ...data };
}

export const actions = {
  login: async ({ request, cookies }) => {
    const password = await fetchPassword();
    if (!password) return fail(500, { error: 'No password configured in PocketBase.' });

    const form = await request.formData();
    const entered = form.get('password')?.toString() ?? '';

    if (entered !== password) {
      return fail(401, { error: 'Incorrect password' });
    }

    cookies.set(COOKIE, tokenFor(password), {
      path: '/cfps',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    });

    redirect(303, '/cfps');
  },

  logout: async ({ cookies }) => {
    cookies.delete(COOKIE, { path: '/cfps' });
    redirect(303, '/cfps');
  }
};

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

// Localhost (`vite dev`) talks to the real PocketBase by default — reads AND writes —
// so /cfps previews the live community. Anything done locally (votes, stars,
// comments, submissions, edits) lands in production under the signed-in user
// (the "Dev Preview" dummy on localhost). Set CFPS_DEV_STUBS=1 in .env to swap
// back to the in-memory dummy stores for safe offline testing. Never active in a
// production build.
export const DEV_STUBS = dev && env.CFPS_DEV_STUBS === '1';

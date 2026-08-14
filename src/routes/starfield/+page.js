// Threlte + WebGL are client-only. Skip SSR entirely to avoid three.js
// touching `window` during prerender.
export const ssr = false;
export const prerender = false;

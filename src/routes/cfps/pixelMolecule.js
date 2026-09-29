// Shared procedural "molecular machine" pixel pattern. Used by both the ambient
// PixelField background and the reagent info modal, so a given reagent's machine
// looks the same wherever it appears. White pixels on a dark field.

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const rng = (seed) => {
  let s = seed || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
};

export const GLYPH = 7;

// Deterministic bilaterally-symmetric pixel blob for a reagent id. Returns the
// lit cells (grid coords 0..GLYPH-1) plus the seed so callers can derive stable
// per-machine motion phases.
export function moleculeCells(id) {
  const seed = hash(id || 'x');
  const rand = rng(seed);
  const G = GLYPH, c = (G - 1) / 2;
  const grid = Array.from({ length: G }, () => new Array(G).fill(0));
  for (let x = 0; x <= c; x++) {
    for (let y = 0; y < G; y++) {
      const dc = Math.hypot(x - c, y - c);
      if (rand() < 0.85 - dc * 0.2) { grid[y][x] = 1; grid[y][G - 1 - x] = 1; }
    }
  }
  grid[c][c] = 2;                                  // bright core
  const by = 1 + ((seed >>> 3) % (G - 2));         // horizontal bond nubs
  grid[by][0] = grid[by][G - 1] = 1;
  const cells = [];
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++)
      if (grid[y][x]) cells.push({ x, y, core: grid[y][x] === 2 });
  return { cells, size: G, center: c, seed };
}

// Render a reagent's machine to a PNG data URL for the info-modal image: white
// pixels with a soft glow on a dark rounded specimen tile (so it reads against
// the modal's light card). Guarantees every reagent has an image, even the
// proteins / polymers / mixtures with no single PubChem structure.
export function moleculeDataUrl(id, { cell = 16, pad = 24, bg = '#10161d' } = {}) {
  if (typeof document === 'undefined') return '';
  const { cells, size } = moleculeCells(id);
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  const W = cell * size + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = W * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  // rounded dark tile
  const r = 16;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, W, r); ctx.arcTo(W, W, 0, W, r);
  ctx.arcTo(0, W, 0, 0, r); ctx.arcTo(0, 0, W, 0, r);
  ctx.closePath(); ctx.fill();
  // white cells with a gentle glow
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  for (const c of cells) {
    ctx.shadowBlur = c.core ? 11 : 6;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = c.core ? 1 : 0.82;
    ctx.fillRect(pad + c.x * cell + 1.5, pad + c.y * cell + 1.5, cell - 3, cell - 3);
  }
  return cv.toDataURL('image/png');
}

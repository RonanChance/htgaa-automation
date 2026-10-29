// Colour for a link value on the page's dark ground: near-black at 0, through
// blue and teal, to yellow at 1 — the same ramp in every heatmap and bar.
const STOPS = [
  [0, [14, 17, 22]],
  [0.25, [32, 68, 104]],
  [0.5, [44, 140, 170]],
  [0.75, [92, 208, 179]],
  [1, [255, 216, 102]]
];

export function heatRGB(v) {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i];
    if (x <= b) {
      const [a, ca] = STOPS[i - 1];
      const t = (x - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const heat = (v) => `rgb(${heatRGB(v).join(',')})`;

// What each round-1 role looks like, everywhere on the page.
export const ROLE_STYLE = {
  first: { label: 'first test', color: '#ffd866' },
  check: { label: 'check test', color: '#5cd0b3' },
  independent: { label: 'independent test', color: '#a87cd8' },
  sweep: { label: 'sweep test', color: '#f0ac5f' },
  follows: { label: "follows its group's tests", color: '#4b5563' }
};

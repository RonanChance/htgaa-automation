// Shared helpers for the JSON edit views in the community reagents and literature
// sections (see JsonEditor.svelte for the textarea itself).

export const serialize = (v) => JSON.stringify(v, null, 2);

// Text → { ok, entries } (an array; a lone object is wrapped) or { ok:false, error }
// with a line number when the parser reports a position. Empty text is zero entries.
export function parseEntries(text) {
  if (!String(text || '').trim()) return { ok: true, entries: [] };
  try {
    const v = JSON.parse(text);
    const entries = Array.isArray(v) ? v : [v];
    const bad = entries.findIndex((e) => !e || typeof e !== 'object' || Array.isArray(e));
    if (bad >= 0) return { ok: false, error: `Entry ${bad + 1} is not an object { … }.` };
    return { ok: true, entries };
  } catch (e) {
    const msg = String(e?.message || 'Invalid JSON');
    const pos = /position (\d+)/.exec(msg);
    const line = /line (\d+)/.exec(msg)?.[1] ?? (pos ? text.slice(0, Number(pos[1])).split('\n').length : null);
    return { ok: false, error: `${line ? `Line ${line}: ` : ''}${msg.replace(/^JSON\.parse: /, '')}` };
  }
}

import { DEV_STUBS } from '$lib/server/devStubs.js';
import { pbAdmin } from '$lib/server/pb.js';
import { clampComment } from '$lib/server/suggestions.js';

// Literature research list: a shared, ever-growing set of papers/articles relevant
// to the coopetition, ranked by upvotes. Papers live in cfps_literature (title,
// authors, published, venue, url, doi, summary, tags, added_by_*, votes); one
// upvote per Keycloak user is enforced by a unique (literature, voter_sub) index on
// cfps_literature_votes — the same pattern as the community-reagent votes. Both
// collections are admin-only, so every read/write goes through the superuser client.
//
// A DOI (or a link containing one) is enough to add a paper: missing title /
// authors / date / venue are filled from doi.org's citation metadata (CSL-JSON,
// which covers Crossref and DataCite DOIs, so bioRxiv and arXiv too).
//
// On localhost (`vite dev`) an in-memory store stands in for PocketBase.
export const LITERATURE = 'cfps_literature';
export const LITERATURE_VOTES = 'cfps_literature_votes';

const LIMITS = { title: 500, authors: 2000, venue: 300, url: 1000, doi: 200, tags: 8, tagLen: 40 };

// ── normalisers ─────────────────────────────────────────────────────────────

// "https://doi.org/10.1101/X", "doi:10.1101/X", "10.1101/X" → "10.1101/x" (DOIs are
// case-insensitive). Returns '' when there's no DOI in the string.
export function normalizeDoi(s) {
  const m = /10\.\d{4,9}\/[^\s"<>?#]+/i.exec(String(s ?? ''));
  return m ? m[0].replace(/[.,;)\]]+$/, '').toLowerCase() : '';
}

// http(s) only; a bare domain is assumed https; any other scheme is rejected.
function sanitizeUrl(s) {
  const v = String(s ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';
  return `https://${v}`;
}

// Comparable form of a URL for duplicate detection: no scheme/www/trailing slash/hash.
function urlKey(u) {
  return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
}

// "2024", "2024-3", "2024-03-05", "March 2024", an ISO timestamp, … → "YYYY",
// "YYYY-MM" or "YYYY-MM-DD". Returns null if unparseable, '' if empty.
export function normalizePublished(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) v = v.join('-'); // CSL date-parts [y, m, d]
  const s = String(v).trim();
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/.exec(s);
  if (!m) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    m = [null, String(d.getUTCFullYear()), String(d.getUTCMonth() + 1), null];
  }
  const [, y, mo, da] = m;
  const year = Number(y);
  if (year < 1800 || year > new Date().getUTCFullYear() + 1) return null;
  if (!mo) return y;
  const mm = Number(mo);
  if (mm < 1 || mm > 12) return null;
  if (!da) return `${y}-${String(mm).padStart(2, '0')}`;
  const dd = Number(da);
  if (dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function cleanTags(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  const out = [];
  for (const t of list) {
    const tag = String(t ?? '').trim().toLowerCase().slice(0, LIMITS.tagLen);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

function cleanAuthors(v) {
  const s = Array.isArray(v) ? v.map((a) => String(a ?? '').trim()).filter(Boolean).join(', ') : String(v ?? '').trim();
  return s.slice(0, LIMITS.authors);
}

// ── DOI metadata lookup ─────────────────────────────────────────────────────

// CSL-JSON from doi.org → { title, authors, published, venue, url, doi } (fields
// may be empty). Throws on network failure / unknown DOI.
export async function lookupDoi(doiInput) {
  const doi = normalizeDoi(doiInput);
  if (!doi) throw new Error('That does not look like a DOI (expected something like 10.1101/2024.01.01.123456).');
  const res = await fetch(`https://doi.org/${encodeURI(doi)}`, {
    headers: { Accept: 'application/vnd.citationstyles.csl+json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000)
  });
  if (res.status === 404) throw new Error(`DOI ${doi} was not found at doi.org.`);
  if (!res.ok) throw new Error(`DOI lookup failed (${res.status}).`);
  const csl = await res.json();
  const pick = (x) => (Array.isArray(x) ? x[0] : x) || '';
  const authors = (csl.author || [])
    .map((a) => a.literal || [a.given, a.family].filter(Boolean).join(' '))
    .filter(Boolean);
  const parts =
    csl.issued?.['date-parts']?.[0] ||
    csl['published-print']?.['date-parts']?.[0] ||
    csl['published-online']?.['date-parts']?.[0] ||
    csl.created?.['date-parts']?.[0];
  return {
    title: String(pick(csl.title)).replace(/\s+/g, ' ').trim().slice(0, LIMITS.title),
    authors: cleanAuthors(authors),
    published: (parts && normalizePublished(parts)) || '',
    venue: String(pick(csl['container-title']) || csl.publisher || '').trim().slice(0, LIMITS.venue),
    // Resolver links (dx.doi.org / doi.org, often plain http) → canonical https form.
    url: (/^https?:\/\/(dx\.)?doi\.org\//i.test(csl.URL || '') ? '' : sanitizeUrl(csl.URL)) || `https://doi.org/${doi}`,
    doi
  };
}

// ── validation ──────────────────────────────────────────────────────────────

// Raw input → { paper, errors[] }. Fills blanks from the DOI when possible. Each
// error is { field, message } so agents can fix exactly what's wrong.
export async function preparePaper(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];
  let doi = normalizeDoi(src.doi);
  if (src.doi && !doi) errors.push({ field: 'doi', message: `"${String(src.doi).slice(0, 80)}" is not a DOI (expected 10.xxxx/…).` });
  let url = sanitizeUrl(src.url ?? src.link);
  if ((src.url ?? src.link) && !url) errors.push({ field: 'url', message: 'url must be an http(s) link.' });
  if (!doi && url) doi = normalizeDoi(url);

  const paper = {
    title: String(src.title ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title),
    authors: cleanAuthors(src.authors),
    published: normalizePublished(src.published ?? src.date ?? src.year),
    venue: String(src.venue ?? src.journal ?? '').trim().slice(0, LIMITS.venue),
    url: url.slice(0, LIMITS.url),
    doi: doi.slice(0, LIMITS.doi),
    summary: clampComment(src.summary ?? src.notes ?? ''),
    tags: cleanTags(src.tags)
  };
  if (paper.published === null) {
    errors.push({ field: 'published', message: 'published must be a date like 2024, 2024-03 or 2024-03-05.' });
    paper.published = '';
  }

  // Fill any blanks from the DOI's citation metadata (best-effort unless the title
  // itself is missing, in which case the lookup is what makes the entry valid).
  let lookupError = '';
  if (paper.doi && (!paper.title || !paper.authors || !paper.published || !paper.venue || !paper.url)) {
    try {
      const meta = await lookupDoi(paper.doi);
      for (const k of ['title', 'authors', 'published', 'venue', 'url']) if (!paper[k] && meta[k]) paper[k] = meta[k];
    } catch (e) {
      lookupError = e?.message || 'DOI lookup failed.';
    }
  }

  if (!paper.title) {
    errors.push({
      field: 'title',
      message: lookupError ? `title is required (and the DOI lookup failed: ${lookupError})` : 'title is required (or give a DOI to fill it in).'
    });
  }
  if (!paper.url && !paper.doi) errors.push({ field: 'url', message: 'Give a link (url) or a DOI so others can find the paper.' });
  if (!paper.url && paper.doi) paper.url = `https://doi.org/${paper.doi}`;
  return { paper, errors };
}

// ── shapes ──────────────────────────────────────────────────────────────────

function normalize(rec, mySub, voted) {
  let tags = rec.tags;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
  return {
    id: rec.id,
    title: rec.title || '',
    authors: rec.authors || '',
    published: rec.published || '',
    venue: rec.venue || '',
    url: rec.url || '',
    doi: rec.doi || '',
    summary: rec.summary || '',
    tags: Array.isArray(tags) ? tags : [],
    addedBy: rec.added_by_name || 'anonymous',
    submittedVia: rec.submitted_via || null,
    created: rec.created || null,
    votes: Number(rec.votes) || 0,
    voted: voted.has(rec.id),
    mine: !!mySub && rec.added_by_sub === mySub
  };
}

const byRank = (a, b) => (b.votes - a.votes) || String(b.created || '').localeCompare(String(a.created || ''));

// ── localhost dummy store ───────────────────────────────────────────────────
const DEV_PAPERS = [
  { id: 'dev-lit-1', title: 'Mimicking the Escherichia coli cytoplasmic environment activates long-lived and efficient cell-free protein synthesis',
    authors: 'Michael C. Jewett, James R. Swartz', published: '2004-04', venue: 'Biotechnology and Bioengineering',
    url: 'https://doi.org/10.1002/bit.20026', doi: '10.1002/bit.20026',
    summary: 'The Cytomim system: glutamate salts, polyamines and no PEG keep oxidative phosphorylation running — the basis of most modern PANOx-SP style recipes.',
    tags: ['energy', 'classic'], added_by_name: 'Grace H.', added_by_sub: 'dev-grace', votes: 4, created: '2026-09-20T09:00:00Z' },
  { id: 'dev-lit-2', title: 'Cell-free protein synthesis: applications come of age',
    authors: 'Erik D. Carlson, Rui Gan, C. Eric Hodgman, Michael C. Jewett', published: '2012', venue: 'Biotechnology Advances',
    url: 'https://doi.org/10.1016/j.biotechadv.2011.09.016', doi: '10.1016/j.biotechadv.2011.09.016',
    summary: 'Broad review — good orientation on what limits CFPS yields.', tags: ['review'],
    added_by_name: 'Ada L.', added_by_sub: 'dev-ada', votes: 2, created: '2026-09-24T12:00:00Z' }
];
const DEV_VOTES = new Map(); // voter_sub → Set(paperId)
let devSeq = DEV_PAPERS.length;

// ── public API (dev-or-PocketBase) ──────────────────────────────────────────

// Ranked list + the viewer's votes. Never throws — a hiccup renders an empty list.
export async function getLiterature(kcUser) {
  const mySub = kcUser?.sub || '';
  if (!mySub) return { items: [], votedIds: [] };
  if (DEV_STUBS) {
    const voted = DEV_VOTES.get(mySub) ?? new Set();
    return { items: DEV_PAPERS.map((r) => normalize(r, mySub, voted)).sort(byRank), votedIds: [...voted] };
  }
  try {
    const pb = await pbAdmin();
    const rows = await pb.collection(LITERATURE).getFullList({ sort: '-votes,-created' });
    const votes = await pb.collection(LITERATURE_VOTES).getFullList({ filter: pb.filter('voter_sub = {:s}', { s: mySub }) });
    const voted = new Set(votes.map((v) => v.literature));
    return { items: rows.map((r) => normalize(r, mySub, voted)).sort(byRank), votedIds: [...voted] };
  } catch {
    return { items: [], votedIds: [] };
  }
}

// Add a paper. Returns { ok, item } or { ok:false, reason:'invalid', errors } /
// { ok:false, reason:'duplicate', existing }.
export async function addPaper(kcUser, input) {
  const { paper, errors } = await preparePaper(input);
  if (errors.length) return { ok: false, reason: 'invalid', errors };
  const mySub = String(kcUser.sub);
  const record = {
    ...paper, added_by_sub: mySub, added_by_name: String(kcUser.name || 'anonymous').slice(0, 200), votes: 0,
    submitted_via: kcUser.via === 'agent' ? 'agent' : 'user'
  };
  const isDup = (r) => (paper.doi && String(r.doi || '').toLowerCase() === paper.doi) || urlKey(r.url) === urlKey(paper.url);

  if (DEV_STUBS) {
    const dup = DEV_PAPERS.find(isDup);
    if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, DEV_VOTES.get(mySub) ?? new Set()) };
    const rec = { id: `dev-lit-${++devSeq}`, ...record, created: new Date().toISOString() };
    DEV_PAPERS.push(rec);
    return { ok: true, item: normalize(rec, mySub, new Set()) };
  }
  const pb = await pbAdmin();
  const candidates = paper.doi
    ? await pb.collection(LITERATURE).getFullList({ filter: pb.filter('doi = {:d}', { d: paper.doi }) })
    : await pb.collection(LITERATURE).getFullList({ fields: 'id,url,doi,title,votes,created,added_by_name,added_by_sub' });
  const dup = candidates.find(isDup);
  if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
  const rec = await pb.collection(LITERATURE).create(record);
  return { ok: true, item: normalize(rec, mySub, new Set()) };
}

// Edit a paper — only whoever added it may. `input` may be partial (an agent fixing
// one field): it's laid over the stored values, then re-validated exactly like an
// add. Returns { ok, item } or { ok:false, reason:'not_found'|'forbidden'|'invalid'
// |'duplicate', errors?, existing? }.
export async function updatePaper(kcUser, id, input) {
  const mySub = String(kcUser.sub);
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const current = DEV_STUBS ? DEV_PAPERS.find((p) => p.id === id) : null;
  let pb = null;
  let rec = current;
  if (!DEV_STUBS) {
    pb = await pbAdmin();
    rec = await pb.collection(LITERATURE).getOne(id).catch(() => null);
  }
  if (!rec) return { ok: false, reason: 'not_found' };
  if (rec.added_by_sub !== mySub) return { ok: false, reason: 'forbidden' };

  let tags = rec.tags;
  if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
  const merged = {
    title: rec.title, authors: rec.authors, published: rec.published, venue: rec.venue,
    url: rec.url, doi: rec.doi, summary: rec.summary, tags: Array.isArray(tags) ? tags : [],
    ...src
  };
  const { paper, errors } = await preparePaper(merged);
  if (errors.length) return { ok: false, reason: 'invalid', errors };

  const isDup = (r) => r.id !== id && ((paper.doi && String(r.doi || '').toLowerCase() === paper.doi) || urlKey(r.url) === urlKey(paper.url));
  if (DEV_STUBS) {
    const dup = DEV_PAPERS.find(isDup);
    if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
    Object.assign(rec, paper);
    return { ok: true, item: normalize(rec, mySub, DEV_VOTES.get(mySub) ?? new Set()) };
  }
  const others = await pb.collection(LITERATURE).getFullList({ fields: 'id,url,doi,title,votes,created,added_by_name,added_by_sub' });
  const dup = others.find(isDup);
  if (dup) return { ok: false, reason: 'duplicate', existing: normalize(dup, mySub, new Set()) };
  const saved = await pb.collection(LITERATURE).update(id, paper);
  return { ok: true, item: normalize(saved, mySub, new Set()) };
}

// The ranked list as plain text — for the "↓" button (opens in a new tab) and for
// agents that would rather read prose than JSON.
export function literatureAsText(items) {
  const lines = [
    'Cell-Free Synthesis Coopetition — literature research list',
    `Exported ${new Date().toISOString().slice(0, 10)} · ${items.length} paper${items.length === 1 ? '' : 's'} · ranked by upvotes`,
    ''
  ];
  items.forEach((p, i) => {
    lines.push(`${i + 1}. [▲ ${p.votes}] ${p.title}`);
    if (p.authors) lines.push(`   ${p.authors}`);
    const meta = [p.venue, p.published, p.doi ? `doi:${p.doi}` : ''].filter(Boolean).join(' · ');
    if (meta) lines.push(`   ${meta}`);
    if (p.url) lines.push(`   ${p.url}`);
    if (p.tags?.length) lines.push(`   Tags: ${p.tags.join(', ')}`);
    if (p.summary) lines.push(`   Why it's relevant: ${p.summary.replace(/\s*\n\s*/g, ' ')}`);
    lines.push(`   Added by ${p.addedBy}${p.created ? ` on ${String(p.created).slice(0, 10)}` : ''} · id ${p.id}`);
    lines.push('');
  });
  if (!items.length) lines.push('No papers yet.');
  return lines.join('\n');
}

// One upvote per user (idempotent). Returns { ok, reason? }.
export async function votePaper(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const rec = DEV_PAPERS.find((p) => p.id === id);
    if (!rec) return { ok: false, reason: 'not_found' };
    const set = DEV_VOTES.get(sub) ?? new Set();
    if (!set.has(id)) { set.add(id); rec.votes += 1; DEV_VOTES.set(sub, set); }
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(LITERATURE).getOne(id).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  try {
    await pb.collection(LITERATURE_VOTES).create({ literature: id, voter_sub: sub, voter_name: kcUser.name || 'anonymous' });
  } catch {
    return { ok: true, dup: true }; // unique index → already voted
  }
  await pb.collection(LITERATURE).update(id, { votes: (Number(rec.votes) || 0) + 1 });
  return { ok: true };
}

export async function unvotePaper(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const rec = DEV_PAPERS.find((p) => p.id === id);
    const set = DEV_VOTES.get(sub);
    if (rec && set?.delete(id)) rec.votes = Math.max(0, rec.votes - 1);
    return { ok: true };
  }
  const pb = await pbAdmin();
  const existing = await pb.collection(LITERATURE_VOTES).getFullList({
    filter: pb.filter('literature = {:p} && voter_sub = {:s}', { p: id, s: sub })
  });
  if (!existing.length) return { ok: true };
  for (const v of existing) await pb.collection(LITERATURE_VOTES).delete(v.id);
  const rec = await pb.collection(LITERATURE).getOne(id).catch(() => null);
  if (rec) await pb.collection(LITERATURE).update(id, { votes: Math.max(0, (Number(rec.votes) || 0) - existing.length) });
  return { ok: true };
}

// Delete a paper — only whoever added it may (its votes cascade-delete).
export async function deletePaper(kcUser, id) {
  const sub = String(kcUser.sub);
  if (DEV_STUBS) {
    const i = DEV_PAPERS.findIndex((p) => p.id === id);
    if (i < 0) return { ok: false, reason: 'not_found' };
    if (DEV_PAPERS[i].added_by_sub !== sub) return { ok: false, reason: 'forbidden' };
    DEV_PAPERS.splice(i, 1);
    for (const set of DEV_VOTES.values()) set.delete(id);
    return { ok: true };
  }
  const pb = await pbAdmin();
  const rec = await pb.collection(LITERATURE).getOne(id).catch(() => null);
  if (!rec) return { ok: false, reason: 'not_found' };
  if (rec.added_by_sub !== sub) return { ok: false, reason: 'forbidden' };
  await pb.collection(LITERATURE).delete(id);
  return { ok: true };
}

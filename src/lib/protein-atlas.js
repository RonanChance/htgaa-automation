// Pull a random protein entry from the RCSB Protein Data Bank atlas.
// Uses the public RCSB Search API (v2) — no auth required, permissive CORS.
//
// Filter is intentionally narrow so picks stay fun and browser-friendly:
//   - single polymer entity (avoids sprawling complexes)
//   - X-ray structure (guaranteed atomic coordinates)
//   - 60–400 residues (readable sequence strip, fast render)
//   - resolution ≤ 2.5 Å (crisp structures)
// That filter still returns tens of thousands of entries — plenty of lottery.

import {
    organismTag,
    tagsFromUniprotKeywords,
    tagFromDiseaseAnnotations
} from './protein-tags.js';
import { suggestAssay, normalizeEcNumbers } from './protein-assays.js';

const SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query';
const DATA_ROOT = 'https://data.rcsb.org/rest/v1/core';
const ENTRY_META_URL = (pdbId) => `${DATA_ROOT}/entry/${pdbId.toUpperCase()}`;
const POLYMER_ENTITY_URL = (pdbId, entityId = 1) =>
    `${DATA_ROOT}/polymer_entity/${pdbId.toUpperCase()}/${entityId}`;
const UNIPROT_URL = (pdbId, entityId = 1) =>
    `${DATA_ROOT}/uniprot/${pdbId.toUpperCase()}/${entityId}`;

// Wrap fetch with an AbortController timeout. Without this a stalled RCSB
// connection would keep `loading` stuck forever on the caller side — the
// spinner never resolves because control never returns from `await fetch`.
async function timedFetch(url, opts = {}, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

// Bucket a raw related-structure count into a 1–5 star tier.
// Thresholds calibrated empirically across curated + random samples: rare
// (single-digit) → textbook (500+, e.g. GFP, insulin, trypsin, lysozyme).
function rankFromStructureCount(n) {
    if (n >= 500) return { stars: 5, label: 'textbook' };
    if (n >= 150) return { stars: 4, label: 'well-studied' };
    if (n >= 40)  return { stars: 3, label: 'moderate' };
    if (n >= 10)  return { stars: 2, label: 'niche' };
    return { stars: 1, label: 'rare' };
}

// Count how many PDB polymer entities share this UniProt accession — a
// direct proxy for how much a protein has been studied structurally. A
// paginate rows=0 request returns total_count without fetching entries.
async function fetchRelatedStructureCount(uniprotAccession) {
    if (!uniprotAccession) return null;
    try {
        const body = {
            query: {
                type: 'terminal', service: 'text',
                parameters: {
                    attribute: 'rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession',
                    operator: 'exact_match',
                    value: uniprotAccession
                }
            },
            return_type: 'polymer_entity',
            request_options: {
                paginate: { start: 0, rows: 0 },
                results_content_type: ['experimental']
            }
        };
        const res = await timedFetch(SEARCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, 6000);
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.total_count === 'number' ? data.total_count : null;
    } catch {
        return null;
    }
}

async function tryJson(url) {
    try {
        const res = await timedFetch(url, {}, 8000);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// Enrich a PDB entry with organism / function / disease tags AND a suggested
// bench assay, derived from RCSB polymer_entity + UniProt cross-reference.
// Both fetches happen in parallel; missing fields are silently skipped so
// partial data still yields something useful.
export async function fetchAnnotations(pdbId, { entityId = 1 } = {}) {
    const [entity, uniprotRaw] = await Promise.all([
        tryJson(POLYMER_ENTITY_URL(pdbId, entityId)),
        tryJson(UNIPROT_URL(pdbId, entityId))
    ]);

    const tags = [];

    // Organism first — it's the most tangible ("this is from a jellyfish").
    const orgTag = organismTag(entity?.rcsb_entity_source_organism);
    if (orgTag) tags.push(orgTag);

    // UniProt keywords give curated, human-friendly function labels.
    const uniprot = Array.isArray(uniprotRaw) ? uniprotRaw[0] : uniprotRaw;
    const keywords = uniprot?.rcsb_uniprot_keyword;
    const kwTags = tagsFromUniprotKeywords(keywords, { max: 4 });
    for (const t of kwTags) tags.push(t);

    // One disease tag if UniProt has any disease annotations.
    const diseaseTag = tagFromDiseaseAnnotations(uniprot?.rcsb_uniprot_annotation);
    if (diseaseTag) tags.push(diseaseTag);

    // Assay suggestion: prefer EC (chemistry-specific), fall back to keywords.
    // EC comes from two possible sources — try both.
    const ecFromEntity = normalizeEcNumbers(entity?.rcsb_polymer_entity?.pdbx_ec);
    const ecFromUniprot = normalizeEcNumbers(uniprot?.rcsb_uniprot_protein?.ec);
    const ecNumbers = [...new Set([...ecFromEntity, ...ecFromUniprot])];
    const assay = suggestAssay({ ecNumbers, uniprotKeywords: keywords || [] });

    // Research intensity: count PDB entities sharing this UniProt accession.
    // Accession is in the entity payload (SIFTS cross-ref) — try that first,
    // fall back to the uniprot payload's container identifiers.
    const accession =
        entity?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers?.[0]?.database_accession
        || uniprot?.rcsb_uniprot_container_identifiers?.uniprot_id
        || null;
    let research = null;
    if (accession) {
        const count = await fetchRelatedStructureCount(accession);
        if (count != null) research = { count, accession, ...rankFromStructureCount(count) };
    }

    return { tags, assay, research };
}

// Back-compat wrapper — some callers only want tags.
export async function fetchDerivedTags(pdbId, opts) {
    const { tags } = await fetchAnnotations(pdbId, opts);
    return tags;
}

// The random offset ceiling. Kept well below the true match count so the
// paginate call always resolves; the true count for this filter is > 20k.
const RANDOM_MAX_OFFSET = 15000;

function buildSearchBody(start) {
    return {
        query: {
            type: 'group',
            logical_operator: 'and',
            nodes: [
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'entity_poly.rcsb_entity_polymer_type',
                        operator: 'exact_match',
                        value: 'Protein'
                    }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'rcsb_entry_info.polymer_entity_count_protein',
                        operator: 'equals',
                        value: 1
                    }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'entity_poly.rcsb_sample_sequence_length',
                        operator: 'range',
                        value: { from: 60, to: 400, include_lower: true, include_upper: true }
                    }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'exptl.method',
                        operator: 'exact_match',
                        value: 'X-RAY DIFFRACTION'
                    }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'rcsb_entry_info.resolution_combined',
                        operator: 'less_or_equal',
                        value: 2.5
                    }
                }
            ]
        },
        return_type: 'entry',
        request_options: {
            paginate: { start, rows: 1 },
            results_content_type: ['experimental']
        }
    };
}

async function fetchRandomPdbId() {
    const start = Math.floor(Math.random() * RANDOM_MAX_OFFSET);
    const res = await timedFetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSearchBody(start))
    }, 8000);
    if (!res.ok) throw new Error(`RCSB search HTTP ${res.status}`);
    const data = await res.json();
    const id = data?.result_set?.[0]?.identifier;
    if (!id) throw new Error('RCSB search returned no entry');
    return id;
}

async function fetchEntryTitle(pdbId) {
    try {
        const res = await timedFetch(ENTRY_META_URL(pdbId), {}, 6000);
        if (!res.ok) return null;
        const meta = await res.json();
        return meta?.struct?.title || null;
    } catch {
        return null;
    }
}

// Look up a PDB entry by free-text name (e.g. "hexokinase", "insulin receptor",
// "1TIM"). Uses the RCSB full-text search — matches structure titles, keywords,
// author-supplied descriptions. Returns the top-scoring hit as a catalog-shaped
// entry, or null if no reasonable match exists.
export async function searchAtlasByName(query) {
    if (!query) return null;
    const q = String(query).trim();
    if (!q) return null;

    const body = {
        query: {
            type: 'group',
            logical_operator: 'and',
            nodes: [
                {
                    type: 'terminal',
                    service: 'full_text',
                    parameters: { value: q }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'entity_poly.rcsb_entity_polymer_type',
                        operator: 'exact_match',
                        value: 'Protein'
                    }
                },
                {
                    type: 'terminal',
                    service: 'text',
                    parameters: {
                        attribute: 'entity_poly.rcsb_sample_sequence_length',
                        operator: 'range',
                        value: { from: 20, to: 800, include_lower: true, include_upper: true }
                    }
                }
            ]
        },
        return_type: 'entry',
        request_options: {
            paginate: { start: 0, rows: 1 },
            sort: [{ sort_by: 'score', direction: 'desc' }]
        }
    };

    const res = await timedFetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    const pdbId = data?.result_set?.[0]?.identifier;
    if (!pdbId) return null;

    const title = await fetchEntryTitle(pdbId);
    const cleaned = title ? title.replace(/\s+/g, ' ').trim() : `PDB entry ${pdbId}`;
    return {
        name: q,
        aliases: [q.toLowerCase(), pdbId.toLowerCase()],
        pdbId,
        chain: 'A',
        description: cleaned,
        beneficialMutations: null,
        wildcard: true
    };
}

// Return a catalog-shaped entry for a random PDB structure.
// Shape matches PROTEINS[i] so it plugs straight into loadProtein().
export async function fetchRandomAtlasEntry({ attempts = 3 } = {}) {
    let lastErr = null;
    for (let i = 0; i < attempts; i += 1) {
        try {
            const pdbId = await fetchRandomPdbId();
            const title = await fetchEntryTitle(pdbId);
            const cleaned = title ? title.replace(/\s+/g, ' ').trim() : `PDB entry ${pdbId}`;
            return {
                name: pdbId,
                aliases: [pdbId.toLowerCase()],
                pdbId,
                chain: 'A',
                description: cleaned,
                beneficialMutations: null,
                wildcard: true
            };
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('Could not fetch a random PDB entry');
}

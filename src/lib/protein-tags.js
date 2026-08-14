// Glyph tag derivation. Turns raw PDB/UniProt metadata into a small set of
// pill-style tags like { glyph: '🪼', label: 'jellyfish', tooltip: 'Aequorea victoria' }.
// The point is to give a viewer something tangible to associate the protein
// with — an animal, a use-case, a disease — in a single glance.

// --- Organism kingdom/taxon → glyph. Matched against taxonomy_lineage names ---
// Ordered from most specific → least specific so cnidarian beats "animal".
const LINEAGE_GLYPHS = [
    { match: /^Cnidaria$|cnidarian/i,        glyph: '🪼', label: 'jellyfish/coral' },
    { match: /^Insecta$|insect/i,            glyph: '🪲', label: 'insect' },
    { match: /^Arachnida$/i,                 glyph: '🕷', label: 'arachnid' },
    { match: /^Crustacea$/i,                 glyph: '🦐', label: 'crustacean' },
    { match: /^Mollusca$/i,                  glyph: '🐚', label: 'mollusc' },
    { match: /^Actinopterygii$|bony fish/i,  glyph: '🐟', label: 'fish' },
    { match: /^Aves$|bird/i,                 glyph: '🐦', label: 'bird' },
    { match: /^Amphibia$/i,                  glyph: '🐸', label: 'amphibian' },
    { match: /^Reptilia$|snake/i,            glyph: '🐍', label: 'reptile' },
    { match: /Cetacea|whale|dolphin/i,       glyph: '🐋', label: 'whale/dolphin' },
    { match: /^Bovidae$|cattle|cow/i,        glyph: '🐄', label: 'cow' },
    { match: /^Suidae$|pig/i,                glyph: '🐷', label: 'pig' },
    { match: /^Equidae$|horse/i,             glyph: '🐴', label: 'horse' },
    { match: /Homo sapiens|human/i,          glyph: '🧑', label: 'human' },
    { match: /Muridae|mouse|rat/i,           glyph: '🐭', label: 'rodent' },
    { match: /^Mammalia$|mammal/i,           glyph: '🐾', label: 'mammal' },
    { match: /Viridiplantae|plant|Embryoph/i,glyph: '🌱', label: 'plant' },
    { match: /^Fungi$|fungus|yeast/i,        glyph: '🍄', label: 'fungus' },
    { match: /^Bacteria$|bacterium/i,        glyph: '🧫', label: 'bacterium' },
    { match: /^Archaea$/i,                   glyph: '🌋', label: 'archaeon' },
    { match: /virus|Viruses|viral/i,         glyph: '🦠', label: 'virus' },
    { match: /Alveolata|Apicomplexa/i,       glyph: '🦟', label: 'parasite' }
];

// --- UniProt keyword → glyph. Applied to `rcsb_uniprot_keyword[].value`. ---
// UniProt keywords are curated, short, and human-friendly.
const UNIPROT_KEYWORD_GLYPHS = [
    { match: /^Fluorescent protein$|Chromophore/i,   glyph: '✨', label: 'fluorescent' },
    { match: /^Bioluminescence$|Luminescence/i,      glyph: '💡', label: 'bioluminescent' },
    { match: /^Photosynthesis$/i,                    glyph: '☀️', label: 'photosynthesis' },
    { match: /^Toxin$|Neurotoxin|Enterotoxin/i,      glyph: '☠️', label: 'toxin' },
    { match: /^Antibiotic$|Antimicrobial/i,          glyph: '🧪', label: 'antimicrobial' },
    { match: /^Antiviral defense$|Antiviral/i,       glyph: '🛡', label: 'antiviral' },
    { match: /^Pharmaceutical$/i,                    glyph: '💊', label: 'pharmaceutical' },
    { match: /^Vaccine$/i,                           glyph: '💉', label: 'vaccine' },
    { match: /^Hormone$/i,                           glyph: '📡', label: 'hormone' },
    { match: /^Immunity$|Innate immunity|Adaptive/i, glyph: '🛡', label: 'immune' },
    { match: /^Immunoglobulin/i,                     glyph: '🛡', label: 'antibody' },
    { match: /^Antifreeze/i,                         glyph: '❄️', label: 'antifreeze' },
    { match: /^Blood coagulation$/i,                 glyph: '🩸', label: 'clotting' },
    { match: /^Blood/i,                              glyph: '🩸', label: 'blood' },
    { match: /^Oxygen transport$|Respiratory chain/i,glyph: '🫁', label: 'oxygen' },
    { match: /^Muscle protein$/i,                    glyph: '💪', label: 'muscle' },
    { match: /^Vision$|Retinal/i,                    glyph: '👁', label: 'vision' },
    { match: /^Membrane$|Transmembrane/i,            glyph: '🧱', label: 'membrane' },
    { match: /^Ion channel$|^Ion transport$/i,       glyph: '⚡', label: 'ion channel' },
    { match: /^Transport$/i,                         glyph: '🚚', label: 'transport' },
    { match: /^Secreted$/i,                          glyph: '📤', label: 'secreted' },
    { match: /^DNA-binding$|DNA replication/i,       glyph: '🧬', label: 'DNA binding' },
    { match: /^RNA-binding$/i,                       glyph: '🧬', label: 'RNA binding' },
    { match: /^Transcription$|^Transcription regulation$/i, glyph: '🧬', label: 'transcription' },
    { match: /^Kinase$|Serine\/threonine|Tyrosine-protein/i, glyph: '📡', label: 'kinase' },
    { match: /^Protease$|Serine protease|Aspartyl protease|Metalloprotease/i, glyph: '✂️', label: 'protease' },
    { match: /^Hydrolase$|^Transferase$|^Lyase$|^Isomerase$|^Ligase$|^Oxidoreductase$/i, glyph: '⚡', label: 'enzyme' },
    { match: /^Cell cycle$|Mitosis|Cell division/i,  glyph: '🔄', label: 'cell cycle' },
    { match: /^Cytoskeleton$|Motor protein/i,        glyph: '🚶', label: 'motor' },
    { match: /^Chaperone$/i,                         glyph: '🛠', label: 'chaperone' },
    { match: /^Ribosomal protein$|Translation/i,     glyph: '🏭', label: 'translation' },
    { match: /^Ubl conjugation pathway$|Ubiquitin/i, glyph: '🏷', label: 'ubiquitin' },
    { match: /^Sensory transduction$|G-protein coupled/i, glyph: '📡', label: 'GPCR' },
    { match: /^Metal-binding$/i,                     glyph: '🔗', label: 'metal-binding' },
    { match: /^Zinc$|Zinc-finger/i,                  glyph: '🔗', label: 'zinc' },
    { match: /^Iron$|Heme/i,                         glyph: '🔗', label: 'iron/heme' },
    { match: /^Calcium$/i,                           glyph: '🔗', label: 'calcium' },
    { match: /^Storage protein$/i,                   glyph: '📦', label: 'storage' },
    { match: /^Disulfide bond$/i,                    glyph: '🔗', label: 'disulfide' }
];

// --- UniProt disease keyword → glyph. Diseases are named directly. ---
const DISEASE_GLYPHS = [
    { match: /diabetes/i,           glyph: '🩺', label: 'diabetes' },
    { match: /Alzheimer/i,          glyph: '🧠', label: 'Alzheimer\'s' },
    { match: /Parkinson/i,          glyph: '🧠', label: 'Parkinson\'s' },
    { match: /cancer|tumor|onco/i,  glyph: '🩺', label: 'cancer-linked' },
    { match: /HIV|AIDS/i,           glyph: '🦠', label: 'HIV' },
    { match: /malaria/i,            glyph: '🦟', label: 'malaria' },
    { match: /prion|Creutzfeldt/i,  glyph: '🩺', label: 'prion disease' },
    { match: /sickle|thalassemia/i, glyph: '🩸', label: 'blood disorder' }
];

// Pull a single organism tag from a polymer_entity `rcsb_entity_source_organism[]`.
export function organismTag(sources) {
    if (!Array.isArray(sources) || !sources.length) return null;
    const src = sources[0];
    const scientific = src.scientific_name || '';
    const common = (src.ncbi_common_names || [])[0] || '';
    const lineageNames = (src.taxonomy_lineage || []).map((t) => t.name);
    const tooltip = common && common !== scientific
        ? `${scientific} (${common})`
        : scientific || 'Unknown organism';
    for (const g of LINEAGE_GLYPHS) {
        for (const name of [scientific, ...lineageNames]) {
            if (g.match.test(name)) return { glyph: g.glyph, label: g.label, tooltip };
        }
    }
    return scientific ? { glyph: '🧬', label: scientific.split(' ')[0].toLowerCase(), tooltip } : null;
}

// Derive tags from UniProt keyword strings (`rcsb_uniprot_keyword[].value`).
export function tagsFromUniprotKeywords(keywords, { max = 3 } = {}) {
    if (!Array.isArray(keywords) || !keywords.length) return [];
    const seen = new Set();
    const out = [];
    for (const kw of keywords) {
        const value = kw?.value || '';
        for (const g of UNIPROT_KEYWORD_GLYPHS) {
            if (!g.match.test(value)) continue;
            if (seen.has(g.label)) break;
            seen.add(g.label);
            out.push({ glyph: g.glyph, label: g.label, tooltip: value });
            break;
        }
        if (out.length >= max) break;
    }
    return out;
}

// One disease tag from the first matching UniProt disease annotation.
export function tagFromDiseaseAnnotations(annotations) {
    if (!Array.isArray(annotations)) return null;
    for (const a of annotations) {
        if (a?.type !== 'disease') continue;
        const name = a.name || '';
        for (const g of DISEASE_GLYPHS) {
            if (g.match.test(name)) return { glyph: g.glyph, label: g.label, tooltip: name };
        }
        return { glyph: '🩺', label: 'disease-linked', tooltip: name };
    }
    return null;
}

// Merge hand-authored (catalog) tags with derived tags, de-duplicated by label.
// Hand tags come first — they were written by a human and win any conflicts.
export function mergeTags(handTags, derivedTags) {
    const hand = Array.isArray(handTags) ? handTags : [];
    const derived = Array.isArray(derivedTags) ? derivedTags : [];
    const seen = new Set(hand.map((t) => t.label.toLowerCase()));
    const merged = [...hand];
    for (const t of derived) {
        const key = t.label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
    }
    return merged;
}

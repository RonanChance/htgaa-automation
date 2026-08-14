// Map RCSB / UniProt annotations to a suggested bench assay.
//
// Two-stage lookup:
//   1. EC number  → most specific. Enzyme Commission classifies enzymes into
//      a 4-level hierarchy where the first 2–3 digits already pin the
//      chemistry (e.g. 3.1.1.x = carboxylic ester hydrolases, 3.4.21.x =
//      serine proteases). Standard bench assays exist for each subclass.
//   2. UniProt keyword → for non-enzymes (fluorescent proteins, antibodies,
//      ion channels, chaperones, etc.) that have no EC entry.
//
// Rules are ORDERED specific → general. The first matching rule wins, so
// e.g. EC 3.4.21 (serine protease) is caught before EC 3.4 (protease) which
// is caught before EC 3 (hydrolase).

const EC_ASSAYS = [
    // Class 1 — oxidoreductases
    { prefix: '1.11', label: 'Peroxidase', substrate: 'ABTS, TMB, or guaiacol + H₂O₂', readout: 'absorbance 405 / 650 / 470 nm' },
    { prefix: '1.13', label: 'Dioxygenase', substrate: 'natural substrate + O₂', readout: 'O₂ consumption (Clark electrode) or product UV' },
    { prefix: '1.14', label: 'Monooxygenase / P450', substrate: 'substrate + NAD(P)H + O₂', readout: 'NAD(P)H at 340 nm; product by LCMS' },
    { prefix: '1.6',  label: 'NAD(P)H diaphorase / reductase', substrate: 'NAD(P)H + acceptor dye', readout: 'MTT, DCPIP, or resazurin colorimetric' },
    { prefix: '1.1',  label: 'Alcohol / sugar dehydrogenase', substrate: 'substrate alcohol + NAD(P)⁺', readout: 'NAD(P)H formation at 340 nm' },
    { prefix: '1.2',  label: 'Aldehyde dehydrogenase', substrate: 'aldehyde + NAD(P)⁺', readout: 'NAD(P)H formation at 340 nm' },
    { prefix: '1.4',  label: 'Amino acid dehydrogenase / oxidase', substrate: 'amino acid + NAD(P)⁺ or O₂', readout: '340 nm or Amplex Red (H₂O₂ coupled) 560 nm' },
    { prefix: '1.5',  label: 'CH-NH oxidoreductase', substrate: 'substrate + NAD(P)⁺', readout: 'NAD(P)H at 340 nm' },
    { prefix: '1',    label: 'Oxidoreductase', substrate: 'redox pair (NAD(P)⁺/H, FAD, O₂)', readout: '340 nm or coupled indicator dye' },
    // Class 2 — transferases
    { prefix: '2.7.10', label: 'Protein tyrosine kinase', substrate: 'ATP + tyrosine-containing peptide', readout: 'ADP-Glo luminescence, HTRF, or anti-pTyr ELISA' },
    { prefix: '2.7.11', label: 'Ser/Thr protein kinase', substrate: 'ATP + peptide substrate', readout: 'ADP-Glo luminescence or HTRF' },
    { prefix: '2.7.12', label: 'Dual-specificity kinase', substrate: 'ATP + peptide substrate', readout: 'ADP-Glo luminescence or HTRF' },
    { prefix: '2.7.1',  label: 'Sugar / alcohol kinase', substrate: 'ATP + acceptor', readout: 'PK/LDH-coupled NADH consumption at 340 nm' },
    { prefix: '2.7.7',  label: 'Nucleotidyltransferase (polymerase)', substrate: 'template + dNTP/NTP', readout: 'PicoGreen dsDNA or fluorescent dNTP incorporation' },
    { prefix: '2.7',    label: 'Phosphotransferase', substrate: 'ATP + acceptor', readout: 'ADP-Glo or PK/LDH-coupled 340 nm' },
    { prefix: '2.3.1',  label: 'Acyltransferase', substrate: 'acyl-CoA + acceptor', readout: 'DTNB (Ellman) at 412 nm for released CoA' },
    { prefix: '2.4',    label: 'Glycosyltransferase', substrate: 'nucleotide-sugar + acceptor', readout: 'UDP-Glo luminescence or coupled phosphatase' },
    { prefix: '2.1',    label: 'One-carbon transferase', substrate: 'donor + acceptor', readout: 'coupled or LCMS (product-specific)' },
    { prefix: '2',      label: 'Transferase', substrate: 'donor + acceptor', readout: 'product-specific (coupled assay or LCMS)' },
    // Class 3 — hydrolases (huge, most bench-friendly)
    { prefix: '3.1.1',  label: 'Carboxylic-ester hydrolase (esterase / lipase / cutinase / PETase)', substrate: 'p-nitrophenyl acetate / butyrate / hexanoate', readout: 'absorbance 410 nm (p-nitrophenolate release)' },
    { prefix: '3.1.3',  label: 'Phosphomonoesterase (phosphatase)', substrate: 'p-nitrophenyl phosphate (pNPP)', readout: 'absorbance 405 nm' },
    { prefix: '3.1.4',  label: 'Phosphodiesterase', substrate: 'bis-pNPP or fluorogenic PDE substrate', readout: 'absorbance 405 nm or fluorescence' },
    { prefix: '3.1',    label: 'Ester hydrolase', substrate: 'chromogenic ester (pNP-linked)', readout: 'absorbance 405–410 nm' },
    { prefix: '3.2.1',  label: 'Glycosidase', substrate: 'p-nitrophenyl or 4-methylumbelliferyl glycoside', readout: '405 nm absorbance or 360/450 nm fluorescence' },
    { prefix: '3.4.21', label: 'Serine protease', substrate: 'AMC-peptide or chromogenic pNA-peptide', readout: 'fluorescence 380/460 nm or absorbance 405 nm' },
    { prefix: '3.4.22', label: 'Cysteine protease', substrate: 'AMC-peptide', readout: 'fluorescence 380/460 nm' },
    { prefix: '3.4.23', label: 'Aspartic protease', substrate: 'Mca / Dnp FRET peptide', readout: 'fluorescence 320/405 nm (FRET dequenching)' },
    { prefix: '3.4.24', label: 'Metalloprotease', substrate: 'Mca / Dnp FRET peptide', readout: 'fluorescence 320/405 nm (FRET dequenching)' },
    { prefix: '3.4',    label: 'Peptidase / protease', substrate: 'AMC-peptide or FRET peptide', readout: 'fluorescence' },
    { prefix: '3.5.2',  label: 'β-lactamase / cyclic amidase', substrate: 'nitrocefin', readout: 'absorbance 486 nm (yellow → red)' },
    { prefix: '3.5.1',  label: 'Amidase / deaminase', substrate: 'natural substrate + ammonia detection', readout: 'Berthelot 640 nm or GDH-coupled 340 nm' },
    { prefix: '3.6.1',  label: 'Pyrophosphatase / NTPase', substrate: 'PPi or NTP', readout: 'malachite green Pi release at 620 nm' },
    { prefix: '3.6.3',  label: 'ATPase (ion transport)', substrate: 'ATP', readout: 'PK/LDH NADH-coupled 340 nm or malachite green 620 nm' },
    { prefix: '3.6.4',  label: 'Motor ATPase (myosin, dynein, kinesin)', substrate: 'ATP ± filament', readout: 'PK/LDH coupled 340 nm or malachite green 620 nm' },
    { prefix: '3.6',    label: 'Acid anhydride hydrolase', substrate: 'ATP / GTP / PPi', readout: 'malachite green Pi release at 620 nm' },
    { prefix: '3',      label: 'Hydrolase', substrate: 'chromogenic or fluorogenic surrogate', readout: 'absorbance 405 nm or fluorescence' },
    // Class 4 — lyases
    { prefix: '4.2.1',  label: 'Hydratase / dehydratase', substrate: 'natural substrate', readout: 'UV absorbance change or coupled dehydrogenase 340 nm' },
    { prefix: '4.6.1',  label: 'Adenylyl / guanylyl cyclase', substrate: 'ATP or GTP', readout: 'cAMP / cGMP HTRF or fluorescent BRET biosensor' },
    { prefix: '4.1',    label: 'Carbon–carbon lyase', substrate: 'natural substrate', readout: 'UV or coupled dehydrogenase 340 nm' },
    { prefix: '4',      label: 'Lyase', substrate: 'natural substrate', readout: 'UV absorbance change or LCMS' },
    // Class 5 — isomerases
    { prefix: '5.3.1',  label: 'Aldose–ketose isomerase (e.g. TIM)', substrate: 'sugar isomer', readout: 'coupled dehydrogenase 340 nm' },
    { prefix: '5',      label: 'Isomerase', substrate: 'natural substrate', readout: 'coupled assay or chiral HPLC' },
    // Class 6 — ligases
    { prefix: '6.1.1',  label: 'Aminoacyl-tRNA synthetase', substrate: 'ATP + amino acid + tRNA', readout: 'PPi release (malachite green) or radiolabeled amino acid' },
    { prefix: '6.3',    label: 'C–N ligase', substrate: 'ATP + substrates', readout: 'PPi / AMP release (malachite green 620 nm)' },
    { prefix: '6',      label: 'Ligase', substrate: 'ATP + substrates', readout: 'PPi / AMP release (malachite green)' },
    // Class 7 — translocases
    { prefix: '7',      label: 'Translocase', substrate: 'ATP + transported ligand', readout: 'ATPase coupled assay or fluorescent ligand flux' }
];

const KEYWORD_ASSAYS = [
    { match: /Fluorescent protein|Chromophore/i,      label: 'Fluorescence readout', substrate: 'native chromophore (matures autocatalytically)', readout: 'excitation/emission per variant (e.g. GFP 488/510 nm)' },
    { match: /Bioluminescence|Luminescence|Photoprotein/i, label: 'Luminescence readout', substrate: 'luciferin (D-luciferin, coelenterazine, or furimazine)', readout: 'integrating luminometer, RLU' },
    { match: /Photosynthesis/i,                       label: 'Photosynthesis / electron transfer', substrate: 'light + electron acceptor (DCPIP)', readout: 'absorbance change 600 nm or O₂ evolution' },
    { match: /Immunoglobulin|Antibody/i,              label: 'Antigen binding', substrate: 'immobilized antigen', readout: 'ELISA (HRP/OD 450 nm), SPR, or BLI' },
    { match: /Ion channel|Ion transport/i,            label: 'Ion flux', substrate: 'permeant ion + fluorescent indicator', readout: 'Tl⁺ (FluxOR), Ca²⁺ (Fluo-4), or patch-clamp' },
    { match: /G-protein coupled|Sensory transduction/i, label: 'GPCR functional', substrate: 'ligand', readout: 'cAMP HTRF, Ca²⁺ mobilization (Fluo-4), or β-arrestin Tango' },
    { match: /^Toxin$|Neurotoxin|Enterotoxin/i,       label: 'Cell-based cytotoxicity', substrate: 'target cell line', readout: 'CellTiter-Glo viability or LDH release' },
    { match: /Chaperone/i,                            label: 'Refolding assay', substrate: 'thermally denatured client (citrate synthase, luciferase)', readout: 'recovery of client activity' },
    { match: /Kinase/i,                               label: 'Kinase activity', substrate: 'ATP + peptide substrate', readout: 'ADP-Glo luminescence or HTRF' },
    { match: /Protease/i,                             label: 'Protease activity', substrate: 'AMC-peptide or FRET peptide', readout: 'fluorescence 380/460 nm' },
    { match: /Hormone|Growth factor|Cytokine/i,       label: 'Receptor binding', substrate: 'immobilized receptor', readout: 'SPR, BLI, or radioligand displacement' },
    { match: /Vaccine|Antigen/i,                      label: 'Immunogenicity', substrate: 'polyclonal serum', readout: 'ELISA against antigen' },
    { match: /DNA-binding|Transcription/i,            label: 'DNA binding', substrate: 'fluorescent oligonucleotide probe', readout: 'EMSA or fluorescence anisotropy' },
    { match: /RNA-binding/i,                          label: 'RNA binding', substrate: 'fluorescent RNA probe', readout: 'EMSA or fluorescence anisotropy' },
    { match: /Storage protein|Ferritin/i,             label: 'Iron loading / release', substrate: 'Fe(II) / ferrozine', readout: 'absorbance 562 nm' },
    { match: /Oxygen transport|Heme/i,                label: 'Oxygen / ligand binding', substrate: 'O₂ or CO', readout: 'Soret band absorbance shift (~415 nm)' },
    { match: /Biotin binding/i,                       label: 'Biotin binding', substrate: 'HABA displacement or fluorescent biotin', readout: 'absorbance 500 nm or fluorescence' },
    { match: /Cell adhesion|Integrin/i,               label: 'Adhesion assay', substrate: 'immobilized matrix ligand', readout: 'crystal violet or fluorescent cell count' },
    { match: /Muscle protein|Motor protein|Cytoskeleton/i, label: 'Motor / cytoskeletal activity', substrate: 'ATP ± filament (actin, tubulin)', readout: 'malachite green Pi release or in-vitro motility TIRF' },
    { match: /Ribosomal protein|Translation/i,        label: 'In vitro translation', substrate: 'coupled transcription–translation lysate + reporter mRNA', readout: 'luciferase or GFP reporter output' },
    { match: /Membrane|Transmembrane/i,               label: 'Membrane reconstitution', substrate: 'liposome or nanodisc + fluorescent probe', readout: 'fluorescence-based transport / stopped-flow' },
    { match: /Antifreeze/i,                           label: 'Ice recrystallization inhibition', substrate: 'controlled freeze/thaw of sucrose–protein droplet', readout: 'splat-cooling microscopy (mean ice crystal area)' }
];

const FALLBACK_ASSAY = {
    label: 'General biophysical screen',
    substrate: 'purified protein alone',
    readout: 'thermal shift (DSF, SYPRO Orange), circular dichroism, SEC-MALS'
};

// Normalize a raw EC field into an array of dotted strings.
// Accepts:  "3.1.1.101"   |  "3.1.1.101, 3.1.1.74"   |  [{number:"..."}]   |  ["...", "..."]
export function normalizeEcNumbers(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw
            .map((x) => (typeof x === 'string' ? x : x?.number))
            .filter(Boolean)
            .map((s) => s.trim());
    }
    if (typeof raw === 'string') {
        return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

function matchEcRule(ec) {
    // Rules are ordered specific → general; first hit wins.
    for (const rule of EC_ASSAYS) {
        if (ec === rule.prefix || ec.startsWith(rule.prefix + '.')) {
            return { ...rule, source: `EC ${ec}` };
        }
    }
    return null;
}

function matchKeywordRule(keywords) {
    for (const kw of keywords) {
        const value = typeof kw === 'string' ? kw : kw?.value || '';
        if (!value) continue;
        for (const rule of KEYWORD_ASSAYS) {
            if (rule.match.test(value)) {
                const { match, ...rest } = rule;
                return { ...rest, source: `keyword "${value}"` };
            }
        }
    }
    return null;
}

// Main entry point. Prefers EC (chemistry-specific) over keywords (broader
// functional bucket). Falls back to a generic biophysical screen so the UI
// always has something to render.
export function suggestAssay({ ecNumbers = [], uniprotKeywords = [] } = {}) {
    for (const ec of ecNumbers) {
        const hit = matchEcRule(ec);
        if (hit) return hit;
    }
    const kw = matchKeywordRule(uniprotKeywords);
    if (kw) return kw;
    return { ...FALLBACK_ASSAY, source: 'no activity annotation — structural default' };
}

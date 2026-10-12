// "Where to start" primer: the main levers of E. coli lysate cell-free protein
// synthesis, grouped by the layer of gene expression they act on. Human-facing
// only (CfpsPrimer.svelte) — it is deliberately NOT given to AI agents, so the
// agent instructions don't steer what gets designed.
//
// `reagents` are CFPSReagentList field names. Consumers show only the ones that are
// currently approved + in stock (the live, contract-filtered catalog), so the
// primer can never point at a reagent people can't actually use.
//
// References are DOIs verified against doi.org.

const REF = {
  jewett2004: { label: 'Jewett & Swartz — Cytomim: mimicking the E. coli cytoplasm (Biotechnol. Bioeng.)', doi: '10.1002/bit.20026' },
  kim2001: { label: 'Kim & Swartz — ATP regeneration from glycolytic intermediates (Biotechnol. Bioeng.)', doi: '10.1002/bit.1121' },
  calhoun2005glc: { label: 'Calhoun & Swartz — Energizing CFPS with glucose metabolism (Biotechnol. Bioeng.)', doi: '10.1002/bit.20449' },
  calhoun2005nmp: { label: 'Calhoun & Swartz — Economical CFPS with glucose and NMPs (Biotechnol. Prog.)', doi: '10.1021/bp050052y' },
  goerke2007: { label: 'Goerke & Swartz — CFPS platforms for disulfide-bonded proteins (Biotechnol. Bioeng.)', doi: '10.1002/bit.21567' },
  garamella2016: { label: 'Garamella et al. — The All E. coli TX-TL Toolbox 2.0 (ACS Synth. Biol.)', doi: '10.1021/acssynbio.5b00296' },
  carlson2012: { label: 'Carlson et al. — Cell-free protein synthesis: applications come of age (Biotechnol. Adv.)', doi: '10.1016/j.biotechadv.2011.09.016' },
  silverman2019: { label: 'Silverman, Karim & Jewett — Cell-free gene expression: an expanded repertoire (Nat. Rev. Genet.)', doi: '10.1038/s41576-019-0186-3' }
};

export const PRIMER = [
  {
    key: 'energy',
    title: 'Energy & ATP regeneration',
    what: 'Keeps ATP and GTP topped up so translation doesn’t stall — usually the first thing to run out.',
    levers: [
      'Pick the primary energy source: PEP is fast and strong but costly and releases phosphate; pyruvate (with pyruvate oxidase) and sugars (glucose, maltose, maltodextrin, ribose) let the lysate’s own enzymes make ATP more slowly and cheaply.',
      'Slow-release substrates such as maltodextrin and maltose can extend reaction lifetime by avoiding the burst of phosphate and acid a single big PEP dose creates.',
      'Acetyl phosphate is a direct phosphate donor for regenerating ATP.',
      'Oxalate inhibits PEP synthetase, an enzyme that otherwise spends ATP converting pyruvate back into PEP.',
      'NAD⁺ and CoA keep the lysate’s central metabolism turning — the idea behind the Cytomim / PANOx-style systems.',
      'Pyruvate oxidase makes hydrogen peroxide as a by-product; pair it with catalase.'
    ],
    tryFirst: 'Start from a reference plate’s energy system (each target has PEP-only and ribose-only references) and change one energy source at a time — e.g. replace part of the PEP with maltodextrin.',
    watchOut: 'Phosphate-releasing energy sources tie up Mg²⁺ — revisit magnesium whenever you change the energy system.',
    reagents: ['pep_mono', 'sodium_pyruvate', 'pyruvate_oxidase', 'catalase', 'glucose', 'maltose', 'maltodextrin_17', 'ribose', 'dilithium_acetyl_phosphate', 'potassium_oxalate', 'nad', 'coa'],
    refs: [REF.kim2001, REF.calhoun2005glc, REF.jewett2004]
  },
  {
    key: 'transcription',
    title: 'Transcription (DNA → mRNA)',
    what: 'How much mRNA T7 RNA polymerase makes from your template, and how long it lasts.',
    levers: [
      'NTPs (ATP, GTP, CTP, UTP) feed transcription directly — and ATP/GTP also fuel translation, so they serve two layers.',
      'NMPs (AMP, CMP, GMP, UMP) are a cheaper route: lysate kinases phosphorylate them up to NTPs using the energy system.',
      'Ribonucleosides and bases (adenosine, guanosine, cytidine, uridine, adenine, guanine, cytosine, uracil) are an even cheaper, exploratory supply that depends on the lysate’s salvage pathways — always test against an NTP control.',
      'Mg²⁺ sets polymerase activity, and NTPs bind Mg²⁺ — raising NTPs lowers free magnesium.',
      'Polyamines (spermidine, putrescine) support transcription and help stabilise nucleic acids.',
      'Fixed in this coopetition: the DNA template and its dose (2000 nL), so focus on supply and environment.'
    ],
    tryFirst: 'Hold the energy system fixed and swap NTPs for NMPs — a clear cost win if yield holds up.',
    watchOut: 'More nucleotide is not always better: excess NTPs chelate Mg²⁺ and can lower yield.',
    reagents: ['atp', 'gtp', 'ctp', 'utp', 'amp', 'gmp', 'cmp', 'ump', 'adenosine', 'guanosine', 'cytidine', 'uridine', 'adenine', 'guanine', 'cytosine', 'uracil', 'spermidine', 'putrescine'],
    refs: [REF.calhoun2005nmp, REF.garamella2016]
  },
  {
    key: 'translation',
    title: 'Translation (mRNA → protein)',
    what: 'Ribosomes reading the mRNA — usually the step that sets yield once energy is solved.',
    levers: [
      'Amino acids: the 17-amino-acid mix plus tyrosine and cysteine added separately (glutamate comes from the glutamate salts). Running short of any one stalls every ribosome.',
      'Mg²⁺ is the most sensitive single knob: ribosomes need it in a narrow window — too little and they come apart, too much and accuracy and yield fall.',
      'K⁺ (potassium glutamate) and NH₄⁺ (ammonium glutamate) support ribosome function; the K⁺ optimum differs by target (see Salt optima in the table settings).',
      'Folinic acid supplies the formyl group for the initiator tRNA (fMet).',
      'Polyamines (spermidine, putrescine) can partly substitute for Mg²⁺ and support ribosomes.',
      'Not available here: extra tRNA (marked ○ in the table).'
    ],
    tryFirst: 'Run a three-level magnesium-glutamate sweep (e.g. −50 / 0 / +50 nL around your starting recipe) as one batch — the cheapest high-information experiment.',
    watchOut: 'Change Mg and K one at a time; they interact, and two changes at once can’t be untangled.',
    reagents: ['amino_acid_mix_17', 'tyrosine', 'cysteine', 'magnesium_glutamate', 'potassium_glutamate', 'ammonium_glutamate', 'folinic_acid', 'spermidine', 'putrescine'],
    refs: [REF.jewett2004, REF.carlson2012]
  },
  {
    key: 'ions',
    title: 'Ionic environment & pH',
    what: 'The salts and buffer every enzyme in the lysate works in.',
    levers: [
      'Counter-ions matter: glutamate is preferred over chloride, which inhibits CFPS — that’s why the salts here are glutamates.',
      'Free vs total Mg²⁺: NTPs, phosphate, polyphosphate and PEP all bind magnesium, so the same Mg dose behaves differently in different energy systems.',
      'Buffering: HEPES-KOH pH 7.5; the potassium phosphate mixes buffer too (1.6:1 dibasic:monobasic ≈ pH 7.0, the monobasic-rich mix is more acidic) and also supply phosphate, which binds Mg²⁺.',
      'Sugar-based energy sources acidify the reaction over time — extra buffer can extend its life.'
    ],
    tryFirst: 'If you switch to a sugar energy source, add buffer capacity (HEPES or a phosphate mix) and re-check magnesium.',
    watchOut: 'Phosphate buffers double as Mg²⁺ sinks — not a neutral swap for HEPES.',
    reagents: ['hepes_koh', 'kpo_dibasic_mix', 'kpo_monobasic_mix', 'potassium_phosphate_dibasic', 'potassium_phosphate_monobasic', 'potassium_glutamate', 'magnesium_glutamate', 'ammonium_glutamate'],
    refs: [REF.jewett2004]
  },
  {
    key: 'redox',
    title: 'Redox & disulfide bonds',
    what: 'Whether cysteines pair into the right disulfide bonds — essential for proteins that need them.',
    levers: [
      'Standard lysates are reducing, which blocks disulfide formation.',
      'The oxidized : reduced glutathione ratio (GSSG : GSH) sets the redox potential — more GSSG favours disulfide formation.',
      'DsbC, a disulfide isomerase, reshuffles mispaired bonds toward the native ones.',
      'Reducing agents help purely cytosolic proteins but work against disulfide-bonded ones.',
      'Know your target: Reteplase (a tPA variant) depends on several disulfide bonds; sfGFP has none.'
    ],
    tryFirst: 'For Reteplase, compare a reducing (GSH-only) against an oxidizing (GSSG-rich) glutathione buffer, with and without DsbC.',
    watchOut: 'An oxidizing environment can slow synthesis of everything else — judge it on activity, not titer.',
    reagents: ['oxidized_glutathione', 'reduced_glutathione', 'dsbc_ecoli'],
    refs: [REF.goerke2007]
  },
  {
    key: 'folding',
    title: 'Folding, solubility & crowding',
    what: 'Getting correctly folded, soluble, active protein — not just a lot of polypeptide.',
    levers: [
      'Crowding agents (PEG-8000) mimic the density of the cytoplasm; they can raise yield but can also drive aggregation at high levels.',
      'A mild detergent (Brij-35) can keep hydrophobic or aggregation-prone proteins in solution.',
      'DMSO is a co-solvent that can help some folding but inhibits translation as its level rises — keep it low.',
      'Speed vs quality: slowing synthesis a little (less magnesium or energy) can give more active protein per nanogram.',
      'PETase and Reteplase are scored on activity, so folding and solubility beat raw titer there.'
    ],
    tryFirst: 'Add a small PEG-8000 step and a Brij-35 step to your best recipe as two arms of one batch.',
    watchOut: 'Crowders and detergents can interfere with assays — compare against a no-additive control.',
    reagents: ['peg_8000', 'brij_35', 'dmso', 'dsbc_ecoli'],
    refs: [REF.carlson2012]
  },
  {
    key: 'cofactors',
    title: 'Cofactors & lysate metabolism',
    what: 'The small molecules the lysate’s own enzymes need to keep running.',
    levers: [
      'NAD⁺ (and nicotinamide, a precursor) and CoA: redox and acyl carriers for central metabolism and energy regeneration.',
      'cAMP is part of classic PANOx-style recipes; its benefit in modern lysates is debated — worth testing rather than assuming.',
      'Folinic acid: one-carbon donor (also needed for initiation).',
      'The lysate (5000 nL) and base buffer (2000 nL) are fixed — anything you add is on top of what’s already there.'
    ],
    tryFirst: 'Drop one cofactor at a time from a full recipe to find which ones actually earn their place (and cost).',
    watchOut: 'Removing a cofactor can look neutral in a short run and matter in a long one — keep timing in mind.',
    reagents: ['nad', 'nicotinamide', 'coa', 'camp', 'folinic_acid'],
    refs: [REF.jewett2004, REF.garamella2016]
  },
  {
    key: 'exploratory',
    title: 'Exploratory additives',
    what: 'Reagents on the list with less established roles in CFPS — good candidates for hypothesis-driven, single-variable tests.',
    levers: [
      'Polyphosphate (sodium hexametaphosphate): a phosphate reservoir in some energy-regeneration schemes; it also binds Mg²⁺.',
      'Potassium formate, succinic acid and oxaloacetic acid: central-metabolism intermediates and salts with possible effects on energy or redox balance.',
      'Thymidine and thymine are DNA building blocks rather than RNA ones, so any effect would be indirect.',
      'Write down the mechanism you expect before you test — the submission’s hypothesis field is the place for it.'
    ],
    tryFirst: 'Add one exploratory reagent at two levels to a well-characterised recipe, alongside an unchanged control.',
    watchOut: 'Expect most exploratory additions to do nothing or hurt — that is still a useful result to share.',
    reagents: ['sodium_hexametaphosphate', 'potassium_formate', 'succinic_acid', 'oxaloacetic_acid', 'thymidine', 'thymine'],
    refs: []
  },
  {
    key: 'strategy',
    title: 'Experimental strategy',
    what: 'How to learn the most from a limited number of wells.',
    levers: [
      'Volume budget: base buffer 2000 + lysate 5000 + template 2000 = 9000 nL fixed, leaving 11,000 nL for supplements and water — concentrated stocks stretch further.',
      'Start from a reference: load a reference plate or literature recipe in the designer, then change one thing.',
      'Use a batch to sweep one variable across 3–5 levels so differences are attributable.',
      'The 25 nL dispense step is the smallest change you can make — check the snap-rounding notice under the designer.',
      'Learn from others: compare with the reference plates, starred community compositions and the literature list.',
      'Cost counts: the table’s cost rows show what each change adds per reaction.'
    ],
    tryFirst: 'Pick one layer above, write a one-sentence hypothesis, and design a 3–5 composition batch that tests only that.',
    watchOut: 'Changing several layers at once makes a good result impossible to explain or build on.',
    reagents: [],
    refs: [REF.silverman2019]
  }
];

export const doiUrl = (doi) => `https://doi.org/${doi}`;

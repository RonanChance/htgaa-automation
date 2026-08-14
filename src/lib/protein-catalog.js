// Curated registry of well-known proteins with real RCSB PDB IDs. Fetched
// client-side from https://files.rcsb.org/download/{pdbId}.pdb (permissive CORS).
// `beneficialMutations` is a list of well-established point mutations known to
// improve folding, brightness, stability, or E. coli soluble yield.
// `tags` are hand-picked pop-culture / tangible associations shown as glyph
// pills. They are MERGED with tags derived at fetch-time from RCSB/UniProt.

export const PROTEINS = [
    {
        name: 'GFP',
        aliases: ['gfp', 'avgfp', 'green fluorescent protein', 'egfp'],
        pdbId: '1EMA',
        chain: 'A',
        description: 'Green fluorescent protein from Aequorea victoria.',
        tags: [
            { glyph: '🪼', label: 'jellyfish', tooltip: 'From Aequorea victoria — a Pacific NW jellyfish' },
            { glyph: '🏆', label: 'Nobel 2008', tooltip: 'Shimomura, Chalfie & Tsien' },
            { glyph: '🔬', label: 'lab reporter' }
        ],
        beneficialMutations: {
            list: [
                { pos: 64, from: 'F', to: 'L' },
                { pos: 65, from: 'S', to: 'T' },
                { pos: 99, from: 'F', to: 'S' },
                { pos: 153, from: 'M', to: 'T' },
                { pos: 163, from: 'V', to: 'A' }
            ],
            rationale: 'Cycle-3/EGFP folding mutations — brighter, faster maturation at 37 °C, higher soluble yield in E. coli.'
        }
    },
    {
        name: 'sfGFP',
        aliases: ['sfgfp', 'superfolder gfp'],
        pdbId: '2B3P',
        chain: 'A',
        description: 'Superfolder GFP — robustly folds even when fused to poorly folding partners.',
        tags: [
            { glyph: '🏗', label: 'engineered' },
            { glyph: '🔬', label: 'fusion reporter' }
        ],
        beneficialMutations: null
    },
    {
        name: 'mCherry',
        aliases: ['mcherry'],
        pdbId: '2H5Q',
        chain: 'A',
        description: 'Bright monomeric red fluorescent protein derived from DsRed.',
        tags: [
            { glyph: '🌸', label: 'pink glow' },
            { glyph: '🔬', label: 'lab reporter' }
        ],
        beneficialMutations: null
    },
    {
        name: 'mRFP1',
        aliases: ['mrfp', 'mrfp1'],
        pdbId: '2VAD',
        chain: 'A',
        description: 'First monomeric red fluorescent protein derived from DsRed.',
        tags: [
            { glyph: '🔴', label: 'red glow' },
            { glyph: '🏗', label: 'first monomer RFP' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Lysozyme',
        aliases: ['lysozyme', 'hewl', 'hen egg white lysozyme'],
        pdbId: '2LYZ',
        chain: 'A',
        description: 'Hen egg-white lysozyme — model globular protein with four disulfides.',
        tags: [
            { glyph: '🥚', label: 'egg white' },
            { glyph: '💧', label: 'tears & saliva' },
            { glyph: '🛡', label: 'antibacterial' }
        ],
        beneficialMutations: null
    },
    {
        name: 'T4 Lysozyme',
        aliases: ['t4 lysozyme', 't4l'],
        pdbId: '2LZM',
        chain: 'A',
        description: 'Bacteriophage T4 lysozyme — classic model for protein stability studies.',
        tags: [
            { glyph: '🦠', label: 'phage weapon' },
            { glyph: '📚', label: 'stability model' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Insulin',
        aliases: ['insulin', 'human insulin'],
        pdbId: '3I40',
        chain: 'A',
        description: 'Human insulin — two disulfide-linked chains; notoriously hard in E. coli cytoplasm.',
        tags: [
            { glyph: '💉', label: 'diabetes drug' },
            { glyph: '🏆', label: 'Nobel 1923' },
            { glyph: '🏭', label: 'first biotech drug', tooltip: 'Humulin, 1982 — first FDA-approved recombinant drug' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Myoglobin',
        aliases: ['myoglobin', 'mb'],
        pdbId: '1MBN',
        chain: 'A',
        description: 'Sperm whale myoglobin — the first protein solved by X-ray crystallography.',
        tags: [
            { glyph: '🐋', label: 'sperm whale' },
            { glyph: '🏆', label: 'first X-ray solved', tooltip: 'Kendrew, 1958' },
            { glyph: '🥩', label: 'red meat pigment' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Hemoglobin α',
        aliases: ['hemoglobin', 'hemoglobin alpha', 'hba'],
        pdbId: '1A3N',
        chain: 'A',
        description: 'Human hemoglobin α-chain.',
        tags: [
            { glyph: '🩸', label: 'red blood cells' },
            { glyph: '🫁', label: 'oxygen carrier' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Ubiquitin',
        aliases: ['ubiquitin', 'ub'],
        pdbId: '1UBQ',
        chain: 'A',
        description: 'Small, extremely stable, universal eukaryotic regulator.',
        tags: [
            { glyph: '🏷', label: 'protein tag', tooltip: 'Marks proteins for degradation' },
            { glyph: '🏆', label: 'Nobel 2004' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Ferritin',
        aliases: ['ferritin'],
        pdbId: '1FHA',
        chain: 'A',
        description: 'Iron storage protein forming a 24-subunit spherical cage.',
        tags: [
            { glyph: '⚙️', label: 'iron cage' },
            { glyph: '🩺', label: 'ferritin blood test' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Thioredoxin',
        aliases: ['thioredoxin', 'trx'],
        pdbId: '2TRX',
        chain: 'A',
        description: 'E. coli thioredoxin — small, ubiquitously used as a solubility tag.',
        tags: [
            { glyph: '🔗', label: 'solubility tag' }
        ],
        beneficialMutations: null
    },
    {
        name: 'RNase A',
        aliases: ['rnase a', 'rnase', 'ribonuclease a'],
        pdbId: '7RSA',
        chain: 'A',
        description: 'Bovine pancreatic ribonuclease — four disulfides; classic folding model.',
        tags: [
            { glyph: '📚', label: 'folding classic', tooltip: 'Anfinsen\'s refolding experiments' },
            { glyph: '🏆', label: 'Nobel 1972' }
        ],
        beneficialMutations: null
    },
    {
        name: 'DHFR',
        aliases: ['dhfr', 'dihydrofolate reductase'],
        pdbId: '4DFR',
        chain: 'A',
        description: 'Dihydrofolate reductase — small enzyme, workhorse of biophysical studies.',
        tags: [
            { glyph: '💊', label: 'methotrexate target', tooltip: 'Chemotherapy & autoimmune drug' }
        ],
        beneficialMutations: null
    },
    {
        name: 'β-lactamase',
        aliases: ['beta-lactamase', 'b-lactamase', 'tem-1', 'bla'],
        pdbId: '1BTL',
        chain: 'A',
        description: 'TEM-1 β-lactamase — confers ampicillin resistance; typically periplasmic.',
        tags: [
            { glyph: '💊', label: 'antibiotic resistance', tooltip: 'Ampicillin/penicillin resistance' }
        ],
        beneficialMutations: null
    },
    {
        name: 'MBP',
        aliases: ['mbp', 'maltose binding protein', 'malE'],
        pdbId: '1ANF',
        chain: 'A',
        description: 'E. coli maltose-binding protein — extremely well-behaved solubility tag.',
        tags: [
            { glyph: '🔗', label: 'solubility tag' },
            { glyph: '🍬', label: 'sugar binder' }
        ],
        beneficialMutations: null
    },
    {
        name: 'SUMO',
        aliases: ['sumo', 'smt3'],
        pdbId: '1EUV',
        chain: 'B',
        description: 'Small ubiquitin-like modifier — commonly fused as a cleavable solubility tag.',
        tags: [
            { glyph: '🏷', label: 'protein modifier' },
            { glyph: '🔗', label: 'solubility tag' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Streptavidin',
        aliases: ['streptavidin', 'sav'],
        pdbId: '1STP',
        chain: 'A',
        description: 'Streptomyces avidinii streptavidin — sub-picomolar biotin binding.',
        tags: [
            { glyph: '🔗', label: 'biotin binder', tooltip: 'Strongest known non-covalent bond' },
            { glyph: '🔬', label: 'lab affinity workhorse' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Firefly Luciferase',
        aliases: ['luciferase', 'fluc', 'firefly luciferase'],
        pdbId: '1LCI',
        chain: 'A',
        description: 'Firefly luciferase — large (~550 aa) reporter enzyme, moderate E. coli yield.',
        tags: [
            { glyph: '🪲', label: 'firefly' },
            { glyph: '💡', label: 'bioluminescent' },
            { glyph: '🔬', label: 'reporter assay' }
        ],
        beneficialMutations: null
    },
    {
        name: 'DsRed',
        aliases: ['dsred', 'ds-red', 'drfp'],
        pdbId: '1G7K',
        chain: 'A',
        description: 'Discosoma red fluorescent protein — obligate tetramer; ancestor of the mCherry lineage.',
        tags: [
            { glyph: '🐚', label: 'sea anemone', tooltip: 'From Discosoma sp.' },
            { glyph: '🔴', label: 'red glow' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Cytochrome c',
        aliases: ['cytochrome c', 'cytc', 'cyt-c'],
        pdbId: '1HRC',
        chain: 'A',
        description: 'Horse heart cytochrome c — small heme protein in the mitochondrial electron transport chain.',
        tags: [
            { glyph: '🫁', label: 'mitochondrion' },
            { glyph: '💀', label: 'apoptosis trigger', tooltip: 'Its release from mitochondria signals cell death' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Calmodulin',
        aliases: ['calmodulin', 'cam'],
        pdbId: '1CLL',
        chain: 'A',
        description: 'Ca²⁺ messenger with two EF-hand lobes linked by a flexible central helix.',
        tags: [
            { glyph: '📡', label: 'Ca²⁺ sensor' },
            { glyph: '🌍', label: 'in every eukaryote' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Carbonic Anhydrase II',
        aliases: ['carbonic anhydrase', 'ca2', 'cah2', 'cah'],
        pdbId: '1CA2',
        chain: 'A',
        description: 'Human carbonic anhydrase II — one of the fastest known enzymes; Zn²⁺-dependent.',
        tags: [
            { glyph: '💨', label: 'CO₂ handler' },
            { glyph: '⚡', label: 'fastest enzyme', tooltip: '~10⁶ reactions per second' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Trypsin',
        aliases: ['trypsin'],
        pdbId: '1S0Q',
        chain: 'A',
        description: 'Bovine trypsin — classic serine protease that cleaves after K/R.',
        tags: [
            { glyph: '🍽', label: 'digestion' },
            { glyph: '🔬', label: 'cell culture reagent', tooltip: 'Lifts cells off dishes' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Chymotrypsin',
        aliases: ['chymotrypsin', 'a-chymotrypsin'],
        pdbId: '5CHA',
        chain: 'A',
        description: 'Bovine α-chymotrypsin — serine protease preferring aromatic P1 residues.',
        tags: [
            { glyph: '🍽', label: 'digestion' },
            { glyph: '✂️', label: 'protein cutter' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Papain',
        aliases: ['papain'],
        pdbId: '9PAP',
        chain: 'A',
        description: 'Papaya cysteine protease — meat tenderizer and archetype of its class.',
        tags: [
            { glyph: '🍈', label: 'papaya' },
            { glyph: '🥩', label: 'meat tenderizer' },
            { glyph: '🍺', label: 'beer clarifier' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Ras (HRAS)',
        aliases: ['ras', 'hras', 'h-ras'],
        pdbId: '5P21',
        chain: 'A',
        description: 'Human H-Ras GTPase — molecular switch; mutant alleles drive ~30% of cancers.',
        tags: [
            { glyph: '🩺', label: '~30% of cancers' },
            { glyph: '📡', label: 'GTP switch' }
        ],
        beneficialMutations: null
    },
    {
        name: 'p53',
        aliases: ['p53', 'tp53'],
        pdbId: '1TUP',
        chain: 'A',
        description: 'Tumor suppressor p53 DNA-binding domain — the "guardian of the genome".',
        tags: [
            { glyph: '🛡', label: 'guardian of genome' },
            { glyph: '🩺', label: 'cancer target' }
        ],
        beneficialMutations: null
    },
    {
        name: 'HIV Protease',
        aliases: ['hiv protease', 'hivpr', 'hiv-1 protease'],
        pdbId: '1HVR',
        chain: 'A',
        description: 'HIV-1 aspartyl protease — target of saquinavir, ritonavir and other inhibitors.',
        tags: [
            { glyph: '💊', label: 'HIV drug target' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Kinesin',
        aliases: ['kinesin', 'kif5'],
        pdbId: '1BG2',
        chain: 'A',
        description: 'Human kinesin motor domain — ATP-powered walker along microtubules.',
        tags: [
            { glyph: '🚶', label: 'walks on microtubules' },
            { glyph: '🚚', label: 'cargo hauler' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Rhodopsin',
        aliases: ['rhodopsin'],
        pdbId: '1F88',
        chain: 'A',
        description: 'Bovine rhodopsin — the archetype GPCR and photoreceptor of dim-light vision.',
        tags: [
            { glyph: '👁', label: 'night vision' },
            { glyph: '📡', label: 'model GPCR' }
        ],
        beneficialMutations: null
    },
    {
        name: 'KcsA Channel',
        aliases: ['kcsa', 'potassium channel', 'k+ channel'],
        pdbId: '1BL8',
        chain: 'A',
        description: 'Streptomyces KcsA — first potassium channel solved; landmark of ion selectivity.',
        tags: [
            { glyph: '🏆', label: 'Nobel 2003' },
            { glyph: '⚡', label: 'K⁺ selectivity' }
        ],
        beneficialMutations: null
    },
    {
        name: 'GroEL',
        aliases: ['groel', 'hsp60'],
        pdbId: '1GRL',
        chain: 'A',
        description: 'E. coli chaperonin — refolds misfolded proteins in an ATP-driven cage.',
        tags: [
            { glyph: '🛠', label: 'folding cage' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Acetylcholinesterase',
        aliases: ['acetylcholinesterase', 'ache'],
        pdbId: '1EVE',
        chain: 'A',
        description: 'Torpedo AChE with donepezil — one of the fastest enzymes; Alzheimer\'s drug target.',
        tags: [
            { glyph: '🐡', label: 'electric ray', tooltip: 'From Torpedo californica' },
            { glyph: '🧠', label: 'Alzheimer target' },
            { glyph: '☠️', label: 'nerve-agent target', tooltip: 'Sarin, VX inhibit AChE' }
        ],
        beneficialMutations: null
    },
    {
        name: 'IgG Antibody',
        aliases: ['antibody', 'igg', 'immunoglobulin'],
        pdbId: '1IGT',
        chain: 'A',
        description: 'Intact murine IgG2a antibody — Y-shaped adaptive-immune sentinel.',
        tags: [
            { glyph: '🛡', label: 'immune Y' },
            { glyph: '💉', label: 'vaccine target' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Thrombin',
        aliases: ['thrombin'],
        pdbId: '1PPB',
        chain: 'H',
        description: 'Human α-thrombin — serine protease at the heart of blood coagulation.',
        tags: [
            { glyph: '🩸', label: 'clotting' },
            { glyph: '💊', label: 'anticoag target', tooltip: 'Dabigatran, argatroban' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Cholera Toxin B',
        aliases: ['cholera toxin', 'ctb', 'ctxb', 'ctx-b'],
        pdbId: '1XTC',
        chain: 'D',
        description: 'Cholera toxin B pentamer — binds GM1 gangliosides on gut epithelia.',
        tags: [
            { glyph: '🧫', label: 'Vibrio cholerae' },
            { glyph: '☠️', label: 'diarrhea toxin' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Ricin',
        aliases: ['ricin'],
        pdbId: '2AAI',
        chain: 'A',
        description: 'Castor bean toxin — A-chain depurinates 28S rRNA and shuts down translation.',
        tags: [
            { glyph: '🌱', label: 'castor bean' },
            { glyph: '☠️', label: 'deadly toxin' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Src Kinase',
        aliases: ['src', 'src kinase', 'c-src'],
        pdbId: '2SRC',
        chain: 'A',
        description: 'Human c-Src tyrosine kinase — the founding proto-oncogene.',
        tags: [
            { glyph: '🩺', label: 'first oncogene' },
            { glyph: '📡', label: 'tyrosine kinase' }
        ],
        beneficialMutations: null
    },
    {
        name: 'PKA',
        aliases: ['pka', 'protein kinase a'],
        pdbId: '1ATP',
        chain: 'E',
        description: 'Mouse PKA catalytic subunit — the archetype Ser/Thr kinase.',
        tags: [
            { glyph: '📡', label: 'kinase archetype' }
        ],
        beneficialMutations: null
    },
    {
        name: 'CDK2',
        aliases: ['cdk2', 'cyclin-dependent kinase 2'],
        pdbId: '1HCK',
        chain: 'A',
        description: 'Human cyclin-dependent kinase 2 — cell-cycle regulator and cancer target.',
        tags: [
            { glyph: '🔄', label: 'cell cycle' },
            { glyph: '🩺', label: 'cancer target' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Trp Cage',
        aliases: ['trp cage', 'trp-cage', 'tc5b'],
        pdbId: '1L2Y',
        chain: 'A',
        description: 'A 20-residue miniprotein — one of the smallest structured proteins ever designed.',
        tags: [
            { glyph: '🏗', label: 'designed protein' },
            { glyph: '📏', label: '20 residues' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Villin Headpiece',
        aliases: ['villin', 'villin headpiece', 'hp35'],
        pdbId: '1VII',
        chain: 'A',
        description: '35-residue three-helix bundle — folding-simulation workhorse.',
        tags: [
            { glyph: '🏗', label: '3-helix bundle' },
            { glyph: '📚', label: 'folding sim' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Crambin',
        aliases: ['crambin'],
        pdbId: '1CRN',
        chain: 'A',
        description: 'Tiny hydrophobic plant seed protein — 46 residues; ultra-high-resolution reference.',
        tags: [
            { glyph: '🌱', label: 'crambe seed' },
            { glyph: '💧', label: 'hydrophobic' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Protein G B1',
        aliases: ['gb1', 'protein g', 'protein g b1'],
        pdbId: '1PGB',
        chain: 'A',
        description: 'Streptococcal Protein G B1 domain — small α/β folding model.',
        tags: [
            { glyph: '🔗', label: 'IgG binder' },
            { glyph: '📚', label: 'folding model' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Alcohol Dehydrogenase',
        aliases: ['adh', 'alcohol dehydrogenase'],
        pdbId: '2OHX',
        chain: 'A',
        description: 'Horse liver ADH — NAD⁺-dependent enzyme that oxidizes ethanol to acetaldehyde.',
        tags: [
            { glyph: '🍺', label: 'ethanol metabolism' },
            { glyph: '🍷', label: 'hangover chemistry' }
        ],
        beneficialMutations: null
    },
    {
        name: 'SARS-CoV-2 Spike',
        aliases: ['spike', 'sars spike', 'sars-cov-2 spike', 'covid spike'],
        pdbId: '6VXX',
        chain: 'A',
        description: 'SARS-CoV-2 spike glycoprotein in closed prefusion — the COVID vaccine antigen.',
        tags: [
            { glyph: '🦠', label: 'COVID-19' },
            { glyph: '💉', label: 'mRNA vaccine antigen' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Hemagglutinin',
        aliases: ['hemagglutinin', 'ha', 'flu ha', 'influenza ha'],
        pdbId: '2HMG',
        chain: 'A',
        description: 'Influenza HA — binds sialic acid and mediates pH-triggered membrane fusion.',
        tags: [
            { glyph: '🦠', label: 'influenza' },
            { glyph: '💉', label: 'flu shot target' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Leucine Zipper',
        aliases: ['leucine zipper', 'gcn4', 'coiled coil'],
        pdbId: '2ZTA',
        chain: 'A',
        description: 'Yeast GCN4 leucine zipper — the definitive parallel coiled-coil dimer.',
        tags: [
            { glyph: '🧬', label: 'DNA binder' },
            { glyph: '🔗', label: 'coiled coil' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Zinc Finger',
        aliases: ['zinc finger', 'zif268', 'egr1'],
        pdbId: '1ZAA',
        chain: 'C',
        description: 'Zif268 zinc-finger DNA-binding domain — modular sequence recognition unit.',
        tags: [
            { glyph: '🧬', label: 'DNA reader' },
            { glyph: '🔗', label: 'zinc site' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Barnase',
        aliases: ['barnase'],
        pdbId: '1BNI',
        chain: 'A',
        description: 'Bacillus extracellular RNase — folding/stability workhorse; partner of barstar.',
        tags: [
            { glyph: '✂️', label: 'RNase' },
            { glyph: '📚', label: 'folding model' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Barstar',
        aliases: ['barstar'],
        pdbId: '1A19',
        chain: 'A',
        description: 'Intracellular inhibitor of barnase — femtomolar binding partner.',
        tags: [
            { glyph: '🤝', label: 'femtomolar binder', tooltip: 'One of the tightest known protein-protein interactions' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Avidin',
        aliases: ['avidin'],
        pdbId: '1AVD',
        chain: 'A',
        description: 'Chicken egg-white avidin — sub-picomolar biotin binder.',
        tags: [
            { glyph: '🥚', label: 'egg white' },
            { glyph: '🔗', label: 'biotin trap' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Rubisco',
        aliases: ['rubisco', 'rubp carboxylase'],
        pdbId: '1RBL',
        chain: 'A',
        description: 'The most abundant enzyme on Earth — CO₂-fixing engine of photosynthesis.',
        tags: [
            { glyph: '🌍', label: 'most abundant enzyme' },
            { glyph: '🌱', label: 'photosynthesis' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Antifreeze Protein',
        aliases: ['antifreeze', 'afp', 'antifreeze protein'],
        pdbId: '1WFA',
        chain: 'A',
        description: 'Winter flounder AFP — 37-residue α-helix that pins ice crystal growth.',
        tags: [
            { glyph: '🐟', label: 'flounder' },
            { glyph: '❄️', label: 'ice binder' },
            { glyph: '🍦', label: 'in ice cream', tooltip: 'AFPs are used to control ice crystal size in commercial ice cream' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Concanavalin A',
        aliases: ['concanavalin a', 'cona'],
        pdbId: '3CNA',
        chain: 'A',
        description: 'Jack bean lectin — binds mannose/glucose; classic jellyroll β-sandwich.',
        tags: [
            { glyph: '🌱', label: 'jack bean' },
            { glyph: '🍬', label: 'sugar binder' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Citrate Synthase',
        aliases: ['citrate synthase', 'cs'],
        pdbId: '1CTS',
        chain: 'A',
        description: 'Pig heart citrate synthase — the entry enzyme of the TCA cycle.',
        tags: [
            { glyph: '🔄', label: 'TCA cycle' }
        ],
        beneficialMutations: null
    },
    {
        name: 'FKBP12',
        aliases: ['fkbp', 'fkbp12'],
        pdbId: '1FKB',
        chain: 'A',
        description: 'Human FK506-binding protein — target of rapamycin and tacrolimus.',
        tags: [
            { glyph: '💊', label: 'rapamycin target' },
            { glyph: '🛡', label: 'immunosuppressant', tooltip: 'Organ transplant drugs' }
        ],
        beneficialMutations: null
    },
    {
        name: 'Cyclophilin A',
        aliases: ['cyclophilin', 'cypa', 'cyclophilin a'],
        pdbId: '2CPL',
        chain: 'A',
        description: 'Human cyclophilin A — cis-trans prolyl isomerase; receptor for cyclosporin A.',
        tags: [
            { glyph: '💊', label: 'cyclosporin target', tooltip: 'Immunosuppressant for transplants' }
        ],
        beneficialMutations: null
    }
];

// Three-letter to one-letter amino acid code
export const THREE_TO_ONE = {
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
    GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H', ILE: 'I',
    LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
    SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
    MSE: 'M', SEC: 'U', PYL: 'O'
};

// Amino acid classes for coloring and rationale generation
export const AA_CLASS = {
    A: 'hydrophobic', V: 'hydrophobic', L: 'hydrophobic', I: 'hydrophobic',
    M: 'hydrophobic', F: 'aromatic',    W: 'aromatic',    Y: 'aromatic',
    S: 'polar',       T: 'polar',       N: 'polar',       Q: 'polar',
    C: 'special',     G: 'special',     P: 'special',
    K: 'basic',       R: 'basic',       H: 'basic',
    D: 'acidic',      E: 'acidic'
};

// Color per class — tuned for both light and dark backgrounds
export const CLASS_COLOR = {
    hydrophobic: '#d4a017', // amber
    aromatic:    '#c2410c', // burnt orange
    polar:       '#0891b2', // teal/cyan
    basic:       '#2563eb', // blue
    acidic:      '#dc2626', // red
    special:     '#7c3aed'  // violet
};

export function classColorFor(aa) {
    const cls = AA_CLASS[aa];
    return CLASS_COLOR[cls] || '#6b7280';
}

// Kyte-Doolittle hydropathy scale — used for GRAVY and core detection
export const HYDROPATHY = {
    A:  1.8, R: -4.5, N: -3.5, D: -3.5, C:  2.5,
    E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I:  4.5,
    L:  3.8, K: -3.9, M:  1.9, F:  2.8, P: -1.6,
    S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V:  4.2
};

export const CANONICAL_AAS = 'ACDEFGHIKLMNPQRSTVWY'.split('');

// The lottery pool for the "random protein" button. Broad on purpose — every
// pick should feel like a fun surprise, spanning fluorescent reporters,
// classic enzymes, motors, receptors, toxins, folding models, viral spikes,
// oncoproteins, and structural landmarks.
export const WELL_STUDIED_NAMES = [
    // Fluorescent / reporters
    'GFP', 'sfGFP', 'mCherry', 'mRFP1', 'DsRed', 'Firefly Luciferase',
    // Classic model proteins
    'Lysozyme', 'T4 Lysozyme', 'Ubiquitin', 'Cytochrome c', 'Myoglobin',
    'Hemoglobin α', 'RNase A', 'DHFR', 'Thioredoxin', 'Crambin',
    'Trp Cage', 'Villin Headpiece', 'Protein G B1', 'Barnase', 'Barstar',
    // Metabolic / enzymes
    'Carbonic Anhydrase II', 'Trypsin', 'Chymotrypsin', 'Papain',
    'Alcohol Dehydrogenase', 'Citrate Synthase', 'Rubisco',
    // Kinases & signaling
    'Src Kinase', 'PKA', 'CDK2', 'Ras (HRAS)', 'Calmodulin', 'Cyclophilin A', 'FKBP12',
    // Structural / motors / channels
    'Kinesin', 'Rhodopsin', 'KcsA Channel', 'GroEL', 'Ferritin',
    // Biotech workhorses
    'MBP', 'SUMO', 'Streptavidin', 'Avidin', 'β-lactamase', 'Insulin',
    // Immunology / disease
    'IgG Antibody', 'p53', 'HIV Protease',
    'SARS-CoV-2 Spike', 'Hemagglutinin', 'Thrombin',
    // Toxins
    'Cholera Toxin B', 'Ricin',
    // DNA-binding & motifs
    'Zinc Finger', 'Leucine Zipper',
    // Curiosities
    'Antifreeze Protein', 'Concanavalin A', 'Acetylcholinesterase'
];

export function pickRandomWellStudied(excludeName = null) {
    const pool = WELL_STUDIED_NAMES.filter((n) => n !== excludeName);
    const name = pool[Math.floor(Math.random() * pool.length)];
    return findProtein(name);
}

export function findProtein(query) {
    if (!query) return null;
    const q = String(query).toLowerCase().trim();
    for (const p of PROTEINS) {
        if (p.name.toLowerCase() === q) return p;
        if (p.aliases.some((a) => a.toLowerCase() === q)) return p;
    }
    for (const p of PROTEINS) {
        if (p.name.toLowerCase().includes(q)) return p;
        if (p.aliases.some((a) => a.toLowerCase().includes(q))) return p;
    }
    return null;
}

// Parse PDB text: extract CA atoms of the requested chain in residue order.
// Returns { residues: [{pos, code}], chainId }.
export function parsePdbSequence(pdbText, chainId = 'A') {
    const residues = [];
    const seen = new Set();
    const lines = pdbText.split('\n');
    for (const line of lines) {
        if (!line.startsWith('ATOM')) continue;
        const atomName = line.substring(12, 16).trim();
        if (atomName !== 'CA') continue;
        const altLoc = line.substring(16, 17).trim();
        if (altLoc && altLoc !== 'A') continue;
        const chain = line.substring(21, 22).trim();
        if (chain !== chainId) continue;
        const resName = line.substring(17, 20).trim();
        const resSeq = parseInt(line.substring(22, 26).trim(), 10);
        const iCode = line.substring(26, 27).trim();
        const key = `${chain}|${resSeq}|${iCode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const one = THREE_TO_ONE[resName] || 'X';
        residues.push({ pos: resSeq, code: one });
    }
    if (residues.length === 0 && chainId !== 'A') {
        return parsePdbSequence(pdbText, 'A');
    }
    return { residues, chainId };
}

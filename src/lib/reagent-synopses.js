// Short, accessible synopses for CFPS reagents.
// Keyed by reagent paper name (matching REAGENT_ALIASES keys).
// role:     1-2 sentence general function in CFPS
// proteins: optional protein-specific note (only if meaningfully different)
// mol:      PubChem compound name for the 2D structure image (null for
//           proteins, polymers and mixtures that have no single structure)
// wiki:     Wikipedia article title for the "learn more" link

export const REAGENT_SYNOPSES = {

  // ─── Salts ─────────────────────────────────────────────────────────────────

  'K(Glu)': {
    role: 'Potassium is the main salt needed for ribosomes to work. Glutamate replaces chloride as the counter-ion because chloride inhibits some CFPS enzymes. Getting the right K⁺ concentration is one of the biggest tuning levers in CFPS.',
    proteins: { reteplase: 'Reteplase needs lower K(Glu) (~250 mM) than sfGFP (~354 mM) to reduce aggregation during synthesis.' },
    mol: 'Monopotassium glutamate',
    wiki: 'Glutamic acid'
  },

  'Mg(Glu)2': {
    role: 'Magnesium holds ribosomes together and keeps tRNAs folded correctly. Too little and translation stalls; too much and proteins aggregate. One of the most sensitive optimization parameters in any CFPS formulation.',
    proteins: { reteplase: 'Oxidizing (DSB) conditions alter Mg²⁺ sensitivity — the reteplase target uses slightly less (~5.7 mM) than sfGFP (~7 mM).' },
    mol: 'Magnesium diglutamate',
    wiki: 'Glutamic acid'
  },

  'NH4(Glu)': {
    role: 'Provides ammonium as an extra salt that supports ribosome function and fine-tunes the ionic environment. Used alongside K(Glu) in several literature formulations.',
    mol: 'Monoammonium glutamate',
    wiki: 'Glutamic acid'
  },

  'Ammonium acetate': {
    role: 'Another way to add ammonium without adding glutamate. The acetate counter-ion is metabolically neutral, making it useful when you want to adjust ionic strength independently of carbon metabolism.',
    mol: 'Ammonium acetate',
    wiki: 'Ammonium acetate'
  },

  'K nitrate': {
    role: 'Adds potassium without adding more glutamate (which is already plentiful from the base buffer). Nitrate can also act as a mild electron acceptor to help balance redox in the lysate.',
    mol: 'Potassium nitrate',
    wiki: 'Potassium nitrate'
  },

  // ─── Amino acids ───────────────────────────────────────────────────────────

  'Amino acids': {
    role: 'The building blocks for protein synthesis. The 17-AA mix covers all standard amino acids except tyrosine, cysteine, and glutamate (added separately). Without a full amino acid pool, the ribosome stalls mid-synthesis.',
    proteins: { reteplase: 'Higher concentrations (5 mM) support the longer 399-AA reteplase chain without running out of building blocks.' },
    mol: null,
    wiki: 'Amino acid'
  },

  'Tyrosine': {
    role: 'An essential amino acid added separately from the mix because it barely dissolves at neutral pH (requires a pH 12 stock). The ribosome needs it to make all three target proteins.',
    mol: 'Tyrosine',
    wiki: 'Tyrosine'
  },

  'Cysteine': {
    role: 'Added separately because it oxidizes quickly in solution. For sfGFP and PETase, cysteine is just a building block. For reteplase, it\'s critical — reteplase has 9 disulfide bonds that all require correctly paired cysteines.',
    proteins: { reteplase: 'In the oxidizing DSB conditions used for reteplase, free cysteine must be balanced carefully — too much quenches the oxidizing environment needed for disulfide bond formation.' },
    mol: 'Cysteine',
    wiki: 'Cysteine'
  },

  // ─── Buffers ───────────────────────────────────────────────────────────────

  'HEPES pH 7.5': {
    role: 'A biologically inert pH buffer that keeps the reaction near pH 7.5 — the sweet spot for E. coli ribosomes. Unlike phosphate, it doesn\'t interfere with energy metabolism or metal ion concentrations.',
    mol: 'HEPES',
    wiki: 'HEPES'
  },

  'HEPES pH 7.2': {
    role: 'Same buffer as HEPES pH 7.5 but at a slightly lower pH. Used when a more acidic starting point is needed, such as in oxidizing reteplase reactions where the GSSG/GSH system can cause pH drift.',
    proteins: { reteplase: 'Used in Jewett reteplase experimental formulations to compensate for pH changes from the glutathione redox buffer.' },
    mol: 'HEPES',
    wiki: 'HEPES'
  },

  'Bis-Tris': {
    role: 'An alternative pH buffer with a lower pKa (~6.5), useful when the reaction tends to drift acidic due to metabolic byproducts. Used in Calhoun & Swartz and Warfel et al. formulations.',
    mol: 'Bis-Tris methane',
    wiki: 'Bis-tris methane'
  },

  'Phosphate': {
    role: 'Acts as both a pH buffer and a phosphate source for ATP regeneration. The trade-off is that phosphate can bind magnesium and reduce its availability, so Mg(Glu)2 levels need to be balanced accordingly.',
    mol: 'Phosphoric acid',
    wiki: 'Phosphate'
  },

  'Phosphate (di:mono)': {
    role: 'A pre-mixed potassium phosphate buffer (more dibasic than monobasic), giving a final pH around 7.4–7.8. Same function as Phosphate but with a specific ratio that determines the exact pH contribution.',
    mol: 'Potassium phosphate',
    wiki: 'Potassium phosphate'
  },

  'Phosphate (mono:di)': {
    role: 'A pre-mixed potassium phosphate buffer (more monobasic than dibasic), giving a final pH closer to 7.0. Used in RFopt where a near-neutral pH is the target.',
    mol: 'Potassium phosphate',
    wiki: 'Potassium phosphate'
  },

  // ─── Energy substrates ─────────────────────────────────────────────────────

  'Glucose': {
    role: 'The primary fuel source. Glucose is broken down by enzymes still active in the lysate to regenerate ATP, which powers both RNA synthesis (transcription) and protein synthesis (translation).',
    mol: 'Glucose',
    wiki: 'Glucose'
  },

  'Sodium pyruvate': {
    role: 'A metabolic intermediate just downstream of glucose breakdown. Adds to the energy pool without going through the full glycolysis pathway, giving a faster ATP boost. The Cytomim system (Jewett & Swartz) uses pyruvate as its primary energy source.',
    proteins: { reteplase: 'High pyruvate (25 mM) in Jewett R1_026 helps sustain energy over the long synthesis period needed for reteplase.' },
    mol: 'Sodium pyruvate',
    wiki: 'Pyruvic acid'
  },

  'Ribose': {
    role: 'A 5-carbon sugar that feeds into the pentose phosphate pathway, generating energy and nucleotide precursors. Identified as a major yield driver in RFopt at 50 mM — one of the highest concentrations of any supplement.',
    mol: 'Ribose',
    wiki: 'Ribose'
  },

  'Maltose': {
    role: 'A two-sugar molecule broken down into glucose by the lysate. Provides a slightly slower, more sustained energy release compared to free glucose.',
    mol: 'Maltose',
    wiki: 'Maltose'
  },

  'Maltodextrin': {
    role: 'A long-chain sugar that releases glucose slowly as it\'s broken down by the lysate. Acts as a slow-release energy source particularly useful for long reactions (10+ hours) such as reteplase synthesis.',
    mol: null,
    wiki: 'Maltodextrin'
  },

  'PEP': {
    role: 'Phosphoenolpyruvate — a high-energy molecule that directly hands a phosphate group to ADP to make ATP via pyruvate kinase. The most direct and fast ATP regeneration system, used in PANOx-SP. It\'s consumed stoichiometrically, so higher starting concentrations extend reaction time.',
    mol: 'Phosphoenolpyruvate',
    wiki: 'Phosphoenolpyruvic acid'
  },

  '3-PGA': {
    role: '3-Phosphoglycerate — a precursor that gets converted to PEP by lysate enzymes, providing a slower and more sustained version of PEP-based ATP regeneration. Used in Borkowski et al. and Garenne et al.',
    mol: '3-Phosphoglyceric acid',
    wiki: '3-Phosphoglyceric acid'
  },

  'Dilithium acetyl phosphate': {
    role: 'Another high-energy phosphate donor that regenerates ATP directly. Identified by the GPT-5 model as an effective alternative to PEP in some autonomous-lab formulations.',
    mol: 'Acetyl phosphate',
    wiki: 'Acetyl phosphate'
  },

  'Phosphoenolpyruvic acid cyclohexylammonium salt': {
    role: 'A more stable salt form of PEP that dissolves and stores better. Functionally identical to PEP — directly regenerates ATP via pyruvate kinase.',
    mol: 'Phosphoenolpyruvate',
    wiki: 'Phosphoenolpyruvic acid'
  },

  // ─── Cofactors ─────────────────────────────────────────────────────────────

  'Folinic acid': {
    role: 'The active form of vitamin B9 (folate). Needed for one-carbon reactions in amino acid metabolism — particularly making the methionine required to start every new protein chain. Without it, translation initiation rates drop over time.',
    mol: 'Folinic acid',
    wiki: 'Folinic acid'
  },

  'tRNA': {
    role: 'Transfer RNA — the adaptor molecules that bring amino acids to the ribosome. Crude lysate already contains tRNA, but supplementing it ensures there\'s always enough, especially for high-yield reactions where the existing pool can become depleted.',
    mol: null,
    wiki: 'Transfer RNA'
  },

  'CoA': {
    role: 'Coenzyme A — an essential carrier molecule for acetyl groups in energy metabolism (TCA cycle) and amino acid processing. Supplementing CoA keeps these metabolic pathways running at full capacity during CFPS.',
    mol: 'Coenzyme A',
    wiki: 'Coenzyme A'
  },

  'NAD': {
    role: 'A molecule that shuttles electrons during energy metabolism (glycolysis, TCA cycle). Without enough NAD⁺, the energy-generating pathways that fuel CFPS slow down. Adding NAD maintains the redox balance needed to keep ATP production going.',
    mol: 'NAD',
    wiki: 'Nicotinamide adenine dinucleotide'
  },

  'Nicotinamide': {
    role: 'A precursor to NAD (vitamin B3). The lysate can convert it to NAD⁺, providing a slow-release way to maintain NAD levels throughout the reaction rather than relying solely on the starting pool.',
    mol: 'Nicotinamide',
    wiki: 'Nicotinamide'
  },

  'cAMP': {
    role: 'A signaling molecule that activates certain genes in E. coli. In CFPS, it may help improve transcription efficiency and boost the overall metabolic activity of the lysate.',
    mol: 'Cyclic adenosine monophosphate',
    wiki: 'Cyclic adenosine monophosphate'
  },

  'Pantothenate': {
    role: 'Vitamin B5 — a precursor to CoA. Adding it gives the lysate enzymes the building block to synthesize more CoA during the reaction, extending CoA availability over time.',
    mol: 'Pantothenic acid',
    wiki: 'Pantothenic acid'
  },

  // ─── Polyamines & redox ────────────────────────────────────────────────────

  'Putrescine': {
    role: 'A small molecule that coats and stabilizes ribosomes by neutralizing their negative charge. Without polyamines, ribosomes fall apart more quickly, reducing the productive lifetime of the CFPS reaction.',
    mol: 'Putrescine',
    wiki: 'Putrescine'
  },

  'Spermidine': {
    role: 'A polyamine similar to putrescine but more positively charged, giving it stronger ribosome-stabilizing effects. Almost every high-yield CFPS formulation includes spermidine at 0.1–1.5 mM.',
    mol: 'Spermidine',
    wiki: 'Spermidine'
  },

  'Dithiothreitol': {
    role: 'A strong reducing agent that keeps all cysteine residues in their reduced (free thiol, –SH) form, preventing unwanted disulfide bonds. Used for sfGFP and PETase. Cannot be used for reteplase because reteplase requires disulfide bonds to fold correctly.',
    proteins: {
      reteplase: 'Not used — DTT is replaced by the GSSG/GSH redox buffer to allow disulfide bond formation.',
      sfgfp: 'Standard condition — keeps the protein in its native reduced state.',
      petase: 'Standard condition — TfCut2 folds reasonably well under reducing conditions.'
    },
    mol: 'Dithiothreitol',
    wiki: 'Dithiothreitol'
  },

  'GSSG': {
    role: 'Oxidized glutathione — creates a mildly oxidizing environment that drives disulfide bond formation in the growing protein chain. Essential for reteplase, which has 9 disulfide bonds. Used together with GSH to set a precise redox potential.',
    proteins: {
      reteplase: 'Critical — without oxidizing conditions, reteplase cannot form its disulfide bonds and is produced as an inactive, misfolded protein.',
      sfgfp: 'Not needed — sfGFP has no disulfide bonds and is expressed under standard reducing conditions.'
    },
    mol: 'Glutathione disulfide',
    wiki: 'Glutathione disulfide'
  },

  'GSH': {
    role: 'Reduced glutathione — works alongside GSSG as a redox buffer. The ratio of GSSG:GSH sets the exact oxidizing potential. GSH also helps reshuffle incorrectly formed disulfide bonds toward the right pairings (disulfide isomerization).',
    proteins: { reteplase: 'Essential partner to GSSG — together they allow DsbC to correct mis-paired disulfide bonds in reteplase toward the 9 correct pairings.' },
    mol: 'Glutathione',
    wiki: 'Glutathione'
  },

  'Oxalic acid': {
    role: 'Oxalate blocks phosphatases — enzymes that break down ATP into ADP or AMP. By inhibiting these enzymes, oxalate preserves the ATP pool and keeps the energy charge high throughout the reaction.',
    mol: 'Oxalic acid',
    wiki: 'Oxalic acid'
  },

  'Potassium Oxalate': {
    role: 'The soluble salt form of oxalic acid. Same function — blocks phosphatases to preserve ATP. The potassium salt dissolves better than the acid form at CFPS working concentrations.',
    mol: 'Potassium oxalate',
    wiki: 'Potassium oxalate'
  },

  // ─── NTPs ──────────────────────────────────────────────────────────────────

  'ATP': { role: 'The main energy currency of the cell. Added directly to jump-start transcription and translation before the energy regeneration system reaches full speed. Also needed to charge tRNAs with amino acids.', mol: 'ATP', wiki: 'Adenosine triphosphate' },
  'CTP': { role: 'One of the four building blocks for RNA synthesis (transcription). T7 RNA polymerase needs all four NTPs to make mRNA from the DNA template.', mol: 'Cytidine triphosphate', wiki: 'Cytidine triphosphate' },
  'GTP': { role: 'Building block for RNA and also directly consumed during translation — GTP is needed to deliver each amino acid to the ribosome. GTP depletion is a common bottleneck in CFPS.', mol: 'Guanosine triphosphate', wiki: 'Guanosine triphosphate' },
  'UTP': { role: 'Building block for RNA synthesis. Like CTP and GTP, it must be available continuously for transcription to keep producing mRNA template.', mol: 'Uridine triphosphate', wiki: 'Uridine triphosphate' },

  // ─── NMPs ──────────────────────────────────────────────────────────────────

  'AMP': { role: 'The monophosphate form of adenosine. The lysate has enzymes that phosphorylate AMP → ADP → ATP using energy from glucose/ribose metabolism. NMP-based formulations are much cheaper than NTP-based ones while achieving similar yields.', mol: 'Adenosine monophosphate', wiki: 'Adenosine monophosphate' },
  'CMP': { role: 'The monophosphate precursor to CTP. Phosphorylated to CTP by lysate kinases. Part of the low-cost NMP energy system used in RFopt and other modern formulations.', mol: 'Cytidine monophosphate', wiki: 'Cytidine monophosphate' },
  'GMP': { role: 'The monophosphate precursor to GTP. Because GTP is consumed during both transcription and translation, maintaining a steady GMP supply for regeneration is important.', mol: 'Guanosine monophosphate', wiki: 'Guanosine monophosphate' },
  'UMP': { role: 'The monophosphate precursor to UTP. Regenerated to UTP by lysate kinases using ATP as the phosphate donor.', mol: 'Uridine monophosphate', wiki: 'Uridine monophosphate' },

  // ─── Nucleosides ───────────────────────────────────────────────────────────

  'Adenosine': { role: 'A nucleoside (adenine + ribose) that the lysate can phosphorylate to AMP, then onward to ATP. An alternative way to supply adenine-containing nucleotides.', mol: 'Adenosine', wiki: 'Adenosine' },
  'Cytidine':  { role: 'Nucleoside precursor to CMP/CTP. Used in some Jewett reteplase formulations as an alternative nucleotide source.', mol: 'Cytidine', wiki: 'Cytidine' },
  'Guanosine': { role: 'Nucleoside precursor to GMP/GTP. The lysate phosphorylates it using kinase enzymes still active in the crude extract.', mol: 'Guanosine', wiki: 'Guanosine' },
  'Uridine':   { role: 'Nucleoside precursor to UMP/UTP. Used alongside other nucleosides as an alternative nucleotide supply strategy.', mol: 'Uridine', wiki: 'Uridine' },
  'Thymidine': { role: 'A nucleoside precursor to TMP/TTP (thymidine triphosphate), used primarily for DNA synthesis. Less directly relevant to CFPS but may support lysate enzyme function.', mol: 'Thymidine', wiki: 'Thymidine' },
  'Adenine':   { role: 'A purine base that can be incorporated into nucleotides. Less direct as a nucleotide precursor than adenosine or AMP.', mol: 'Adenine', wiki: 'Adenine' },
  'Guanine':   { role: 'A purine base used as a nucleotide precursor. May feed into GMP synthesis in the lysate.', mol: 'Guanine', wiki: 'Guanine' },
  'Cytosine':  { role: 'A pyrimidine base used as a nucleotide precursor.', mol: 'Cytosine', wiki: 'Cytosine' },
  'Uracil':    { role: 'A pyrimidine base used as a nucleotide precursor. Can feed into UMP synthesis in the lysate.', mol: 'Uracil', wiki: 'Uracil' },

  // ─── Enzymes ───────────────────────────────────────────────────────────────

  'Catalase': {
    role: 'An enzyme that breaks down hydrogen peroxide (H₂O₂) — a toxic byproduct of oxidative metabolism that would otherwise damage proteins and nucleotides in the reaction. Adding catalase extends the productive lifetime of the CFPS reaction.',
    proteins: { reteplase: 'Particularly useful in oxidizing DSB conditions where H₂O₂ production may be higher.' },
    mol: null,
    wiki: 'Catalase'
  },

  'DsbC': {
    role: 'Disulfide bond isomerase — an enzyme that corrects mis-paired disulfide bonds. When a protein folds and forms disulfide bonds in the wrong order, DsbC reshuffles them until all bonds are in the right place. Essential for reteplase which has 9 disulfide bonds.',
    proteins: {
      reteplase: 'Without DsbC, reteplase forms many incorrect disulfide bonds and is largely inactive. DsbC is added at 5 µM as purified protein or co-expressed from a helper plasmid.',
      sfgfp: 'Not needed — sfGFP has no disulfide bonds.',
      petase: 'May improve yield since TfCut2 has 1 disulfide bond, but not as critical as for reteplase.'
    },
    mol: null,
    wiki: 'Protein disulfide isomerase'
  },

  'DsbC helper DNA': {
    role: 'A plasmid encoding DsbC so it gets expressed directly inside the CFPS reaction alongside the target protein. This means DsbC is produced continuously during reteplase synthesis rather than being added as a fixed dose upfront.',
    proteins: { reteplase: 'Used in Jewett R1_001 as an alternative to adding purified DsbC protein directly.' },
    mol: null,
    wiki: 'Plasmid'
  },

  // ─── Other ─────────────────────────────────────────────────────────────────

  'Succinic acid': {
    role: 'An intermediate in the TCA cycle (energy-generating metabolism). Adding it gives the lysate\'s metabolic machinery an extra boost for ATP production during long reactions.',
    mol: 'Succinic acid',
    wiki: 'Succinic acid'
  },

  'Oxaloacetic acid': {
    role: 'Another TCA cycle intermediate that helps kick-start the energy-generating cycle in the lysate. Used in some GPT-5 formulations to sustain energy production.',
    mol: 'Oxaloacetic acid',
    wiki: 'Oxaloacetic acid'
  },

  'Potassium formate': {
    role: 'Formate can donate electrons to help regenerate NADH, providing an additional energy handle in the lysate. May also help balance pH.',
    mol: 'Potassium formate',
    wiki: 'Potassium formate'
  },

  'Sodium hexametaphosphate': {
    role: 'A chain of phosphate groups that can donate phosphate to regenerate ATP. Also controls free magnesium levels by chelating excess Mg²⁺. Identified by the GPT-5 model as useful in some autonomous-lab formulations.',
    mol: 'Sodium hexametaphosphate',
    wiki: 'Sodium hexametaphosphate'
  },

  'PEG-8000': {
    role: 'A large inert polymer that acts as a "crowding agent" — it takes up space in the reaction and mimics the crowded environment inside a cell. Molecular crowding can improve protein folding and ribosome function, which is relevant for complex proteins like reteplase.',
    mol: null,
    wiki: 'Polyethylene glycol'
  },

};

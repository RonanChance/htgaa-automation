// Industry-benchmark cell-free reaction formulations, sourced from
// Olsen et al. 2026 (Nature Communications) Table 1 — plus their two new
// formulations (Minimal + RFopt). All concentrations are in mM unless the
// unit field says otherwise. This file is the single source of truth for
// the /cfps benchmark comparison table.
//
// When you add a new benchmark, also add any missing reagent → inventory
// mappings to REAGENT_ALIASES below.

// ─── Source paper links ─────────────────────────────────────────────────────
// Clicking a composition name opens its source paper. Olsen et al. formulations
// (Table 1) and the oxidizing controls (Fig. 5) link to the Nature article; the
// GPT-5 autonomous-lab compositions (Table 2) link to the bioRxiv preprint.
// Ginkgo internal targets / experimental compositions have no public paper.
export const NATURE_URL = 'https://www.nature.com/articles/s41467-026-69605-8/tables/1';
export const BIORXIV_URL = 'https://www.biorxiv.org/content/10.64898/2026.02.05.703998v1.full.pdf';

// ─── Formulations ──────────────────────────────────────────────────────────
// Each entry is { name, citation, doi, category, paperUrl, components: {reagent: value} }
// Reagent keys match those in REAGENT_ALIASES.

export const BENCHMARK_FORMULATIONS = [
    {
        key: 'panox-sp',
        name: 'PANOx-SP',
        short: 'PANOx-SP',
        citation: 'Jewett & Swartz 2004',
        year: 2004,
        category: 'phosphorylated',
        yield_g_l: 1.11,
        cost_per_l: 4535,
        cost_per_g: 4083,
        components: {
            'Mg(Glu)2': 8, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Amino acids': 2, 'Tyrosine': 2, 'Cysteine': 2,
            'HEPES pH 7.5': 57, 'Putrescine': 1, 'Spermidine': 1.5,
            'Folinic acid': 0.03, 'tRNA': 0.17, 'CoA': 0.27, 'NAD': 0.4,
            'PEP': 30, 'Oxalic acid': 4,
            'ATP': 1.2, 'CTP': 0.85, 'GTP': 0.85, 'UTP': 0.85
        }
    },
    // Oxidizing PANOx-SP — disulfide-bond-forming positive control (Olsen Fig. 4/5).
    // Adds the published redox set (4 mM GSSG + 1 mM GSH + 5 µM purified DsbC) on top
    // of PANOx-SP. IAM lysate pretreatment (25–500 µM) and a BL21 Star (DE3) Δgor
    // lysate are also required but are pretreatments, not Echo-dispensed reagents.
    {
        key: 'panox-sp-ox',
        name: 'PANOx-SP (ox.)',
        short: 'PANOx-SP (ox.)',
        citation: 'Jewett & Swartz 2004, oxidizing (Olsen et al. 2026 Fig. 5) — +IAM pretreatment, BL21 Star Δgor lysate, 5 µM DsbC',
        year: 2004,
        category: 'oxidizing-control',
        components: {
            'Mg(Glu)2': 8, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Amino acids': 2, 'Tyrosine': 2, 'Cysteine': 2,
            'HEPES pH 7.5': 57, 'Putrescine': 1, 'Spermidine': 1.5,
            'Folinic acid': 0.03, 'tRNA': 0.17, 'CoA': 0.27, 'NAD': 0.4,
            'PEP': 30, 'Oxalic acid': 4,
            'ATP': 1.2, 'CTP': 0.85, 'GTP': 0.85, 'UTP': 0.85,
            'GSSG': 4, 'GSH': 1, 'DsbC': 5
        }
    },
    {
        key: 'jewett-2004',
        name: 'Jewett & Swartz',
        short: 'Jewett04',
        citation: 'Jewett & Swartz 2004',
        year: 2004,
        category: 'phosphorylated',
        yield_g_l: 0.62,
        cost_per_l: 1958,
        cost_per_g: 3181,
        components: {
            'Mg(Glu)2': 8, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Amino acids': 2,
            'Sodium pyruvate': 33, 'Putrescine': 1, 'Spermidine': 1.5,
            'Folinic acid': 0.034, 'tRNA': 0.17, 'CoA': 0.26, 'NAD': 0.33,
            'Oxalic acid': 4,
            'ATP': 1.2, 'CTP': 0.85, 'GTP': 0.85, 'UTP': 0.85
        }
    },
    {
        key: 'calhoun-2005',
        name: 'Calhoun & Swartz',
        short: 'Calhoun05',
        citation: 'Calhoun & Swartz 2005',
        year: 2005,
        category: 'non-phosphorylated',
        yield_g_l: 0.69,
        cost_per_l: 1921,
        cost_per_g: 2803,
        components: {
            'Mg(Glu)2': 8, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Glucose': 30, 'Amino acids': 2,
            'Phosphate': 10, 'Bis-Tris': 57, 'Putrescine': 1, 'Spermidine': 1.5,
            'Folinic acid': 0.034, 'tRNA': 0.17, 'CoA': 0.26, 'NAD': 0.33,
            'ATP': 1.2, 'CTP': 0.85, 'GTP': 0.85, 'UTP': 0.85
        }
    },
    {
        key: 'zawada-2011',
        name: 'Zawada et al.',
        short: 'Zawada11',
        citation: 'Zawada et al. 2011 (2 mM AA mix + 1 mM tyrosine per Table 1 footnote *)',
        year: 2011,
        category: 'non-phosphorylated',
        yield_g_l: 0.91,
        cost_per_l: 308,
        cost_per_g: 339,
        components: {
            'Mg(Glu)2': 8, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Amino acids': 2, 'Tyrosine': 1,
            'Phosphate': 15, 'Sodium pyruvate': 35, 'Putrescine': 1, 'Spermidine': 1.5,
            'Oxalic acid': 4, 'GSSG': 4, 'GSH': 1,
            'AMP': 1.2, 'CMP': 0.86, 'GMP': 0.86, 'UMP': 0.86
        }
    },
    {
        key: 'cai-2015',
        name: 'Cai et al.',
        short: 'Cai15',
        citation: 'Cai et al. 2015 (2 mM AA mix + 1 mM tyrosine per Table 1 footnote *)',
        year: 2015,
        category: 'non-phosphorylated',
        yield_g_l: 0.46,
        cost_per_l: 257,
        cost_per_g: 564,
        components: {
            'Mg(Glu)2': 8, 'K(Glu)': 260, 'Amino acids': 2, 'Tyrosine': 1,
            'Phosphate': 15, 'Spermidine': 1.5,
            'Oxalic acid': 4, 'GSSG': 2,
            'AMP': 1.2, 'CMP': 0.86, 'GMP': 0.86, 'UMP': 0.86
        }
    },
    {
        key: 'borkowski-2020',
        name: 'Borkowski et al.',
        short: 'Borkow20',
        citation: 'Borkowski et al. 2020',
        year: 2020,
        category: 'phosphorylated',
        yield_g_l: 0.72,
        cost_per_l: 2179,
        cost_per_g: 3026,
        components: {
            'Mg(Glu)2': 4, 'K(Glu)': 80, 'Amino acids': 1.5,
            'HEPES pH 7.5': 50, 'Spermidine': 0.1, 'Dithiothreitol': 2.5,
            'Folinic acid': 0.035, 'tRNA': 0.06, 'CoA': 0.026, 'NAD': 0.165, '3-PGA': 9,
            'PEG-8000': 2,
            'ATP': 1.5, 'CTP': 0.9, 'GTP': 1.5, 'UTP': 0.9
        }
    },
    {
        key: 'garenne-2021',
        name: 'Garenne et al.',
        short: 'Garenne21',
        citation: 'Garenne et al. 2019/2021 (1.5 mM AA mix + 1.25 mM extra leucine per Table 1 footnote **; leucine surplus not modelled — no standalone leucine stock)',
        year: 2021,
        category: 'non-phosphorylated',
        yield_g_l: 1.01,
        cost_per_l: 4577,
        cost_per_g: 4550,
        components: {
            'Mg(Glu)2': 8, 'K(Glu)': 80, 'Amino acids': 1.5, 
            'HEPES pH 7.5': 50, 'Spermidine': 1, 'Dithiothreitol': 1, 'Ribose': 30,
            'Folinic acid': 0.032, 'tRNA': 0.2, 'CoA': 0.26, 'NAD': 0.33, 'cAMP': 0.75,
            '3-PGA': 30, 'Maltodextrin': 21.6,
            'ATP': 1.5, 'CTP': 0.9, 'GTP': 1.5, 'UTP': 0.9
        }
    },
    {
        key: 'warfel-2023',
        name: 'Warfel et al.',
        short: 'Warfel23',
        citation: 'Warfel et al. 2023',
        year: 2023,
        category: 'non-phosphorylated',
        yield_g_l: 0.72,
        cost_per_l: 257,
        cost_per_g: 356,
        components: {
            'Mg(Glu)2': 10, 'NH4(Glu)': 10, 'K(Glu)': 130, 'Amino acids': 2,
            'Phosphate': 75, 'Bis-Tris': 57, 'Putrescine': 1, 'Spermidine': 1.5,
            'Folinic acid': 0.034, 'NAD': 0.4,
            'Oxalic acid': 4, 'Maltodextrin': 60,
            'AMP': 1.2, 'CMP': 0.86, 'GMP': 0.86, 'UMP': 0.86
        }
    },
    {
        key: 'zhu-2025',
        name: 'Zhu et al.',
        short: 'Zhu25',
        citation: 'Zhu et al. 2025',
        year: 2025,
        category: 'phosphorylated',
        yield_g_l: 0.61,
        cost_per_l: 6974,
        cost_per_g: 11433,
        components: {
            'Mg(Glu)2': 12, 'K(Glu)': 130, 'Ammonium acetate': 10, 'Amino acids': 2,
            'HEPES pH 7.5': 57, 'Spermidine': 0.13,
            'Folinic acid': 2.05,
            'PEP': 40,
            'ATP': 2.6, 'CTP': 1.9, 'GTP': 1.9, 'UTP': 1.9
        }
    },
    {
        key: 'minimal-2026',
        name: 'Minimal',
        short: 'Minimal',
        citation: 'Olsen et al. 2026',
        year: 2026,
        category: 'non-phosphorylated',
        yield_g_l: 0.53,
        cost_per_l: 93,
        cost_per_g: 175,
        components: {
            'K(Glu)': 300, 'Amino acids': 3.25, 'Tyrosine': 3.25, 'Cysteine': 3.25,
            'AMP': 1.2, 'CMP': 0.86, 'GMP': 0.86, 'UMP': 0.86
        }
    },
    {
        key: 'rfopt-2026',
        name: 'RFopt',
        short: 'RFopt',
        citation: 'Olsen et al. 2026 (optimized)',
        year: 2026,
        category: 'non-phosphorylated',
        yield_g_l: 2.39,
        cost_per_l: 143,
        cost_per_g: 60,
        components: {
            'Mg(Glu)2': 8, 'K(Glu)': 362, 'Glucose': 10, 'Amino acids': 5, 'Tyrosine': 5, 'Cysteine': 5,
            'Phosphate': 15, 'Nicotinamide': 4, 'Ribose': 50, 'HEPES pH 7.5': 75,
            'AMP': 3, 'CMP': 2.15, 'GMP': 2.15, 'UMP': 2.15
        }
    },
    // Oxidizing RFopt — the reteplase/vtPA positive control (Olsen Fig. 5b: vtPA
    // activity was produced with RFopt in an oxidizing environment). Adds 4 mM GSSG
    // + 1 mM GSH + 5 µM purified DsbC. RFopt already uses HEPES-KOH pH 7.5 (the pH
    // raised in Olsen Fig. 4c to prevent the glutathione-driven pH drop). IAM
    // pretreatment + BL21 Star (DE3) Δgor lysate also required (not dispensed here).
    {
        key: 'rfopt-2026-ox',
        name: 'RFopt (ox.)',
        short: 'RFopt (ox.)',
        citation: 'Olsen et al. 2026, oxidizing (Fig. 5, reteplase/vtPA) — +IAM pretreatment, BL21 Star Δgor lysate, HEPES pH 7.5, 5 µM DsbC',
        year: 2026,
        category: 'oxidizing-control',
        components: {
            'Mg(Glu)2': 8, 'K(Glu)': 362, 'Glucose': 10, 'Amino acids': 5, 'Tyrosine': 5, 'Cysteine': 5,
            'Phosphate': 15, 'Nicotinamide': 4, 'Ribose': 50, 'HEPES pH 7.5': 75,
            'AMP': 3, 'CMP': 2.15, 'GMP': 2.15, 'UMP': 2.15,
            'GSSG': 4, 'GSH': 1, 'DsbC': 5
        }
    },
    // ─── GPT-5-driven autonomous lab (Smith et al. 2026, Ginkgo × OpenAI) ───
    // Table 2 top-performers. Titer measured in 2-mL tubes with 5 nM DNA + 25% lysate.
    // Cost per L reaction = cost_per_g × yield_g_l.
    {
        key: 'ginkgo-1777863-77',
        name: 'GPT-5 #77',
        short: 'GPT-5 #77',
        citation: 'Smith et al. 2026 · 1777863_77',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 3.04,
        cost_per_l: 1282,
        cost_per_g: 422,
        components: {
            'HEPES pH 7.5': 45.0, 'K(Glu)': 312.6, 'Mg(Glu)2': 7.0, 'Glucose': 6.9,
            'Amino acids': 4.1, 'Tyrosine': 4.1, 'Cysteine': 4.0,
            'Phosphate (di:mono)': 5.6, 'Phosphate (mono:di)': 5.6,
            'Nicotinamide': 3.1, 'Ribose': 77.4,
            'AMP': 0.6, 'CMP': 0.4, 'UMP': 0.4,
            'Guanine': 0.2
        }
    },
    {
        key: 'ginkgo-1784943-26',
        name: 'GPT-5 #26',
        short: 'GPT-5 #26',
        citation: 'Smith et al. 2026 · 1784943_26',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 3.01,
        cost_per_l: 1279,
        cost_per_g: 425,
        components: {
            'HEPES pH 7.5': 50.0, 'K(Glu)': 299.8, 'Mg(Glu)2': 7.0,
            'Amino acids': 3.2, 'Tyrosine': 3.2, 'Cysteine': 3.2,
            'Phosphate (di:mono)': 7.5, 'Phosphate (mono:di)': 7.5,
            'Nicotinamide': 4.0, 'Ribose': 69.9,
            'AMP': 0.8, 'CMP': 0.5, 'GMP': 0.5, 'UMP': 0.5
        }
    },
    {
        key: 'ginkgo-1793122-35',
        name: 'GPT-5 #35',
        short: 'GPT-5 #35',
        citation: 'Smith et al. 2026 · 1793122_35 (most balanced)',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 3.04,
        cost_per_l: 1307,
        cost_per_g: 430,
        components: {
            'HEPES pH 7.5': 67.5, 'K(Glu)': 273.2, 'Mg(Glu)2': 8.8, 'Glucose': 8.3, 'Sodium pyruvate': 9.1,
            'Amino acids': 4.8, 'Tyrosine': 1.2, 'Cysteine': 5.0,
            'Phosphate (di:mono)': 7.5, 'Phosphate (mono:di)': 7.5,
            'Nicotinamide': 4.0, 'Spermidine': 1.2, 'Ribose': 40.0,
            'AMP': 0.5, 'CMP': 1.0, 'GMP': 1.0, 'UMP': 1.0,
            'Adenosine': 0.4,
            'Catalase': 187.5
        }
    },
    {
        key: 'ginkgo-1793665-74',
        name: 'GPT-5 #74',
        short: 'GPT-5 #74',
        citation: 'Smith et al. 2026 · 1793665_74',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 2.92,
        cost_per_l: 1302,
        cost_per_g: 446,
        components: {
            'HEPES pH 7.5': 75.0, 'K(Glu)': 299.8, 'Mg(Glu)2': 8.2, 'Glucose': 8.3,
            'Oxaloacetic acid': 5.0,
            'Amino acids': 4.8, 'Tyrosine': 1.2, 'Cysteine': 4.0,
            'Phosphate (di:mono)': 15.0,
            'Nicotinamide': 4.0, 'Spermidine': 1.2, 'Ribose': 40.0,
            'AMP': 1.5, 'CMP': 1.0, 'UMP': 1.0,
            'Guanine': 0.6
        }
    },
    {
        key: 'ginkgo-1793119-36',
        name: 'GPT-5 #36a',
        short: 'GPT-5 #36a',
        citation: 'Smith et al. 2026 · 1793119_36',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 2.77,
        cost_per_l: 1291,
        cost_per_g: 466,
        components: {
            'HEPES pH 7.5': 75.0, 'K(Glu)': 277.5, 'Mg(Glu)2': 8.2, 'Glucose': 9.7, 'Sodium pyruvate': 18.2,
            'Amino acids': 3.0, 'Tyrosine': 3.0, 'Cysteine': 3.0,
            'Phosphate (di:mono)': 15.0,
            'Dilithium acetyl phosphate': 0.2,
            'Nicotinamide': 0.4, 'Ribose': 50.0,
            'AMP': 1.0, 'CMP': 1.0, 'GMP': 1.0, 'UMP': 1.0
        }
    },
    {
        key: 'ginkgo-1794089-36',
        name: 'GPT-5 #36b',
        short: 'GPT-5 #36b',
        citation: 'Smith et al. 2026 · 1794089_36',
        year: 2026,
        category: 'gpt5-autonomous',
        yield_g_l: 2.75,
        cost_per_l: 1293,
        cost_per_g: 470,
        components: {
            'HEPES pH 7.5': 60.0, 'K(Glu)': 273.2, 'Mg(Glu)2': 8.2, 'Glucose': 8.3,
            'Amino acids': 4.8, 'Tyrosine': 3.2, 'Cysteine': 4.0,
            'Phosphate (di:mono)': 7.5, 'Phosphate (mono:di)': 7.5,
            'Nicotinamide': 3.0, 'Spermidine': 1.2, 'Ribose': 40.0,
            'CMP': 1.1, 'GMP': 1.1, 'UMP': 1.1
        }
    },
    // ─── Ginkgo internal target-control recipes (from LIMS) ────────────────
    // Final concentrations back-calculated from the per-reagent nL volumes in
    // each LIMS sample's contents record (20 µL reaction, base buffer 2 µL).
    //   Formula: final_mM = stock_mM × (supp_volume_nL / 20000) + base_contribution_mM
    // sfGFP target control — LIMS sample 116796825
    {
        key: 'ginkgo-target-sfgfp',
        name: 'Target',
        short: 'Target',
        citation: 'Ginkgo internal · LIMS 116796825 (sfGFP target control)',
        year: 2026,
        category: 'ginkgo-target',
        components: {
            'K(Glu)': 354.2, 'Mg(Glu)2': 6.975, 'HEPES pH 7.5': 50.0,
            'Amino acids': 3.25, 'Tyrosine': 3.25, 'Cysteine': 3.25,
            'Ribose': 70.0, 'Nicotinamide': 4.0,
            'Phosphate (mono:di)': 7.5, 'Phosphate (di:mono)': 7.5,
            'AMP': 0.75, 'CMP': 0.5, 'GMP': 0.5, 'UMP': 0.5
        }
    },
    // Reteplase target control (salt-optimized 8.5) — LIMS sample 118688180
    {
        key: 'ginkgo-target-reteplase',
        name: 'Target (Reteplase)',
        short: 'Target (Reteplase)',
        citation: 'Ginkgo internal · LIMS 118688180 (reteplase salt-optimized 8.5)',
        year: 2026,
        category: 'ginkgo-target',
        components: {
            'K(Glu)': 250.3, 'Mg(Glu)2': 5.725, 'HEPES pH 7.5': 50.0,
            'Amino acids': 3.25, 'Tyrosine': 3.25, 'Cysteine': 3.25,
            'PEP': 10.0, 'Nicotinamide': 4.0,
            'Phosphate (mono:di)': 7.5, 'Phosphate (di:mono)': 7.5,
            'AMP': 0.75, 'CMP': 0.5, 'GMP': 0.5, 'UMP': 0.5,
            'DsbC': 4.0, 'GSSG': 3.825, 'GSH': 1.25
        }
    },
    // Older reteplase target control (glucose/ribose energy) — LIMS sample 119260961
    {
        key: 'ginkgo-target-reteplase-old',
        name: 'Target (Old Reteplase)',
        short: 'Target (Old Reteplase)',
        citation: 'Ginkgo internal · LIMS 119260961 (reteplase target control, prior recipe)',
        year: 2026,
        category: 'ginkgo-target',
        components: {
            'K(Glu)': 329.1, 'Mg(Glu)2': 6.975, 'HEPES pH 7.5': 50.0,
            'Amino acids': 3.25, 'Tyrosine': 3.25, 'Cysteine': 3.25,
            'Ribose': 70.0, 'Nicotinamide': 4.0,
            'Phosphate (mono:di)': 7.5, 'Phosphate (di:mono)': 7.5,
            'AMP': 0.75, 'CMP': 0.5, 'GMP': 0.5, 'UMP': 0.5,
            'DsbC': 4.0, 'GSSG': 3.825, 'GSH': 1.25
        }
    },
    // Jewett Reteplase_R1_044 — mixed NMP + nucleoside energy blend with high
    // K nitrate, glucose, pyruvate, and DsbC helper DNA.
    {
        key: 'jewett-reteplase-r1-044',
        name: 'Jewett (Reteplase_R1_044)',
        short: 'Jewett (Reteplase_R1_044)',
        citation: 'Ginkgo internal · Reteplase_R1_044',
        year: 2026,
        category: 'ginkgo-experimental',
        components: {
            // Total = supplement + base buffer (K(Glu) +200, Mg(Glu)2 +2.6, AA +1, Tyr +1, Cys +1)
            'K(Glu)': 272.1875, 'Mg(Glu)2': 13.85, 'HEPES pH 7.2': 8.75, 'K nitrate': 31.25,
            'Amino acids': 1.5, 'Tyrosine': 1.5, 'Cysteine': 3.0,
            'ATP': 3.25, 'AMP': 1.75, 'CMP': 1.5, 'GMP': 1.625, 'UMP': 1.5,
            'Adenosine': 0.34375, 'Cytidine': 0.28125, 'Guanosine': 0.3125, 'Uridine': 0.28125,
            'Glucose': 19.425, 'Maltose': 1.095, 'Ribose': 4.995,
            'Maltodextrin': 8.25, 'Sodium pyruvate': 17.044,
            'Folinic acid': 0.2625, 'Nicotinamide': 2.0, 'cAMP': 2.25, 'Pantothenate': 0.75,
            'Spermidine': 2.5, 'GSSG': 2.975, 'GSH': 1.375,
            'Succinic acid': 1.875,
            'DsbC helper DNA': 2.375
        }
    },
    // Jewett Reteplase_R1_001 (well I19) — top-performing reteplase composition.
    // Multi-carbon energy blend (maltose + ribose + glucose + succinate) with
    // pantothenate, pH-7.2 HEPES supplement, and DsbC helper plasmid.
    {
        key: 'jewett-reteplase-r1-001',
        name: 'Jewett (Reteplase_R1_001)',
        short: 'Jewett (Reteplase_R1_001)',
        citation: 'Ginkgo internal · Reteplase_R1_001 well I19',
        year: 2026,
        category: 'ginkgo-experimental',
        components: {
            'K(Glu)': 265.625, 'Mg(Glu)2': 26.35, 'HEPES pH 7.2': 18.75, 'K nitrate': 5.0,
            'Amino acids': 2.0, 'Tyrosine': 1.0, 'Cysteine': 1.0,
            'ATP': 0.5, 'CMP': 4.375, 'GMP': 4.25, 'UMP': 0.875,
            'Glucose': 24.975, 'Maltose': 3.103, 'Ribose': 34.965,
            'Maltodextrin': 4.5, 'Sodium pyruvate': 1.136,
            'Folinic acid': 0.163, 'Nicotinamide': 1.875, 'cAMP': 1.75, 'Pantothenate': 1.875,
            'Spermidine': 1.875, 'GSSG': 2.763, 'GSH': 2.625,
            'Succinic acid': 8.75,
            'DsbC helper DNA': 2.375
        }
    },
    // Jewett Reteplase_R1_026 — sibling composition on the same run. Uses
    // nucleosides (adenosine/cytidine/guanosine/uridine) instead of NMPs,
    // adds DsbC protein instead of the helper DNA, and higher Mg + K nitrate.
    {
        key: 'jewett-reteplase-r1-026',
        name: 'Jewett (Reteplase_R1_026)',
        short: 'Jewett (Reteplase_R1_026)',
        citation: 'Ginkgo internal · Reteplase_R1_026',
        year: 2026,
        category: 'ginkgo-experimental',
        components: {
            'K(Glu)': 278.75, 'Mg(Glu)2': 48.225, 'HEPES pH 7.2': 6.25, 'K nitrate': 15.0,
            'Amino acids': 3.5, 'Tyrosine': 1.0, 'Cysteine': 2.0,
            'ATP': 1.5,
            'Adenosine': 1.1875, 'Cytidine': 0.344, 'Guanosine': 0.281, 'Uridine': 0.219,
            'Glucose': 1.3875, 'Maltose': 2.008, 'Ribose': 16.65,
            'Maltodextrin': 3.375, 'Sodium pyruvate': 25.0,
            'Folinic acid': 0.275, 'Nicotinamide': 0.25, 'cAMP': 3.75, 'Pantothenate': 0.625,
            'Spermidine': 4.0625, 'GSSG': 2.7625, 'GSH': 0.375,
            'Succinic acid': 6.875,
            'DsbC': 1.0
        }
    }
];

// Attach the source-paper link + Echo-native flag to each formulation by category.
//  - paperUrl: Olsen Table 1 + oxidizing controls → Nature; GPT-5 → bioRxiv;
//    Ginkgo internal targets/experimental → none.
//  - echoNative: true for compositions that were DESIGNED or MEASURED at 25 nL Echo
//    resolution on our exact stocks (GPT-5 autonomous-lab designs + Ginkgo LIMS
//    targets/experimental). Their listed concentrations are the nearest 25 nL-
//    achievable values, rounded for display — so snapping recovers the true recipe
//    and there is NO real rounding error (the apparent Δ% is just paper display
//    rounding, e.g. AMP 125 nL = 0.625 mM printed as "0.6"). Literature targets
//    (Olsen Table 1 + oxidizing controls) are NOT Echo-native: their published
//    concentrations weren't designed around our Echo, so 25 nL rounding is real.
for (const bm of BENCHMARK_FORMULATIONS) {
    if (bm.category === 'gpt5-autonomous') { bm.paperUrl = BIORXIV_URL; bm.echoNative = true; }
    else if (bm.category === 'ginkgo-target' || bm.category === 'ginkgo-experimental') { bm.paperUrl = null; bm.echoNative = true; }
    else { bm.paperUrl = NATURE_URL; bm.echoNative = false; }
}

// ─── Paper reagent name → our reagent inventory ─────────────────────────────
// Each entry describes how to realize a paper reagent using our stocks.
//
//   ids:      one or more reagent_id values from the CFPS PocketBase inventory.
//             For multi-reagent groups (e.g. "Amino acids" = aa mix + tyr + cys)
//             we list all of them; the loader splits target evenly or by hint.
//   stockMm:  effective stock concentration in mM (used to compute headroom)
//   unit:     'mM' | 'mg/mL' | '% w/v' — how the paper reports it
//   notes:    free-text caveats

export const REAGENT_ALIASES = {
    'Mg(Glu)2':        { ids: ['magnesium_glutamate'],           stockMm: 500,  unit: 'mM' },
    'K(Glu)':          { ids: ['potassium_glutamate'],           stockMm: 875,  unit: 'mM' },
    'NH4(Glu)':        { ids: null, unit: 'mM', maxSolubleMm: 1000,
                         notes: 'Ammonium glutamate not in stock. Could substitute NH4Cl or omit.' },
    'Ammonium acetate':{ ids: null, unit: 'mM', maxSolubleMm: 1000,
                         notes: 'Ammonium acetate not in stock. Could substitute for NH4(Glu).' },
    'Glucose':         { ids: ['glucose'],                       stockMm: 1110.15, unit: 'mM' },
    'Amino acids':     { ids: ['aa_mix_17', 'tyrosine', 'cysteine'], stockMm: 50, unit: 'mM',
                         notes: 'Composite: 17 aa mix + tyrosine + cysteine. Each contributes the same mM target.' },
    'Tyrosine':        { ids: ['tyrosine'],                       stockMm: 50,  unit: 'mM' },
    'Cysteine':        { ids: ['cysteine'],                       stockMm: 200, unit: 'mM' },
    'Phosphate':       { ids: ['potassium_phosphate_ratio_dibasic_monobasic'], stockMm: 500, unit: 'mM' },
    'Phosphate (di:mono)': { ids: ['potassium_phosphate_ratio_dibasic_monobasic'], stockMm: 500, unit: 'mM',
                             notes: '1.6:1 dibasic:monobasic molar ratio.' },
    'Phosphate (mono:di)': { ids: ['potassium_phosphate_ratio_monobasic_dibasic'], stockMm: 500, unit: 'mM',
                             notes: '1.6:1 monobasic:dibasic molar ratio.' },
    'Dilithium acetyl phosphate': { ids: ['dilithium_acetyl_phosphate'], stockMm: 50, unit: 'mM' },
    'Oxaloacetic acid': { ids: ['oxaloacetic_acid'],              stockMm: 500, unit: 'mM' },
    'Adenosine':       { ids: ['adenosine'],                      stockMm: 25,  unit: 'mM' },
    'Cytidine':        { ids: ['cytidine'],                       stockMm: 25,  unit: 'mM' },
    'Guanosine':       { ids: ['guanosine'],                      stockMm: 25,  unit: 'mM' },
    'Uridine':         { ids: ['uridine'],                        stockMm: 25,  unit: 'mM' },
    'Guanine':         { ids: ['guanine'],                        stockMm: 25,  unit: 'mM' },
    'Catalase':        { ids: ['catalase'],                       stockMm: 50000, unit: 'U/mL',
                         notes: 'Stock 50,000 U/mL — targets in the GPT-5 paper are U/mL.' },
    'DsbC':            { ids: ['dsbc_ecoli'],                    stockMm: 100, unit: 'µM',
                         notes: 'Disulfide bond isomerase for reteplase folding. Stock 100 µM (0.1 mM); paper targets in µM.' },
    'Maltose':         { ids: ['maltose'],                        stockMm: 146.07, unit: 'mM',
                         notes: 'Maltose stock 50 g/L (MW 342 → 146 mM).' },
    'Succinic acid':   { ids: ['succinic_acid'],                  stockMm: 500, unit: 'mM' },
    'Pantothenate':    { ids: ['pantothenic_acid_calcium'],       stockMm: 100, unit: 'mM',
                         notes: 'Pantothenic acid, calcium salt (0.1 M stock).' },
    'HEPES pH 7.2':    { ids: ['hepes_ph_7_2'],                   stockMm: 1000, unit: 'mM',
                         notes: 'HEPES at pH 7.2 — different pH stock from the standard hepes_koh (which is pH 7.5).' },
    'K nitrate':       { ids: ['potassium_nitrate'],              stockMm: 1000, unit: 'mM' },
    'DsbC helper DNA': { ids: ['dsbc_pdam_let'],                  stockMm: 100, unit: 'ng/µL',
                         notes: 'Co-expressed DsbC helper plasmid (100 ng/µL stock). Targets in ng/µL.' },
    'Nicotinamide':    { ids: ['nicotinamide'],                  stockMm: 100,  unit: 'mM' },
    'Ribose':          { ids: ['ribose'],                        stockMm: 666.09,  unit: 'mM' },
    'HEPES pH 7.5':           { ids: ['hepes_koh'],                     stockMm: 1000, unit: 'mM' },
    'Bis-Tris':        { ids: null, unit: 'mM', maxSolubleMm: 500,
                         notes: 'Bis-Tris buffer not in stock. HEPES-KOH pH 7.5 is closest substitute.' },
    'Sodium pyruvate':        { ids: ['sodium_pyruvate'],               stockMm: 908.76,  unit: 'mM' },
    'Putrescine':      { ids: null, unit: 'mM', maxSolubleMm: 500,
                         notes: 'Putrescine not in stock. Spermidine partially compensates.' },
    'Spermidine':      { ids: ['spermidine'],                    stockMm: 250,  unit: 'mM' },
    'Dithiothreitol':  { ids: null, unit: 'mM', maxSolubleMm: 1000,
                         notes: 'DTT not in stock. Cell lysate contains endogenous reducing power.' },
    'Folinic acid':    { ids: ['folinic_acid'],                  stockMm: 10,   unit: 'mg/mL',
                         notes: 'Stock is 10 mg/mL; target values in paper are mg/mL.' },
    'tRNA':            { ids: null, unit: 'mg/mL', maxSolubleMm: 5,
                         notes: 'Purified tRNA not in stock. Cell lysate provides basal levels. Practical stock ≤5 mg/mL.' },
    'CoA':             { ids: null, unit: 'mM', maxSolubleMm: 50,
                         notes: 'Coenzyme A not in stock. Cell lysate provides some. Practical stock ≤50 mM.' },
    'NAD':             { ids: ['nad'],                           stockMm: 100,  unit: 'mM' },
    'cAMP':            { ids: ['camp'],                          stockMm: 200,  unit: 'mM' },
    'PEP':             { ids: ['pep_mono'],                       stockMm: 100, unit: 'mM',
                         notes: 'Uses the in-stock pep_mono variant (100 mM).' },
    '3-PGA':           { ids: null, unit: 'mM', maxSolubleMm: 200,
                         notes: '3-Phosphoglycerate not in stock. Related to central carbon metabolism.' },
    'Oxalic acid':     { ids: ['potassium_oxalate'],             stockMm: 500,  unit: 'mM',
                         notes: 'Supplied as potassium oxalate (0.5 M stock).' },
    'GSSG':            { ids: ['oxidized_glutathione'],          stockMm: 170,  unit: 'mM' },
    'GSH':             { ids: ['reduced_glutathione'],           stockMm: 100,  unit: 'mM' },
    'Maltodextrin':    { ids: ['maltodextrin_17'],               stockMm: 300,  unit: 'mg/mL',
                         notes: 'Stock is 300 mg/mL; target values are mg/mL.' },
    'PEG-8000':        { ids: null, unit: '% w/v',
                         notes: 'PEG-8000 (crowding agent) not in stock.' },
    'ATP':             { ids: ['atp'],                           stockMm: 100,  unit: 'mM' },
    'CTP':             { ids: ['ctp'],                           stockMm: 100,  unit: 'mM' },
    'GTP':             { ids: ['gtp'],                           stockMm: 100,  unit: 'mM' },
    'UTP':             { ids: ['utp'],                           stockMm: 100,  unit: 'mM' },
    'AMP':             { ids: ['amp'],                           stockMm: 100,  unit: 'mM' },
    'CMP':             { ids: ['cmp'],                           stockMm: 100,  unit: 'mM' },
    'GMP':             { ids: ['gmp'],                           stockMm: 100,  unit: 'mM' },
    'UMP':             { ids: ['ump'],                           stockMm: 100,  unit: 'mM' }
};

// ─── LIMS object links ──────────────────────────────────────────────────────
// Maps a site reagent id → its first LIMS object id from reagent_info.txt.
// The prefix routes the URL: "m…" → /molecules/{n}, "e…" → /reagents/{n}.
// (First id per reagent, per spec — note some differ from the picking-list
// entity, e.g. hepes_koh's first object is the molecule m2433311.)
// A few site ids use different names in reagent_info.txt; those are mapped to
// the reagent_info name's first object id here (aa_mix_17 → amino_acid_mix_17,
// potassium_phosphate_ratio_* → kpo_*_mix).
export const LIMS_OBJECT_ID_BY_ID = {
    magnesium_glutamate: 'm8827570',
    potassium_glutamate: 'm9063889',
    glucose: 'e11006',
    aa_mix_17: 'e12030',                 // amino_acid_mix_17
    tyrosine: 'm29868',
    cysteine: 'm29857',
    potassium_phosphate_ratio_dibasic_monobasic: 'e12144', // kpo_dibasic_mix
    potassium_phosphate_ratio_monobasic_dibasic: 'e12145', // kpo_monobasic_mix
    dilithium_acetyl_phosphate: 'm9113077',
    oxaloacetic_acid: 'e8229',
    adenosine: 'm9113099',
    cytidine: 'm9113101',
    guanosine: 'm9113100',
    uridine: 'm9113102',
    guanine: 'm9113105',
    catalase: 'e12099',
    dsbc_ecoli: 'e12499',
    dsbc_ecoli_jewettprep: 'e12487',
    maltose: 'e11994',
    maltodextrin_17: 'e12044',
    succinic_acid: 'e5198',
    pantothenic_acid_calcium: 'e12436',
    hepes_ph_7_2: 'e12489',
    hepes_ph_7_8: 'e12490',
    calcium_chloride: 'e10814',
    potassium_nitrate: 'e12500',
    dsbc_pdam_let: 'm9378859',
    nicotinamide: 'e877',
    ribose: 'e1310',
    hepes_koh: 'm2433311',
    sodium_pyruvate: 'e1276',
    spermidine: 'm3327247',
    folinic_acid: 'm9063890',
    nad: 'e2583',
    camp: 'e3269',
    pep_mono: 'm30809',
    potassium_oxalate: 'e2757',
    oxidized_glutathione: 'e12352',
    reduced_glutathione: 'e12351',
    atp: 'm29357',
    ctp: 'm3327215',
    gtp: 'm3327209',
    utp: 'm3327246',
    amp: 'm9113078',
    cmp: 'm9113079',
    gmp: 'm9113097',
    ump: 'm9113098'
};

const LIMS_BASE = 'https://lims.ginkgobioworks.com';

// Build a LIMS URL for one of our reagent ids, or null if there's no mapping
// (or the object id is a placeholder). "m…" → molecule page, "e…" → reagent page.
export function limsUrlForReagentId(id) {
    const obj = LIMS_OBJECT_ID_BY_ID[id];
    if (!obj || obj === 'PLACEHOLDER') return null;
    const kind = obj[0] === 'm' ? 'molecules' : 'reagents';
    const num = obj.slice(1);
    if (!/^\d+$/.test(num)) return null;
    return `${LIMS_BASE}/${kind}/${num}`;
}

// ─── Custom Ginkgo reagents ─────────────────────────────────────────────────
// Special-order stocks (from specific_yaml.yaml) that aren't part of the
// standard CFPS reagent set. Marked with a ◆ in the table and listed under it.
export const CUSTOM_REAGENTS = [
    { id: 'oxidized_glutathione',     name: 'Oxidized glutathione' },
    { id: 'reduced_glutathione',      name: 'Reduced glutathione' },
    { id: 'calcium_chloride',         name: 'Calcium Chloride' },
    { id: 'pantothenic_acid_calcium', name: 'Pantothenic acid' },
    { id: 'hepes_ph_7_2',             name: 'HEPES pH 7.2' },
    { id: 'hepes_ph_7_8',             name: 'HEPES pH 7.8' },
    { id: 'potassium_oxalate',        name: 'Oxalate (potassium salt)' },
    { id: 'dsbc_ecoli',               name: 'Disulfide bond isomerase (DsbC)' },
    { id: 'dsbc_pdam_let',            name: 'P. dam DsbC LET' },
    { id: 'potassium_nitrate',        name: 'Potassium nitrate' }
];

// All ids treated as custom (includes the Jewett-prep DsbC variant so every
// DsbC row is flagged even though only the canonical id is listed above).
export const CUSTOM_REAGENT_IDS = new Set([
    ...CUSTOM_REAGENTS.map((r) => r.id),
    'dsbc_ecoli_jewettprep'
]);

// ─── Reagent display groups (row order in the table) ────────────────────────
export const REAGENT_GROUPS = [
    { name: 'Salts', reagents: ['K(Glu)', 'Mg(Glu)2', 'NH4(Glu)', 'Ammonium acetate', 'K nitrate'] },
    { name: 'Amino acids', reagents: ['Amino acids', 'Tyrosine', 'Cysteine'] },
    { name: 'Buffers', reagents: ['HEPES pH 7.5', 'HEPES pH 7.2', 'Bis-Tris', 'Phosphate', 'Phosphate (di:mono)', 'Phosphate (mono:di)'] },
    { name: 'Energy substrates', reagents: ['Glucose', 'Sodium pyruvate', 'Maltose', 'Maltodextrin', 'Ribose', 'PEP', '3-PGA', 'Dilithium acetyl phosphate'] },
    { name: 'Cofactors', reagents: ['Folinic acid', 'tRNA', 'CoA', 'NAD', 'cAMP', 'Nicotinamide', 'Pantothenate'] },
    { name: 'Polyamines / redox', reagents: ['Putrescine', 'Spermidine', 'Dithiothreitol', 'GSSG', 'GSH', 'Oxalic acid'] },
    { name: 'Crowd', reagents: ['PEG-8000'] },
    { name: 'TCA', reagents: ['Oxaloacetic acid', 'Succinic acid'] },
    { name: 'Nucleosides / bases', reagents: ['Adenosine', 'Cytidine', 'Guanosine', 'Uridine', 'Guanine'] },
    { name: 'Enzymes', reagents: ['Catalase', 'DsbC', 'DsbC helper DNA'] },
    { name: 'NTPs', reagents: ['ATP', 'CTP', 'GTP', 'UTP'] },
    { name: 'NMPs', reagents: ['AMP', 'CMP', 'GMP', 'UMP'] }
];

// ─── Base buffer contribution ──────────────────────────────────────────────
// The 10× base buffer (2 µL in a 20 µL reaction = 10% volume = 1× final)
// pre-loads the reaction with these concentrations BEFORE any supplemental
// reagent addition. Source: reagent_yaml.yaml `base_buffer` entry —
// "2.0M KGlu, 0.026M MgGlu, 0.3M HEPES, 0.01M 17AA mix, 0.01M Cys, 0.01M Tyr".
// At 10% volume, each is diluted 10× → these are the effective final mM values.
export const BASE_BUFFER_1X_CONTRIBUTION_MM = {
    'K(Glu)':     200,
    'Mg(Glu)2':   2.6,
    'HEPES pH 7.5':      30,
    'Amino acids': 1,   // 17aa mix baseline
    'Tyrosine':   1,    // tyrosine baseline (base buffer pre-loads 0.01 M at 10×)
    'Cysteine':   1     // cysteine baseline
};

// Same recipe keyed by our reagent inventory IDs (the shape the CFPS designer
// needs). Consumed by +page.svelte to credit the base buffer's contribution
// against per-reagent supplement volumes.
export const BASE_BUFFER_1X_CONTRIBUTION_MM_BY_ID = {
    potassium_glutamate:  200,
    magnesium_glutamate:  2.6,
    hepes_koh:            30,
    // NOTE: the runtime reagent id in the CFPS designer is `aa_mix_17`,
    // not `amino_acid_mix_17` (which is the LIMS-side name in
    // reagent_info.txt). Keying by the wrong name silently skips the
    // base-buffer credit for the AA mix and doubles the supplement.
    aa_mix_17:            1,
    tyrosine:             1,
    cysteine:             1
};

// Standard 10× base buffer volume that delivers 1× baseline: 2 µL in a 20 µL
// reaction (10% v/v). The CFPS designer's fixed base_buffer volume defaults to
// this; scaling this ratio linearly gives the actual contribution.
export const STANDARD_BASE_BUFFER_NL = 2000;

// ─── Echo transfer resolution ───────────────────────────────────────────────
// Every acoustic (Echo) transfer must be a whole multiple of 25 nL. Supplement
// volumes are snapped to the nearest increment; the resulting concentration
// error is surfaced as deviationPct in feasibilityFor / formulationFidelity.
export const ECHO_INCREMENT_NL = 25;
export function snapNl(nl) {
    return Math.round(nl / ECHO_INCREMENT_NL) * ECHO_INCREMENT_NL;
}

// ─── Compute feasibility of a given reagent value against a reaction volume ──
// Returns { status, pctHeadroom, baseContribution, neededSupplementMm, reason }
// where:
//   status:            'ok' | 'tight' | 'very-tight' | 'over-baseline' | 'missing'
//   pctHeadroom:       % of the reagent-add budget the SUPPLEMENT consumes
//                      (0 when base buffer alone meets/exceeds target)
//   baseContribution:  mM (or paper-unit) already supplied by the base buffer
//   neededSupplementMm: mM the operator would still add above the base buffer
//
// Default reaction geometry: 20 µL total reaction, 9 µL of headroom for reagent
// additions (rest: 2 µL DNA + 5 µL lysate + 2 µL base buffer + 2 µL water).
export function feasibilityFor(paperName, targetValue, opts = {}) {
    const rxnVol = opts.rxnVolUl ?? 20;
    const addBudget = opts.addBudgetUl ?? 9;
    const alias = REAGENT_ALIASES[paperName];
    if (!alias) return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: 'unknown reagent' };
    if (!alias.ids) return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: alias.notes || 'not in stock' };
    if (alias.unit === '% w/v') return { status: 'missing', pctHeadroom: 0, baseContribution: 0, reason: '% w/v reagents not modelled' };

    // Base buffer already supplies some of the target for a handful of reagents.
    const baseContribution = BASE_BUFFER_1X_CONTRIBUTION_MM[paperName] ?? 0;
    const remainingTarget = targetValue - baseContribution;

    if (remainingTarget <= 0) {
        // Base buffer alone equals or exceeds the target — no supplement needed.
        return {
            status: 'over-baseline',
            pctHeadroom: 0,
            baseContribution,
            neededSupplementMm: 0,
            neededNl: 0,
            snappedNl: 0,
            deviationPct: 0,
            reason: `Base buffer alone contributes ${baseContribution} ${alias.unit} — meets or exceeds target of ${targetValue}. No supplement needed (or reduce base buffer to hit target exactly).`
        };
    }

    const stock = alias.stockMm;
    const neededUl = (remainingTarget * rxnVol) / stock;
    const neededNl = Math.round(neededUl * 1000);
    // Echo resolution: the real transfer is snapped to the nearest 25 nL. Report
    // the concentration this delivers vs the intended target, as a % of the
    // final target (units cancel, so this works for mM/µM/mg·mL/U·mL/ng·µL).
    const snappedNl = snapNl(neededNl);
    const achievedSupplement = (snappedNl / 1000) * stock / rxnVol;
    const deviationPct = targetValue
        ? ((achievedSupplement - remainingTarget) / targetValue) * 100
        : 0;
    const pctHeadroom = (neededUl / addBudget) * 100;
    const base = { pctHeadroom, baseContribution, neededSupplementMm: remainingTarget, neededNl, snappedNl, deviationPct };
    if (pctHeadroom < 30) return { status: 'ok', ...base };
    if (pctHeadroom < 60) return { status: 'tight', ...base };
    return { status: 'very-tight', ...base };
}

// ─── Water headroom per formulation ────────────────────────────────────────
// Sum every reagent's supplement volume (from feasibilityFor) and compute how
// much fill water is left in the reaction. Fixed volumes (2 µL DNA + 5 µL
// lysate + 2 µL base buffer = 9 µL) come off the top; the rest of the 20 µL
// is either supplements or water. If supplements > 11 µL the water goes to
// zero — the formulation is over the add-budget.
export function totalSupplementNlForFormulation(formulation, opts = {}) {
    let total = 0;
    for (const [paperName, val] of Object.entries(formulation.components)) {
        const feas = feasibilityFor(paperName, val, opts);
        // Sum the SNAPPED volumes — that's what actually gets transferred, so
        // the water-fill row reflects the real delivered composition.
        if (Number.isFinite(feas.snappedNl)) total += feas.snappedNl;
    }
    return total;
}

// ─── Per-formulation 25 nL fidelity ─────────────────────────────────────────
// Splits a formulation into (a) reagents we can make whose delivered mM drifts
// from target because their volume snapped to a 25 nL increment, each with its
// own deviationPct, and (b) reagents we can't make at all (additional needed).
export function formulationFidelity(formulation, opts = {}) {
    const offReagents = [];
    const additional = [];
    for (const [paperName, val] of Object.entries(formulation.components)) {
        const alias = REAGENT_ALIASES[paperName];
        const feas = feasibilityFor(paperName, val, opts);
        if (feas.status === 'missing') {
            additional.push({ paperName, value: val, unit: alias?.unit ?? '', reason: feas.reason });
            continue;
        }
        // over-baseline reagents transfer no supplement → no rounding error.
        if (feas.status === 'over-baseline') continue;
        // Echo-native compositions are exact by construction (their listed values
        // are 25 nL-achievable, just display-rounded), so skip rounding deviations.
        // Only surface reagents off by ≥1% in either direction; sub-1% drift
        // from 25 nL rounding is noise for this summary.
        if (!formulation.echoNative && Math.abs(feas.deviationPct) >= 1) {
            offReagents.push({
                paperName,
                targetValue: val,
                unit: alias?.unit ?? 'mM',
                neededNl: feas.neededNl,
                snappedNl: feas.snappedNl,
                deviationPct: feas.deviationPct
            });
        }
    }
    // Sort farthest-from-intended first (largest |deviation| → smallest) so the
    // biggest concentration misses lead each composition's summary.
    offReagents.sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
    return { offReagents, additional };
}

export function waterFillNlForFormulation(formulation, opts = {}) {
    const rxnVol = opts.rxnVolUl ?? 20;
    const fixedVolUl = opts.fixedVolUl ?? 9;
    const rxnNl = rxnVol * 1000;
    const fixedNl = fixedVolUl * 1000;
    return rxnNl - fixedNl - totalSupplementNlForFormulation(formulation, opts);
}

// ─── Map a benchmark formulation into targetMm entries for the CFPS designer ──
// Returns { targetMm: {reagent_id: mM}, targetGramsPerLiter: {reagent_id: g/L},
//           skipped: [{paperName, reason}] }
export function mapFormulationToTargets(formulation) {
    const targetMm = {};
    const targetGramsPerLiter = {};
    const targetUnitsPerMl = {};
    const targetNgPerUl = {};
    const skipped = [];
    for (const [paperName, value] of Object.entries(formulation.components)) {
        const alias = REAGENT_ALIASES[paperName];
        if (!alias || !alias.ids) {
            skipped.push({ paperName, value, reason: alias?.notes || 'not in stock' });
            continue;
        }
        if (alias.unit === 'mM') {
            // Amino acids gets special handling: split across 3 stocks so each
            // contributes 1/3 of the target concentration.
            if (paperName === 'Amino acids') {
                for (const id of alias.ids) targetMm[id] = value;
            } else {
                for (const id of alias.ids) targetMm[id] = value;
            }
        } else if (alias.unit === 'µM') {
            // Sub-mM enzymes (e.g. DsbC) — spec'd in µM for readability, but
            // the designer stores everything as mM. Convert here.
            for (const id of alias.ids) targetMm[id] = value / 1000;
        } else if (alias.unit === 'mg/mL') {
            // g/L == mg/mL, so pass through
            for (const id of alias.ids) targetGramsPerLiter[id] = value;
        } else if (alias.unit === 'U/mL') {
            // Enzymes (catalase, pyruvate oxidase) — designer parses "U/ml" stock
            // and computes volume as (target / stock) × rxnVol.
            for (const id of alias.ids) targetUnitsPerMl[id] = value;
        } else if (alias.unit === 'ng/µL' || alias.unit === 'ng/uL') {
            // DNA templates (helper plasmids like dsbc_pdam_let) — same
            // volume-ratio math as U/mL; unit cancels.
            for (const id of alias.ids) targetNgPerUl[id] = value;
        } else {
            skipped.push({ paperName, value, reason: `unit ${alias.unit} not supported by designer` });
        }
    }
    return { targetMm, targetGramsPerLiter, targetUnitsPerMl, targetNgPerUl, skipped };
}

export const CITATION = {
    title: 'Design-driven optimization of low-cost reagent formulations for reproducible and high-yielding cell-free gene expression',
    authors: 'Olsen ML, Copeland CE, Sundberg CA, Aw R, Shaver ZM, Rao G, Swartz JR, Karim AS, Jewett MC',
    journal: 'Nature Communications',
    year: 2026,
    doi: '10.1038/s41467-026-69605-8',
    tableSource: 'Table 1 (p.3) plus supplementary yield/cost measurements'
};

// Curated lineage of well-known fluorescent proteins.
//
// The FPbase public API does NOT expose parent/child relationships. Naive
// sequence-similarity lineage produces embarrassing results for famous cases
// (mScarlet was designed de novo — it is NOT a mCherry variant; mNeonGreen
// comes from LanYFP, not avGFP; mKate2 comes from eqFP578, not DsRed).
//
// So we hand-curate the ~60 relationships nobody wants to see wrong, and let
// the build script fall back to sequence similarity for every other FP.
//
// Keys and values are FPbase slugs (lowercase, hyphenated). Every entry means
// "this FP was derived from that FP". Verified against Nature Methods and the
// primary literature.

export const LINEAGE_ANCHORS = {
    // === avGFP (Aequorea victoria) tree ===
    'egfp': 'avgfp',                   // Cormack et al. 1996 (F64L/S65T)
    'superfolder-gfp': 'egfp',         // Pédelacq et al. 2006
    'emerald': 'egfp',                 // Cubitt et al. 1999
    'clover': 'egfp',                  // Lam et al. 2012
    'moxgfp': 'egfp',                  // Costantini et al. 2015
    'megfp': 'egfp',                   // monomerizing A206K mutation

    // Yellow branch (from avGFP)
    'eyfp': 'egfp',                    // Y66→FYW pathway, but from GFP chassis
    'citrine': 'eyfp',                 // Griesbeck et al. 2001
    'mcitrine': 'citrine',             // monomerized
    'venus': 'eyfp',                   // Nagai et al. 2002
    'mvenus': 'venus',                 // monomerized (A206K)
    'ypet': 'eyfp',                    // Nguyen & Daugherty 2005
    'mypet': 'ypet',
    'topaz': 'eyfp',

    // Cyan/Blue branch (from avGFP)
    'ecfp': 'avgfp',                   // Y66W etc.
    'mcerulean': 'ecfp',               // Rizzo et al. 2004
    'mcerulean3': 'mcerulean',         // Markwardt et al. 2011
    'mturquoise': 'mcerulean',         // Goedhart et al. 2010
    'mturquoise2': 'mturquoise',       // Goedhart et al. 2012
    'ebfp': 'avgfp',                   // Y66H
    'ebfp2': 'ebfp',                   // Ai et al. 2007
    'mtagbfp': 'tagrfp',               // Subach et al. 2008 — from RFP, not GFP!
    'mtagbfp2': 'mtagbfp',

    // Superfolder variants
    'superfolder-cfp': 'superfolder-gfp',
    'superfolder-yfp': 'superfolder-gfp',
    'superfolder-bfp': 'superfolder-gfp',
    'superfolder-phluorin': 'superfolder-gfp',

    // === LanYFP (Branchiostoma lanceolatum) — separate origin from avGFP ===
    'mneongreen': 'lanyfp',            // Shaner et al. 2013

    // === DsRed (Discosoma) tree ===
    'dsred2': 'dsred',                 // Clontech optimization
    'dsred-express': 'dsred',
    'mrfp1': 'dsred',                  // Campbell et al. 2002 — first monomeric RFP
    'mcherry': 'mrfp1',                // Shaner et al. 2004 (mFruits paper)
    'morange': 'mrfp1',
    'morange2': 'morange',
    'mstrawberry': 'mrfp1',
    'mtangerine': 'mrfp1',
    'mplum': 'mrfp1',
    'mgrape': 'mrfp1',
    'mhoneydew': 'mrfp1',
    'mbanana': 'mrfp1',
    'tdtomato': 'mrfp1',               // tandem-dimer

    // === eqFP578 / eqFP611 tree (Entacmaea) ===
    'tagrfp': 'eqfp578',               // Merzlyak et al. 2007
    'tagrfp-t': 'tagrfp',              // Shaner et al. 2008
    'mkate': 'eqfp578',                // Shcherbo et al. 2007
    'mkate2': 'mkate',                 // Shcherbo et al. 2009
    'mneptune': 'mkate2',              // Lin et al. 2009
    'mnoctiluca': 'mkate2',
    'turborfp': 'eqfp578',

    // === eqFP611 sub-tree (mRuby family) ===
    'mruby': 'eqfp611',                // Kredel et al. 2009
    'mruby2': 'mruby',                 // Lam et al. 2012
    'mruby3': 'mruby2',                // Bajar et al. 2016
    'mraspberry': 'mrfp1',

    // === mScarlet lineage (DE NOVO — no parent for original) ===
    // mScarlet was synthesized from scratch (Bindels et al. 2017). Its successors
    // ARE derived from it. Leaving 'mscarlet' out means orphan/no parent (correct).
    'mscarlet-i': 'mscarlet',
    'mscarlet-h': 'mscarlet',
    'mscarlet3': 'mscarlet',

    // === Photoconvertible ===
    'kaede': 'kikg',                   // Ando et al. 2002 (actually independent, but KikG is the family founder)
    'kikgr1': 'kikg',
    'mkikgr': 'kikgr1',
    'dendra2': 'dendra',
    'meos2': 'meos',                   // if 'meos' isn't in DB, similarity-fallback will re-parent
    'meos3-1': 'meos2',
    'meos32': 'meos2',
    'meos4b': 'meos32',
    'psmorange': 'morange',            // photoswitchable mOrange
    'psmorange2': 'psmorange',

    // === Photoswitchable ===
    'padron': 'dronpa',
    'rsegfp': 'egfp',
    'rsegfp2': 'rsegfp',

    // === Cyan / near-IR from bacterial phytochromes (separate origin) ===
    // iRFPs are from bacteriophytochromes, not GFP-family — no parent in FPbase
};

// Pinned 3D positions (x, y, z) for major "sun" FPs — seed the force-directed
// layout so families spread out into recognizable regions before the sim runs.
// Rough intuition: X goes green→red (blue→red-ish wavelength progression),
// Y adds vertical separation for divergent families, Z spreads variants.
// The force sim moves everything toward equilibrium but anchor pins are held.

export const ANCHOR_POSITIONS = {
    // Green core
    'avgfp':       { x: -35, y:   5, z:   0 },
    'egfp':        { x: -25, y:   3, z:   8 },
    'superfolder-gfp': { x: -20, y:  15, z:  -5 },

    // Cyan branch (further left)
    'mcerulean':   { x: -65, y:  -2, z:   0 },
    'mturquoise2': { x: -70, y:  -5, z:  10 },
    'ebfp2':       { x: -75, y:  10, z:  -5 },

    // Yellow branch (drift right)
    'eyfp':        { x:  -8, y:   5, z:  12 },
    'mvenus':      { x:  -2, y:   0, z:  18 },

    // LanYFP island (separate origin, above main plane)
    'lanyfp':      { x:  -5, y:  30, z:  25 },
    'mneongreen':  { x:   2, y:  32, z:  30 },

    // Red core (DsRed cluster, right)
    'dsred':       { x:  35, y:  -3, z:   0 },
    'mrfp1':       { x:  28, y:  -5, z:   8 },
    'mcherry':     { x:  25, y:  -8, z:  15 },
    'morange':     { x:  22, y:   0, z:  20 },
    'tdtomato':    { x:  32, y:  -12, z: 12 },

    // Far-red (eqFP578 branch, further right, below plane)
    'tagrfp':      { x:  55, y: -10, z: -12 },
    'mkate2':      { x:  65, y:  -5, z: -18 },
    'mneptune':    { x:  72, y:   0, z: -20 },

    // mRuby family (from eqFP611, below the tagrfp line)
    'mruby3':      { x:  50, y: -25, z:   0 },

    // mScarlet island (DE NOVO — off to the side, above main plane)
    'mscarlet':    { x:  20, y:  25, z: -25 },
    'mscarlet3':   { x:  22, y:  28, z: -28 },

    // Photoconvertibles / photoswitchables — below main plane, separate region
    'kaede':       { x:  -5, y: -35, z:  10 },
    'dendra2':     { x:   0, y: -30, z: -15 },
    'meos2':       { x:   8, y: -32, z:   0 },
    'dronpa':      { x:  15, y: -40, z: -10 }
};

// The subset of anchors we treat as "suns" (big billboard stars) in the scene.
// These are the FPs that ~every biologist recognizes — worth extra visual weight.
export const SUN_SLUGS = new Set([
    'avgfp', 'egfp', 'superfolder-gfp', 'mvenus', 'mturquoise2',
    'dsred', 'mcherry', 'mscarlet', 'mkate2', 'mneongreen'
]);

import { AA_CLASS, CANONICAL_AAS, HYDROPATHY } from './protein-catalog.js';

// Pick a random index in [0, n)
function randInt(n) {
    return Math.floor(Math.random() * n);
}

function pickRandom(arr) {
    return arr[randInt(arr.length)];
}

// A rough substitution matrix — mildly favor same-class swaps so random
// mutations don't always demolish the fold.
function pickSubstitution(from) {
    const cls = AA_CLASS[from];
    const sameClass = CANONICAL_AAS.filter((a) => a !== from && AA_CLASS[a] === cls);
    const other = CANONICAL_AAS.filter((a) => a !== from && AA_CLASS[a] !== cls);
    // 60% chance same-class, 40% chance different class.
    if (sameClass.length && Math.random() < 0.6) return pickRandom(sameClass);
    return pickRandom(other);
}

// Random single-point mutation.
export function randomMutation(residues) {
    const candidates = residues.filter((r) => /^[A-Z]$/.test(r.code) && r.code !== 'X');
    if (!candidates.length) return null;
    const r = candidates[randInt(candidates.length)];
    const to = pickSubstitution(r.code);
    return {
        mutations: [{ pos: r.pos, from: r.code, to }],
        source: 'random'
    };
}

// Apply the curated beneficial set from a catalog entry, filtered to positions
// present in the current residues.
export function beneficialMutations(catalogEntry, residues) {
    const set = catalogEntry?.beneficialMutations;
    if (!set) return null;
    const posMap = new Map(residues.map((r) => [r.pos, r]));
    const mutations = set.list
        .map(({ pos, from, to }) => {
            const cur = posMap.get(pos);
            if (!cur) return null;
            return { pos, from: cur.code, to };
        })
        .filter(Boolean);
    if (!mutations.length) return null;
    return {
        mutations,
        source: 'beneficial',
        curatedRationale: set.rationale
    };
}

// Destabilizing mutation: prefer to introduce a proline into a hydrophobic run
// (mimics helix disruption) or a charged residue into a buried hydrophobic
// residue. WHY: charged/pro residues in buried/helix contexts have well-known
// large stability penalties (ΔΔG > 2 kcal/mol in many cases).
export function destabilizingMutation(residues) {
    const codes = residues.map((r) => r.code);
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 2; i < codes.length - 2; i += 1) {
        const win = codes.slice(i - 2, i + 3);
        const meanH = win.reduce((s, a) => s + (HYDROPATHY[a] || 0), 0) / win.length;
        if (meanH > bestScore && codes[i] !== 'P' && codes[i] !== 'C') {
            bestScore = meanH;
            bestIdx = i;
        }
    }
    if (bestIdx < 0) return randomMutation(residues);
    const target = residues[bestIdx];
    const swap = Math.random() < 0.5 ? 'P' : 'D';
    return {
        mutations: [{ pos: target.pos, from: target.code, to: swap }],
        source: 'destabilize'
    };
}

// Apply a list of {pos, from, to} to a residues array and return a fresh one
// plus a Set of mutated positions for styling.
export function applyMutations(residues, mutations) {
    const posSet = new Set(mutations.map((m) => m.pos));
    const nextMutated = new Set();
    const next = residues.map((r) => {
        const m = mutations.find((x) => x.pos === r.pos);
        if (!m) return r;
        nextMutated.add(r.pos);
        return { ...r, code: m.to };
    });
    return { residues: next, mutatedPositions: nextMutated, positionsChanged: posSet };
}

// Produce a one-sentence rationale for a single substitution.
export function rationaleFor(mutation, catalogEntry) {
    const { pos, from, to } = mutation;

    // 1. Catalog-annotated mutation wins.
    const curated = catalogEntry?.beneficialMutations?.list?.find(
        (m) => m.pos === pos && m.to === to
    );
    if (curated && catalogEntry?.beneficialMutations?.rationale) {
        return catalogEntry.beneficialMutations.rationale;
    }

    // 2. Cys events dominate for E. coli.
    if (from !== 'C' && to === 'C') {
        return 'Adds a cysteine — risk of incorrect disulfides in the reducing E. coli cytoplasm.';
    }
    if (from === 'C' && to !== 'C') {
        return 'Removes a cysteine — may abolish a disulfide needed for folding/stability.';
    }

    // 3. Proline introduction.
    if (from !== 'P' && to === 'P') {
        return `Proline at position ${pos} restricts backbone geometry (no NH donor) — often disruptive in helices/sheets.`;
    }
    if (from === 'P' && to !== 'P') {
        return `Removes a proline — likely relaxes a local backbone kink, small structural effect.`;
    }

    // 4. Glycine into a rigid stretch.
    if (from !== 'G' && to === 'G') {
        return `Glycine at position ${pos} adds backbone flexibility — can destabilize secondary structure.`;
    }

    // 5. Charge changes.
    const isPos = (a) => a === 'K' || a === 'R' || a === 'H';
    const isNeg = (a) => a === 'D' || a === 'E';
    const isCharged = (a) => isPos(a) || isNeg(a);
    const isHydrophobic = (a) => HYDROPATHY[a] > 1.5;
    if ((isPos(from) && isNeg(to)) || (isNeg(from) && isPos(to))) {
        return `Charge reversal (${from}→${to}) at position ${pos} — may disrupt salt bridges or introduce repulsion.`;
    }
    if (isHydrophobic(from) && isCharged(to)) {
        return `Introduces a charge in a hydrophobic context — expect destabilization / misfolding.`;
    }
    if (isCharged(from) && isHydrophobic(to)) {
        return `Buries the surface charge (${from}→${to}) — may reduce solubility.`;
    }

    // 6. Same-class conservative.
    const fromCls = AA_CLASS[from];
    const toCls = AA_CLASS[to];
    if (fromCls && fromCls === toCls) {
        return `Conservative ${fromCls} substitution (${from}→${to}) — usually tolerated.`;
    }

    // 7. Fallback.
    return `${from}${pos}${to}: ${fromCls || 'unknown'} → ${toCls || 'unknown'} substitution.`;
}

// For a batch of mutations, join with " · ".
export function combinedRationale(result, catalogEntry) {
    if (result.curatedRationale) return result.curatedRationale;
    return result.mutations
        .map((m) => rationaleFor(m, catalogEntry))
        .filter((r, i, a) => a.indexOf(r) === i) // dedupe
        .join(' · ');
}

// Format a list of mutations as "S65T, F64L" style.
export function formatMutations(mutations) {
    return mutations.map((m) => `${m.from}${m.pos}${m.to}`).join(', ');
}

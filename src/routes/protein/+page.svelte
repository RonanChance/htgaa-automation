<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import {
        PROTEINS,
        findProtein,
        pickRandomWellStudied,
        parsePdbSequence,
        classColorFor,
        AA_CLASS,
        CANONICAL_AAS
    } from '$lib/protein-catalog.js';
    import { producibilityScore } from '$lib/protein-producibility.js';
    import {
        randomMutation,
        beneficialMutations,
        destabilizingMutation,
        applyMutations,
        combinedRationale,
        formatMutations
    } from '$lib/protein-mutations.js';
    import { fetchRandomAtlasEntry, searchAtlasByName, fetchAnnotations } from '$lib/protein-atlas.js';
    import { mergeTags } from '$lib/protein-tags.js';

    const CDN_3DMOL = 'https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.0/3Dmol-min.js';
    const RCSB_URL = (pdbId) => `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`;

    let viewerEl;
    let viewer = null;
    let scriptReady = $state(false);

    let currentProtein = $state(PROTEINS[0]);
    let searchInput = $state(PROTEINS[0].name);
    let loading = $state(true);
    let errorMsg = $state('');

    let wildTypeResidues = $state([]);
    let residues = $state([]);
    let mutatedPositions = $state(new Set());
    let lastMutationSet = $state(null);
    let lastRationale = $state('');
    let lastScoreDelta = $state(0);

    let currentTags = $state([]);
    let currentAssay = $state(null); // { label, substrate, readout, source } | null
    let currentResearch = $state(null); // { count, accession, stars, label } | null

    // "Transmission being decoded" animation. decodePhase runs 0 → 1 over
    // DECODE_MS; scrambleTick increments every frame so unrevealed characters
    // re-randomize. Reads of both are picked up by the template.
    const AA_SCRAMBLE = 'ACDEFGHIKLMNPQRSTVWY';
    const TEXT_SCRAMBLE = 'ACDEFGHIJKLMNPQRSTUVWXYZ0123456789#@$%&*+/';
    const DECODE_MS = 900;
    let decodePhase = $state(1);
    let scrambleTick = $state(0);
    let decodeTimer = null;

    function startDecode() {
        if (decodeTimer) { clearInterval(decodeTimer); decodeTimer = null; }
        decodePhase = 0;
        scrambleTick = 0;
        const startTs = performance.now();
        decodeTimer = setInterval(() => {
            const t = performance.now() - startTs;
            decodePhase = Math.min(1, t / DECODE_MS);
            scrambleTick += 1;
            if (decodePhase >= 1) {
                clearInterval(decodeTimer);
                decodeTimer = null;
            }
        }, 45);
    }

    // Passthrough characters (punctuation/spaces) stay put — only "letters"
    // scramble, so the shape of the sentence is preserved during decode.
    const KEEP_CHARS = new Set([' ', '.', ',', '(', ')', '-', '—', '–', '/', '·', '\'', '"', ':', ';', '!', '?']);

    function scrambleText(target) {
        // Read reactive state to establish template deps.
        const phase = decodePhase;
        void scrambleTick;
        if (!target) return '';
        if (phase >= 1) return target;
        const revealCount = Math.floor(target.length * phase);
        let out = '';
        for (let i = 0; i < target.length; i++) {
            const ch = target[i];
            if (i < revealCount || KEEP_CHARS.has(ch)) out += ch;
            else out += TEXT_SCRAMBLE[Math.floor(Math.random() * TEXT_SCRAMBLE.length)];
        }
        return out;
    }

    function displayedResidueCode(i, code, total) {
        const phase = decodePhase;
        void scrambleTick;
        if (phase >= 1) return code;
        const threshold = (i + 0.5) / Math.max(1, total);
        if (phase >= threshold) return code;
        return AA_SCRAMBLE[Math.floor(Math.random() * AA_SCRAMBLE.length)];
    }

    let customMode = $state(false);
    let pasteOpen = $state(false);
    let pasteText = $state('');
    let pasteError = $state('');

    let toastMsg = $state('');
    let toastTimer = null;

    let hoveredPos = $state(null);
    let picker = $state(null); // { residue, x, y } | null
    let sequenceContainer;

    // Score reactively derived
    let seqString = $derived(residues.map((r) => r.code).join(''));
    let wildTypeSeq = $derived(wildTypeResidues.map((r) => r.code).join(''));
    let scoreResult = $derived(producibilityScore(seqString));
    let baselineScore = $derived(producibilityScore(wildTypeSeq).score);

    function showToast(msg) {
        toastMsg = msg;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastMsg = ''; }, 2600);
    }

    function ensureScriptLoaded() {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined') { reject(new Error('no window')); return; }
            if (window.$3Dmol) { resolve(); return; }
            const existing = document.querySelector(`script[src="${CDN_3DMOL}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('3Dmol failed to load')), { once: true });
                return;
            }
            const s = document.createElement('script');
            s.src = CDN_3DMOL;
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('3Dmol failed to load'));
            document.head.appendChild(s);
        });
    }

    let loadToken = 0;

    async function loadProtein(entry, { silent = false } = {}) {
        const token = ++loadToken;
        loading = true;
        errorMsg = '';
        customMode = false;
        try {
            // Timeout on the PDB download — some structures hang on RCSB
            // occasionally, and without an abort the spinner locks forever.
            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), 12000);
            let res;
            try {
                res = await fetch(RCSB_URL(entry.pdbId), { signal: ctrl.signal });
            } finally {
                clearTimeout(timeoutId);
            }
            if (token !== loadToken) return false;
            if (!res.ok) throw new Error(`RCSB ${entry.pdbId}: HTTP ${res.status}`);
            const pdb = await res.text();
            if (token !== loadToken) return false;
            const { residues: parsed, chainId } = parsePdbSequence(pdb, entry.chain || 'A');
            if (!parsed.length) throw new Error('No residues parsed from PDB');
            wildTypeResidues = parsed;
            residues = parsed.map((r) => ({ ...r }));
            mutatedPositions = new Set();
            lastMutationSet = null;
            lastRationale = '';
            lastScoreDelta = 0;
            hoveredPos = null;
            picker = null;
            currentProtein = entry;
            searchInput = entry.name;
            currentTags = Array.isArray(entry.tags) ? entry.tags : [];
            currentAssay = null;
            currentResearch = null;
            startDecode();
            await renderStructure(pdb, chainId);
            if (token !== loadToken) return false;
            enrichAnnotations(entry, token);
            return true;
        } catch (err) {
            if (token !== loadToken) return false;
            console.error(err);
            errorMsg = err.message || String(err);
            if (!silent) showToast(`Failed to load ${entry.name}: ${errorMsg}`);
            return false;
        } finally {
            if (token === loadToken) loading = false;
        }
    }

    // Background enrichment: fetch organism / function / disease tags AND a
    // suggested bench assay from RCSB + UniProt, then merge tags with any
    // hand-authored catalog tags. Runs fire-and-forget; the load token
    // guards against a stale response clobbering data for a newer protein.
    async function enrichAnnotations(entry, token) {
        if (!entry?.pdbId) return;
        try {
            const { tags: derived, assay, research } = await fetchAnnotations(entry.pdbId);
            if (token !== loadToken) return;
            if (derived.length) currentTags = mergeTags(entry.tags || [], derived);
            if (assay) currentAssay = assay;
            if (research) currentResearch = research;
        } catch (err) {
            console.error('annotation enrichment failed', err);
        }
    }

    async function renderStructure(pdbText, chainId) {
        if (!scriptReady || !viewerEl) return;
        const mol = window.$3Dmol;
        if (viewer) {
            try { viewer.clear(); } catch {}
            viewer = null;
        }
        viewer = mol.createViewer(viewerEl, {
            backgroundColor: '#faf9f5',
            antialias: true,
            hoverDuration: 30
        });
        if (typeof viewer.setHoverDuration === 'function') viewer.setHoverDuration(30);
        viewer.addModel(pdbText, 'pdb');
        viewer.setStyle({}, { cartoon: { color: 'spectrum', opacity: 0.95, thickness: 0.35 } });
        viewer.setStyle({ chain: chainId, hetflag: false }, { cartoon: { color: 'spectrum', opacity: 0.95, thickness: 0.35 } });
        viewer.setStyle({ hetflag: true }, { stick: { colorscheme: 'default', radius: 0.15 } });
        viewer.zoomTo();
        viewer.zoom(0.75);
        viewer.setHoverable(
            { chain: chainId },
            true,
            (atom) => {
                hoveredPos = atom?.resi ?? null;
                restyleViewer();
                // Show a pointer cursor over the canvas for clickability.
                if (viewerEl) viewerEl.style.cursor = 'pointer';
            },
            () => {
                hoveredPos = null;
                restyleViewer();
                if (viewerEl) viewerEl.style.cursor = 'grab';
            }
        );
        viewer.setClickable({ chain: chainId }, true, (atom, _viewer, event) => {
            if (atom?.resi == null) return;
            const r = residues.find((x) => x.pos === atom.resi);
            if (!r) return;
            const x = event?.clientX ?? event?.pageX ?? window.innerWidth / 2;
            const y = event?.clientY ?? event?.pageY ?? window.innerHeight / 2;
            openPickerAt(r, x, y);
        });
        if (viewerEl) viewerEl.style.cursor = 'grab';
        viewer.render();
        restyleViewer();
    }

    // Re-apply base + mutation + hover styling from scratch. 3Dmol's setStyle
    // is a replace, so we always rebuild from the base layer down.
    function restyleViewer() {
        if (!viewer || customMode) return;
        const chain = currentProtein.chain || 'A';
        viewer.setStyle({}, { cartoon: { color: 'spectrum', opacity: 0.95, thickness: 0.35 } });
        viewer.setStyle({ chain, hetflag: false }, { cartoon: { color: 'spectrum', opacity: 0.95, thickness: 0.35 } });
        viewer.setStyle({ hetflag: true }, { stick: { colorscheme: 'default', radius: 0.15 } });
        for (const pos of mutatedPositions) {
            const r = residues.find((x) => x.pos === pos);
            if (!r) continue;
            const color = classColorFor(r.code);
            viewer.setStyle({ resi: pos, chain }, {
                cartoon: { color, opacity: 1.0, thickness: 0.55 },
                sphere: { color, radius: 1.3, opacity: 0.85 }
            });
        }
        if (hoveredPos != null) {
            const r = residues.find((x) => x.pos === hoveredPos);
            if (r) {
                const hc = classColorFor(r.code);
                // Overlay a bright translucent "lego stud" on top of whatever
                // style is already there — signals clickability.
                viewer.addStyle({ resi: hoveredPos, chain }, {
                    sphere: { color: hc, radius: 2.0, opacity: 0.55 }
                });
            }
        }
        viewer.render();
    }

    function applyMutationStyling() { restyleViewer(); }

    function commitMutationResult(result) {
        if (!result) { showToast('No mutation applied.'); return; }
        const prev = scoreResult.score;
        const { residues: nextR, mutatedPositions: nextMut } = applyMutations(residues, result.mutations);
        residues = nextR;
        const merged = new Set(mutatedPositions);
        for (const p of nextMut) merged.add(p);
        mutatedPositions = merged;
        lastMutationSet = result;
        lastRationale = combinedRationale(result, currentProtein);
        // score is derived, but reactive derivation happens after this frame
        // — recompute now for delta display
        const nextScore = producibilityScore(residues.map((r) => r.code).join('')).score;
        lastScoreDelta = nextScore - prev;
        applyMutationStyling();
    }

    function onRandom() {
        commitMutationResult(randomMutation(residues));
    }

    function onBeneficial() {
        if (customMode) { showToast('Load a catalog protein to apply curated mutations.'); return; }
        const r = beneficialMutations(currentProtein, residues);
        if (!r) { showToast('No curated beneficial set for this protein.'); return; }
        commitMutationResult(r);
    }

    function onDestabilize() {
        commitMutationResult(destabilizingMutation(residues));
    }

    function onReset() {
        residues = wildTypeResidues.map((r) => ({ ...r }));
        mutatedPositions = new Set();
        lastMutationSet = null;
        lastRationale = '';
        lastScoreDelta = 0;
        restyleViewer();
    }

    async function onSubmitSearch(evt) {
        evt?.preventDefault?.();
        const q = searchInput.trim();
        if (!q) return;
        const found = findProtein(q);
        if (found) {
            if (found.name === currentProtein.name && !customMode) return;
            await loadProtein(found);
            return;
        }
        loading = true;
        try {
            const entry = await searchAtlasByName(q);
            if (entry) {
                await loadProtein(entry, { silent: true });
                return;
            }
            showToast(`No PDB match for "${q}" — try Paste Sequence.`);
        } catch (err) {
            console.error(err);
            showToast(`Search failed for "${q}" — try again.`);
        } finally {
            loading = false;
        }
    }

    // Fires as the user types OR picks from the datalist. Auto-load only when
    // the value exactly matches a catalog name or alias — so partial typing
    // never triggers a fetch, but selecting from the dropdown does.
    function onSearchInput() {
        const q = searchInput.trim().toLowerCase();
        if (!q) return;
        const exact = PROTEINS.find(
            (p) => p.name.toLowerCase() === q || p.aliases.some((a) => a.toLowerCase() === q)
        );
        if (exact && (exact.name !== currentProtein.name || customMode)) {
            loadProtein(exact);
        }
    }

    async function onRandomProtein() {
        loading = true;
        // Last-resort safety: if the entire flow (fetches + parse + render)
        // takes longer than this, force the spinner off so the UI recovers
        // even in the worst case. The in-flight work is still ignored via
        // the loadToken check, so no stale state gets committed.
        const safetyId = setTimeout(() => {
            console.warn('random protein: safety timeout fired, releasing spinner');
            loadToken += 1;
            loading = false;
        }, 25000);
        try {
            for (let i = 0; i < 5; i += 1) {
                try {
                    const entry = await fetchRandomAtlasEntry();
                    const ok = await loadProtein(entry, { silent: true });
                    if (ok) return;
                } catch (err) {
                    console.error(err);
                }
                loading = true;
            }
            const fallback = pickRandomWellStudied(customMode ? null : currentProtein.name);
            if (fallback) await loadProtein(fallback, { silent: true });
        } finally {
            clearTimeout(safetyId);
            loading = false;
        }
    }

    function openPickerAt(residue, clientX, clientY) {
        const width = 220;
        const height = 148;
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let px = clientX - width / 2;
        px = Math.max(margin, Math.min(px, vw - width - margin));
        let py = clientY - height - margin;
        if (py < margin) py = Math.min(clientY + margin, vh - height - margin);
        picker = { residue: { ...residue }, x: px, y: py };
    }

    function openPickerFromLetter(residue, evt) {
        evt.stopPropagation();
        const rect = evt.currentTarget.getBoundingClientRect();
        openPickerAt(residue, rect.left + rect.width / 2, rect.top);
    }

    function closePicker() {
        picker = null;
    }

    function applySubstitution(residue, to) {
        closePicker();
        if (!to || to === residue.code) return;
        commitMutationResult({
            mutations: [{ pos: residue.pos, from: residue.code, to }],
            source: 'manual'
        });
    }

    function wildTypeCodeFor(pos) {
        const wt = wildTypeResidues.find((r) => r.pos === pos);
        return wt ? wt.code : null;
    }

    function restoreResidue(residue) {
        closePicker();
        const wtCode = wildTypeCodeFor(residue.pos);
        if (!wtCode || wtCode === residue.code) return;
        const prev = scoreResult.score;
        residues = residues.map((r) => (r.pos === residue.pos ? { ...r, code: wtCode } : r));
        const next = new Set(mutatedPositions);
        next.delete(residue.pos);
        mutatedPositions = next;
        lastMutationSet = {
            mutations: [{ pos: residue.pos, from: residue.code, to: wtCode }],
            source: 'restore'
        };
        lastRationale = `Restored position ${residue.pos} to wild-type ${wtCode}.`;
        const nextScore = producibilityScore(residues.map((r) => r.code).join('')).score;
        lastScoreDelta = nextScore - prev;
        restyleViewer();
    }

    function onKeydown(evt) {
        if (evt.key === 'Escape') {
            if (picker) { closePicker(); return; }
            if (pasteOpen) { closePaste(); return; }
        }
    }

    function openPaste() {
        pasteOpen = true;
        pasteText = '';
        pasteError = '';
    }

    function closePaste() {
        pasteOpen = false;
    }

    function normalizeFasta(text) {
        const cleaned = text
            .split(/\r?\n/)
            .filter((line) => !line.startsWith('>'))
            .join('')
            .toUpperCase()
            .replace(/[^A-Z]/g, '');
        return cleaned;
    }

    function loadCustomSequence() {
        const clean = normalizeFasta(pasteText);
        if (!clean.length) { pasteError = 'Enter an amino acid sequence.'; return; }
        const invalid = clean.split('').filter((c) => !CANONICAL_AAS.includes(c));
        if (invalid.length > 0 && (invalid.length / clean.length) > 0.05) {
            pasteError = `Sequence contains non-standard characters (${[...new Set(invalid)].slice(0, 6).join('')}...).`;
            return;
        }
        // Assign synthetic positions 1..N
        const custom = clean.split('').map((c, i) => ({ pos: i + 1, code: CANONICAL_AAS.includes(c) ? c : 'X' }));
        wildTypeResidues = custom;
        residues = custom.map((r) => ({ ...r }));
        mutatedPositions = new Set();
        lastMutationSet = null;
        lastRationale = '';
        lastScoreDelta = 0;
        customMode = true;
        currentProtein = { name: 'Custom', pdbId: '', chain: 'A', description: 'User-supplied sequence.', beneficialMutations: null };
        currentTags = [];
        currentAssay = null;
        currentResearch = null;
        searchInput = `Custom (${clean.length} aa)`;
        startDecode();
        if (viewer) { try { viewer.clear(); } catch {} viewer = null; }
        pasteOpen = false;
        loading = false;
        errorMsg = '';
    }

    // Compact number formatter: 649 → "649", 1371 → "1.4k", 12500 → "12.5k".
    function formatCount(n) {
        if (n == null) return '';
        if (n < 1000) return String(n);
        const k = n / 1000;
        return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
    }

    function scoreColorClass(score) {
        if (score >= 75) return 'bg-emerald-500';
        if (score >= 50) return 'bg-amber-400';
        return 'bg-rose-500';
    }

    function factorColorClass(score) {
        if (score >= 15) return 'bg-emerald-500';
        if (score >= 10) return 'bg-amber-400';
        return 'bg-rose-500';
    }

    onMount(async () => {
        if (!browser) return;
        try {
            await ensureScriptLoaded();
            scriptReady = true;
            await loadProtein(PROTEINS[0]);
        } catch (err) {
            errorMsg = err.message || String(err);
            loading = false;
        }
    });
</script>

<svelte:head>
    <title>Protein Explorer</title>
</svelte:head>

<div class="h-screen flex flex-col overflow-hidden bg-base-100 text-base-content">
    <!-- Header -->
    <header class="flex-none flex items-center gap-2 px-3 py-2 border-b border-base-300">
        <span class="text-sm font-semibold whitespace-nowrap">Protein Explorer</span>

        {#if !customMode && currentResearch}
            <span
                class="flex items-center gap-1 text-[11px] whitespace-nowrap transition-opacity duration-500"
                style="opacity: {decodePhase >= 1 ? 1 : 0}"
                title={`${currentResearch.count.toLocaleString()} PDB polymer entities share UniProt ${currentResearch.accession} — a proxy for how much this protein has been studied structurally. Tier: ${currentResearch.label}.`}
            >
                <span class="text-amber-500 tracking-tighter">{'★'.repeat(currentResearch.stars)}<span class="opacity-25">{'★'.repeat(5 - currentResearch.stars)}</span></span>
                <span class="font-mono tabular-nums opacity-80">{formatCount(currentResearch.count)}</span>
                <span class="opacity-50">structures</span>
                <span class="opacity-40 hidden sm:inline">· {currentResearch.label}</span>
            </span>
        {/if}

        <form class="flex items-center gap-1 ml-auto" onsubmit={onSubmitSearch}>
            <input
                type="text"
                list="protein-list"
                class="input input-xs input-bordered w-32 sm:w-44 rounded text-xs"
                placeholder="Search protein..."
                bind:value={searchInput}
                oninput={onSearchInput}
                autocomplete="off"
            />
            <datalist id="protein-list">
                {#each PROTEINS as p}
                    <option value={p.name}>{p.description}</option>
                {/each}
            </datalist>
            <button
                type="button"
                class="btn btn-xs rounded bg-base-200 hover:bg-base-300 gap-1"
                onclick={onRandomProtein}
                disabled={loading}
                title="Pull a random protein from the PDB atlas — anything goes"
            >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="8" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>
                Random
            </button>
            <button
                type="button"
                class="btn btn-xs rounded bg-base-200 hover:bg-base-300"
                onclick={openPaste}
                title="Paste a raw amino acid sequence"
            >
                Paste Seq
            </button>
            {#if currentProtein.pdbId}
                <a
                    class="btn btn-xs rounded bg-base-200 hover:bg-base-300"
                    href={`https://www.rcsb.org/structure/${currentProtein.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View source structure at RCSB"
                >
                    {currentProtein.pdbId}
                </a>
            {/if}
        </form>
    </header>

    <!-- Protein identity strip -->
    <div class="flex-none px-3 py-1.5 border-b border-base-300 bg-base-200/50 flex flex-col gap-0.5 min-w-0">
        <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-semibold whitespace-nowrap font-mono tabular-nums">{scrambleText(customMode ? 'Custom sequence' : currentProtein.name)}</span>
            <span class="text-xs opacity-75 truncate min-w-0 font-mono tabular-nums">{scrambleText(customMode ? 'Sequence-only mode — no structure' : currentProtein.description)}</span>
            {#if !customMode && currentTags.length}
                <div
                    class="flex items-center gap-1 flex-none ml-auto overflow-hidden transition-opacity duration-500"
                    style="opacity: {decodePhase >= 1 ? 1 : 0}"
                >
                    {#each currentTags as tag}
                        <span
                            class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-base-100 border border-base-300 rounded-full whitespace-nowrap"
                            title={tag.tooltip || tag.label}
                        >
                            <span aria-hidden="true">{tag.glyph}</span>
                            <span class="opacity-70">{tag.label}</span>
                        </span>
                    {/each}
                </div>
            {/if}
        </div>
        {#if !customMode && currentAssay}
            <div
                class="flex items-baseline gap-2 text-[11px] leading-tight min-w-0 transition-opacity duration-500"
                style="opacity: {decodePhase >= 1 ? 1 : 0}"
                title={`Suggested from ${currentAssay.source}`}
            >
                <span class="opacity-60 whitespace-nowrap">🧪 Suggested assay</span>
                <span class="font-semibold whitespace-nowrap">{currentAssay.label}</span>
                <span class="opacity-70 truncate min-w-0">
                    <span class="opacity-60">substrate:</span> {currentAssay.substrate}
                    <span class="opacity-40 mx-1">·</span>
                    <span class="opacity-60">readout:</span> {currentAssay.readout}
                </span>
            </div>
        {/if}
    </div>

    <!-- 3D viewer (dominant) -->
    <section class="relative flex-1 min-h-0 bg-[#faf9f5]">
        <div bind:this={viewerEl} class="absolute inset-0"></div>

        {#if loading}
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span class="loading loading-spinner loading-md opacity-70"></span>
            </div>
        {/if}

        {#if customMode}
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div class="text-center px-6 max-w-md">
                    <div class="text-sm font-medium opacity-80">No structure — sequence-only analysis</div>
                    <div class="text-xs opacity-60 mt-1">
                        Producibility scoring and mutations still work. Add this protein to the catalog to see a 3D fold.
                    </div>
                </div>
            </div>
        {/if}

        {#if !customMode && !loading && !errorMsg}
            <div class="absolute left-2 bottom-2 text-[10px] uppercase tracking-wider opacity-40 pointer-events-none">
                drag to rotate · scroll to zoom · wild-type fold shown; markers = substitutions
            </div>
        {/if}

        {#if errorMsg && !loading}
            <div class="absolute inset-0 flex items-center justify-center px-6">
                <div class="text-center text-xs text-error">{errorMsg}</div>
            </div>
        {/if}
    </section>

    <!-- Sequence strip -->
    <section class="flex-none border-t border-base-300 bg-base-100">
        <div
            bind:this={sequenceContainer}
            class="px-3 py-1.5 h-20 overflow-y-auto font-mono text-xs tabular-nums leading-snug"
        >
            {#if residues.length === 0}
                <span class="opacity-40">loading sequence…</span>
            {:else}
                {#each residues as r, i (r.pos)}<span role="button" tabindex="0" class="cursor-pointer" style="color: {classColorFor(r.code)}; {mutatedPositions.has(r.pos) ? 'font-weight:700; text-decoration:underline; text-decoration-thickness:2px; text-underline-offset:2px;' : ''} {hoveredPos === r.pos ? 'background:' + classColorFor(r.code) + '33; border-radius:2px;' : ''}" title={`${r.code}${r.pos} · ${AA_CLASS[r.code] || 'unknown'}${mutatedPositions.has(r.pos) ? ' · mutated' : ''} — click to substitute`} onclick={(evt) => openPickerFromLetter(r, evt)} onkeydown={(evt) => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); openPickerFromLetter(r, evt); } }} onmouseenter={() => { hoveredPos = r.pos; }} onmouseleave={() => { if (hoveredPos === r.pos) hoveredPos = null; }}>{displayedResidueCode(i, r.code, residues.length)}</span>{#if (i + 1) % 10 === 0}{' '}{/if}{/each}
            {/if}
        </div>
    </section>

    <!-- Mutation rationale strip -->
    <section class="flex-none border-t border-base-300 bg-base-200/60">
        <div class="px-3 py-1 h-7 text-[11px] flex items-center gap-2 overflow-hidden">
            {#if lastMutationSet}
                <span class="font-mono font-semibold whitespace-nowrap">
                    {formatMutations(lastMutationSet.mutations)}
                </span>
                <span class="opacity-40">·</span>
                <span class="truncate opacity-80">{lastRationale}</span>
                <span class="ml-auto font-mono font-semibold whitespace-nowrap {lastScoreDelta > 0 ? 'text-emerald-600' : lastScoreDelta < 0 ? 'text-rose-600' : 'opacity-60'}">
                    {lastScoreDelta > 0 ? '+' : ''}{lastScoreDelta}
                </span>
            {:else}
                <span class="opacity-40 italic">Apply a mutation to see its predicted impact.</span>
            {/if}
        </div>
    </section>

    <!-- Mutation buttons -->
    <section class="flex-none border-t border-base-300 bg-base-100">
        <div class="px-3 py-1.5 flex flex-wrap items-center gap-2">
            <button class="btn btn-xs rounded bg-base-200 hover:bg-base-300 gap-1" onclick={onRandom}>
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h6v6H4zM14 14h6v6h-6zM4 14h6v6H4zM14 4h6v6h-6z"/></svg>
                Random
            </button>
            <button
                class="btn btn-xs rounded bg-base-200 hover:bg-base-300 gap-1"
                onclick={onBeneficial}
                disabled={customMode || !currentProtein.beneficialMutations}
                title={customMode ? 'Load a catalog protein first' : currentProtein.beneficialMutations ? 'Apply curated folding/stability mutations' : 'No curated mutations for this protein'}
            >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                Beneficial
                {#if currentProtein.beneficialMutations}
                    <span class="opacity-60 font-mono text-[10px]">({formatMutations(currentProtein.beneficialMutations.list)})</span>
                {/if}
            </button>
            <button class="btn btn-xs rounded bg-base-200 hover:bg-base-300 gap-1" onclick={onDestabilize}>
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                Destabilize
            </button>
            <button class="btn btn-xs rounded bg-base-200 hover:bg-base-300 gap-1 ml-auto" onclick={onReset}>
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>
                Reset
            </button>
        </div>
    </section>

    <!-- Producibility -->
    <section class="flex-none border-t border-base-300 bg-base-200/40">
        <div class="px-3 py-2 flex flex-col gap-1">
            <div class="flex items-center gap-2">
                <span class="text-[11px] font-semibold whitespace-nowrap">E. coli BL21(DE3) lysate producibility</span>
                <div class="flex-1 h-2 rounded bg-base-300 overflow-hidden">
                    <div
                        class="h-full transition-all duration-300 {scoreColorClass(scoreResult.score)}"
                        style="width: {scoreResult.score}%"
                    ></div>
                </div>
                <span class="text-xs font-mono font-semibold tabular-nums w-14 text-right">
                    {scoreResult.score} / 100
                </span>
                {#if !customMode && wildTypeResidues.length && scoreResult.score !== baselineScore}
                    <span class="text-[10px] opacity-60 whitespace-nowrap w-16 text-right">
                        WT: {baselineScore}
                    </span>
                {:else}
                    <span class="w-16"></span>
                {/if}
            </div>
            <div class="flex items-center gap-2 flex-wrap text-[10px] font-mono tabular-nums">
                {#each scoreResult.factors as f}
                    <span class="inline-flex items-center gap-1 rounded bg-base-100 px-1.5 py-0.5 border border-base-300">
                        <span class="w-1.5 h-1.5 rounded-full {factorColorClass(f.score)}"></span>
                        <span class="opacity-70">{f.label}</span>
                        <span class="font-semibold">{f.fmt}</span>
                    </span>
                {/each}
            </div>
        </div>
    </section>
</div>

<!-- Paste sequence modal -->
{#if pasteOpen}
    <div class="fixed inset-0 z-40 bg-black/40 flex items-center justify-center px-4">
        <button
            type="button"
            class="absolute inset-0 w-full h-full cursor-default"
            aria-label="Close dialog"
            onclick={closePaste}
        ></button>
        <div class="relative bg-base-100 rounded-lg shadow-xl max-w-lg w-full p-4" role="dialog" aria-modal="true" tabindex="-1">
            <div class="flex items-center justify-between mb-2">
                <div class="text-sm font-semibold">Paste amino acid sequence</div>
                <button class="btn btn-xs btn-ghost" onclick={closePaste} aria-label="Close">✕</button>
            </div>
            <p class="text-xs opacity-70 mb-2">
                Raw sequence or FASTA. One-letter codes only. Non-catalog proteins won't render in 3D, but producibility scoring and mutations still work.
            </p>
            <textarea
                class="textarea textarea-bordered w-full h-40 font-mono text-xs"
                placeholder=">my_protein
MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT..."
                bind:value={pasteText}
            ></textarea>
            {#if pasteError}
                <div class="text-xs text-error mt-1">{pasteError}</div>
            {/if}
            <div class="flex justify-end gap-2 mt-3">
                <button class="btn btn-xs rounded bg-base-200 hover:bg-base-300" onclick={closePaste}>Cancel</button>
                <button class="btn btn-xs rounded bg-neutral-700 text-base-100 hover:bg-neutral-600 hover:text-base-100" onclick={loadCustomSequence}>Load Sequence</button>
            </div>
        </div>
    </div>
{/if}

<!-- Substitution picker -->
{#if picker}
    {@const wtCode = wildTypeCodeFor(picker.residue.pos)}
    {@const isMutated = wtCode && wtCode !== picker.residue.code}
    <div class="fixed inset-0 z-40">
        <button
            type="button"
            class="absolute inset-0 w-full h-full cursor-default"
            aria-label="Close substitution picker"
            onclick={closePicker}
        ></button>
        <div
            class="absolute bg-base-100 rounded-lg shadow-xl border border-base-300 p-2 w-[220px]"
            style="left: {picker.x}px; top: {picker.y}px;"
            role="dialog"
            aria-modal="true"
            tabindex="-1"
        >
            <div class="flex items-center justify-between mb-1.5">
                <div class="text-[11px] opacity-70">
                    Substitute <span class="font-mono font-semibold" style="color: {classColorFor(picker.residue.code)}">{picker.residue.code}{picker.residue.pos}</span> with
                </div>
                <button class="text-[10px] opacity-50 hover:opacity-100" onclick={closePicker} aria-label="Close">✕</button>
            </div>
            <div class="grid grid-cols-5 gap-0.5">
                {#each CANONICAL_AAS as aa}
                    <button
                        type="button"
                        class="h-6 rounded font-mono text-xs hover:bg-base-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                        style="color: {classColorFor(aa)}; {wtCode === aa ? 'outline: 1px dashed ' + classColorFor(aa) + '; outline-offset: -2px;' : ''}"
                        disabled={aa === picker.residue.code}
                        onclick={() => applySubstitution(picker.residue, aa)}
                        title={`${AA_CLASS[aa] || ''}${wtCode === aa ? ' · wild-type' : ''}`}
                    >
                        {aa}
                    </button>
                {/each}
            </div>
            {#if isMutated}
                <button
                    type="button"
                    class="mt-1.5 w-full h-6 rounded text-[11px] bg-base-200 hover:bg-base-300 transition flex items-center justify-center gap-1"
                    onclick={() => restoreResidue(picker.residue)}
                    title={`Revert this residue to wild-type ${wtCode}`}
                >
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>
                    Restore wild-type
                    <span class="font-mono font-semibold" style="color: {classColorFor(wtCode)}">{wtCode}</span>
                </button>
            {/if}
        </div>
    </div>
{/if}

<!-- Toast -->
{#if toastMsg}
    <div role="alert" class="fixed left-1/2 top-4 z-50 max-w-[85vw] -translate-x-1/2 alert alert-warning shadow-lg text-xs py-2">
        <span>{toastMsg}</span>
    </div>
{/if}

<svelte:window onkeydown={onKeydown} />

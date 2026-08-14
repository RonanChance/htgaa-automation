<script>
    // Comparison of industry-benchmark cell-free reaction formulations
    // (Olsen et al. 2026 Nat Commun, Table 1). Reads the benchmark data and
    // reagent aliases from $lib/cfps-benchmarks.js. Click a column header to
    // load that formulation's targets into the parent's design state.

    import {
        BENCHMARK_FORMULATIONS,
        REAGENT_ALIASES,
        REAGENT_GROUPS,
        CUSTOM_REAGENTS,
        CUSTOM_REAGENT_IDS,
        feasibilityFor,
        formulationFidelity,
        limsUrlForReagentId,
        waterFillNlForFormulation
    } from '$lib/cfps-benchmarks.js';
    import { REAGENT_SYNOPSES } from '$lib/reagent-synopses.js';

    // Teal marker colour for custom Ginkgo reagents (distinct from the purple
    // ○ used for theoretical / not-in-stock reagents).
    const CUSTOM_COLOR = '#2dd4bf';

    let { onLoad, onShowRecipe } = $props();

    let tableScrollEl = $state(null);
    let isDownloading = $state(false);

    function downloadCSV() {
        const allReagents = REAGENT_GROUPS.flatMap(g => g.reagents);
        const header = ['Reagent', 'Unit', ...displayFormulations.map(bm => `${bm.name} (${bm.year})`)];
        const rows = allReagents.map(paperName => {
            const alias = REAGENT_ALIASES[paperName];
            const unit = alias?.unit ?? 'mM';
            const values = displayFormulations.map(bm => {
                const v = applyOptima(bm).components[paperName];
                return v == null ? '' : v;
            });
            return [paperName, unit, ...values];
        }).filter(row => row.slice(2).some(v => v !== ''));

        const csv = [header, ...rows]
            .map(row => row.map(cell => {
                const s = String(cell);
                return s.includes(',') || s.includes('"') || s.includes('\n')
                    ? `"${s.replace(/"/g, '""')}"` : s;
            }).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.download = 'cfps-composition-table.csv';
        link.href = URL.createObjectURL(blob);
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }

    async function downloadTableImage() {
        if (!tableScrollEl || isDownloading) return;
        isDownloading = true;
        try {
            const domtoimage = await import('dom-to-image-more');

            // Clone into an off-screen div with no scroll/height constraints
            const wrapper = document.createElement('div');
            wrapper.setAttribute('data-theme', 'light');
            wrapper.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff;';
            const clone = tableScrollEl.cloneNode(true);
            clone.style.cssText = 'overflow:visible;max-height:none;height:auto;width:' + tableScrollEl.scrollWidth + 'px;';
            // Remove sticky so the clone renders fully flat
            clone.querySelectorAll('*').forEach(el => {
                const s = getComputedStyle(el).position;
                if (s === 'sticky') el.style.position = 'relative';
            });
            wrapper.appendChild(clone);
            document.body.appendChild(wrapper);

            await new Promise(r => requestAnimationFrame(r));

            const blob = await domtoimage.toBlob(clone, { bgcolor: '#ffffff', scale: 2 });
            document.body.removeChild(wrapper);

            const link = document.createElement('a');
            link.download = 'cfps-composition-table.png';
            link.href = URL.createObjectURL(blob);
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        } catch (e) {
            console.error('Download failed:', e);
        } finally {
            isDownloading = false;
        }
    }

    let hoveredCell = $state(null); // {row: string, col: string} | null
    let activeSynopsis = $state(null); // { name, synopsis } | null

    // Currently-selected composition key. Clicking a column header or a fidelity
    // card sets this, which outlines the matching column in the table AND the
    // matching card in the fidelity section below (cyan). Header clicks also load
    // the formulation into the designer; fidelity-card clicks only select.
    let selectedKey = $state(null);
    const SEL_COLOR = '#22d3ee';

    // Salt optima — override K(Glu) and Mg(Glu)2 across all formulations
    let saltOptima = $state('default');
    const SALT_OPTIMA = {
        default:         { label: 'Default',                  overrides: null },
        sfgfp:           { label: 'Target (sfGFP)',            overrides: { 'K(Glu)': 354.2, 'Mg(Glu)2': 6.975 } },
        reteplase:       { label: 'Target (Reteplase)',          overrides: { 'K(Glu)': 250.3, 'Mg(Glu)2': 5.725 } },
        reteplase_old:   { label: 'Target (Reteplase - Old)',    overrides: { 'K(Glu)': 329.1, 'Mg(Glu)2': 6.975 } }
    };
    function applyOptima(bm) {
        const { overrides } = SALT_OPTIMA[saltOptima] ?? SALT_OPTIMA.default;
        if (!overrides) return bm;
        return { ...bm, components: { ...bm.components, ...overrides } };
    }

    function formulationPaperGroup(bm) {
        if (bm.category === 'gpt5-autonomous')   return 'smith';
        if (bm.category === 'ginkgo-target')      return 'ginkgo-target';
        if (bm.category === 'ginkgo-experimental') return 'ginkgo-experimental';
        if (bm.year === 2026)                     return 'olsen';
        return 'historical';
    }

    const PAPER_GROUP_META = {
        historical:          { label: 'Literature',           color: 'rgba(0,0,0,0.04)'        },
        olsen:               { label: 'Olsen et al. 2026',    color: 'rgba(34,211,238,0.20)'   },
        smith:               { label: 'Smith et al. 2026',    color: 'rgba(139,92,246,0.22)'   },
        'ginkgo-target':     { label: 'Ginkgo Internal',      color: 'rgba(245,158,11,0.22)'   },
        'ginkgo-experimental':{ label: 'Jewett Experimental 7/17/26', color: 'rgba(52,211,153,0.22)'  }
    };

    // Column visibility toggles
    let showLiterature = $state(false);
    let showGinkgoInternal = $state(false);

    const NON_JEWETT_LIT = new Set(['jewett-2004','calhoun-2005','zawada-2011','cai-2015','borkowski-2020','garenne-2021','warfel-2023','zhu-2025']);
    const GINKGO_TARGET_ORDER = ['ginkgo-target-sfgfp','ginkgo-target-reteplase-old','ginkgo-target-reteplase'];

    // Fidelity-card list: same literature filter but Ginkgo targets always included.
    const fidelityFormulations = $derived.by(() =>
        BENCHMARK_FORMULATIONS.filter(bm => {
            if (!showLiterature && NON_JEWETT_LIT.has(bm.key)) return false;
            return true;
        })
    );

    // Derived display list: filters and places Ginkgo Internal at the far right.
    const displayFormulations = $derived.by(() => {
        const base = BENCHMARK_FORMULATIONS.filter(bm => {
            if (bm.category === 'ginkgo-target') return false;
            if (!showLiterature && NON_JEWETT_LIT.has(bm.key)) return false;
            return true;
        });
        if (!showGinkgoInternal) return base;
        const targets = GINKGO_TARGET_ORDER
            .map(k => BENCHMARK_FORMULATIONS.find(b => b.key === k))
            .filter(Boolean);
        return [...base, ...targets];
    });

    // Consecutive runs of same paper group, for the colspan group-header row.
    const displayColumnGroups = $derived.by(() => {
        const groups = [];
        for (const bm of displayFormulations) {
            const g = formulationPaperGroup(bm);
            if (groups.length && groups[groups.length - 1].group === g) {
                groups[groups.length - 1].count++;
            } else {
                groups.push({ group: g, count: 1 });
            }
        }
        return groups;
    });
    function splitName(name) {
        const i = name.indexOf('(');
        if (i <= 0) return { main: name, sub: null };
        return { main: name.slice(0, i).trimEnd(), sub: name.slice(i) };
    }

    function selectColumn(bm) {
        selectedKey = selectedKey === bm.key ? null : bm.key;
    }
    // Build the cyan outline box-shadow for a cell in a selected column. `top`
    // adds the column's top edge (header cell), `bottom` the bottom edge (water
    // row). Appends to any existing shadow so it composes with cell backgrounds.
    function colOutline(isSel, { top = false, bottom = false, existing = '' } = {}) {
        if (!isSel) return existing;
        let s = `inset 2px 0 0 ${SEL_COLOR}, inset -2px 0 0 ${SEL_COLOR}`;
        if (top) s = `inset 0 2px 0 0 ${SEL_COLOR}, ${s}`;
        if (bottom) s = `${s}, inset 0 -2px 0 0 ${SEL_COLOR}`;
        return existing ? `${existing}, ${s}` : s;
    }

    // View mode: default shows just the paper concentration (mM / mg/mL / U/mL
    // / ng/µL). Click anywhere in the table body to reveal the +nL supplement
    // volumes underneath. Toggle again to hide.
    let showSupplementNl = $state(false);
    function toggleSupplementMode() {
        showSupplementNl = !showSupplementNl;
    }

    // Alphas bumped so the coloured backgrounds read as solid tints over the
    // dark base. Text is white — reads clearly on all five tinted backgrounds
    // against the dark theme (black text was still low-contrast on the muted
    // greens/blues).
    function feasibilityCellStyle(feas) {
        if (feas.status === 'ok')            return { bg: 'rgba(34, 197, 94, 0.35)',  border: 'rgba(34, 197, 94, 0.55)',  text: 'oklch(var(--bc))' };
        if (feas.status === 'tight')         return { bg: 'rgba(245, 158, 11, 0.4)',  border: 'rgba(245, 158, 11, 0.6)',  text: 'oklch(var(--bc))' };
        if (feas.status === 'very-tight')    return { bg: 'rgba(239, 68, 68, 0.4)',   border: 'rgba(239, 68, 68, 0.6)',   text: 'oklch(var(--bc))' };
        // Base buffer alone meets/exceeds the target — no supplement needed.
        if (feas.status === 'over-baseline') return { bg: 'rgba(14, 165, 233, 0.35)', border: 'rgba(14, 165, 233, 0.6)',  text: 'oklch(var(--bc))' };
        // "missing" = paper reagent not in our inventory. Rendered as theoretical
        // (purple/violet) so it reads as "you'd need to buy this" not "N/A".
        return { bg: 'rgba(168, 85, 247, 0.35)', border: 'rgba(168, 85, 247, 0.6)', text: 'oklch(var(--bc))' };
    }

    // Count how many components in a formulation are actually stockable.
    function inStockCount(bm) {
        let ok = 0, total = 0;
        for (const [name] of Object.entries(bm.components)) {
            total += 1;
            const a = REAGENT_ALIASES[name];
            if (a?.ids) ok += 1;
        }
        return { ok, total, missing: total - ok };
    }

    function fmt(v) {
        if (v == null) return '';
        // Round to a sensible precision by magnitude, then strip trailing
        // zeros so "2.00" shows as "2" and "4.10" shows as "4.1".
        let s;
        if (v >= 100) s = v.toFixed(0);
        else if (v >= 10) s = v.toFixed(1);
        else if (v >= 1) s = v.toFixed(2);
        else s = v.toFixed(3);
        if (s.includes('.')) s = s.replace(/\.?0+$/, '');
        return s.replace(/^0+(?=\d)/, ''); // trim leading zeros but keep "0.x"
    }

    function roundUpNice(value) {
        if (!Number.isFinite(value) || value <= 0) return null;
        const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
        for (const factor of [1, 2, 2.5, 5, 10]) {
            const candidate = factor * magnitude;
            if (candidate >= value) return candidate;
        }
        return magnitude * 10;
    }

    // Echo transfer limits (384 LDV source plate, standard CFPS setup).
    // A single source well can only donate so much; exceeding this means the
    // reagent can't be dispensed from a single LDV well in one pass.
    const ECHO_MAX_TRANSFER_NL = 10_000; // 10 µL per source well per reaction
    const ECHO_MIN_TRANSFER_NL = 25;     // 25 nL minimum step

    // Compute minimum stock concentrations for all "needed" reagents assuming
    // they are ALL added simultaneously and share the water budget equally.
    // Returns an array parallel to `additional`. Each entry has:
    //   { suggested, unit, volumeNl, tooLow, tooHigh, impossible }
    // tooLow  = volume < 25 nL (below Echo minimum — stock too concentrated)
    // tooHigh = volume > 10,000 nL (above Echo max per LDV well — stock too dilute)
    function stockSuggestionsForAll(additional, waterNl) {
        const rxnNl = 20_000;
        const modelled = additional.filter(a => a.unit && a.unit !== '% w/v');
        const N = modelled.length;
        const perNl = N > 0 ? waterNl / N : 0;

        return additional.map(a => {
            if (!a.unit || a.unit === '% w/v') return null;
            if (perNl < ECHO_MIN_TRANSFER_NL) return { impossible: true, unit: a.unit, volumeNl: 0 };

            const alias = REAGENT_ALIASES[a.paperName];
            const maxSoluble = alias?.maxSolubleMm ?? null;

            const minStock = (a.value * rxnNl) / perNl;
            const rawSuggested = roundUpNice(minStock);
            if (!rawSuggested) return null;

            // If the minimum stock needed exceeds known solubility, cap it and
            // flag crash risk — the resulting volume will exceed the budget but
            // we still show it so the user can see the true gap.
            const crashRisk = maxSoluble != null && rawSuggested > maxSoluble;
            const suggested = crashRisk ? maxSoluble : rawSuggested;

            const snappedNl = Math.round((a.value / suggested) * rxnNl / ECHO_MIN_TRANSFER_NL) * ECHO_MIN_TRANSFER_NL;
            return {
                suggested,
                unit: a.unit,
                volumeNl: snappedNl,
                crashRisk,
                tooLow: snappedNl < ECHO_MIN_TRANSFER_NL,
                tooHigh: snappedNl > ECHO_MAX_TRANSFER_NL
            };
        });
    }

    function inventoryLabel(paperName) {
        const a = REAGENT_ALIASES[paperName];
        if (!a?.ids) return 'not in stock';
        return a.ids.join(' + ');
    }

    function handleLoad(bm) {
        if (typeof onLoad === 'function') onLoad(applyOptima(bm));
    }

    // Set of reagent ids the parent supplies recipes for — used to decide
    // whether to show the ⓘ button next to a reagent name. Kept in sync with
    // REAGENT_RECIPES in +page.svelte.
    const REAGENTS_WITH_RECIPE = new Set(['aa_mix_17']);
    function invokeShowRecipe(reagentId) {
        if (typeof onShowRecipe === 'function') onShowRecipe(reagentId);
    }

    // Water headroom colour: blue if plenty of room (≥2 µL water reserve),
    // amber tight (0 to <2 µL — zero is tight, not broken), red over-budget
    // (>25 nL under zero, i.e. supplements exceed the 11 µL budget by more
    // than one Echo step). Blue reuses the "base buffer already meets
    // target" hue elsewhere in the table.
    function waterCellStyle(waterNl) {
        if (waterNl < -25)  return { bg: 'rgba(239, 68, 68, 0.4)', border: 'rgba(239, 68, 68, 0.6)', text: 'oklch(var(--bc))' };
        if (waterNl <= 0)   return { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.4)', text: 'oklch(var(--bc))' };
        return { bg: 'rgba(34, 197, 94, 0.35)', border: 'rgba(34, 197, 94, 0.55)', text: 'oklch(var(--bc))' };
    }

    // ─── Coloring mode ──────────────────────────────────────────────────────
    let coloringMode = $state('default');
    const COLORING_OPTIONS = [
        { key: 'default',              label: 'Default' },
        { key: 'target-sfgfp',         label: 'vs Target (sfGFP)' },
        { key: 'target-reteplase',     label: 'vs Target (Reteplase)' },
        { key: 'target-reteplase-old', label: 'vs Target (Reteplase old)' }
    ];
    const COLORING_TARGET_KEYS = {
        'target-sfgfp':         'ginkgo-target-sfgfp',
        'target-reteplase':     'ginkgo-target-reteplase',
        'target-reteplase-old': 'ginkgo-target-reteplase-old'
    };

    function coloringCellStyle(paperName, val) {
        if (coloringMode === 'default') return null;
        const targetBm = BENCHMARK_FORMULATIONS.find(b => b.key === COLORING_TARGET_KEYS[coloringMode]);
        if (!targetBm) return null;
        const targetVal = targetBm.components[paperName];
        // Reagent not in target → keep green (extra in this composition vs target)
        if (targetVal == null || targetVal === 0) {
            return { bg: 'rgba(34, 197, 94, 0.35)', border: 'rgba(34, 197, 94, 0.55)', text: 'oklch(var(--bc))' };
        }
        // Gradient: blue (low) → neutral (at target) → red (high), log2 scale ±2 folds
        const logRatio = Math.log2(val / targetVal);
        const t = Math.max(-1, Math.min(1, logRatio / 2)); // -1 to 1
        const alpha = 0.15 + Math.abs(t) * 0.55;
        if (t < -0.05) {
            const f = -t;
            return { bg: `rgba(30, 120, 255, ${alpha * f + 0.08})`, border: 'transparent', text: 'oklch(var(--bc))' };
        } else if (t > 0.05) {
            return { bg: `rgba(239, 68, 68, ${alpha * t + 0.08})`, border: 'transparent', text: 'oklch(var(--bc))' };
        } else {
            return { bg: 'rgba(150, 150, 150, 0.12)', border: 'transparent', text: 'oklch(var(--bc))' };
        }
    }

    // ─── Onboarding difficulty ──────────────────────────────────────────────
    // Classify how hard each composition is to run on our system:
    //   difficult — no water headroom left (supplements already exceed budget)
    //   complete  — fits perfectly, every reagent already in stock
    //   easy      — only additional reagents are putrescine and/or PEG-8000
    //   medium    — everything else (needs other additional reagents)
    const EASY_ADDITIONAL = new Set(['Putrescine', 'PEG-8000']);
    function onboardingClass(bm) {
        const ebm = applyOptima(bm);
        const waterNl = waterFillNlForFormulation(ebm);
        const { additional } = formulationFidelity(ebm);
        // Difficult: over-budget (negative water) OR < 1 µL headroom AND still
        // needs additional reagents (basically no room to add what's missing).
        if (waterNl < 0 || (waterNl < 1000 && additional.length > 0)) return 'difficult';
        if (additional.length === 0) return 'complete';
        if (additional.every((a) => EASY_ADDITIONAL.has(a.paperName))) return 'easy';
        return 'medium';
    }
    // Difficulty groups that render as cards, in order. `complete` is handled
    // separately as a compact "Done" list.
    const ONBOARDING_GROUPS = [
        { key: 'easy',      label: 'Easy',      color: '#4ade80', desc: 'only needs putrescine and/or PEG-8000' },
        { key: 'medium',    label: 'Medium',    color: '#f59e0b', desc: 'needs a few additional reagents' },
        { key: 'difficult', label: 'Difficult', color: '#ef4444', desc: 'no water headroom left — supplements exceed the 11 µL budget' }
    ];
</script>

<section class="mt-2 mb-4 bg-base-100 rounded-lg border border-base-300">
    <!-- Horizontal-scroll wrapper: the table keeps its natural (wide) width and
         scrolls sideways WITHIN this box, so the page itself isn't pushed wide.
         Rows are viewed by scrolling the page down (table keeps full length).
         The left reagent columns use position:sticky left, so they stay pinned
         while scrolling right — you can always see which reagent a value is for. -->
    <!-- 2-D scroll region: scroll right for more columns, down for more rows,
         all WITHIN this box (the page isn't pushed wide). max-h keeps it tall so
         it still reads as a full table. The header row is sticky-top and the
         reagent columns are sticky-left, so both stay frozen while scrolling
         anywhere in the grid. No left padding — the sticky-left columns must sit
         flush at scrollport x=0 so scrolling cells can't peek to their left. -->
    <div class="pb-3 pr-3 overflow-auto max-h-[78vh] isolate" bind:this={tableScrollEl}>
            <!-- border-separate (not collapse): collapse breaks position:sticky on
                 the thead (ghost/duplicate rows) and drops per-cell box-shadows.
                 Separated borders with 0 spacing render identically but make the
                 sticky header + frozen columns + seam shadows reliable. -->
            <table class="w-max mx-auto text-[11px] border-separate border-spacing-0">
                <!-- z-50: header sits above the sticky-left body columns (z-30/z-40)
                     so it covers them when scrolling down. `isolate` on the wrapper
                     scopes this z-index so it can't fight the page preset bar. -->
                <thead class="sticky top-0 z-50 bg-base-200">
                    <!-- Paper-group header row -->
                    <tr class="text-[9px]">
                        <th
                            colspan="2"
                            class="sticky left-0 z-40"
                            style="background: oklch(var(--b2)); "
                        ></th>
                        {#each displayColumnGroups as grp}
                            {@const meta = PAPER_GROUP_META[grp.group]}
                            <th
                                colspan={grp.count}
                                class="text-center px-1 py-0.5 font-bold uppercase tracking-widest border-b"
                                style="background: {meta.color}; border-color: oklch(var(--bc) / 0.12); color: oklch(var(--bc) / 0.65); letter-spacing: 0.08em;"
                            >{meta.label}</th>
                        {/each}
                    </tr>
                    <tr>
                        <!-- Corner cell spans both the rotated group-label column AND
                             the reagent-name column. Intentionally empty + fully opaque
                             (no element-level opacity) so scrolling value cells can't
                             show through it. -->
                        <th
                            colspan="2"
                            class="border-b border-base-300 sticky left-0 z-40"
                            style="min-width: 202px; background: oklch(var(--b2)); "
                        ></th>
                        {#each displayFormulations as bm}
                            {@const stk = inStockCount(bm)}
                            {@const isSel = selectedKey === bm.key}
                            {@const sn = splitName(bm.name)}
                            <!-- Opaque cell background so scrolling body rows don't
                                 show through the header when it's stuck. Top edge of
                                 the column outline lives on this header cell. -->
                            <th class="text-center px-2 py-2 border-b border-base-300" style="min-width: 66px; background: oklch(var(--b2)); box-shadow: {colOutline(isSel, { top: true })};">
                                <!-- Clickable header cell (div, not button, so the name can be a
                                     nested <a> link). Click loads + selects the formulation; the
                                     name itself links to the source paper (new tab). -->
                                <div
                                    role="button"
                                    tabindex="0"
                                    class="w-full text-center hover:bg-base-100/60 rounded px-1 py-1 transition cursor-pointer"
                                    onclick={() => { selectColumn(bm); handleLoad(bm); }}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColumn(bm); handleLoad(bm); } }}
                                    title={stk.missing === 0
                                        ? `Load ${bm.name} (${bm.citation}) — all ${stk.total} components in stock`
                                        : `Load ${bm.name} (${bm.citation}) — ${stk.missing}/${stk.total} components are theoretical (not in stock)`}
                                >
                                    <div class="flex flex-col items-center justify-start" style="min-height: 2.4em;">
                                    {#if bm.paperUrl}
                                        <a
                                            href={bm.paperUrl}
                                            target="_blank"
                                            rel="noopener"
                                            class="font-semibold text-[11px] leading-tight hover:underline hover:text-primary"
                                            onclick={(e) => e.stopPropagation()}
                                            title={`Open source paper for ${bm.name}`}
                                        >{sn.main}{#if sn.sub}<br/><span class="font-normal opacity-70">{sn.sub}</span>{/if}</a>
                                    {:else}
                                        <div class="font-semibold text-[11px] leading-tight">{sn.main}{#if sn.sub}<br/><span class="font-normal opacity-70">{sn.sub}</span>{/if}</div>
                                    {/if}
                                    </div>
                                    <div class="text-[9px] opacity-55 leading-tight">{bm.year}</div>
                                    <div
                                        class="text-[9px] font-mono leading-tight mt-0.5"
                                        style={stk.missing === 0
                                            ? 'color: #22c55e;'
                                            : (stk.missing >= stk.total / 2
                                                ? 'color: #a855f7;'
                                                : 'color: #f59e0b;')}
                                    >
                                        {stk.ok}/{stk.total}
                                    </div>
                                </div>
                            </th>
                        {/each}
                    </tr>
                    <!-- Summary rows: yield + cost -->
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">yield (g/L)</span></td>
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">{bm.yield_g_l?.toFixed(2) ?? '—'}</span></td>
                        {/each}
                    </tr>
                    {#if showSupplementNl}
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">$/g protein</span></td>
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">${bm.cost_per_g?.toLocaleString() ?? '—'}</span></td>
                        {/each}
                    </tr>
                    {/if}
                </thead>
                <!-- Click anywhere in the table body to toggle supplement-nL
                     rendering on/off (default off = concentrations only). Cell
                     tooltips (title attribute on hover) are unaffected. Column
                     headers have their own load-button handlers and stop the
                     click propagation on their own. -->
                <tbody onclick={toggleSupplementMode} class="cursor-pointer" title={showSupplementNl ? 'Click to hide supplement volumes' : 'Click to show supplement volumes'}>
                    {#each REAGENT_GROUPS as group, groupIndex}
                        {#each group.reagents as paperName, reagentIndex}
                            {@const alias = REAGENT_ALIASES[paperName]}
                            {@const missing = !alias?.ids}
                            {@const isGroupFirstRow = reagentIndex === 0}
                            <!-- Draw the group divider as an inset box-shadow rather than
                                 border-top: border-collapse eats per-cell borders (they lose
                                 to the previous row's absent border), but a shadow renders
                                 through unconditionally. -->
                            {@const boundaryShadow = isGroupFirstRow && groupIndex > 0
                                ? 'inset 0 -2px 0 oklch(var(--bc) / 0.35)'
                                : 'none'}
                            {@const hasRecipe = REAGENTS_WITH_RECIPE.has(alias?.ids?.[0])}
                            {@const limsUrl = alias?.ids ? limsUrlForReagentId(alias.ids[0]) : null}
                            {@const isCustom = !!(alias?.ids && CUSTOM_REAGENT_IDS.has(alias.ids[0]))}
                            <tr class="hover:bg-base-200/30 transition">
                                {#if isGroupFirstRow}
                                    <!-- Rotated group-label column. z-40 so it sits above value
                                         cells during any scroll state. -->
                                    <td
                                        rowspan={group.reagents.length}
                                        class="sticky left-0 z-40 text-center align-middle uppercase tracking-widest text-[10px] font-semibold"
                                        style="background: oklch(var(--b3)); width: 32px; min-width: 32px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 6px 0; border-right: 1px solid oklch(var(--b3)); box-shadow: {boundaryShadow};"
                                    >
                                        <span class="opacity-70">{group.name}</span>
                                    </td>
                                {/if}
                                <!-- Reagent name column. z-30 (above value cells but below the
                                     group column). Explicit min-width so table layout can't
                                     collapse this cell and let value cells overlap. Solid
                                     bg-base-100 + right shadow to visually detach from the
                                     scrolling values behind. -->
                                <td
                                    class="px-3 py-1 sticky z-30 whitespace-nowrap"
                                    style="left: 31px; min-width: 200px; background: oklch(var(--b2)); "
                                >
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <!-- Reagent name links to its LIMS object (opens in a new
                                             tab). stopPropagation so clicking the name doesn't also
                                             toggle the supplement-nL view. Falls back to plain text
                                             when the reagent isn't in stock / has no LIMS mapping. -->
                                        {#if limsUrl}
                                            <a
                                                href={limsUrl}
                                                target="_blank"
                                                rel="noopener"
                                                class="hover:underline hover:text-primary"
                                                onclick={(e) => e.stopPropagation()}
                                                title={`Open ${paperName} in LIMS`}
                                            >{paperName}</a>
                                        {:else}
                                            <span class="{missing ? 'opacity-70' : ''}">{paperName}</span>
                                        {/if}
                                        {#if alias?.ids && alias?.stockMm}
                                            <span class="text-[8px] opacity-35 font-mono">{alias.stockMm} {alias.unit}</span>
                                        {/if}
                                        {#if isCustom}
                                            <span
                                                class="text-[9px] leading-none"
                                                style="color: {CUSTOM_COLOR};"
                                                title="Custom Ginkgo reagent (special-order stock)"
                                            >◆</span>
                                        {/if}
                                        {#if missing}
                                            <span
                                                class="text-[9px] leading-none font-mono"
                                                style="color: #a855f7;"
                                                title={alias?.notes || 'Not in stock — add to order list to use this formulation.'}
                                            >○</span>
                                        {/if}
                                        {#if hasRecipe}
                                            <button
                                                type="button"
                                                class="text-[10px] leading-none px-1 py-0.5 rounded text-primary/60 hover:text-primary hover:bg-primary/10"
                                                onclick={(e) => { e.stopPropagation(); invokeShowRecipe(alias.ids[0]); }}
                                                aria-label={`View recipe for ${paperName}`}
                                            >&#9432;</button>
                                        {/if}
                                        {#if REAGENT_SYNOPSES[paperName]}
                                            <button
                                                type="button"
                                                class="text-[10px] leading-none px-1 py-0.5 rounded text-base-content/40 hover:text-base-content hover:bg-base-content/10"
                                                onclick={(e) => { e.stopPropagation(); activeSynopsis = { name: paperName, synopsis: REAGENT_SYNOPSES[paperName] }; }}
                                                aria-label={`About ${paperName}`}
                                            >&#9432;</button>
                                        {/if}
                                    </div>
                                    {#if showSupplementNl && alias?.ids?.[0]}
                                        <div class="text-[8px] opacity-30 font-mono truncate leading-tight" style="max-width: 160px;" title={inventoryLabel(paperName)}>
                                            {alias.ids[0]}
                                        </div>
                                    {/if}
                                </td>
                                {#each displayFormulations as bm}
                                    {@const val = applyOptima(bm).components[paperName]}
                                    {@const isSel = selectedKey === bm.key}
                                    {#if val == null}
                                        <!-- Reagent unused in this formulation — leave the cell blank
                                             (but still draw the column outline through it when selected). -->
                                        <td style="background: oklch(var(--b2)); box-shadow: {colOutline(isSel)};"></td>
                                    {:else}
                                        {@const feas = feasibilityFor(paperName, val)}
                                        {@const style = coloringCellStyle(paperName, val) ?? feasibilityCellStyle(feas)}
                                        {@const tooltip = feas.status === 'missing'
                                            ? `${paperName}: ${val} ${alias?.unit ?? ''} — theoretical (${feas.reason || 'not in stock; add to order list to run this formulation'})`
                                            : feas.status === 'over-baseline'
                                                ? feas.reason
                                                : (feas.baseContribution > 0
                                                    ? `${paperName}: ${val} ${alias.unit} target. Base buffer contributes ${feas.baseContribution} → supplement ${feas.neededSupplementMm.toFixed(1)} ${alias.unit} (${feas.pctHeadroom.toFixed(0)}% of add-budget).`
                                                    : `${paperName}: ${val} ${alias.unit} → ${feas.pctHeadroom.toFixed(0)}% of reagent-add budget`)}
                                        <td
                                            class="text-center px-1 py-1 font-mono cursor-help leading-tight"
                                            style="background: {style.bg}; color: {style.text}; box-shadow: {colOutline(isSel)};"
                                            title={tooltip}
                                        >
                                            <div>{fmt(val)}</div>
                                            {#if showSupplementNl}
                                                {#if feas.status === 'over-baseline'}
                                                    <div class="text-[8px] opacity-70" title="Base buffer already meets target — no supplement needed">
                                                        +0 nL
                                                    </div>
                                                {:else if feas.status === 'ok' || feas.status === 'tight' || feas.status === 'very-tight'}
                                                    <div class="text-[8px] opacity-70" title={`Exact ${feas.neededNl} nL → snapped to ${feas.snappedNl} nL (25 nL Echo resolution)`}>
                                                        +{feas.snappedNl} nL{feas.baseContribution > 0 ? '*' : ''}
                                                    </div>
                                                    {#if !bm.echoNative && Math.abs(feas.deviationPct) >= 0.05}
                                                        <div
                                                            class="text-[8px] font-semibold"
                                                            style="color: {Math.abs(feas.deviationPct) >= 5 ? '#fbbf24' : 'oklch(var(--bc) / 0.85)'};"
                                                            title={`Delivered concentration is ${feas.deviationPct >= 0 ? 'over' : 'under'} target by ${Math.abs(feas.deviationPct).toFixed(1)}% due to 25 nL rounding`}
                                                        >
                                                            Δ{feas.deviationPct >= 0 ? '+' : '−'}{Math.abs(feas.deviationPct).toFixed(1)}%
                                                        </div>
                                                    {/if}
                                                {:else}
                                                    <!-- theoretical / missing → no volume to show -->
                                                    <div class="text-[8px] opacity-30">—</div>
                                                {/if}
                                            {/if}
                                        </td>
                                    {/if}
                                {/each}
                            </tr>
                        {/each}
                    {/each}
                    <!-- Water headroom row: fill volume left after the 9 µL of
                         fixed reagents (DNA + lysate + base buffer) and all
                         supplement additions. Blue = comfortable, amber =
                         tight (<2 µL reserve), red = over the 11 µL budget. -->
                    <tr class="hover:bg-base-200/30 transition">
                        <td
                            class="sticky left-0 z-40 text-center align-middle uppercase tracking-widest text-[10px] font-semibold"
                            style="background: oklch(var(--b3)); width: 32px; min-width: 32px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 6px 0; border-right: 1px solid oklch(var(--b3)); box-shadow: inset 0 -2px 0 oklch(var(--bc) / 0.35);"
                        >
                            <span class="opacity-70">Water</span>
                        </td>
                        <td
                            class="px-3 py-1 sticky z-30 whitespace-nowrap"
                            style="left: 31px; min-width: 200px; background: oklch(var(--b2)); "
                        >
                            <div>Water</div>
                        </td>
                        {#each displayFormulations as bm}
                            {@const waterNl = waterFillNlForFormulation(applyOptima(bm))}
                            {@const waterUl = waterNl / 1000}
                            {@const wstyle = waterCellStyle(waterNl)}
                            {@const tooltip = waterNl > 0
                                ? `${waterUl.toFixed(2)} µL water fill left after ${((20000 - 9000 - waterNl)/1000).toFixed(2)} µL of supplements`
                                : `Supplements exceed 11 µL budget by ${(-waterUl).toFixed(2)} µL — over-budget, would need to scale down`}
                            <td
                                class="text-center px-1 py-1 font-mono cursor-help leading-tight"
                                style="background: {wstyle.bg}; color: {wstyle.text}; box-shadow: {colOutline(selectedKey === bm.key, { bottom: true })};"
                                title={tooltip}
                            >
                                <div>{waterUl.toFixed(2)}</div>
                                <div class="text-[8px] opacity-70">µL</div>
                            </td>
                        {/each}
                    </tr>
                </tbody>
            </table>
        </div>

    <div class="flex justify-end gap-3 pr-3 pt-2 pb-1 items-center flex-wrap">
        <div class="flex items-center gap-1.5">
            <span class="text-[10px] text-base-content/40">Show</span>
            <button
                class="text-[10px] px-2 py-0.5 rounded border transition {showLiterature ? 'border-base-content/40 text-base-content/70 bg-base-content/5' : 'border-base-content/15 text-base-content/35'}"
                onclick={() => showLiterature = !showLiterature}
            >Literature</button>
            <button
                class="text-[10px] px-2 py-0.5 rounded border transition {showGinkgoInternal ? 'border-base-content/40 text-base-content/70 bg-base-content/5' : 'border-base-content/15 text-base-content/35'}"
                onclick={() => showGinkgoInternal = !showGinkgoInternal}
            >Ginkgo Internal</button>
        </div>
        <span class="text-[10px] text-base-content/40">Coloring</span>
        <select
            class="text-xs rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1.5 py-0.5"
            bind:value={coloringMode}
        >
            {#each COLORING_OPTIONS as opt}
                <option value={opt.key}>{opt.label}</option>
            {/each}
        </select>
        <span class="text-[10px] text-base-content/40">Salt optima</span>
        <select
            class="text-xs rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1.5 py-0.5"
            bind:value={saltOptima}
        >
            {#each Object.entries(SALT_OPTIMA) as [key, opt]}
                <option value={key}>{opt.label}</option>
            {/each}
        </select>
        <button
            class="text-xs px-2 py-0.5 rounded border border-base-content/20 hover:border-base-content/40 text-base-content/50 hover:text-base-content transition"
            onclick={downloadCSV}
            title="Download concentrations as CSV"
        >↓ CSV</button>
        <button
            class="text-xs px-2 py-0.5 rounded border border-base-content/20 hover:border-base-content/40 text-base-content/50 hover:text-base-content transition disabled:opacity-30"
            onclick={downloadTableImage}
            disabled={isDownloading}
            title="Download table as PNG"
        >{isDownloading ? 'Saving…' : '↓ PNG'}</button>
    </div>

    <!-- ── Under-table notes ────────────────────────────────────────────── -->
    <div class="px-3 pt-4 pb-4 space-y-4">
        <!-- Custom reagents + legend in the same row -->
        <div class="flex gap-3 items-start">
            <!-- Custom reagents -->
            <div class="rounded-lg border border-base-300 p-3 shrink-0" style="background: oklch(var(--b2));">
                <div class="text-[11px] font-semibold mb-2 flex items-center gap-1.5">
                    <span style="color: {CUSTOM_COLOR};">◆</span> Custom reagents
                </div>
                <div class="flex flex-col gap-1 text-[11px]">
                    {#each CUSTOM_REAGENTS as cr}
                        {@const url = limsUrlForReagentId(cr.id)}
                        <div class="flex items-center gap-1.5">
                            <span style="color: {CUSTOM_COLOR};">◆</span>
                            {#if url}
                                <a href={url} target="_blank" rel="noopener" class="hover:underline hover:text-primary">{cr.name}</a>
                            {:else}
                                <span>{cr.name}</span>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>

            <!-- Legend -->
            <div class="rounded-lg border border-base-300 p-3 text-[11px] space-y-2 flex-1" style="background: oklch(var(--b2));">
                <div class="opacity-70 leading-snug">
                    <div><span class="opacity-80">Base buffer pre-loads</span> <span class="font-mono">200 mM K(Glu) · 2.6 mM Mg(Glu)2 · 30 mM HEPES · 1 mM (17-AA / Tyr / Cys)</span>.</div>
                </div>
                <div class="flex gap-8">
                    <div class="flex flex-col gap-1">
                        <div class="inline-flex items-center gap-2"><span class="w-3 h-3 rounded" style="background: rgba(34,197,94,0.7)"></span> in stock, easy</div>
                        <div class="inline-flex items-center gap-2"><span class="w-3 h-3 rounded" style="background: rgba(245,158,11,0.7)"></span> tight (&gt;30% of supplement budget)</div>
                        <div class="inline-flex items-center gap-2"><span class="w-3 h-3 rounded" style="background: rgba(239,68,68,0.7)"></span> very tight (&gt;60% of supplement budget)</div>
                        <div class="inline-flex items-center gap-2"><span class="w-3 h-3 rounded" style="background: rgba(14,165,233,0.7)"></span> base buffer already meets target</div>
                        <div class="inline-flex items-center gap-2"><span class="w-3 h-3 rounded" style="background: rgba(168,85,247,0.7)"></span> theoretical</div>
                    </div>
                    <div class="opacity-60 space-y-0.5 leading-snug">
                        <div><span style="color: {CUSTOM_COLOR};">◆</span> — custom Jewett reagent</div>
                        <div><span class="font-mono">○</span> — reagent not in stock</div>
                        <div><span class="font-mono">blank</span> — reagent unused in this formulation</div>
                        <div><span class="font-mono">+nL*</span> — supplement on top of base-buffer baseline (snapped to 25 nL)</div>
                        <div><span class="font-mono">Δ%</span> — concentration error from 25 nL rounding</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 25 nL fidelity, grouped by onboarding difficulty. Click a card (or a
             column header above) to outline that composition in both places. -->
        {#each ONBOARDING_GROUPS as grp}
            {@const members = fidelityFormulations.filter((b) => onboardingClass(b) === grp.key)}
            {#if members.length > 0}
                <div class="rounded-lg border border-base-300 p-3" style="background: oklch(var(--b2));">
                    <div class="text-[11px] font-semibold mb-1.5" style="color: {grp.color};">
                        {grp.label} <span class="opacity-40 font-normal">· {members.length}</span>
                    </div>
                    <div class="grid grid-cols-4 gap-2 text-[10px]">
                        {#each members as bm}
                            {@const ebm = applyOptima(bm)}
                            {@const fid = formulationFidelity(ebm)}
                            {@const displayReagents = fid.offReagents.filter(o => Math.abs(o.deviationPct) >= 3)}
                {@const isSel = selectedKey === bm.key}
                {@const waterNl = waterFillNlForFormulation(ebm)}
                {@const wstyle = waterCellStyle(waterNl)}
                <div
                    role="button"
                    tabindex="0"
                    class="rounded border p-2 cursor-pointer transition hover:border-base-content/30 flex flex-col"
                    style="background: oklch(var(--b1)); border-color: {isSel ? SEL_COLOR : 'oklch(var(--bc) / 0.08)'}; box-shadow: {isSel ? `0 0 0 1px ${SEL_COLOR}` : 'none'};"
                    onclick={() => { selectColumn(bm); handleLoad(bm); }}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColumn(bm); handleLoad(bm); } }}
                >
                    <div class="font-semibold text-[11px] mb-1">
                        {#if bm.paperUrl}
                            <a
                                href={bm.paperUrl}
                                target="_blank"
                                rel="noopener"
                                class="hover:underline hover:text-primary"
                                onclick={(e) => e.stopPropagation()}
                                title={`Open source paper for ${bm.name}`}
                            >{bm.name}</a>
                        {:else}
                            {bm.name}
                        {/if}
                        <span class="opacity-40 font-normal">{bm.year}</span>
                    </div>
                    {#if waterNl < 0}
                        <div class="text-[10px]" style="color:#f59e0b;">Exceeds 20 µL reaction limit</div>
                    {:else if displayReagents.length === 0}
                        <div class="opacity-50">{fid.offReagents.length > 0 ? 'All deviations < 3%' : 'All in-stock reagents hit exact 25 nL steps'}</div>
                    {:else}
                        <!-- Off-reagents ≥3% deviation, two centered columns, farthest first. -->
                        <div class="grid grid-cols-[auto_auto] justify-center gap-x-6 gap-y-0.5 font-mono">
                            {#each displayReagents as o}
                                {@const delivered = o.targetValue + (o.deviationPct / 100) * o.targetValue}
                                <span class="whitespace-nowrap" title={`${o.paperName}: ${fmt(o.targetValue)} → ${fmt(delivered)} ${o.unit}`}>
                                    <span class="opacity-80">{o.paperName}</span>
                                    <span style="color: {Math.abs(o.deviationPct) >= 5 ? '#fbbf24' : 'inherit'};">{o.deviationPct >= 0 ? '+' : '−'}{Math.abs(o.deviationPct).toFixed(1)}%</span>
                                </span>
                            {/each}
                        </div>
                    {/if}
                    <!-- Bottom bar: Needs (left) + water (right). mt-auto pushes
                         this whole bar to the bottom of the flex-col card. -->
                    <div class="mt-auto pt-1 flex items-end justify-between gap-2">
                        <div style="color: #c084fc;">
                            {#if fid.additional.length > 0}
                                Needs ({fid.additional.length}): {fid.additional.map((a) => a.paperName).join(', ')}
                            {/if}
                        </div>
                        <div class="font-mono whitespace-nowrap shrink-0" style="color: {waterNl < -25 ? '#ef4444' : (fid.additional.length === 0 ? 'oklch(var(--bc)/0.4)' : (waterNl < 2000 ? '#f59e0b' : '#38bdf8'))};" title="Nuclease-free water fill left in the 20 µL reaction">
                            water: {(waterNl / 1000).toFixed(2)} µL
                        </div>
                    </div>
                    {#if isSel && (displayReagents.length > 0 || fid.additional.length > 0)}
                        <div class="mt-1 pt-1 border-t font-mono" style="border-color: oklch(var(--bc) / 0.1); font-size: 11px;">
                            {#if displayReagents.length > 0}
                                {#each displayReagents as o}
                                    {@const delivered = o.targetValue + (o.deviationPct / 100) * o.targetValue}
                                    {@const stockMm = REAGENT_ALIASES[o.paperName]?.stockMm}
                                    <div class="flex justify-between gap-2 opacity-80">
                                        <span class="truncate">{o.paperName}{#if stockMm != null}<span class="opacity-40 ml-1.5">{fmt(stockMm)} {o.unit}</span>{/if}</span>
                                        <span class="whitespace-nowrap shrink-0 opacity-60">{fmt(o.targetValue)} → <span style="color: {Math.abs(o.deviationPct) >= 5 ? '#fbbf24' : 'oklch(var(--bc)/0.6)'};">{fmt(delivered)}</span> {o.unit}</span>
                                    </div>
                                {/each}
                            {/if}
                            {#if fid.additional.length > 0}
                                {@const suggestions = stockSuggestionsForAll(fid.additional, waterNl)}
                                {@const modelledSuggestions = suggestions.filter(s => s !== null)}
                                {@const totalNl = suggestions.reduce((s, r) => s + (r?.volumeNl ?? 0), 0)}
                                {@const allFit = modelledSuggestions.length === 0
                                    ? true
                                    : totalNl <= waterNl && modelledSuggestions.every(r => r.impossible || (!r.crashRisk && !r.tooLow && !r.tooHigh))}
                                <div class="mt-1 pt-0.5 opacity-40" style="border-top: 1px solid rgba(192,132,252,0.25);">needed — if all added simultaneously</div>
                                {#each fid.additional as a, i}
                                    {@const sugg = suggestions[i]}
                                    <div class="flex justify-between gap-2" style="color: #c084fc;">
                                        <span class="truncate opacity-80">{a.paperName}</span>
                                        {#if !sugg}
                                            <span class="opacity-40 shrink-0">not modelled</span>
                                        {:else if sugg.impossible}
                                            <span style="color: #ef4444;">no water headroom</span>
                                        {:else}
                                            <span class="whitespace-nowrap shrink-0 opacity-70">
                                                {fmt(sugg.suggested)} {sugg.unit} stock
                                                <span class="opacity-60">→ {(sugg.volumeNl / 1000).toFixed(2)} µL</span>
                                                {#if sugg.crashRisk}
                                                    <span title="Stock above known solubility limit — likely to crash out of solution" style="color: #ef4444;">⚠ solubility</span>
                                                {:else if sugg.tooHigh}
                                                    <span title="Exceeds Echo LDV max (~10 µL/well)" style="color: #f59e0b;">⚠ vol high</span>
                                                {:else if sugg.tooLow}
                                                    <span title="Below Echo 25 nL minimum" style="color: #f59e0b;">⚠ vol low</span>
                                                {/if}
                                            </span>
                                        {/if}
                                    </div>
                                {/each}
                                <div class="flex justify-between gap-2 mt-0.5 pt-0.5 opacity-60" style="border-top: 1px solid rgba(192,132,252,0.15);">
                                    <span>combined</span>
                                    {#if modelledSuggestions.length === 0}
                                        <span style="color: #34d399;">✓ (only unmodelled reagents)</span>
                                    {:else}
                                        <span class="whitespace-nowrap" style="color: {allFit ? '#34d399' : '#ef4444'};">
                                            {(totalNl / 1000).toFixed(2)} / {(waterNl / 1000).toFixed(2)} µL {allFit ? '✓' : '✗'}
                                        </span>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
                        {/each}
                    </div>
                </div>
            {/if}
        {/each}

        <!-- Done: compositions that fit perfectly with every reagent in stock. -->
        {#if fidelityFormulations.some((b) => onboardingClass(b) === 'complete')}
            {@const completeMembers = fidelityFormulations.filter((b) => onboardingClass(b) === 'complete')}
            <div class="rounded-lg border border-base-300 p-3" style="background: oklch(var(--b2));">
                <div class="text-[11px] font-semibold mb-1.5" style="color: oklch(var(--bc)/0.5);">
                    Complete <span class="opacity-40 font-normal">· {completeMembers.length}</span>
                </div>
                <div class="grid grid-cols-4 gap-2 text-[10px]">
                    {#each completeMembers as bm}
                        {@const ebm = applyOptima(bm)}
                        {@const fid = formulationFidelity(ebm)}
                        {@const displayReagents = fid.offReagents.filter(o => Math.abs(o.deviationPct) >= 3)}
                        {@const isSel = selectedKey === bm.key}
                        {@const waterNl = waterFillNlForFormulation(ebm)}
                        {@const wstyle = waterCellStyle(waterNl)}
                        {@const sn = splitName(bm.name)}
                        <div
                            role="button"
                            tabindex="0"
                            class="rounded border p-2 cursor-pointer transition hover:border-base-content/30 flex flex-col"
                            style="background: oklch(var(--b1)); border-color: {isSel ? SEL_COLOR : 'oklch(var(--bc) / 0.08)'}; box-shadow: {isSel ? `0 0 0 1px ${SEL_COLOR}` : 'none'};"
                            onclick={() => { selectColumn(bm); handleLoad(bm); }}
                            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectColumn(bm); handleLoad(bm); } }}
                        >
                            <div class="font-semibold text-[11px] mb-1">
                                <div class="flex flex-col items-start justify-start" style="min-height: 2.4em;">
                                    {#if bm.paperUrl}
                                        <a href={bm.paperUrl} target="_blank" rel="noopener" class="hover:underline hover:text-primary" onclick={(e) => e.stopPropagation()} title={`Open source paper for ${bm.name}`}>{sn.main}{#if sn.sub}<br/><span class="font-normal opacity-70">{sn.sub}</span>{/if}</a>
                                    {:else}
                                        <div>{sn.main}{#if sn.sub}<br/><span class="font-normal opacity-70">{sn.sub}</span>{/if}</div>
                                    {/if}
                                </div>
                                <div class="text-[9px] opacity-55 leading-tight">{bm.year}</div>
                            </div>
                            {#if waterNl < 0}
                                <div class="text-[10px]" style="color:#f59e0b;">Exceeds 20 µL reaction limit</div>
                            {:else if displayReagents.length === 0}
                                <div class="opacity-50">{fid.offReagents.length > 0 ? 'All deviations < 3%' : 'All in-stock reagents hit exact 25 nL steps'}</div>
                            {:else}
                                <div class="grid grid-cols-[auto_auto] justify-center gap-x-6 gap-y-0.5 font-mono">
                                    {#each displayReagents as o}
                                        {@const delivered = o.targetValue + (o.deviationPct / 100) * o.targetValue}
                                        <span class="whitespace-nowrap" title={`${o.paperName}: ${fmt(o.targetValue)} → ${fmt(delivered)} ${o.unit}`}>
                                            <span class="opacity-80">{o.paperName}</span>
                                            <span style="color: {Math.abs(o.deviationPct) >= 5 ? '#fbbf24' : 'inherit'};">{o.deviationPct >= 0 ? '+' : '−'}{Math.abs(o.deviationPct).toFixed(1)}%</span>
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                            <div class="mt-auto pt-1 flex items-end justify-between gap-2">
                                <div></div>
                                <div class="font-mono whitespace-nowrap shrink-0" style="color: {waterNl < -25 ? '#ef4444' : 'oklch(var(--bc)/0.4)'};" title="Water fill left in the 20 µL reaction">
                                    water: {(waterNl / 1000).toFixed(2)} µL
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

</section>

{#if activeSynopsis}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onclick={() => activeSynopsis = null}
        role="presentation"
    >
        <div
            class="max-w-lg w-full max-h-[80vh] overflow-auto rounded-lg shadow-xl border border-base-300 bg-base-100"
            onclick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`About ${activeSynopsis.name}`}
        >
            <div class="flex items-center justify-between gap-4 px-5 py-3 border-b border-base-300 bg-base-200/60">
                <h3 class="text-sm font-semibold text-base-content/80">{activeSynopsis.name}</h3>
                <button type="button" class="text-base-content/50 hover:text-base-content text-lg leading-none" onclick={() => activeSynopsis = null} aria-label="Close">✕</button>
            </div>
            <div class="px-5 py-4 space-y-3 text-sm text-base-content/80 leading-relaxed">
                <p>{activeSynopsis.synopsis.role}</p>
                {#if activeSynopsis.synopsis.proteins}
                    <div class="space-y-2 pt-1 border-t border-base-300/50">
                        {#each Object.entries(activeSynopsis.synopsis.proteins) as [protein, note]}
                            <div>
                                <span class="text-xs font-semibold uppercase tracking-wide text-base-content/40">{protein === 'sfgfp' ? 'sfGFP' : protein === 'petase' ? 'PETase' : protein === 'reteplase' ? 'Reteplase' : protein}</span>
                                <p class="text-xs text-base-content/65 mt-0.5">{note}</p>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<script>
    // Comparison of industry-benchmark cell-free reaction formulations
    // (Olsen et al. 2026 Nat Commun, Table 1). Reads the benchmark data and
    // reagent aliases from $lib/cfps-benchmarks.js. Click a column header to
    // load that formulation's targets into the parent's design state.

    import { onDestroy, onMount } from 'svelte';
    import {
        REAGENT_ALIASES,
        REAGENT_GROUPS,
        CUSTOM_REAGENT_IDS,
        feasibilityFor,
        limsUrlForReagentId,
        waterFillNlForFormulation
    } from '$lib/cfps-benchmarks.js';
    import { REAGENT_SYNOPSES } from '$lib/reagent-synopses.js';

    // Blue-grey accent marker for custom Ginkgo reagents (distinct from the purple
    // ○ used for theoretical / not-in-stock reagents).
    const CUSTOM_COLOR = '#4a5560';

    let {
        onLoad,
        onShowRecipe,
        // Live design bridge from the parent designer. `customMix` is a map
        // paperName → { reagentId, unit, value, label, adjustable, canInc, canDec }
        // computed from volumesNl; `customWaterUl` is the current water fill in µL;
        // `onAdjust(reagentId, ±1)` nudges the design by one Echo step.
        customMix = {},
        customWaterUl = null,
        onAdjust = null,
        // Resets the Custom Mix back to the parent's default recipe (clears +/-
        // tweaks / any loaded formulation). Null hides the reset affordance.
        onReset = null,
        // Starting-composition control for the Custom Mix column. `customStartKey`
        // is the recipe the live design was seeded from; `customIsCustomized` is
        // true once the design diverges from it (→ the column reads "Custom");
        // `onSetCustomStart(key)` loads a new starting composition + re-baselines.
        customStartKey = 'ginkgo-target-sfgfp',
        customIsCustomized = false,
        onSetCustomStart = null,
        // Live-design notices, surfaced inside this section so they read as part
        // of the table. `discrepancies` = snap-rounding drift rows; `theoretical`
        // = reagents a loaded formulation needs that aren't in stock.
        discrepancies = [],
        theoretical = null,
        // Live direct reagent cost of the Custom Mix, computed by the parent from
        // the current design volumes × per-mL catalog costs (sourced from
        // autonomous-cfps models.py). `customCostPerMl` = $/mL of reaction;
        // `customCostUsd` = $ for the reaction as mixed. Fills the Custom Mix cell
        // in the "reagent cost" row (reference columns use their published cost_per_l).
        customCostPerMl = null,
        customCostUsd = null,
        // Optional footer snippet (concentration rank + reagent supplement JSON,
        // owned by the parent) rendered inside this section so the export panels
        // read as part of the same cell-free reaction designer.
        exportPanels = null,
        // Optional snippet rendered alone on the toolbar's second row (the parent's
        // "Submit composition" button) — every option control sits on the row above.
        submitRow = null,
        // Community-submitted compositions from the DB (cfps_designs), pre-shaped
        // by the parent to look like BENCHMARK_FORMULATIONS entries
        // ({ key, name, year, category:'community', components, citation }). Offered
        // as a "Community" group in the added-column dropdowns so any submission
        // can be pulled in as a comparison column.
        communityFormulations = [],
        // A composition picked in the plate-reader modal's ranked-titers chart,
        // shaped like a BENCHMARK_FORMULATIONS entry. When set it takes over the
        // Comparison Mix column (forced visible) instead of the dropdown selection;
        // `onClearExternalComparison` drops it and hands the column back to the
        // dropdown. Null = normal dropdown-driven Comparison Mix.
        externalComparison = null,
        onClearExternalComparison = null,
        // Benchmark composition table, supplied by the parent from PocketBase
        // (static_values) so it's editable without a redeploy. Defaults to an empty
        // list — the parent always passes the loaded data.
        benchmarkFormulations = []
    } = $props();

    // "$1.23" / "$0.0042" — a few sig-figs of precision for small per-mL costs.
    function fmtCost(v) {
        if (v == null || !Number.isFinite(v)) return '—';
        if (v === 0) return '$0';
        if (v >= 100) return '$' + Math.round(v).toLocaleString();
        if (v >= 1) return '$' + v.toFixed(2);
        return '$' + v.toFixed(v >= 0.1 ? 3 : 4);
    }

    let tableScrollEl = $state(null);
    let isDownloading = $state(false);

    // ─── Resizable columns ───────────────────────────────────────────────────
    // The customizer columns (reagent name + Custom / Comparison / Closest /
    // any added Compare columns) are drag-resizable via a thin handle on each
    // header's right edge. Widths live in `colWidths` keyed by a stable column id
    // and are applied through the <colgroup> (one <col> per column) so a single
    // value sizes the header, body and summary cells of that column at once — no
    // per-cell wiring. An unset id falls back to the column's design default.
    // Floors are chosen so a column can't be dragged narrow enough to clip/wrap
    // its content; the reference/literature columns stay content-sized as before.
    const COL_DEFAULTS = { rcol: 200, custom: 96, comparison: 96, closest: 132 };
    const COL_FLOOR = { rcol: 150, value: 64 };
    const COL_MAX = { rcol: 480, value: 260 };
    let colWidths = $state({});
    // Left offset that freezes the Custom Mix column immediately right of the
    // sticky group-label (0–32px) + reagent-name (31px + its width) columns, so
    // it stays visible while the reference columns scroll. Tracks the resizable
    // reagent column; the 1px base mirrors the group↔name seam overlap. Applied
    // as a CSS var so the sticky offset lives in CSS (desktop-only, see .bench-custcol).
    const customStickyLeft = $derived(31 + (colWidths.rcol ?? COL_DEFAULTS.rcol));
    let colResize = null;
    // Inline <col> style for a resizable column: an explicit px width once the
    // user has dragged it, otherwise the design default so the layout is unchanged.
    function colColStyle(id, def) {
        const w = colWidths[id] ?? def;
        return w == null ? '' : `width: ${w}px;`;
    }
    function startColResize(e, id, def, floor, max) {
        e.preventDefault();
        e.stopPropagation();
        colResize = { id, startX: e.clientX, startW: colWidths[id] ?? def, floor, max };
        window.addEventListener('pointermove', onColResizeMove);
        window.addEventListener('pointerup', endColResize);
    }
    function onColResizeMove(e) {
        if (!colResize) return;
        const next = Math.round(colResize.startW + (e.clientX - colResize.startX));
        colWidths = {
            ...colWidths,
            [colResize.id]: Math.max(colResize.floor, Math.min(colResize.max, next))
        };
    }
    function endColResize() {
        colResize = null;
        // Guarded for SSR: onDestroy fires this on the server, where there's no window.
        if (typeof window === 'undefined') return;
        window.removeEventListener('pointermove', onColResizeMove);
        window.removeEventListener('pointerup', endColResize);
    }
    // Double-click a handle to drop the override and restore the default width.
    function resetColWidth(id) {
        if (colWidths[id] == null) return;
        const { [id]: _drop, ...rest } = colWidths;
        colWidths = rest;
    }
    onDestroy(endColResize);

    // ─── Customizer columns (rightmost) ──────────────────────────────────────
    // Comparison Mix is a view-only reference the Custom Mix (live design) is
    // diffed against. Its dropdown lists the measured reference plates first,
    // then every literature / GPT formulation. Default = the reteplase target
    // plate — the folding-heavy control is the most useful cross-check to keep
    // handy. The column itself is off by default (toggled via "Comparison").
    const COMPARISON_OPTIONS = $derived(
        benchmarkFormulations.filter((b) => b.category !== 'ginkgo-target')
    );
    let comparisonKey = $state('ginkgo-target-reteplase');
    // `comparisonBm` is declared lower down, AFTER applyAll / SALT_OPTIMA — during
    // SSR Svelte evaluates $derived eagerly at its declaration line, so it must
    // not run before the salt-optima constants it depends on are initialized.

    // ── User-added comparison columns (the thin "+" by the Comparison Mix) ────
    // Each entry is a formulation key; the column renders just like the Comparison
    // Mix (concentration + signed % vs the live Custom Mix). New columns default to
    // the usual sfGFP target composition, and each carries its own dropdown that —
    // on top of the reference plates and literature models — offers a "Community"
    // group of every submission in the database. `addedColumns` (the resolved,
    // optima/exclusion-applied formulations) is declared lower down, after applyAll.
    const DEFAULT_ADDED_KEY = 'ginkgo-target-sfgfp-best';
    let addedColumnKeys = $state([]);
    function addComparisonColumn() {
        addedColumnKeys = [...addedColumnKeys, DEFAULT_ADDED_KEY];
    }
    function removeComparisonColumn(i) {
        addedColumnKeys = addedColumnKeys.filter((_, idx) => idx !== i);
    }
    function setAddedColumn(i, key) {
        addedColumnKeys = addedColumnKeys.map((k, idx) => (idx === i ? key : k));
    }

    // "+2.5" / "−0.4" / "0" — signed, magnitude-precision, trailing zeros trimmed.
    function fmtSigned(v) {
        if (v == null || !Number.isFinite(v)) return '—';
        if (Math.abs(v) < 1e-9) return '0';
        return (v > 0 ? '+' : '−') + fmt(Math.abs(v));
    }

    // Everything is now diffed AGAINST the live Custom Mix: each reference column
    // (Comparison Mix, Closest Match) shows its own concentration plus how far it
    // sits above/below the custom design. Signed % = (reference − custom) / custom.
    // null when the custom value is 0 or absent (a % change off zero is undefined),
    // so the caller renders "n/a".
    function pctDiff(refValue, customValue) {
        if (refValue == null || customValue == null || customValue === 0) return null;
        return ((refValue - customValue) / customValue) * 100;
    }
    function pctVsCustom(paperName, refValue) {
        return pctDiff(refValue, customMix?.[paperName]?.value ?? null);
    }
    // Pure-percent label + direction coloring for the sub-line under a reference
    // concentration. "n/a" when the diff is undefined; teal above / red below the
    // custom mix, muted at parity.
    function pctLabel(pct) {
        return pct == null ? 'n/a' : `${fmtSigned(pct)}%`;
    }
    function pctClass(pct) {
        if (pct == null || Math.abs(pct) < 1e-9) return 'delta-flat';
        return pct > 0 ? 'delta-up' : 'delta-dn';
    }

    // ─── Hold + drag scrubbing on the Custom Mix +/- steppers ─────────────────
    // A plain click nudges one Echo step. Pressing and holding a stepper repeats at a
    // base rate; while holding, the CURSOR direction takes over the sign — drag right
    // to increase, drag left to decrease (regardless of which button you pressed) — and
    // the farther you drag, the faster it sweeps. adjustVolumeNl/setVolumeNl in the
    // parent clamp to [0, available], so the extra calls past a limit are harmless.
    let scrubState = null; // { reagentId, dir, startX, lastX, accum, last }
    let scrubRaf = null;

    // Keyboard activation (Enter/Space) fires click with detail 0 — handle the
    // single step there; pointer-driven clicks are already covered by the hold.
    function stepClick(e, reagentId, dir) {
        e.stopPropagation();
        if (e.detail !== 0) return;
        if (onAdjust) onAdjust(reagentId, dir);
    }

    function startScrub(e, reagentId, dir) {
        if (!onAdjust || e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        onAdjust(reagentId, dir); // immediate step on press
        scrubState = { reagentId, dir, startX: e.clientX, lastX: e.clientX, accum: 0, last: performance.now() };
        window.addEventListener('pointermove', onScrubMove);
        window.addEventListener('pointerup', endScrub);
        window.addEventListener('pointercancel', endScrub);
        scrubRaf = requestAnimationFrame(scrubTick);
    }
    function onScrubMove(e) {
        if (scrubState) scrubState.lastX = e.clientX;
    }
    function scrubTick(now) {
        const s = scrubState;
        if (!s) return;
        const dt = Math.min(120, now - s.last);
        s.last = now;
        // Cursor direction — not the pressed button — drives the sign while holding:
        // drag right of the start point increases, drag left decreases, and the rate
        // scales with how far you've dragged. Within a small deadzone around the start
        // it holds the pressed button's own direction at the base rate.
        const deltaX = s.lastX - s.startX;
        const DEADZONE = 4; // px
        let dir, rate;
        if (deltaX > DEADZONE) {
            dir = 1;
            rate = 7 + (deltaX - DEADZONE) * 0.4;
        } else if (deltaX < -DEADZONE) {
            dir = -1;
            rate = 7 + (-deltaX - DEADZONE) * 0.4;
        } else {
            dir = s.dir;
            rate = 7;
        }
        s.accum += rate * (dt / 1000);
        let n = Math.floor(s.accum);
        if (n > 0) {
            s.accum -= n;
            while (n-- > 0) onAdjust(s.reagentId, dir);
        }
        scrubRaf = requestAnimationFrame(scrubTick);
    }
    function endScrub() {
        scrubState = null;
        if (typeof window === 'undefined') return; // SSR teardown — nothing bound
        if (scrubRaf) {
            cancelAnimationFrame(scrubRaf);
            scrubRaf = null;
        }
        window.removeEventListener('pointermove', onScrubMove);
        window.removeEventListener('pointerup', endScrub);
        window.removeEventListener('pointercancel', endScrub);
    }
    onDestroy(endScrub);

    function downloadCSV() {
        const allReagents = REAGENT_GROUPS.flatMap(g => g.reagents);
        const header = ['Reagent', 'Unit', ...displayFormulations.map(bm => `${bm.name} (${bm.year})`)];
        const rows = allReagents.map(paperName => {
            const alias = REAGENT_ALIASES[paperName];
            const unit = alias?.unit ?? 'mM';
            const values = displayFormulations.map(bm => {
                const v = applyAll(bm).components[paperName];
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

    // 2D structure image from PubChem's name→PNG endpoint. Small molecules
    // resolve directly by common name; proteins/polymers/mixes carry mol:null
    // and get no image. The <img onerror> hides any name that fails to resolve.
    function molImageUrl(name) {
        return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/PNG?image_size=320x220`;
    }
    // PubChem lookup for the "learn more" link. Prefers the compound name used
    // for the 2D structure image; falls back to the wiki title as a search term
    // for proteins/mixtures that have no single small-molecule entry.
    function pubchemUrl(query) {
        return `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(query)}`;
    }

    // Currently-selected composition key. Clicking a column header or a fidelity
    // card sets this, which outlines the matching column in the table AND the
    // matching card in the fidelity section below (cyan). Header clicks also load
    // the formulation into the designer; fidelity-card clicks only select.
    let selectedKey = $state(null);
    const SEL_COLOR = '#4a5560';

    // Editing the live Custom Mix (designer sliders OR the in-table +/- steppers)
    // should drop the benchmark outline, since the composition no longer matches
    // the mix that was selected. We watch a signature of the custom-mix values:
    // the single change caused by loading a benchmark (flagged in selectColumn) is
    // skipped so the just-set outline survives its own load; any later change clears.
    let mixSig = $derived(
        JSON.stringify(Object.fromEntries(
            Object.entries(customMix ?? {}).map(([k, v]) => [k, v?.value ?? null])
        ))
    );
    let lastMixSig = '';            // non-reactive snapshot of the last seen signature
    let skipNextMixClear = false;   // set when a load is about to change the mix
    $effect(() => {
        const sig = mixSig;         // reactive dependency
        if (sig === lastMixSig) return;
        lastMixSig = sig;
        if (skipNextMixClear) { skipNextMixClear = false; return; }
        selectedKey = null;         // a genuine custom-mix edit → clear the outline
    });

    // Salt optima — override K(Glu) and Mg(Glu)2 across all formulations
    let saltOptima = $state('default');
    const SALT_OPTIMA = {
        default:         { label: 'Default',                  overrides: null },
        sfgfp:           { label: 'Target (sfGFP)',            overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.85 } },
        petase:          { label: 'Target (PETase)',           overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.85 } },
        reteplase:       { label: 'Target (Reteplase)',        overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.225 } }
    };
    function applyOptima(bm) {
        const { overrides } = SALT_OPTIMA[saltOptima] ?? SALT_OPTIMA.default;
        if (!overrides) return bm;
        return { ...bm, components: { ...bm.components, ...overrides } };
    }
    // Click-to-cycle through the salt-optima presets (Default → sfGFP → PETase →
    // Reteplase → Default), replacing the old dropdown.
    function cycleSaltOptima() {
        const keys = Object.keys(SALT_OPTIMA);
        const i = keys.indexOf(saltOptima);
        saltOptima = keys[(i + 1) % keys.length];
    }
    const saltOptimaLabel = $derived((SALT_OPTIMA[saltOptima] ?? SALT_OPTIMA.default).label);

    function formulationPaperGroup(bm) {
        if (bm.category === 'gpt5-autonomous')   return 'smith';
        if (bm.category === 'ginkgo-target')      return 'ginkgo-target';
        if (bm.year === 2026)                     return 'olsen';
        return 'historical';
    }

    const PAPER_GROUP_META = {
        historical:          { label: 'Literature',           color: 'rgba(122,133,144,0.10)'  },
        olsen:               { label: 'Olsen et al. 2026',    color: 'rgba(15,124,132,0.14)'   },
        smith:               { label: 'Smith et al. 2026',    color: 'rgba(111,75,208,0.14)'   },
        'ginkgo-target':     { label: 'Reference Plates',      color: 'rgba(96,141,199,0.16)'   }
    };

    // Column visibility toggles — all OFF by default, so the table opens showing
    // just the Custom Reaction. Enabling a group appends its columns on the right
    // (see displayFormulations), building leftward from the Custom Reaction.
    let showLiterature = $state(false);
    // Reference Plates start ENABLED so the table opens with the measured
    // reference columns next to the Custom Mix.
    let showReferencePlates = $state(true);
    // Ginkgo's autonomous (GPT-5 / "Smith et al.") reactions — grouped under a
    // single "Ginkgo" toggle so they can be collapsed out of the comparison.
    let showGinkgo = $state(false);
    // Comparison Mix customizer column — a view-only reference dropdown diffed
    // against the Custom Mix. Off by default (toggled via "Comparison"); the
    // Custom Mix column is always shown.
    let showComparison = $state(false);
    // Closest Match customizer column — off by default; this reveals the
    // auto-matched reference to the right of the customizer columns.
    let showClosestMatch = $state(false);

    // A plate sample loaded from the modal always shows the Comparison column, so
    // the just-loaded reference is visible without hunting for the toggle.
    $effect(() => {
        if (externalComparison) showComparison = true;
    });

    // Each Ginkgo target is followed by its best-yielding control-plate condition.
    const GINKGO_TARGET_ORDER = [
        'ginkgo-target-sfgfp',     'ginkgo-target-sfgfp-best',
        'ginkgo-target-petase',    'ginkgo-target-petase-best',
        'ginkgo-target-reteplase', 'ginkgo-target-reteplase-best'
    ];

    // Reference plates offered as Comparison-Mix options (declared after
    // GINKGO_TARGET_ORDER to avoid a TDZ under SSR's eager derived eval).
    const COMPARISON_REFERENCE_OPTIONS = $derived(
        GINKGO_TARGET_ORDER
            .map((k) => benchmarkFormulations.find((b) => b.key === k))
            .filter(Boolean)
    );

    // Derived display list. The Custom Reaction now sits on the LEFT (immediately
    // right of the reagent names); enabled reference groups append to ITS right,
    // nearest-first in Show-button order: Reference Plates hug the Custom Reaction,
    // then Ginkgo, then Literature farthest right.
    const displayFormulations = $derived.by(() => {
        const out = [];
        // Reference Plates — nearest the Custom Reaction.
        if (showReferencePlates) {
            out.push(...GINKGO_TARGET_ORDER
                .map(k => benchmarkFormulations.find(b => b.key === k))
                .filter(Boolean));
        }
        // Ginkgo autonomous (GPT-5 / Smith et al.).
        if (showGinkgo) {
            out.push(...benchmarkFormulations.filter(bm => formulationPaperGroup(bm) === 'smith'));
        }
        // Literature = historical papers (incl. PANOx-SP) + Olsen et al. — farthest right.
        if (showLiterature) {
            out.push(...benchmarkFormulations.filter(bm => {
                const g = formulationPaperGroup(bm);
                return g === 'historical' || g === 'olsen';
            }));
        }
        return out;
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
        const next = selectedKey === bm.key ? null : bm.key;
        selectedKey = next;
        // A header click also loads the formulation (handleLoad), which changes the
        // custom mix once. Don't let that one change immediately clear the outline.
        skipNextMixClear = next != null;
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

    // Soft catalyst washes: pale tints of the blueprint data palette over the
    // light surface. Ink text reads clearly on all five tints; borders use the
    // same hue at higher alpha so cells read as an understated engineering grid.
    function feasibilityCellStyle(feas) {
        if (feas.status === 'ok')            return { bg: 'rgba(47, 143, 78, 0.18)',  border: 'rgba(47, 143, 78, 0.42)',  text: 'oklch(var(--bc))' };
        if (feas.status === 'tight')         return { bg: 'rgba(189, 111, 22, 0.20)', border: 'rgba(189, 111, 22, 0.48)', text: 'oklch(var(--bc))' };
        if (feas.status === 'very-tight')    return { bg: 'rgba(192, 57, 43, 0.20)',  border: 'rgba(192, 57, 43, 0.5)',   text: 'oklch(var(--bc))' };
        // Base buffer alone meets/exceeds the target — no supplement needed.
        if (feas.status === 'over-baseline') return { bg: 'rgba(15, 124, 132, 0.16)', border: 'rgba(15, 124, 132, 0.44)', text: 'oklch(var(--bc))' };
        // "missing" = paper reagent not in our inventory. Rendered as theoretical
        // (petase/violet) so it reads as "you'd need to buy this" not "N/A".
        return { bg: 'rgba(111, 75, 208, 0.15)', border: 'rgba(111, 75, 208, 0.42)', text: 'oklch(var(--bc))' };
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

    function inventoryLabel(paperName) {
        const a = REAGENT_ALIASES[paperName];
        if (!a?.ids) return 'not in stock';
        return a.ids.join(' + ');
    }

    // Click-to-exclude reagents — clicking a reagent name zeroes it out of all
    // formulations and recalculates feasibility. Click again to re-enable.
    let excludedReagents = $state(new Set());
    function toggleReagentExclusion(paperName) {
        const next = new Set(excludedReagents);
        if (next.has(paperName)) next.delete(paperName); else next.add(paperName);
        excludedReagents = next;
    }

    function applyExclusions(bm) {
        if (excludedReagents.size === 0) return bm;
        const components = { ...bm.components };
        for (const name of excludedReagents) delete components[name];
        return { ...bm, components };
    }

    function applyAll(bm) { return applyExclusions(applyOptima(bm)); }

    // Selected Comparison Mix, with the same optima/exclusions applied as the rest
    // of the table. Declared here (not with the other customizer state up top) so
    // its eager SSR evaluation happens after SALT_OPTIMA / applyAll are defined.
    const comparisonBm = $derived.by(() => {
        // A plate sample picked in the modal overrides the dropdown selection.
        if (externalComparison) return applyAll(externalComparison);
        const bm =
            benchmarkFormulations.find((b) => b.key === comparisonKey) ??
            communityFormulations.find((b) => b.key === comparisonKey) ??
            COMPARISON_OPTIONS[0];
        return bm ? applyAll(bm) : null;
    });

    // Every formulation an added column can resolve to: the static benchmarks plus
    // the community submissions. Keyed so a dropdown value maps straight to its mix.
    const allFormulationsByKey = $derived.by(() => {
        const map = new Map();
        for (const bm of benchmarkFormulations) map.set(bm.key, bm);
        for (const bm of communityFormulations) map.set(bm.key, bm);
        return map;
    });
    // Resolved added columns — { key, bm } with the same optima/exclusions the rest
    // of the table applies. bm is null if a key no longer exists (e.g. a community
    // submission was removed from the DB), which renders as an empty column.
    const addedColumns = $derived(
        addedColumnKeys.map((key) => {
            const raw = allFormulationsByKey.get(key);
            return { key, bm: raw ? applyAll(raw) : null };
        })
    );

    // ─── Closest match ────────────────────────────────────────────────────────
    // Which known reaction the live Custom Mix most resembles. For every candidate
    // formulation we score agreement reagent-by-reagent over the union of reagents
    // used by either side: each shared reagent contributes 1 − |a−b|/max(a,b)
    // (1 = identical, 0 = one side is zero / very different), averaged. A reagent
    // present in only one mix scores 0, so missing/extra reagents penalise the
    // match. Declared after applyAll for the same SSR eager-eval reason as above.
    function similarityScore(customComponents, candidateComponents) {
        const names = new Set([
            ...Object.keys(customComponents),
            ...Object.keys(candidateComponents)
        ]);
        let agree = 0;
        let n = 0;
        for (const name of names) {
            const a = customComponents[name] ?? 0;
            const b = candidateComponents[name] ?? 0;
            if (a === 0 && b === 0) continue;
            const hi = Math.max(a, b);
            agree += hi > 0 ? 1 - Math.abs(a - b) / hi : 0;
            n += 1;
        }
        return n ? agree / n : 0;
    }
    const closestMatch = $derived.by(() => {
        // Flatten the Custom Mix into { paperName: value } over reagents actually dosed.
        const customComponents = {};
        for (const [name, cm] of Object.entries(customMix ?? {})) {
            if (cm?.value != null && cm.value > 0) customComponents[name] = cm.value;
        }
        if (Object.keys(customComponents).length === 0) return null;
        let best = null;
        for (const bm of benchmarkFormulations) {
            const score = similarityScore(customComponents, applyAll(bm).components);
            if (!best || score > best.score) best = { bm, score };
        }
        return best;
    });
    // Per-reagent values of the closest match, so the column can render like a
    // (auto-selected) comparison column beneath its named header.
    const closestComponents = $derived(closestMatch ? applyAll(closestMatch.bm).components : null);
    const closestName = $derived(closestMatch ? splitName(closestMatch.bm.name).main : null);

    function handleLoad(bm) {
        if (typeof onLoad === 'function') onLoad(applyAll(bm));
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
        if (waterNl < -25)  return { bg: 'rgba(192, 57, 43, 0.22)', border: 'rgba(192, 57, 43, 0.5)',  text: 'oklch(var(--bc))' };
        if (waterNl <= 0)   return { bg: 'rgba(192, 57, 43, 0.11)', border: 'rgba(192, 57, 43, 0.3)',  text: 'oklch(var(--bc))' };
        return { bg: 'rgba(47, 143, 78, 0.18)', border: 'rgba(47, 143, 78, 0.42)', text: 'oklch(var(--bc))' };
    }

    // ── persist the designer's view toggles across refreshes (localStorage) ──────
    // Which comparison columns / coloring / excluded reagents are shown is part of
    // the user's in-progress work, so it survives a refresh. `togglesRestored` gates
    // the save effect so defaults can't overwrite the saved snapshot before restore.
    // Bump the version suffix whenever the default toggle set changes, so returning
    // browsers discard a stale snapshot and pick up the new defaults (v2: Reference
    // Plates now default-on, Comparison Mix now a default-off toggle).
    const TOGGLES_STATE_KEY = 'cfps:designer-toggles:v2';
    let togglesRestored = $state(false);

    onMount(() => {
        try {
            const raw = localStorage.getItem(TOGGLES_STATE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (s && typeof s === 'object') {
                    if (typeof s.comparisonKey === 'string') comparisonKey = s.comparisonKey;
                    if (typeof s.saltOptima === 'string') saltOptima = s.saltOptima;
                    if (typeof s.showLiterature === 'boolean') showLiterature = s.showLiterature;
                    if (typeof s.showReferencePlates === 'boolean') showReferencePlates = s.showReferencePlates;
                    if (typeof s.showGinkgo === 'boolean') showGinkgo = s.showGinkgo;
                    if (typeof s.showComparison === 'boolean') showComparison = s.showComparison;
                    if (typeof s.showClosestMatch === 'boolean') showClosestMatch = s.showClosestMatch;
                    if (typeof s.showSupplementNl === 'boolean') showSupplementNl = s.showSupplementNl;
                    if (Array.isArray(s.excludedReagents)) excludedReagents = new Set(s.excludedReagents);
                    if (Array.isArray(s.addedColumnKeys)) addedColumnKeys = s.addedColumnKeys.filter((k) => typeof k === 'string');
                }
            }
        } catch { /* ignore corrupt or unavailable storage */ }
        togglesRestored = true;
    });

    $effect(() => {
        // Read every persisted toggle so the effect re-runs when any of them change.
        const snapshot = {
            comparisonKey,
            saltOptima,
            showLiterature,
            showReferencePlates,
            showGinkgo,
            showComparison,
            showClosestMatch,
            showSupplementNl,
            excludedReagents: Array.from(excludedReagents),
            addedColumnKeys
        };
        if (!togglesRestored) return; // don't clobber the saved snapshot before restore
        try { localStorage.setItem(TOGGLES_STATE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
    });

</script>

<section class="mt-2 mb-4">
    <!-- Drag handle pinned to a header cell's right edge: drag to resize the column,
         double-click to restore its default width. The host <th> is position:relative
         (or sticky) so this absolute handle rides its right border. -->
    {#snippet colResizeHandle(id, def, floor, max)}
        <span
            class="bench-resize"
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize · double-click to reset"
            onpointerdown={(e) => startColResize(e, id, def, floor, max)}
            ondblclick={() => resetColWidth(id)}
        ></span>
    {/snippet}
    <!-- Supplement-volume sub-line (Details view): the snapped Echo transfer nL to
         hit `value` for this reagent, computed with the same feasibilityFor model
         as the data columns so numbers line up across the whole row. -->
    {#snippet nlLine(paperName, value)}
        {@const feas = feasibilityFor(paperName, value)}
        {#if feas.status === 'over-baseline'}
            <div class="text-[8px] opacity-50" title="Base buffer already meets target — no supplement needed">0 nL</div>
        {:else if feas.status === 'ok' || feas.status === 'tight' || feas.status === 'very-tight'}
            <div class="text-[8px] opacity-50" title={`Exact ${feas.neededNl} nL → snapped to ${feas.snappedNl} nL (25 nL Echo resolution)`}>{feas.snappedNl} nL</div>
        {:else}
            <div class="text-[8px] opacity-30">—</div>
        {/if}
    {/snippet}
    <!-- Reference-column cell body: a concentration plus its signed % vs the live
         Custom Mix (the reference we now diff everything against), and — in the
         Details view — its supplement nL. Shared by the Comparison Mix and Closest
         Match columns so both read identically. -->
    {#snippet refValueDelta(paperName, refValue)}
        {#if refValue != null}
            {@const pct = pctVsCustom(paperName, refValue)}
            <div class="opacity-80 leading-tight">{fmt(refValue)}</div>
            {#if showSupplementNl}
                <!-- % difference vs the Custom Mix only shows in Details mode -->
                <div class="text-[8px] leading-tight {pctClass(pct)}">{pctLabel(pct)}</div>
                {@render nlLine(paperName, refValue)}
            {/if}
        {:else}
            <span class="opacity-30">—</span>
        {/if}
    {/snippet}
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
    <!-- The table is its own rounded, bordered card (the section is now just a
         transparent spacing wrapper — no white background). overflow-auto clips the
         opaque sticky cells to all four rounded corners. w-fit + max-w-full makes the
         card hug the table's own width (no white side gutters) but still scroll when
         the grid is wider than the viewport. Radius tracks var(--r) to match the
         sibling .panel sections; bg-base-100 keeps the grid opaque. -->
    <div class="pb-3 pr-3 overflow-auto max-h-[78vh] isolate rounded-[var(--r,5px)] border border-base-300 bg-base-100 w-fit max-w-full mx-auto" bind:this={tableScrollEl}>
        <!-- Flex rail wrapper: the table plus a thin full-height "add column" button
             pinned to its right edge, so you can add a comparison column the moment
             you scroll to the edge. -->
        <div class="flex items-stretch w-max mx-auto">
            <!-- border-separate (not collapse): collapse breaks position:sticky on
                 the thead (ghost/duplicate rows) and drops per-cell box-shadows.
                 Separated borders with 0 spacing render identically but make the
                 sticky header + frozen columns + seam shadows reliable. -->
            <table class="self-start text-[11px] border-separate border-spacing-0">
                <!-- One <col> per column, in visual order, so a single width value
                     sizes every cell in a column (header + body + summary rows).
                     The group column and the reference/literature columns keep their
                     content-driven sizing; the customizer columns are drag-resizable
                     via colWidths (see startColResize / colResizeHandle). -->
                <colgroup>
                    <col style="width: 32px;" />
                    <col style={colColStyle('rcol', COL_DEFAULTS.rcol)} />
                    <col style={colColStyle('custom', COL_DEFAULTS.custom)} />
                    {#if showComparison}
                        <col style={colColStyle('comparison', COL_DEFAULTS.comparison)} />
                    {/if}
                    {#if showClosestMatch}
                        <col style={colColStyle('closest', COL_DEFAULTS.closest)} />
                    {/if}
                    {#each addedColumns as _col, i (i)}
                        <col style={colColStyle('added:' + i, COL_DEFAULTS.custom)} />
                    {/each}
                    {#each displayFormulations as bm (bm.key)}
                        <col />
                    {/each}
                </colgroup>
                <!-- z-50: header sits above the sticky-left body columns (z-30/z-40)
                     so it covers them when scrolling down. `isolate` on the wrapper
                     scopes this z-index so it can't fight the page preset bar. -->
                <thead class="sticky top-0 z-50 bg-base-200">
                    <!-- Paper-group header row — only when reference formulation
                         columns are shown. With just the Custom/Comparison mixes it
                         would be an empty spanning row that reads as a stray line
                         above the header, so skip it entirely then. -->
                    {#if displayColumnGroups.length}
                        <tr class="text-[9px]">
                            <th
                                colspan="2"
                                class="sticky left-0 z-40"
                                style="background: oklch(var(--b2)); "
                            ></th>
                            <!-- Customizer columns (Custom Mix · Comparison Mix ·
                                 optional Closest Match) sit immediately right of the
                                 reagent names; enabled reference groups append to their
                                 right. No group label — these blank cells just blend
                                 with the header surface. The Custom Mix spacer is frozen
                                 so it stays above the sticky Custom column; the rest scroll. -->
                            <th
                                class="bench-vsep bench-custcol border-b"
                                style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2)); border-color: oklch(var(--bc) / 0.12);"
                            ></th>
                            {#if (showComparison ? 1 : 0) + (showClosestMatch ? 1 : 0) + addedColumns.length > 0}
                                <th
                                    colspan={(showComparison ? 1 : 0) + (showClosestMatch ? 1 : 0) + addedColumns.length}
                                    class="border-b"
                                    style="background: oklch(var(--b2)); border-color: oklch(var(--bc) / 0.12);"
                                ></th>
                            {/if}
                            {#each displayColumnGroups as grp}
                                {@const meta = PAPER_GROUP_META[grp.group]}
                                <th
                                    colspan={grp.count}
                                    class="text-center px-1 py-0.5 font-bold uppercase tracking-widest border-b"
                                    style="background: {meta.color}; border-color: oklch(var(--bc) / 0.12); color: oklch(var(--bc) / 0.65); letter-spacing: 0.08em;"
                                >{meta.label}</th>
                            {/each}
                        </tr>
                    {/if}
                    <tr>
                        <!-- Corner cell spans both the rotated group-label column AND
                             the reagent-name column. Intentionally empty + fully opaque
                             (no element-level opacity) so scrolling value cells can't
                             show through it. -->
                        <th
                            colspan="2"
                            class="bench-corner border-b border-base-300 sticky left-0 z-40"
                            style="min-width: 182px; background: oklch(var(--b2)); "
                        >{@render colResizeHandle('rcol', COL_DEFAULTS.rcol, COL_FLOOR.rcol, COL_MAX.rcol)}</th>
                        <!-- Custom Mix — the live design, and the baseline every
                             reference column is diffed against. Leftmost customizer
                             column, immediately right of the reagent names. -->
                        <th class="bench-vsep bench-custcol text-center px-2 py-2 border-b border-base-300 align-top" style="--cust-left: {customStickyLeft}px; min-width: 64px; background: oklch(var(--b2));">
                            <div class="flex items-start justify-center gap-1 min-h-[2.4em]">
                                <div class="font-semibold text-[10px] leading-tight">Custom Mix</div>
                                {#if onReset}
                                    <button
                                        type="button"
                                        class="cust-reset"
                                        onclick={() => onReset()}
                                        title="Reset the Custom Mix to the starting composition"
                                        aria-label="Reset Custom Mix"
                                    >↺</button>
                                {/if}
                            </div>
                            <!-- Starting-composition picker. Loads a recipe into the live
                                 design + re-baselines; once edited, the select shows a
                                 "Custom" sentinel until the design matches the start again. -->
                            <select
                                class="text-center text-[9px] rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1 py-0.5 mt-1"
                                style="width: 100%; min-width: 0; max-width: 88px; text-overflow: ellipsis;"
                                value={customIsCustomized ? '__custom__' : customStartKey}
                                onchange={(e) => { const k = e.currentTarget.value; if (k !== '__custom__') onSetCustomStart?.(k); }}
                                title="Starting composition — pick a recipe to load into the Custom Mix"
                            >
                                {#if customIsCustomized}
                                    <option value="__custom__">Custom</option>
                                {/if}
                                <optgroup label="Reference plates">
                                    {#each COMPARISON_REFERENCE_OPTIONS as opt}
                                        <option value={opt.key}>{opt.name}</option>
                                    {/each}
                                </optgroup>
                                <optgroup label="Literature / models">
                                    {#each COMPARISON_OPTIONS as opt}
                                        <option value={opt.key}>{opt.name} ({opt.year})</option>
                                    {/each}
                                </optgroup>
                                {#if communityFormulations.length}
                                    <optgroup label="Community">
                                        {#each communityFormulations as opt}
                                            <option value={opt.key}>{opt.name}</option>
                                        {/each}
                                    </optgroup>
                                {/if}
                            </select>
                            {@render colResizeHandle('custom', COL_DEFAULTS.custom, COL_FLOOR.value, COL_MAX.value)}
                        </th>
                        <!-- Comparison Mix header holds the view-only reference
                             dropdown; sits right of the Custom Mix. Off by default
                             (toggled via "Comparison"). -->
                        {#if showComparison}
                        <th class="relative text-center px-2 py-2 border-b border-base-300 align-top" style="min-width: 64px; background: oklch(var(--b2));">
                            <div class="flex items-start justify-center gap-1 min-h-[2.4em]">
                                <div class="font-semibold text-[10px] leading-tight">Comparison Mix</div>
                                {#if externalComparison}
                                    <button
                                        type="button"
                                        class="cust-reset"
                                        onclick={() => onClearExternalComparison?.()}
                                        title="Clear the plate sample and return to the dropdown reference"
                                        aria-label="Clear plate sample comparison"
                                    >✕</button>
                                {/if}
                            </div>
                            {#if externalComparison}
                                <!-- Plate sample loaded from the modal's ranked-titers chart.
                                     The dropdown is replaced by the sample name until cleared. -->
                                <div class="text-[9px] leading-tight mt-1 font-semibold" style="color: #4a5560;" title={externalComparison.citation || externalComparison.name}>
                                    {externalComparison.name}
                                </div>
                                <div class="text-[8px] opacity-55 leading-tight">plate sample</div>
                            {:else}
                                <select
                                    class="text-center text-[9px] rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1 py-0.5 mt-1"
                                    style="width: 100%; min-width: 0; max-width: 80px; text-overflow: ellipsis;"
                                    bind:value={comparisonKey}
                                    title="Reference formulation to diff the Custom Mix against"
                                >
                                    <optgroup label="Reference plates">
                                        {#each COMPARISON_REFERENCE_OPTIONS as opt}
                                            <option value={opt.key}>{opt.name}</option>
                                        {/each}
                                    </optgroup>
                                    <optgroup label="Literature / models">
                                        {#each COMPARISON_OPTIONS as opt}
                                            <option value={opt.key}>{opt.name} ({opt.year})</option>
                                        {/each}
                                    </optgroup>
                                    {#if communityFormulations.length}
                                        <optgroup label="Community">
                                            {#each communityFormulations as opt}
                                                <option value={opt.key}>{opt.name}</option>
                                            {/each}
                                        </optgroup>
                                    {/if}
                                </select>
                            {/if}
                            {@render colResizeHandle('comparison', COL_DEFAULTS.comparison, COL_FLOOR.value, COL_MAX.value)}
                        </th>
                        {/if}
                        <!-- Closest Match (optional): the known reaction the live
                             Custom Mix most resembles, auto-computed. Header names it
                             + similarity %; the body cells render its per-reagent
                             values. Off by default (toggled via "Closest Match"). -->
                        {#if showClosestMatch}
                            <th class="relative text-center px-2 py-2 border-b border-base-300 align-top" style="min-width: 64px; background: oklch(var(--b2));">
                                <div class="font-semibold text-[10px] leading-tight">Closest Match</div>
                                {#if closestMatch}
                                    <div class="text-[9px] leading-tight mt-0.5 font-semibold" style="color: #4a5560;">{closestName}</div>
                                    <div class="text-[9px] opacity-55 leading-tight">{(closestMatch.score * 100).toFixed(0)}% similar</div>
                                {:else}
                                    <div class="text-[9px] opacity-55 leading-tight mt-0.5">design a mix</div>
                                {/if}
                                {@render colResizeHandle('closest', COL_DEFAULTS.closest, COL_FLOOR.value, COL_MAX.value)}
                            </th>
                        {/if}
                        <!-- User-added comparison columns. Each carries its own picker
                             (reference plates · literature · community) and a remove ✕,
                             and diffs against the live Custom Mix exactly like the
                             Comparison Mix column. -->
                        {#each addedColumns as col, i (i)}
                            <th class="relative text-center px-2 py-2 border-b border-base-300 align-top" style="min-width: 64px; background: oklch(var(--b2));">
                                <div class="flex items-start justify-center gap-1 min-h-[2.4em]">
                                    <div class="font-semibold text-[10px] leading-tight">Compare</div>
                                    <button
                                        type="button"
                                        class="cust-reset"
                                        onclick={() => removeComparisonColumn(i)}
                                        title="Remove this comparison column"
                                        aria-label="Remove comparison column"
                                    >✕</button>
                                </div>
                                <select
                                    class="text-center text-[9px] rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1 py-0.5 mt-1"
                                    style="width: 100%; min-width: 0; max-width: 80px; text-overflow: ellipsis;"
                                    value={col.key}
                                    onchange={(e) => setAddedColumn(i, e.currentTarget.value)}
                                    title="Composition to compare against the Custom Mix"
                                >
                                    <optgroup label="Reference plates">
                                        {#each COMPARISON_REFERENCE_OPTIONS as opt}
                                            <option value={opt.key}>{opt.name}</option>
                                        {/each}
                                    </optgroup>
                                    <optgroup label="Literature / models">
                                        {#each COMPARISON_OPTIONS as opt}
                                            <option value={opt.key}>{opt.name} ({opt.year})</option>
                                        {/each}
                                    </optgroup>
                                    {#if communityFormulations.length}
                                        <optgroup label="Community">
                                            {#each communityFormulations as opt}
                                                <option value={opt.key}>{opt.name}</option>
                                            {/each}
                                        </optgroup>
                                    {/if}
                                </select>
                                {@render colResizeHandle('added:' + i, COL_DEFAULTS.custom, COL_FLOOR.value, COL_MAX.value)}
                            </th>
                        {/each}
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
                                            ? 'color: #2f8f4e;'
                                            : (stk.missing >= stk.total / 2
                                                ? 'color: #6f4bd0;'
                                                : 'color: #bd6f16;')}
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
                        <td class="bench-vsep bench-custcol text-center py-1 font-mono" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-30">—</span></td>
                        {#if showComparison}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{comparisonBm?.yield_g_l?.toFixed(2) ?? '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.yield_g_l?.toFixed(2) ?? '—'}</span></td>
                        {/if}
                        {#each addedColumns as col}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{col.bm?.yield_g_l != null ? col.bm.yield_g_l.toFixed(2) : '—'}</span></td>
                        {/each}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">{bm.yield_g_l?.toFixed(2) ?? '—'}</span></td>
                        {/each}
                    </tr>
                    {#if showSupplementNl}
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">$/g protein</span></td>
                        <td class="bench-vsep bench-custcol text-center py-1 font-mono" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-30">—</span></td>
                        {#if showComparison}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">${comparisonBm?.cost_per_g?.toLocaleString() ?? '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.cost_per_g != null ? '$' + closestMatch.bm.cost_per_g.toLocaleString() : '—'}</span></td>
                        {/if}
                        {#each addedColumns as col}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{col.bm?.cost_per_g != null ? '$' + col.bm.cost_per_g.toLocaleString() : '—'}</span></td>
                        {/each}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">${bm.cost_per_g?.toLocaleString() ?? '—'}</span></td>
                        {/each}
                    </tr>
                    <!-- Direct reagent cost per mL of reaction. The Custom Mix cell is
                         computed live by the parent from the current design volumes ×
                         per-mL catalog costs (autonomous-cfps models.py); reference
                         columns show each formulation's published cost_per_l ÷ 1000. -->
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">reagent cost ($/mL)</span></td>
                        <td class="bench-vsep bench-custcol text-center py-1 font-mono" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2));" title={customCostUsd != null ? `≈ ${fmtCost(customCostUsd)} per reaction as mixed` : ''}><span class="opacity-90" style="color: oklch(var(--bc));">{fmtCost(customCostPerMl)}</span></td>
                        {#if showComparison}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{comparisonBm?.cost_per_l != null ? fmtCost(comparisonBm.cost_per_l / 1000) : '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.cost_per_l != null ? fmtCost(closestMatch.bm.cost_per_l / 1000) : '—'}</span></td>
                        {/if}
                        {#each addedColumns as col}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{col.bm?.cost_per_l != null ? fmtCost(col.bm.cost_per_l / 1000) : '—'}</span></td>
                        {/each}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">{bm.cost_per_l != null ? fmtCost(bm.cost_per_l / 1000) : '—'}</span></td>
                        {/each}
                    </tr>
                    <!-- Direct reagent cost of a single 20 µL reaction — the same
                         basis as $/mL scaled to one reaction so you can read the
                         per-reaction price directly. Custom uses the parent's live
                         per-reaction figure (customCostUsd); reference columns scale
                         cost_per_l to 20 µL (× 20e-6 L = ÷ 50,000). -->
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">reagent cost ($/20µL)</span></td>
                        <td class="bench-vsep bench-custcol text-center py-1 font-mono" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2));" title={customCostUsd != null ? `≈ ${fmtCost(customCostUsd)} per 20 µL reaction (as mixed)` : ''}><span class="opacity-90" style="color: oklch(var(--bc));">{fmtCost(customCostUsd)}</span></td>
                        {#if showComparison}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{comparisonBm?.cost_per_l != null ? fmtCost(comparisonBm.cost_per_l / 50000) : '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.cost_per_l != null ? fmtCost(closestMatch.bm.cost_per_l / 50000) : '—'}</span></td>
                        {/if}
                        {#each addedColumns as col}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-70">{col.bm?.cost_per_l != null ? fmtCost(col.bm.cost_per_l / 50000) : '—'}</span></td>
                        {/each}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">{bm.cost_per_l != null ? fmtCost(bm.cost_per_l / 50000) : '—'}</span></td>
                        {/each}
                    </tr>
                    {/if}
                </thead>
                <!-- Supplement-nL rendering is toggled by the "Details" button in
                     the Show controls below the table (default off = concentrations
                     only). Cell tooltips (title on hover) are always available. -->
                <tbody>
                    {#each REAGENT_GROUPS as group, groupIndex}
                        {#each group.reagents as paperName, reagentIndex}
                            {@const alias = REAGENT_ALIASES[paperName]}
                            {@const missing = !alias?.ids}
                            {@const isGroupFirstRow = reagentIndex === 0}
                            <!-- Category-group boundary: the first reagent row of each
                                 group (after the first) gets a stronger full-width top
                                 hairline via the .bench-grp class (see <style>). Every
                                 row also gets a faint bottom hairline so rows are easy
                                 to track across the wide grid. -->
                            {@const hasRecipe = REAGENTS_WITH_RECIPE.has(alias?.ids?.[0])}
                            {@const limsUrl = alias?.ids ? limsUrlForReagentId(alias.ids[0]) : null}
                            {@const isCustom = !!(alias?.ids && CUSTOM_REAGENT_IDS.has(alias.ids[0]))}
                            {@const isExcluded = excludedReagents.has(paperName)}
                            {@const compVal = comparisonBm?.components?.[paperName]}
                            {@const cm = customMix?.[paperName]}
                            <tr class="hover:bg-base-200/30 transition" class:bench-grp={isGroupFirstRow && groupIndex > 0}>
                                {#if isGroupFirstRow}
                                    <!-- Rotated group-label column. z-40 so it sits above value
                                         cells during any scroll state. -->
                                    <td
                                        rowspan={group.reagents.length}
                                        class="bench-gcol sticky left-0 z-40 text-center align-middle uppercase tracking-widest text-[10px] font-semibold"
                                        style="background: oklch(var(--b3)); width: 32px; min-width: 32px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 6px 0;"
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
                                    class="bench-rcol px-3 py-1 sticky z-30 whitespace-nowrap cursor-pointer select-none"
                                    style="left: 31px; min-width: 150px; background: oklch(var(--b2));"
                                    onclick={(e) => { e.stopPropagation(); toggleReagentExclusion(paperName); }}
                                    title={isExcluded ? `Click to re-enable ${paperName}` : `Click to exclude ${paperName} from calculations`}
                                >
                                    <div class="flex items-center gap-1.5 flex-wrap" class:opacity-35={isExcluded} class:line-through={isExcluded}>
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
                                                style="color: #6f4bd0;"
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
                                <!-- ── Customizer cells: Custom (baseline) / Comparison / Closest ──
                                     Sit immediately right of the reagent name; enabled
                                     reference data columns append to their right. -->
                                <td class="bench-vsep bench-custcol text-center px-1 py-1 font-mono leading-tight" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b1));">
                                    {#if cm && cm.value != null}
                                        {#if cm.adjustable && onAdjust}
                                            {@const isZero = cm.value === 0}
                                            <div class="cust-cell" class:cust-cell--zero={isZero} class:cust-cell--active={!isZero}>
                                                <button class="cust-step" onpointerdown={(e) => startScrub(e, cm.reagentId, -1)} onclick={(e) => stepClick(e, cm.reagentId, -1)} disabled={!cm.canDec} aria-label={`Decrease ${paperName}`}>−</button>
                                                <span class="cust-val">{#if isZero}—{:else}{fmt(cm.value)}{/if}</span>
                                                <button class="cust-step" onpointerdown={(e) => startScrub(e, cm.reagentId, 1)} onclick={(e) => stepClick(e, cm.reagentId, 1)} disabled={!cm.canInc} aria-label={`Increase ${paperName}`}>+</button>
                                            </div>
                                        {:else}
                                            <span class="opacity-80">{fmt(cm.value)}</span>
                                        {/if}
                                        {#if showSupplementNl && cm.value}{@render nlLine(paperName, cm.value)}{/if}
                                    {:else}
                                        <span class="opacity-30">—</span>
                                    {/if}
                                </td>
                                {#if showComparison}
                                    <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                        {@render refValueDelta(paperName, compVal)}
                                    </td>
                                {/if}
                                {#if showClosestMatch}
                                    <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                        {@render refValueDelta(paperName, closestComponents?.[paperName])}
                                    </td>
                                {/if}
                                {#each addedColumns as col}
                                    <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                        {@render refValueDelta(paperName, col.bm?.components?.[paperName])}
                                    </td>
                                {/each}
                                {#each displayFormulations as bm}
                                    {@const val = applyAll(bm).components[paperName]}
                                    {@const isSel = selectedKey === bm.key}
                                    {#if val == null}
                                        <!-- Reagent unused in this formulation — leave the cell blank
                                             (but still draw the column outline through it when selected). -->
                                        <td style="background: oklch(var(--b2)); box-shadow: {colOutline(isSel)};"></td>
                                    {:else}
                                        {@const feas = feasibilityFor(paperName, val)}
                                        {@const style = feasibilityCellStyle(feas)}
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
                                                        0 nL
                                                    </div>
                                                {:else if feas.status === 'ok' || feas.status === 'tight' || feas.status === 'very-tight'}
                                                    <div class="text-[8px] opacity-70" title={`Exact ${feas.neededNl} nL → snapped to ${feas.snappedNl} nL (25 nL Echo resolution)`}>
                                                        {feas.snappedNl} nL
                                                    </div>
                                                    {#if !bm.echoNative && Math.abs(feas.deviationPct) >= 0.05}
                                                        <div
                                                            class="text-[8px] font-semibold"
                                                            style="color: {Math.abs(feas.deviationPct) >= 5 ? '#bd6f16' : 'oklch(var(--bc) / 0.85)'};"
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
                    <tr class="hover:bg-base-200/30 transition bench-grp">
                        <td
                            class="bench-gcol sticky left-0 z-40 text-center align-middle uppercase tracking-widest text-[10px] font-semibold"
                            style="background: oklch(var(--b3)); width: 32px; min-width: 32px; writing-mode: vertical-rl; transform: rotate(180deg); padding: 6px 0; border-right: 1px solid oklch(var(--b3));"
                        >
                            <span class="opacity-70">Water</span>
                        </td>
                        <td
                            class="bench-rcol px-3 py-1 sticky z-30 whitespace-nowrap"
                            style="left: 31px; min-width: 150px; background: oklch(var(--b2));"
                        >
                            <div>Water</div>
                        </td>
                        <!-- ── Customizer cells (water): Custom / Comparison / Closest ── -->
                        <td class="bench-vsep bench-custcol text-center px-1 py-1 font-mono" style="--cust-left: {customStickyLeft}px; background: oklch(var(--b1));">{#if customWaterUl != null}<span class="opacity-80">{customWaterUl.toFixed(2)}</span>{:else}<span class="opacity-30">—</span>{/if}</td>
                        {#if showComparison}
                            {#if comparisonBm}
                                {@const compWaterUl = waterFillNlForFormulation(comparisonBm) / 1000}
                                {@const compWaterPct = pctDiff(compWaterUl, customWaterUl)}
                                <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                    <div class="opacity-80 leading-tight">{compWaterUl.toFixed(2)}</div>
                                    {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(compWaterPct)}">{pctLabel(compWaterPct)}</div>{/if}
                                </td>
                            {:else}
                                <td class="text-center px-1 py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-30">—</span></td>
                            {/if}
                        {/if}
                        {#if showClosestMatch}
                            {@const closestWaterUl = closestMatch ? waterFillNlForFormulation(applyAll(closestMatch.bm)) / 1000 : null}
                            <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                {#if closestWaterUl != null}
                                    {@const closestWaterPct = pctDiff(closestWaterUl, customWaterUl)}
                                    <div class="opacity-80 leading-tight">{closestWaterUl.toFixed(2)}</div>
                                    {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(closestWaterPct)}">{pctLabel(closestWaterPct)}</div>{/if}
                                {:else}<span class="opacity-30">—</span>{/if}
                            </td>
                        {/if}
                        {#each addedColumns as col}
                            {#if col.bm}
                                {@const colWaterUl = waterFillNlForFormulation(col.bm) / 1000}
                                {@const colWaterPct = pctDiff(colWaterUl, customWaterUl)}
                                <td class="text-center px-1 py-1 font-mono leading-tight" style="background: oklch(var(--b2));">
                                    <div class="opacity-80 leading-tight">{colWaterUl.toFixed(2)}</div>
                                    {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(colWaterPct)}">{pctLabel(colWaterPct)}</div>{/if}
                                </td>
                            {:else}
                                <td class="text-center px-1 py-1 font-mono" style="background: oklch(var(--b2));"><span class="opacity-30">—</span></td>
                            {/if}
                        {/each}
                        {#each displayFormulations as bm}
                            {@const waterNl = waterFillNlForFormulation(applyAll(bm))}
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
            <!-- Full-height rail: click anywhere along it to append a comparison
                 column (defaults to the sfGFP target composition). -->
            <button
                type="button"
                class="add-col-rail"
                onclick={addComparisonColumn}
                title="Add a comparison column"
                aria-label="Add a comparison column"
            >
                <span class="add-col-rail__plus">＋</span>
            </button>
        </div>
        </div>

    <div class="flex flex-col items-center gap-2 px-3 pt-3 pb-1">
        <div class="flex items-center gap-1.5 flex-wrap justify-center">
            <button
                class="btn-bp bench-toggle"
                aria-pressed={showReferencePlates}
                onclick={() => showReferencePlates = !showReferencePlates}
            >Reference Plates</button>
            <button
                class="btn-bp bench-toggle"
                aria-pressed={showGinkgo}
                onclick={() => showGinkgo = !showGinkgo}
                title="Show Ginkgo's autonomous (GPT-5 / Smith et al.) reactions"
            >Ginkgo</button>
            <button
                class="btn-bp bench-toggle"
                aria-pressed={showLiterature}
                onclick={() => showLiterature = !showLiterature}
            >Literature</button>
            <button
                class="btn-bp bench-toggle"
                aria-pressed={showClosestMatch}
                onclick={() => showClosestMatch = !showClosestMatch}
                title="Show the known reaction the live Custom Mix most resembles"
            >Closest Match</button>
            <button
                class="btn-bp bench-toggle"
                aria-pressed={showSupplementNl}
                onclick={toggleSupplementMode}
                title="Show per-reagent supplement volumes (nL) and the $/g cost row"
            >Details</button>
            <button
                class="btn-bp bench-toggle"
                aria-pressed={saltOptima !== 'default'}
                onclick={cycleSaltOptima}
                title="Click to cycle: override K(Glu) and Mg(Glu)2 across all formulations to a target's salt optimum"
            >Salt Optima: {saltOptimaLabel}</button>
            <button
                class="btn-bp"
                onclick={downloadCSV}
                title="Download concentrations as CSV"
            >↓ CSV</button>
            <button
                class="btn-bp"
                onclick={downloadTableImage}
                disabled={isDownloading}
                title="Download table as PNG"
            >{isDownloading ? 'Saving…' : '↓ PNG'}</button>
        </div>
        {#if submitRow}
            <div class="flex items-center flex-wrap justify-center">
                {@render submitRow()}
            </div>
        {/if}
    </div>

    <!-- ── Design notices (live) + export panels ─────────────────────────── -->
    <div class="px-3 pt-4 pb-4 space-y-2">
        {#if theoretical && theoretical.items?.length}
            <div class="rounded-lg border p-3 text-[11px]" style="background: rgba(111,75,208,0.07); border-color: rgba(111,75,208,0.35);">
                <div class="font-semibold mb-1" style="color: #6f4bd0;">{theoretical.items.length} reagent{theoretical.items.length === 1 ? '' : 's'} needed for {theoretical.formulationName} — not in current stock</div>
                <div class="opacity-60">{theoretical.items.map((i) => i.paperName).join(', ')}</div>
            </div>
        {/if}

        <!-- Concentration rank + reagent supplement JSON — owned by the parent,
             rendered here so the export panels read as part of this designer. -->
        {#if exportPanels}{@render exportPanels()}{/if}

        <!-- Snap-rounding drift notice sits UNDER the export panels: it's a caveat on
             the composition above (the 25 nL Echo grid can't hit every target exactly),
             so it reads best right below the rank + JSON it qualifies. -->
        {#if discrepancies.length > 0}
            <div class="rounded-lg border p-3 text-[11px]" style="background: rgba(189,111,22,0.07); border-color: rgba(189,111,22,0.35);">
                <div class="font-semibold mb-1.5" style="color: #bd6f16;">Snap rounding ≥3% off target · {discrepancies.length} reagent{discrepancies.length === 1 ? '' : 's'}</div>
                <table class="w-full" style="font-variant-numeric: tabular-nums;">
                    <thead>
                        <tr class="opacity-50 text-left">
                            <th class="font-normal" style="width:40%;">Reagent</th>
                            <th class="font-normal text-right" style="width:25%;">Intended</th>
                            <th class="font-normal text-right" style="width:25%;">Achievable</th>
                            <th class="font-normal text-right" style="width:10%;">Δ%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each discrepancies as d}
                            <tr>
                                <td>{d.name}</td>
                                <td class="text-right opacity-60">{d.intendedLabel}</td>
                                <td class="text-right">{d.achievableLabel}</td>
                                <td class="text-right" style="color: #bd6f16;">{d.pct.toFixed(1)}%</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
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
                {#if activeSynopsis.synopsis.mol}
                    <div class="flex justify-center rounded-md bg-white border border-base-300/70 p-2">
                        <img
                            src={molImageUrl(activeSynopsis.synopsis.mol)}
                            alt={`2D structure of ${activeSynopsis.name}`}
                            loading="lazy"
                            class="h-[180px] w-auto object-contain"
                            onerror={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                        />
                    </div>
                {/if}
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
                {#if activeSynopsis.synopsis.mol || activeSynopsis.synopsis.wiki}
                    <div class="pt-1 border-t border-base-300/50">
                        <a
                            href={pubchemUrl(activeSynopsis.synopsis.mol ?? activeSynopsis.synopsis.wiki)}
                            target="_blank"
                            rel="noopener"
                            class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >Look up on PubChem →</a>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    /* Benchmarks comparison grid — horizontal row separators only (no vertical
       lines), ported from the catalyst .bench-row / .bench-grp treatment so each
       reagent row is easy to track across the wide formulation × reagent matrix.
       Colors are literal AND fully opaque (not rgba with alpha): a semi-transparent
       hairline composites to a different shade over the frozen sticky columns
       (bg-base-200/300) than over the scrolling colour-washed value cells, which
       read as the light/dark lines being swapped between "the side" and the table.
       Opaque greys render identically everywhere and also survive the dom-to-image
       PNG export, whose clone lives outside the .cfps-page scope. */
    /* One separator per boundary: draw it as the TOP border of the lower row so a
       row and its neighbour never each contribute a hairline to the same seam
       (which previously stacked a light line over a dark one — "doubled up"). */
    tbody tr td {
        border-top: 1px solid #dce1e6;
    }
    /* No line above the first body row — the header already closes the top edge. */
    tbody tr:first-child td {
        border-top: none;
    }
    /* Category-group boundaries use the same quiet hairline as every other row
       (no heavier group rule) so the salts↔amino-acids seam — which reads clean —
       matches every other group boundary. The .bench-grp class is kept as a hook
       but no longer draws a stronger line. */
    tbody tr.bench-grp td {
        border-top: 1px solid #dce1e6;
    }
    /* (Previously a thick vertical divider sat here between the data columns and
       the Custom Reaction; removed at the user's request. The .bench-vsep class is
       kept on those cells as a hook but no longer draws a border.) */

    /* Freeze the Custom Mix column to the left, right after the group-label +
       reagent-name columns, so the live design stays visible while the reference
       columns scroll. --cust-left (set inline per cell) tracks the resizable
       reagent column. position:relative is the base so the header's resize handle
       always has a positioned ancestor; desktop upgrades it to sticky. A soft
       right shadow marks where the frozen region ends. */
    .bench-custcol {
        position: relative;
    }
    @media (min-width: 641px) {
        .bench-custcol {
            position: sticky;
            left: var(--cust-left);
            z-index: 20;
            box-shadow: 4px 0 6px -4px rgba(27, 31, 37, 0.16);
        }
        /* Header cells sit above the sticky body columns (z-30/40) they scroll over. */
        :global(thead) .bench-custcol {
            z-index: 30;
        }
    }

    /* Column resize handle: a thin hit-target riding a header cell's right edge.
       Invisible at rest, it shows a faint accent bar on hover/drag so the seam is
       discoverable without cluttering the header. The host <th> is position:relative
       (or sticky), so this absolute box tracks the column's right border. */
    .bench-resize {
        position: absolute;
        top: 0;
        right: -3px;
        width: 7px;
        height: 100%;
        cursor: col-resize;
        z-index: 5;
        touch-action: none;
        user-select: none;
    }
    .bench-resize::after {
        content: '';
        position: absolute;
        top: 4px;
        bottom: 4px;
        left: 3px;
        width: 2px;
        border-radius: 1px;
        background: transparent;
        transition: background 0.12s;
    }
    .bench-resize:hover::after,
    .bench-resize:active::after {
        background: #4a5560;
    }

    /* Custom Mix +/- stepper — one cohesive pill rather than two boxed buttons.
       At rest it's a quiet capsule that just frames the value; the − / + are
       faint and only light up (blue-grey accent) when you hover the cell, so the
       column reads as clean numbers until you reach for it. Literal colors for
       PNG export. */
    .cust-cell {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        white-space: nowrap;
        padding: 1px;
        border-radius: 999px;
        border: 1px solid transparent;
        transition: background 0.12s ease, border-color 0.12s ease;
    }
    /* Reagent that starts at zero: the capsule blends into the row — a faint dash
       and near-invisible steppers — so it reads as "not in the mix" like the empty
       cells around it. Hovering reveals the + so you can still dial it up. */
    .cust-cell--zero .cust-val { opacity: 0.3; }
    .cust-cell--zero .cust-step { opacity: 0.16; }
    /* Once a value is dialled in the capsule turns white and lifts off the row. */
    .cust-cell--active {
        background: #ffffff;
        border-color: var(--hair);
    }
    .cust-cell:hover {
        background: rgba(74, 85, 96, 0.08);
        border-color: rgba(74, 85, 96, 0.28);
    }
    .cust-val {
        /* Fixed width (not min-width) + tabular figures so the − / + buttons stay
           put as the value's digit count changes — reserves room for values up to
           roughly "###.##". */
        width: 3.6em;
        flex: 0 0 auto;
        text-align: center;
        font-weight: 500;
        padding: 0 2px;
        font-variant-numeric: tabular-nums;
    }
    .cust-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 17px;
        height: 17px;
        border-radius: 999px;
        border: 0;
        background: transparent;
        color: currentColor;
        opacity: 0.28;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
        touch-action: none;
        user-select: none;
        transition: background 0.12s ease, opacity 0.12s ease, color 0.12s ease;
    }
    .cust-cell:hover .cust-step {
        opacity: 0.7;
    }
    .cust-step:hover:not(:disabled) {
        background: rgba(74, 85, 96, 0.16);
        color: #3f464f;
        opacity: 1;
    }
    .cust-step:disabled {
        opacity: 0.12;
        cursor: default;
    }

    /* Small reset (↺) button in the Custom Mix header — quiet until hovered. */
    .cust-reset {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 15px;
        height: 15px;
        border-radius: 999px;
        border: 0;
        background: transparent;
        color: currentColor;
        opacity: 0.4;
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        transition: background 0.12s ease, opacity 0.12s ease, color 0.12s ease;
    }
    .cust-reset:hover {
        background: rgba(74, 85, 96, 0.16);
        color: #3f464f;
        opacity: 1;
    }

    /* Thin full-height rail at the right edge of the table. Click anywhere along
       it to append a comparison column — a seamless "add another column" affordance
       you meet exactly when you scroll to the table's edge. */
    .add-col-rail {
        /* Match the 32px rotated group-label column on the left so the table's
           left and right gutters are symmetric. */
        flex: 0 0 32px;
        align-self: stretch;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 0;
        border: 0;
        border-left: 1px dashed oklch(var(--bc) / 0.18);
        background: oklch(var(--b2) / 0.4);
        color: oklch(var(--bc) / 0.4);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .add-col-rail:hover {
        background: oklch(var(--p) / 0.1);
        color: oklch(var(--p));
        border-left-color: oklch(var(--p) / 0.5);
    }
    /* Keep the glyph in view no matter how far the table is scrolled vertically. */
    .add-col-rail__plus {
        position: sticky;
        top: 45%;
        font-size: 16px;
        font-weight: 400;
        line-height: 1;
        padding: 6px 0;
    }

    /* Toggle buttons: ON is a filled dark accent pill (white text on --teal) so it
       stands clearly apart from the OFF state, which keeps the standard white .btn-bp
       look like the CSV/PNG buttons. Scoped with .btn-bp to outrank the global
       aria-pressed rule. */
    .bench-toggle.btn-bp[aria-pressed="true"] {
        color: #fff;
        background: var(--teal);
        border-color: var(--teal);
    }
    .bench-toggle.btn-bp[aria-pressed="true"]:hover {
        color: #fff;
        background: var(--ink-2);
        border-color: var(--ink-2);
    }

    /* Delta direction coloring — blue-grey up, red down, muted at parity. */
    .delta-up {
        color: #4a5560;
    }
    .delta-dn {
        color: #c0392b;
    }
    .delta-flat {
        opacity: 0.45;
    }

    /* ── Mobile: the sticky reagent-name column ate ~half the screen. Shrink the
       vertical group rail and the name column, let long reagent names wrap onto
       two lines, and pull the left offsets in to match. !important beats the
       per-cell inline min-width / left values. ─────────────────────────────── */
    @media (max-width: 640px) {
        .bench-gcol {
            width: 20px !important;
            min-width: 20px !important;
            font-size: 8.5px !important;
        }
        .bench-corner {
            min-width: 132px !important;
        }
        .bench-rcol {
            left: 19px !important;
            min-width: 112px !important;
            max-width: 42vw !important;
            padding-left: 6px !important;
            padding-right: 6px !important;
            white-space: normal !important;
            font-size: 10px;
            line-height: 1.2;
        }
        .bench-rcol :global(a),
        .bench-rcol :global(span) {
            overflow-wrap: anywhere;
            word-break: break-word;
        }
    }
</style>

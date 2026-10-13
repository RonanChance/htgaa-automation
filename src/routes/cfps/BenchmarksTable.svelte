<script>
    // Comparison of industry-benchmark cell-free reaction formulations
    // (Olsen et al. 2026 Nat Commun, Table 1). Reads the benchmark data and
    // reagent aliases from $lib/cfps-benchmarks.js. Click a column header to
    // load that formulation's targets into the parent's design state.

    import { onDestroy, onMount } from 'svelte';
    import {
        REAGENT_ALIASES as STATIC_REAGENT_ALIASES,
        REAGENT_GROUPS as STATIC_REAGENT_GROUPS,
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
        // Reagent groups (row order) + paper-name → inventory aliases. Default to
        // the literature-only static sets for safety, but the parent always passes
        // the merged versions (REAGENT_GROUPS/REAGENT_ALIASES + buildCatalogExtras),
        // so the table also lists reagents from the live PocketBase catalog that no
        // benchmark formulation mentions.
        reagentGroups = STATIC_REAGENT_GROUPS,
        reagentAliases = STATIC_REAGENT_ALIASES,
        onLoad,
        onShowRecipe,
        // Live design bridge from the parent designer. `customMix` is a map
        // paperName → { reagentId, unit, value, label, adjustable, canInc, canDec }
        // computed from volumesNl; `customWaterUl` is the current water fill in µL;
        // `onAdjust(reagentId, ±1)` nudges the design by one Echo step.
        customMix = {},
        customWaterUl = null,
        onAdjust = null,
        // Starting-composition control for the Custom Mix column. `customStartKey`
        // is the recipe the live design was seeded from; `customIsCustomized` is
        // true once the design diverges from it (→ the column reads "Custom");
        // `onSetCustomStart(key)` loads a new starting composition + re-baselines.
        customStartKey = 'ginkgo-target-sfgfp-pep',
        customIsCustomized = false,
        onSetCustomStart = null,
        // `onPickCommunity(key)` FOCUSES a community composition clicked in the rail:
        // it clears standard / other-author columns, makes the picked one the leftmost
        // (selected) column, and keeps the user's own customized mixes to its right.
        // Null → single rail cards fall back to onSetCustomStart (reseed in place).
        onPickCommunity = null,
        // `onLoadBatch(memberIds, label)` loads every composition in a batch into the
        // Custom Mix columns at once (one column per member). Used by the community
        // rail's batch cards; null → batch cards fall back to loading their first arm.
        onLoadBatch = null,
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
        // Signed-in viewer's display name — added to a card's starrer list
        // optimistically while a star request is in flight.
        viewerName = '',
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
        benchmarkFormulations = [],
        // (bm) → { paperName: concentration } for a formulation after the parent's
        // concentration → grid-snapped nL volumes → concentration round-trip (the
        // same one the live Custom Mix uses). The closest-match scores against this,
        // not the pristine paper numbers, so a loaded formulation self-matches at
        // 100%. Falls back to bm.components when not provided.
        fingerprintFor = null,
        // ── mix columns (batch designing) ─────────────────────────────────────
        // Every candidate composition is a numbered "Mix N" column — all equal peers
        // in the experiment batch, frozen together as one sticky-left group, fixed in
        // creation order (they never reorder). `mixColumns` is the full ordered list
        // (each shaped like a BENCHMARK_FORMULATIONS entry plus { id, label, selected,
        // proteinTarget, startKey, isCustomized }). Exactly one carries `selected:true`
        // — that column is editable IN PLACE (the +/- steppers + the live
        // customMix/customWaterUl/customCost* props drive it); the rest are read-only.
        // Callbacks bridge to the parent, which owns the mix state (all keyed by mix id):
        //   onAddMix(id)          — append a new Mix column (copy of mix `id`)
        //   onSelectMix(id)       — make that mix the editable one, IN PLACE
        //   onRemoveMix(id)       — drop that mix (never the last one)
        //   onResetMix(id)        — reset that mix to its starting composition
        //   onSetMixTarget(id, t) — set that mix's protein target
        mixColumns = [],
        proteinTarget = 'sfGFP',
        proteinTargets = ['sfGFP', 'PETase', 'Reteplase'],
        onAddMix = null,
        onSelectMix = null,
        onRemoveMix = null,
        onResetMix = null,
        onSetMixTarget = null
    } = $props();

    // Always exactly two decimal places, with thousands separators: "$1,234.00",
    // "$1.23", "$0.11", "$0.00".
    function fmtCost(v) {
        if (v == null || !Number.isFinite(v)) return '—';
        return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Apparent enzyme activity (µM product): 1 dp at/above 10, else 2 dp so the
    // sub-µM reteplase ribose value (0.81) keeps its precision.
    function fmtUM(v) {
        if (v == null || !Number.isFinite(v)) return '—';
        return v >= 10 ? v.toFixed(1) : v.toFixed(2);
    }

    // ISO timestamp → "Sep 20, 2026" for the community-composition detail cards.
    function fmtDate(iso) {
        if (!iso) return '';
        const dt = new Date(iso);
        return Number.isNaN(dt.getTime())
            ? ''
            : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    let tableScrollEl = $state(null);
    let isDownloading = $state(false);
    // Toggle for the community-composition browse rail on the left of the designer.
    let showCommunityRail = $state(false);
    // Hover affordances for the frozen mix group: which mix column the pointer is over
    // (whole-column highlight + "click to select" cue), and whether it's over the
    // add-mix rail (whole-rail highlight). Updated from one bubbling mouseover handler
    // on the table so moving between a column's separate cells reads as one column.
    let hoveredMixId = $state(null);
    let railHovered = $state(false);
    function onTableHover(e) {
        const mixEl = e.target.closest('[data-mix-id]');
        hoveredMixId = mixEl ? mixEl.getAttribute('data-mix-id') : null;
        railHovered = !!e.target.closest('[data-rail]');
    }
    function clearTableHover() {
        hoveredMixId = null;
        railHovered = false;
    }

    // Per-protein accent (green / orange / red for sfGFP / PETase / Reteplase) —
    // mirrors PROTEIN_PALETTE on the main page and the 3D structure glows, used to
    // tint the protein-target badges in the community browse rail.
    const PROTEIN_PALETTE = {
        sfGFP:     { ink: '#1f7a3f', wash: '#e6f4ea', line: '#2f8f4e' },
        PETase:    { ink: '#b25e00', wash: '#fbeede', line: '#e07b1a' },
        Reteplase: { ink: '#b5271a', wash: '#fbe4e0', line: '#e0402e' }
    };
    function proteinBadgeStyle(t) {
        const p = PROTEIN_PALETTE[t];
        return p ? `color:${p.ink};background:${p.wash};border-color:${p.line};` : '';
    }

    // ─── Resizable columns ───────────────────────────────────────────────────
    // The customizer columns (reagent name + Custom / Comparison / Closest /
    // any added Compare columns) are drag-resizable via a thin handle on each
    // header's right edge. Widths live in `colWidths` keyed by a stable column id
    // and are applied through the <colgroup> (one <col> per column) so a single
    // value sizes the header, body and summary cells of that column at once — no
    // per-cell wiring. An unset id falls back to the column's design default.
    // Floors are chosen so a column can't be dragged narrow enough to clip/wrap
    // its content; the reference/literature columns stay content-sized as before.
    const COL_DEFAULTS = { rcol: 212, custom: 96, comparison: 96, closest: 132 }; // rcol 212: fits "Phosphate (di:mono)" + stock + ⓘ on one line
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
    // then every literature / GPT formulation. Default = the reteplase PANOx
    // reference plate — the folding-heavy control is the most useful cross-check
    // to keep handy. The column itself is off by default (toggled via "Comparison").
    const COMPARISON_OPTIONS = $derived(
        benchmarkFormulations.filter((b) => b.category !== 'ginkgo-target')
    );
    let comparisonKey = $state('ginkgo-target-reteplase-pep');
    // `comparisonBm` is declared lower down, AFTER applyAll / SALT_OPTIMA — during
    // SSR Svelte evaluates $derived eagerly at its declaration line, so it must
    // not run before the salt-optima constants it depends on are initialized.

    // ── Saved mix columns (batch designing) ───────────────────────────────────
    // The extra columns right of the Custom Mix are the user's saved candidate
    // compositions (`savedMixColumns`, owned by the parent). They render read-only
    // — concentration + signed % vs the live Custom Mix, exactly like a reference
    // column — with Load / Copy / Remove actions in the header. `addedColumns` (the
    // optima/exclusion-applied render models) is derived lower down, after applyAll.

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

    // Steppers live on EVERY mix column, not just the selected one. Touching a
    // non-selected mix's +/- promotes that mix to selected FIRST — onSelectMix
    // (selectMix in the parent) swaps the live $state buffer synchronously, so the
    // step that follows in the same call stack lands on the mix you just touched.
    // This is the "start changing a mix and it becomes the one you're editing" UX.
    function mixStepScrub(e, col, reagentId, dir) {
        if (col && !col.selected) onSelectMix?.(col.id);
        startScrub(e, reagentId, dir);
    }
    function mixStepClick(e, col, reagentId, dir) {
        if (col && !col.selected) onSelectMix?.(col.id);
        stepClick(e, reagentId, dir);
    }

    // CSV of the table: your Mix columns first (the same values their cells show),
    // then every visible reference / literature column. Every stocked reagent row is
    // kept even when empty, so the export lists the full reagent set; reference-only
    // rows (nothing in stock, e.g. Bis-Tris) are kept only when some column uses them.
    function downloadCSV() {
        const allReagentPapers = reagentGroups.flatMap(g => g.reagents);
        const mixCols = resolvedMixColumns.map((col) => ({
            header: `${col.label}${col.proteinTarget ? ` (${col.proteinTarget})` : ''}`,
            value: (paperName) => (col.selected ? customMix?.[paperName] : col.stepper?.[paperName])?.value ?? null
        }));
        const header = ['Reagent', 'Unit', ...mixCols.map((c) => c.header), ...displayFormulations.map(bm => `${bm.name} (${bm.year})`)];
        const tidy = (v) => (v == null || !Number.isFinite(Number(v)) || Number(v) === 0 ? '' : Number(Number(v).toPrecision(6)));
        const rows = allReagentPapers.map(paperName => {
            const alias = reagentAliases[paperName];
            const unit = alias?.unit ?? 'mM';
            const mixValues = mixCols.map((c) => tidy(c.value(paperName)));
            const values = displayFormulations.map(bm => {
                const v = applyAll(bm).components[paperName];
                return v == null ? '' : v;
            });
            return { stocked: !!alias?.ids, cells: [paperName, unit, ...mixValues, ...values] };
        })
            .filter(({ stocked, cells }) => stocked || cells.slice(2).some(v => v !== ''))
            .map(({ cells }) => cells);

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

    // Escape closes the reagent synopsis popup first, then leaves fullscreen focus
    // mode (only reachable without the Fullscreen API — with it, the browser eats
    // Escape itself and onFullscreenChange syncs focusMode back off).
    function handleSynopsisKeydown(e) {
        if (e.key !== 'Escape') return;
        hideSynopsisHover();
        if (activeSynopsis) activeSynopsis = null;
        else if (focusMode) exitFocus();
    }

    // ─── Hover preview of a reagent synopsis ──────────────────────────────────
    // Hovering the ⓘ shows the same summary as the click modal in a popover beside
    // it. A short show delay stops it flickering as the pointer sweeps down the
    // reagent column; a short hide delay lets the pointer cross into the popover
    // (so its PubChem link is clickable). Mouse only — touch keeps tap → modal.
    // Positioned with fixed coords from the button's rect: it grows downward from
    // buttons in the top half of the viewport and upward from the bottom half, with
    // a max-height so it never runs off-screen (no measuring needed).
    let hoverSynopsis = $state(null); // { name, synopsis, left, top|bottom, maxH } | null

    // A row's reagent summary: the written synopsis, or — when nobody has written
    // one yet (e.g. a reagent auto-added from the live catalog) — a short generated
    // one, so every stocked row gets an ⓘ. Carries the alias's "just added" flags:
    // `addedOn` (curated, dated) and `autoAdded` (catalog safety net), which turn
    // the ⓘ light blue and add a note to the popup.
    function synopsisFor(paperName) {
        const alias = reagentAliases[paperName];
        const written = REAGENT_SYNOPSES[paperName];
        if (!written && !alias?.ids) return null;
        const synopsis = written ?? {
            role: `${paperName} — stock ${alias.stockMm} ${alias.unit}. A description hasn’t been written yet.`,
            mol: null,
            wiki: paperName
        };
        return { ...synopsis, addedOn: alias?.addedOn ?? null, autoAdded: !!alias?.autoAdded };
    }
    const isNewReagent = (syn) => !!(syn?.addedOn || syn?.autoAdded);
    // '2026-10-11' → '10/11/26' (string-sliced, so no time-zone shift).
    function fmtAddedOn(iso) {
        const [y, m, d] = String(iso || '').split('-');
        return y && m && d ? `${Number(m)}/${Number(d)}/${y.slice(2)}` : '';
    }
    let synShowTimer = null;
    let synHideTimer = null;
    const SYN_POP_W = 320;

    function queueSynopsisHover(e, paperName) {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(synHideTimer);
        clearTimeout(synShowTimer);
        const r = e.currentTarget.getBoundingClientRect();
        synShowTimer = setTimeout(() => {
            const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
            const left = r.right + pad + SYN_POP_W <= vw ? r.right + pad : Math.max(pad, r.left - pad - SYN_POP_W);
            const down = r.top < vh / 2;
            hoverSynopsis = {
                name: paperName,
                synopsis: synopsisFor(paperName),
                left,
                ...(down
                    ? { top: Math.max(pad, r.top - 6), maxH: vh - Math.max(pad, r.top - 6) - pad }
                    : { bottom: Math.max(pad, vh - r.bottom - 6), maxH: r.bottom + 6 - pad })
            };
        }, 180);
    }
    function leaveSynopsisHover() {
        clearTimeout(synShowTimer);
        clearTimeout(synHideTimer);
        synHideTimer = setTimeout(() => (hoverSynopsis = null), 140);
    }
    function hideSynopsisHover() {
        clearTimeout(synShowTimer);
        clearTimeout(synHideTimer);
        hoverSynopsis = null;
    }

    // ─── Fullscreen focus mode ────────────────────────────────────────────────
    // Pins the designer over the whole viewport: community contributions on the
    // left half (wide, readable cards), the comparison table on the right half,
    // and the toggle bar along the bottom. Also asks the browser for real
    // fullscreen on <html> (not this section) so the page-level modals — recipe,
    // submit, plate reader, synopsis — still layer above it as usual.
    let focusMode = $state(false);

    async function enterFocus() {
        focusMode = true;
        try {
            if (document.fullscreenEnabled && !document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            }
        } catch { /* denied / unsupported (e.g. iOS) — the overlay alone still works */ }
    }
    async function exitFocus() {
        focusMode = false;
        if (document.fullscreenElement) {
            try { await document.exitFullscreen(); } catch { /* already exiting */ }
        }
    }
    function toggleFocus() {
        hideSynopsisHover();
        if (focusMode) exitFocus();
        else enterFocus();
    }
    // Leaving browser fullscreen (Esc / F11 / browser UI) also leaves focus mode.
    function onFullscreenChange() {
        if (!document.fullscreenElement && focusMode) focusMode = false;
    }
    // Freeze the page behind the overlay so wheel scrolling stays in the panes.
    $effect(() => {
        if (!focusMode) return;
        const html = document.documentElement;
        const prev = html.style.overflow;
        html.style.overflow = 'hidden';
        return () => { html.style.overflow = prev; };
    });
    onDestroy(() => {
        clearTimeout(synShowTimer);
        clearTimeout(synHideTimer);
    });

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
        sfgfp:           { label: 'sfGFP',                     overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.85 } },
        petase:          { label: 'PETase',                    overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.85 } },
        reteplase:       { label: 'Reteplase',                 overrides: { 'K(Glu)': 200, 'Mg(Glu)2': 8.225 } }
    };
    function applyOptima(bm) {
        const { overrides } = SALT_OPTIMA[saltOptima] ?? SALT_OPTIMA.default;
        if (!overrides) return bm;
        return { ...bm, components: { ...bm.components, ...overrides } };
    }

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

    // Each protein contributes its two reference energy conditions — PEP vs Ribose.
    // (For reteplase these are the PANOx-SP-like [PEP] and Ginkgo3 [ribose] plates.)
    const GINKGO_TARGET_ORDER = [
        'ginkgo-target-sfgfp-pep',      'ginkgo-target-sfgfp-ribose',
        'ginkgo-target-petase-pep',     'ginkgo-target-petase-ribose',
        'ginkgo-target-reteplase-pep',  'ginkgo-target-reteplase-ribose'
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
            const a = reagentAliases[name];
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
        const a = reagentAliases[paperName];
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

    // Resolved mix columns — the parent's ordered mix list, each run through applyAll
    // (same optima/exclusions as the rest of the table) so every mix diffs on the same
    // footing. `index` keys its resizable width + sticky offset; `selected` marks the
    // one that's editable in place. Order is fixed (creation order) so columns stay put.
    const resolvedMixColumns = $derived(
        (mixColumns ?? []).map((m, i) => ({
            ...m,
            key: m.id,
            label: m.label || m.name,
            index: i,
            proteinTarget: m.proteinTarget || null,
            bm: applyAll(m)
        }))
    );
    // Whether any mix can be removed (never drop the last one — there's always ≥1).
    const mixRemovable = $derived(resolvedMixColumns.length > 1);

    // ── Frozen experimental group (sticky-left) ───────────────────────────────
    // The mixes are the experiment batch: pinned together from `customStickyLeft`
    // rightward so they stay put while the reference / literature columns scroll. The
    // "add mix" rail sits immediately right of the last mix (the boundary between the
    // batch and the rest of the table); the optional comparison / closest reference
    // columns are pinned after it. Each offset is the running sum of the widths of the
    // frozen columns to its left (defaults unless the user has dragged one).
    const RAIL_WIDTH = 26;
    const comparisonColWidth = $derived(colWidths.comparison ?? COL_DEFAULTS.comparison);
    const closestColWidth = $derived(colWidths.closest ?? COL_DEFAULTS.closest);
    const mixColWidthAt = (i) => colWidths['mix:' + i] ?? COL_DEFAULTS.custom;
    // Per-index left offset for each mix column (cumulative from customStickyLeft).
    const mixStickyLefts = $derived.by(() => {
        const out = [];
        let left = customStickyLeft;
        for (let i = 0; i < resolvedMixColumns.length; i++) {
            out.push(left);
            left += mixColWidthAt(i);
        }
        return out;
    });
    const railStickyLeft = $derived(
        customStickyLeft + resolvedMixColumns.reduce((sum, _m, i) => sum + mixColWidthAt(i), 0)
    );
    const comparisonStickyLeft = $derived(railStickyLeft + (onAddMix ? RAIL_WIDTH : 0));
    const closestStickyLeft = $derived(comparisonStickyLeft + (showComparison ? comparisonColWidth : 0));

    // Community submissions, newest first, for the toggle-able browse rail on the
    // left of the designer. Clicking a card loads it into the Custom Mix via
    // onSetCustomStart; the card whose key matches customStartKey reads as active.
    const communityByRecent = $derived.by(() =>
        [...communityFormulations].sort(
            (a, b) => new Date(b.created || 0) - new Date(a.created || 0)
        )
    );

    // The same submissions, but with batches (compositions sharing a batch_id,
    // submitted together) collapsed into a single card. A batch needs ≥2 members
    // actually present; a lone survivor falls back to a standalone card. Each entry is
    // { kind:'single', card } or { kind:'batch', batchId, name, count, targets[],
    // members[], memberIds[] }. Newest-first. Batch cards carry every distinct protein
    // target present so the rail can tag them (sfGFP / PETase / Reteplase).
    const communityRailItems = $derived.by(() => {
        const byBatch = new Map();
        for (const c of communityFormulations) {
            const bid = c.batchId && Number(c.batchSize) > 1 ? c.batchId : null;
            if (!bid) continue;
            if (!byBatch.has(bid)) byBatch.set(bid, []);
            byBatch.get(bid).push(c);
        }
        const items = [];
        const grouped = new Set();
        for (const [bid, members] of byBatch) {
            if (members.length < 2) continue;
            const sorted = [...members].sort(
                (a, b) => (Number(a.batchIndex) || 0) - (Number(b.batchIndex) || 0)
            );
            sorted.forEach((m) => grouped.add(m.key));
            const present = proteinTargets.filter((t) => sorted.some((m) => m.proteinTarget === t));
            const hasOther = sorted.some(
                (m) => m.proteinTarget && !proteinTargets.includes(m.proteinTarget)
            );
            items.push({
                kind: 'batch',
                key: `batch-${bid}`,
                batchId: bid,
                name: bid,
                count: sorted.length,
                targets: hasOther ? [...present, 'Other'] : present,
                members: sorted,
                memberIds: sorted.map((m) => m.id ?? String(m.key).replace(/^community-/, '')),
                // One group-level hypothesis for the batch, stored on a single member —
                // surface whichever member carries it.
                experimentHypothesis: sorted.find((m) => m.experimentHypothesis)?.experimentHypothesis || '',
                author: sorted[0]?.author || null,
                created: sorted.map((m) => m.created || '').sort().slice(-1)[0] || null
            });
        }
        for (const c of communityFormulations) {
            if (grouped.has(c.key)) continue;
            items.push({ kind: 'single', key: c.key, card: c, created: c.created || null });
        }
        items.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
        return items;
    });

    // Headline numbers for the toggle tab and the list header. Counts are always in
    // compositions (a batch card counts as all of its members — see countIn) so the
    // tab and the opened list agree; contributors are distinct submitters by contributorKey.
    const communityContributorCount = $derived(
        new Set(communityFormulations.map((c) => c.contributorKey || c.author).filter(Boolean)).size
    );
    const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

    // ─── Stars on community compositions ─────────────────────────────────────
    // Server truth arrives on each formulation (starCount / starredBy / starredByMe).
    // A click applies optimistically into `starOverrides` (record id → same shape),
    // then settles to the server's reply — or rolls back if the request fails. A
    // batch card stars/unstars every member; its count is the union of starrers.
    let starOverrides = $state({});
    let starError = $state('');

    function starsFor(c) {
        return starOverrides[c.id] ?? {
            starCount: Number(c.starCount) || 0,
            starredBy: c.starredBy ?? [],
            starredByMe: !!c.starredByMe
        };
    }
    function itemStars(item) {
        if (item.kind !== 'batch') return starsFor(item.card);
        const names = new Set();
        let mine = false;
        for (const m of item.members) {
            const st = starsFor(m);
            st.starredBy.forEach((n) => names.add(n));
            mine ||= st.starredByMe;
        }
        return { starCount: names.size, starredBy: [...names], starredByMe: mine };
    }

    async function toggleStar(item) {
        const members = item.kind === 'batch' ? item.members : [item.card];
        const on = !itemStars(item).starredByMe;
        const me = viewerName || 'you';
        const prev = {};
        for (const m of members) {
            const st = starsFor(m);
            prev[m.id] = starOverrides[m.id];
            if (st.starredByMe === on) continue;
            const names = [...st.starredBy];
            if (on) names.push(me);
            else { const i = names.lastIndexOf(me); if (i >= 0) names.splice(i, 1); }
            starOverrides[m.id] = { starCount: Math.max(0, st.starCount + (on ? 1 : -1)), starredBy: names, starredByMe: on };
        }
        starError = '';
        try {
            const res = await fetch('/cfps/stars', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: on ? 'star' : 'unstar', ids: members.map((m) => m.id) })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Star failed (${res.status}).`);
            for (const [id, st] of Object.entries(data.stars ?? {})) starOverrides[id] = st;
        } catch (e) {
            for (const m of members) {
                if (prev[m.id] === undefined) delete starOverrides[m.id];
                else starOverrides[m.id] = prev[m.id];
            }
            starError = e?.message || 'Could not update the star.';
        }
    }

    // ─── Comment threads on community compositions ───────────────────────────
    // Same behaviour as the community-reagent threads: a 💬 count toggles the
    // thread open inside the card, anyone signed in can post (500-word cap), and
    // authors can delete their own. Threads arrive on each formulation (`comments`)
    // and are replaced by the server's refreshed thread after every write. A batch
    // card's thread lives on its first member — the record that also carries the
    // batch hypothesis.
    let threadOverrides = $state({}); // composition id → [comment, ...]
    let openThreads = $state(new Set()); // item keys with an expanded thread
    let commentDraft = $state({}); // composition id → draft text
    let commentBusy = $state(new Set());
    let commentError = $state({}); // composition id → message
    const COMMENT_WORD_LIMIT = 500;
    const CHARS_PER_WORD = 15; // a long space-free run counts as several words (mirrors the server)
    function wordCount(t) {
        const str = String(t || '').trim();
        return str ? str.split(/\s+/).reduce((n, tok) => n + Math.max(1, Math.ceil(tok.length / CHARS_PER_WORD)), 0) : 0;
    }
    const threadOwner = (item) => (item.kind === 'batch' ? item.members[0] : item.card);
    const commentsFor = (c) => threadOverrides[c.id] ?? c.comments ?? [];
    function toggleThread(item) {
        const next = new Set(openThreads);
        if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
        openThreads = next;
    }
    async function sendComment(owner, payload) {
        commentBusy = new Set(commentBusy).add(owner.id);
        commentError = { ...commentError, [owner.id]: '' };
        try {
            const res = await fetch('/cfps/design-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
            threadOverrides[owner.id] = data.comments ?? [];
            return true;
        } catch (e) {
            commentError = { ...commentError, [owner.id]: e?.message || 'Could not update the thread.' };
            return false;
        } finally {
            const next = new Set(commentBusy); next.delete(owner.id); commentBusy = next;
        }
    }
    async function postComment(owner) {
        const text = (commentDraft[owner.id] || '').trim();
        if (!text || commentBusy.has(owner.id)) return;
        if (await sendComment(owner, { action: 'comment', id: owner.id, body: text })) {
            commentDraft = { ...commentDraft, [owner.id]: '' };
        }
    }
    function fmtWhen(iso) {
        const d = iso ? new Date(iso) : null;
        return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    }

    // Filter tabs on the contributions list (shared by the rail and the fullscreen
    // pane): All, one per protein target, or Starred (= the viewer's own stars).
    // The search box narrows every tab; tab counts reflect the search.
    let commTab = $state('all'); // 'all' | 'starred' | a protein target
    let commQuery = $state('');

    // Search text for a composition: its sample_id (the card name), its rationale
    // (the description), and the batch-level hypothesis.
    const searchText = (c) => [c.name, c.rationale, c.experimentHypothesis].join(' ').toLowerCase();
    function matchesQuery(item, q) {
        if (!q) return true;
        if (item.kind === 'single') return searchText(item.card).includes(q);
        return [item.batchId, item.experimentHypothesis].join(' ').toLowerCase().includes(q)
            || item.members.some((m) => searchText(m).includes(q));
    }
    const hasTarget = (item, t) =>
        item.kind === 'batch' ? item.targets.includes(t) : item.card.proteinTarget === t;
    function inTab(item, tab) {
        if (tab === 'all') return true;
        if (tab === 'starred') return itemStars(item).starredByMe;
        return hasTarget(item, tab);
    }
    // Compositions an item contributes to a tab's count — under a protein tab, only
    // a batch's members for that protein.
    function countIn(item, tab) {
        if (item.kind !== 'batch') return 1;
        if (tab === 'all' || tab === 'starred') return item.count;
        return item.members.filter((m) => m.proteinTarget === tab).length;
    }
    const searchedRailItems = $derived.by(() => {
        const q = commQuery.trim().toLowerCase();
        return communityRailItems.filter((i) => matchesQuery(i, q));
    });
    const commTabs = $derived(['all', ...proteinTargets, 'starred']);
    const commTabCounts = $derived(
        Object.fromEntries(commTabs.map((t) => [
            t, searchedRailItems.reduce((n, i) => n + (inTab(i, t) ? countIn(i, t) : 0), 0)
        ]))
    );
    const visibleRailItems = $derived(searchedRailItems.filter((i) => inTab(i, commTab)));
    function commEmptyText() {
        const q = commQuery.trim();
        if (q) return `No contributions match “${q}”${commTab === 'all' ? '' : ' in this tab'}.`;
        if (commTab === 'starred') return 'Nothing starred yet — click the ☆ on any composition to keep it here.';
        if (commTab !== 'all') return `No ${commTab} contributions yet.`;
        return 'No contributions yet.';
    }

    // Hover list of who starred a card — fixed-position, so the rail's scroll
    // container can't clip it. Placed below the star, flipped above near the bottom.
    let hoverStars = $state(null); // { names, left, top|bottom } | null
    function showStarHover(e, item) {
        const names = itemStars(item).starredBy;
        if (e.pointerType !== 'mouse' || !names.length) return;
        const r = e.currentTarget.getBoundingClientRect();
        const below = r.bottom < window.innerHeight - 160;
        hoverStars = {
            names,
            left: Math.max(8, Math.min(r.left - 6, window.innerWidth - 228)),
            ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 })
        };
    }

    // Load a batch (or, without an onLoadBatch bridge, its first arm) from the rail.
    function loadCommunityBatch(item) {
        if (onLoadBatch && item.memberIds?.length) {
            onLoadBatch(item.memberIds, item.name);
        } else if (item.members?.length) {
            onSetCustomStart?.(item.members[0].key);
        }
    }

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
    // Candidate components each formulation is scored against. When the parent
    // supplies `fingerprintFor`, we compare against the formulation's realized
    // (round-tripped) concentrations so a loaded formulation self-matches at 100%
    // instead of losing points to grid snapping; otherwise the pristine paper
    // numbers. Keyed off the formulations + optima/exclusions only (NOT customMix),
    // so nudging the Custom Mix doesn't re-run the heavy conversion.
    const candidateFingerprints = $derived.by(() =>
        benchmarkFormulations.map((bm) => {
            const applied = applyAll(bm);
            return { bm, comps: fingerprintFor ? fingerprintFor(applied) : applied.components };
        })
    );
    const closestMatch = $derived.by(() => {
        // Flatten the Custom Mix into { paperName: value } over reagents actually dosed.
        const customComponents = {};
        for (const [name, cm] of Object.entries(customMix ?? {})) {
            if (cm?.value != null && cm.value > 0) customComponents[name] = cm.value;
        }
        if (Object.keys(customComponents).length === 0) return null;
        let best = null;
        for (const cand of candidateFingerprints) {
            const score = similarityScore(customComponents, cand.comps);
            if (!best || score > best.score) best = { bm: cand.bm, score, comps: cand.comps };
        }
        return best;
    });
    // Per-reagent values of the closest match, so the column can render like a
    // (auto-selected) comparison column beneath its named header. Uses the same
    // round-tripped components it was scored on, so the diff cells agree with the
    // reported similarity %.
    const closestComponents = $derived(closestMatch ? closestMatch.comps : null);
    // Split so the header can show the full name — main line + a parenthetical
    // qualifier (e.g. a literature "... (Author Year)" splits into name + "(…)")
    // — matching the benchmark column headers below.
    const closestNameParts = $derived(closestMatch ? splitName(closestMatch.bm.name) : null);

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
            excludedReagents: Array.from(excludedReagents)
        };
        if (!togglesRestored) return; // don't clobber the saved snapshot before restore
        try { localStorage.setItem(TOGGLES_STATE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
    });

</script>

<section class="mt-2 mb-4" class:bench-focus={focusMode} aria-label={focusMode ? 'Cell-Free Reaction Designer (fullscreen)' : undefined}>
    {#if focusMode}
        <div class="bench-focus__hd">
            <span class="bench-focus__ttl">Cell-Free Reaction Designer</span>
            <span class="bench-focus__sub">fullscreen · Esc to exit</span>
            <button type="button" class="btn-bp" onclick={exitFocus} title="Exit fullscreen (Esc)">✕ Exit fullscreen</button>
        </div>
    {/if}
    <!-- One community-composition card, shared by the slim browse rail and the wide
         fullscreen pane. `wide` adds what the rail has no room for: the AI model,
         acknowledgements, and each batch member's own rationale. The card is a
         div[role=button] rather than a <button> so the star inside it can be a real
         button of its own. -->
    {#snippet starBtn(item)}
        {@const st = itemStars(item)}
        <button
            type="button"
            class="cf-star"
            class:is-on={st.starredByMe}
            aria-pressed={st.starredByMe}
            aria-label={`${st.starredByMe ? 'Unstar' : 'Star'} ${item.kind === 'batch' ? item.name : item.card.name} · ${st.starCount} star${st.starCount === 1 ? '' : 's'}`}
            title=""
            onclick={(e) => { e.stopPropagation(); toggleStar(item); }}
            onkeydown={(e) => e.stopPropagation()}
            onpointerenter={(e) => showStarHover(e, item)}
            onpointerleave={() => (hoverStars = null)}
        >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                    d="M8 1.4l1.95 4.1 4.45.55-3.28 3.08.84 4.42L8 11.4l-3.96 2.15.84-4.42L1.6 6.05l4.45-.55z"
                    fill={st.starredByMe ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linejoin="round"
                />
            </svg>
            {#if st.starCount}<span class="cf-star__n">{st.starCount}</span>{/if}
        </button>
    {/snippet}
    {#snippet commentBtn(item)}
        {@const n = commentsFor(threadOwner(item)).length}
        {@const open = openThreads.has(item.key)}
        <button
            type="button"
            class="cbtn"
            class:is-on={open}
            aria-expanded={open}
            title={open ? 'Hide comments' : 'Show comments'}
            onclick={(e) => { e.stopPropagation(); toggleThread(item); }}
            onkeydown={(e) => e.stopPropagation()}
        >💬 {n}</button>
    {/snippet}
    <!-- Expanded thread. Clicks/keys inside it never reach the card (which would
         load the composition into the designer). -->
    {#snippet commentThread(item)}
        {@const owner = threadOwner(item)}
        {@const comments = commentsFor(owner)}
        {@const words = wordCount(commentDraft[owner.id])}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (handlers only stop propagation to the card) -->
        <div class="cf-thread" role="group" aria-label="Comments" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
            {#if comments.length === 0}
                <p class="cf-thread__empty">No comments yet — start the thread.</p>
            {:else}
                {#each comments as c (c.id)}
                    <div class="cf-comment">
                        <div class="cf-comment__meta">
                            <span class="cf-comment__who">{c.author}</span>
                            {#if c.created}<span class="cf-comment__when">· {fmtWhen(c.created)}</span>{/if}
                            {#if c.mine}
                                <button type="button" class="cf-comment__del" disabled={commentBusy.has(owner.id)} onclick={() => sendComment(owner, { action: 'uncomment', id: c.id })} title="Delete your comment" aria-label="Delete your comment">✕</button>
                            {/if}
                        </div>
                        <p class="cf-comment__body">{c.body}</p>
                    </div>
                {/each}
            {/if}
            {#if commentError[owner.id]}<p class="cf-thread__err" role="alert">{commentError[owner.id]}</p>{/if}
            <div class="cf-compose">
                <textarea class="cf-compose__in" rows="2" placeholder="Add a comment…" bind:value={commentDraft[owner.id]} aria-label="Add a comment"></textarea>
                <span class="cf-compose__count" class:is-over={words > COMMENT_WORD_LIMIT}>{COMMENT_WORD_LIMIT - words}</span>
                <button type="button" class="cf-compose__btn" disabled={commentBusy.has(owner.id) || words === 0 || words > COMMENT_WORD_LIMIT} onclick={() => postComment(owner)}>Post</button>
            </div>
        </div>
    {/snippet}
    {#snippet commCard(item, wide)}
        {@const activate = () => (item.kind === 'batch' ? loadCommunityBatch(item) : (onPickCommunity ?? onSetCustomStart)?.(item.card.key))}
        <div
            role="button"
            tabindex="0"
            class="cf-comm-card"
            class:cf-comm-card--batch={item.kind === 'batch'}
            class:is-active={item.kind !== 'batch' && item.card.key === customStartKey}
            onclick={activate}
            onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(); } }}
            title={item.kind === 'batch'
                ? `Batch of ${item.count} — click to load all into the designer`
                : (wide ? 'Click to load into the designer' : item.card.rationale || item.card.name)}
        >
            {#if item.kind === 'batch'}
                <div class="cf-comm-card__top">
                    <span class="cf-comm-card__name">{item.name}</span>
                    {@render starBtn(item)}
                    <span class="cf-comm-card__count" title="{item.count} compositions in this batch">{item.count}×</span>
                </div>
                {#if item.targets.length}
                    <div class="cf-comm-card__tags">
                        {#each item.targets as t}
                            <span class="cf-comm-card__badge" style={proteinBadgeStyle(t)}>{t}</span>
                        {/each}
                    </div>
                {/if}
                {#if item.experimentHypothesis}
                    <p class="cf-comm-card__desc" title={wide ? undefined : item.experimentHypothesis}>{item.experimentHypothesis}</p>
                {/if}
                {#if wide}
                    {#each item.members as m (m.key)}
                        {#if m.rationale}
                            <div class="cf-comm-card__member">
                                <div class="cf-comm-card__top">
                                    <span class="cf-comm-card__name">{m.name}</span>
                                    {#if m.proteinTarget}<span class="cf-comm-card__badge" style={proteinBadgeStyle(m.proteinTarget)}>{m.proteinTarget}</span>{/if}
                                </div>
                                <p class="cf-comm-card__desc">{m.rationale}</p>
                            </div>
                        {/if}
                    {/each}
                {/if}
                <div class="cf-comm-card__foot">
                    {#if item.author}<span class="cf-comm-card__by">{item.author}</span>{/if}
                    {#if wide && item.members[0]?.aiModel}<span class="cf-comm-card__ai">{item.members[0].aiModel}</span>{/if}
                    {#if item.created}<span class="cf-comm-card__date">{fmtDate(item.created)}</span>{/if}
                    {@render commentBtn(item)}
                </div>
                {#if openThreads.has(item.key)}{@render commentThread(item)}{/if}
            {:else}
                {@const c = item.card}
                <div class="cf-comm-card__top">
                    <span class="cf-comm-card__name">{c.name}</span>
                    {@render starBtn(item)}
                    {#if c.proteinTarget}<span class="cf-comm-card__badge" style={proteinBadgeStyle(c.proteinTarget)}>{c.proteinTarget}</span>{/if}
                </div>
                {#if c.rationale}<p class="cf-comm-card__desc">{c.rationale}</p>{/if}
                {#if wide && c.acknowledgements}<p class="cf-comm-card__ack">Acknowledgements: {c.acknowledgements}</p>{/if}
                <div class="cf-comm-card__foot">
                    {#if c.author}<span class="cf-comm-card__by">{c.author}</span>{/if}
                    {#if wide && c.aiModel}<span class="cf-comm-card__ai">{c.aiModel}</span>{/if}
                    {#if c.created}<span class="cf-comm-card__date">{fmtDate(c.created)}</span>{/if}
                    {@render commentBtn(item)}
                </div>
                {#if openThreads.has(item.key)}{@render commentThread(item)}{/if}
            {/if}
        </div>
    {/snippet}
    <!-- Contributions list header + list, shared by the rail and the fullscreen pane:
         All / Starred tabs, the star error (if a request failed), and the cards. -->
    {#snippet commList(wide)}
        <div class="cf-comm-rail__hd">
            <span class="label">HTBAA Contributions</span>
            <div class="seg seg--fill" role="tablist" aria-label="Filter contributions">
                {#each commTabs as t (t)}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={commTab === t}
                        onclick={() => (commTab = t)}
                        title={t === 'all' ? 'All contributions' : t === 'starred' ? 'Compositions you starred' : `${t} compositions`}
                    >
                        <span class="cf-comm-tabs__t"
                            >{t === 'all' ? 'All' : t === 'starred' ? (wide ? '★ Starred' : '★') : t}</span>
                        <span class="cf-comm-tabs__n">{commTabCounts[t]}</span>
                    </button>
                {/each}
            </div>
            <input
                class="cf-in search-in cf-comm-search"
                type="search"
                placeholder="Search sample_id, hypothesis…"
                bind:value={commQuery}
                aria-label="Search contributions"
            />
            <div class="cf-comm-rail__meta">
                {plural(communityFormulations.length, 'composition')} by {plural(communityContributorCount, 'user')}
            </div>
        </div>
        {#if starError}<div class="cf-comm-err" role="alert">{starError}</div>{/if}
        <div class="cf-comm-rail__list" role="tabpanel">
            {#each visibleRailItems as item (item.key)}{@render commCard(item, wide)}{/each}
            {#if !visibleRailItems.length}
                <p class="cf-comm-empty">
                    {commEmptyText()}
                </p>
            {/if}
        </div>
    {/snippet}
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
    <!-- Header corner over the group-label + reagent-name columns. Fully opaque (no
         element-level opacity) so scrolling value cells can't show through it. Holds
         the fullscreen toggle (top-left) and the reagent column's resize handle. -->
    {#snippet cornerCell(rowspan)}
        <th
            colspan="2"
            {rowspan}
            class="bench-corner border-b border-base-300 sticky left-0 z-40"
            style="min-width: 182px; background: oklch(var(--b2)); "
        >
            <button
                type="button"
                class="bench-fs-btn"
                class:is-on={focusMode}
                onclick={toggleFocus}
                title={focusMode ? 'Exit fullscreen (Esc)' : 'Fullscreen: community contributions beside the comparison table'}
                aria-label={focusMode ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-pressed={focusMode}
            >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                    {#if focusMode}
                        <path d="M6 1.5V6H1.5M10 1.5V6h4.5M6 14.5V10H1.5M10 14.5V10h4.5" />
                    {:else}
                        <path d="M1.5 6V1.5H6M10 1.5h4.5V6M1.5 10v4.5H6M14.5 10v4.5H10" />
                    {/if}
                </svg>
            </button>
            {@render colResizeHandle('rcol', COL_DEFAULTS.rcol, COL_FLOOR.rcol, COL_MAX.rcol)}
        </th>
    {/snippet}
    <!-- Supplement-volume sub-line (Details view): the snapped Echo transfer nL to
         hit `value` for this reagent, computed with the same feasibilityFor model
         as the data columns so numbers line up across the whole row. -->
    {#snippet nlLine(paperName, value)}
        {@const feas = feasibilityFor(paperName, value, { aliases: reagentAliases })}
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
    <!-- Summary "yield / activity" cell. sfGFP is a true mass titer (g/L, from a
         purified-protein standard curve with a known MW); PETase/reteplase have no
         MW on file, so their reference metric is an apparent activity — an endpoint
         product concentration (µM PNP/AMC vs a product standard curve), flagged
         with a † so it isn't read as a yield. -->
    {#snippet yieldCell(bm)}
        {#if bm?.yield_g_l != null}
            <span class="opacity-70">{bm.yield_g_l.toFixed(2)}<span class="opacity-50"> g/L</span></span>
        {:else if bm?.activity_uM != null}
            <span class="opacity-70">{fmtUM(bm.activity_uM)}<span class="opacity-50"> µM</span><span style="color: #6f4bd0;">†</span></span>
        {:else}
            <span class="opacity-30">—</span>
        {/if}
    {/snippet}

    <!-- ── Mix column cells (one experimental-group column per snippet call) ──────
         Every mix renders through these so the selected (editable) mix and the
         read-only peers sit in one `{#each resolvedMixColumns}` loop, in fixed order,
         each at its own sticky offset. `bench-vsep` (left separator of the batch)
         rides the first mix column only. -->
    {#snippet mixHeaderCell(col)}
        {@const i = col.index}
        <th
            class="bench-custcol text-center px-2 py-2 border-b border-base-300 align-top"
            class:cust-mix-col--sel={col.selected}
            class:cust-mix-col--hover={!col.selected && col.id === hoveredMixId}
            class:cust-mix-col--pick={!col.selected}
            data-mix-id={col.id}
            onclick={() => onSelectMix?.(col.id)}
            style="--cust-left: {mixStickyLefts[i]}px; min-width: 64px; background: oklch(var(--b2));"
        >
            <div class="flex flex-col items-center gap-0.5 min-h-[2.4em]">
                {#if col.selected}
                    <div class="font-semibold text-[10px] leading-tight cust-mix-name" title="{col.label} (editing)">{col.label}</div>
                {:else}
                    <!-- Editing any value in this column auto-selects it; the name is a
                         shortcut to select without changing a value. It never moves. -->
                    <button
                        type="button"
                        class="cust-mix-name cust-mix-name--btn font-semibold text-[10px] leading-tight"
                        onclick={() => onSelectMix?.(col.id)}
                        title="Select {col.label} — or just start changing a value and it becomes the editable mix (it stays in place)"
                    >{col.label}</button>
                {/if}
                <!-- Same second-row actions on every mix, in this exact order: ✕ ↺ ＋ -->
                <div class="flex items-center justify-center gap-1">
                    {#if mixRemovable && onRemoveMix}
                        <button type="button" class="cust-reset" onclick={(e) => { e.stopPropagation(); onRemoveMix(col.id); }} title="Remove this mix" aria-label="Remove {col.label}">✕</button>
                    {/if}
                    {#if onResetMix}
                        <button type="button" class="cust-reset" onclick={(e) => { e.stopPropagation(); onResetMix(col.id); }} title="Reset this mix to its starting composition" aria-label="Reset {col.label}">↺</button>
                    {/if}
                    {#if onAddMix}
                        <button type="button" class="cust-reset cust-add" onclick={(e) => { e.stopPropagation(); onAddMix(col.id); }} title="Add a new Mix column (copy of this mix)" aria-label="Add a new Mix column from {col.label}">＋</button>
                    {/if}
                </div>
            </div>
            {#if onSetMixTarget}
                <!-- Protein target for this mix (recorded as protein_target on submit). -->
                <select
                    class="cust-mix-target"
                    value={col.proteinTarget || proteinTargets[0]}
                    onchange={(e) => onSetMixTarget(col.id, e.currentTarget.value)}
                    onclick={(e) => e.stopPropagation()}
                    title="Protein target for this mix"
                    aria-label="Protein target for {col.label}"
                >
                    {#each proteinTargets as t}
                        <option value={t}>{t}</option>
                    {/each}
                </select>
            {/if}
            {#if col.selected}
                <!-- Starting-composition picker (editable mix only). Loads a recipe into
                     the live design + re-baselines; once edited it reads "Custom". -->
                <select
                    class="text-center text-[9px] rounded border border-base-content/20 bg-base-100 text-base-content/70 px-1 py-0.5 mt-1"
                    style="width: 100%; min-width: 0; max-width: 88px; text-overflow: ellipsis;"
                    value={customIsCustomized ? '__custom__' : customStartKey}
                    onchange={(e) => { const k = e.currentTarget.value; if (k !== '__custom__') onSetCustomStart?.(k); }}
                    title="Starting composition — pick a recipe to load into this mix"
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
            {:else}
                <div class="text-[8px] opacity-45 leading-tight mt-1 cust-mix-hint" aria-hidden="true">{col.isCustomized ? 'custom' : 'recipe'}</div>
            {/if}
            {@render colResizeHandle('mix:' + i, COL_DEFAULTS.custom, COL_FLOOR.value, COL_MAX.value)}
        </th>
    {/snippet}

    {#snippet mixBodyCell(col, paperName)}
        {@const i = col.index}
        <!-- Live steppers on EVERY mix: the selected mix reads the live buffer
             (customMix); peers read their own stored volumes (col.stepper). Touching a
             peer's +/- promotes it to selected first (mixStepScrub/mixStepClick) so the
             column you start changing becomes the editable one — no separate "click to
             edit" step. -->
        {@const cm = col.selected ? customMix?.[paperName] : col.stepper?.[paperName]}
        <td
            class="bench-custcol text-center px-1 py-1 font-mono leading-tight"
            class:cust-mix-col--sel={col.selected}
            class:cust-mix-col--hover={!col.selected && col.id === hoveredMixId}
            class:cust-mix-col--pick={!col.selected}
            data-mix-id={col.id}
            onclick={() => { if (!col.selected) onSelectMix?.(col.id); }}
            style="--cust-left: {mixStickyLefts[i]}px; background: {col.selected ? 'oklch(var(--b1))' : 'oklch(var(--b2))'};"
        >
            {#if cm && cm.value != null}
                {#if cm.adjustable && onAdjust}
                    {@const isZero = cm.value === 0}
                    <div class="cust-cell" class:cust-cell--zero={isZero} class:cust-cell--active={!isZero}>
                        <button class="cust-step" onpointerdown={(e) => mixStepScrub(e, col, cm.reagentId, -1)} onclick={(e) => mixStepClick(e, col, cm.reagentId, -1)} disabled={!cm.canDec} aria-label={`Decrease ${paperName} in ${col.label}`}>−</button>
                        <span class="cust-val">{#if isZero}—{:else}{fmt(cm.value)}{/if}</span>
                        <button class="cust-step" onpointerdown={(e) => mixStepScrub(e, col, cm.reagentId, 1)} onclick={(e) => mixStepClick(e, col, cm.reagentId, 1)} disabled={!cm.canInc} aria-label={`Increase ${paperName} in ${col.label}`}>+</button>
                    </div>
                {:else}
                    <span class="opacity-80">{fmt(cm.value)}</span>
                {/if}
                {#if showSupplementNl && cm.value}{@render nlLine(paperName, cm.value)}{/if}
            {:else}
                <span class="opacity-30">—</span>
            {/if}
        </td>
    {/snippet}

    {#snippet mixWaterCell(col)}
        {@const i = col.index}
        <td
            class="bench-custcol text-center px-1 py-1 font-mono leading-tight"
            class:cust-mix-col--sel={col.selected}
            class:cust-mix-col--hover={!col.selected && col.id === hoveredMixId}
            class:cust-mix-col--pick={!col.selected}
            data-mix-id={col.id}
            onclick={() => { if (!col.selected) onSelectMix?.(col.id); }}
            style="--cust-left: {mixStickyLefts[i]}px; background: {col.selected ? 'oklch(var(--b1))' : 'oklch(var(--b2))'};"
        >
            {#if col.selected}
                {#if customWaterUl != null}<span class="opacity-80">{customWaterUl.toFixed(2)}</span>{:else}<span class="opacity-30">—</span>{/if}
            {:else if col.bm}
                {@const colWaterUl = waterFillNlForFormulation(col.bm, { aliases: reagentAliases }) / 1000}
                {@const colWaterPct = pctDiff(colWaterUl, customWaterUl)}
                <div class="opacity-80 leading-tight">{colWaterUl.toFixed(2)}</div>
                {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(colWaterPct)}">{pctLabel(colWaterPct)}</div>{/if}
            {:else}
                <span class="opacity-30">—</span>
            {/if}
        </td>
    {/snippet}

    <!-- Summary-row mix cell. kind: yield | costg | costml | cost20. The selected mix
         shows the parent's live cost figures; peers show their own back-solved cost. -->
    {#snippet mixSummaryCell(col, kind)}
        {@const i = col.index}
        <td
            class="bench-custcol text-center py-1 font-mono"
            class:cust-mix-col--sel={col.selected}
            class:cust-mix-col--hover={!col.selected && col.id === hoveredMixId}
            class:cust-mix-col--pick={!col.selected}
            data-mix-id={col.id}
            onclick={() => { if (!col.selected) onSelectMix?.(col.id); }}
            style="--cust-left: {mixStickyLefts[i]}px; background: oklch(var(--b2));"
            title={col.selected && kind === 'cost20' && customCostUsd != null ? `≈ ${fmtCost(customCostUsd)} per 20 µL reaction (as mixed)` : (col.selected && kind === 'costml' && customCostUsd != null ? `≈ ${fmtCost(customCostUsd)} per reaction as mixed` : '')}
        >
            {#if kind === 'yield'}
                {@render yieldCell(col.bm)}
            {:else if kind === 'costg'}
                <span class="opacity-70">{fmtCost(col.bm?.cost_per_g)}</span>
            {:else if kind === 'costml'}
                {#if col.selected}<span class="opacity-90" style="color: oklch(var(--bc));">{fmtCost(customCostPerMl)}</span>{:else}<span class="opacity-70">{col.bm?.cost_per_l != null ? fmtCost(col.bm.cost_per_l / 1000) : '—'}</span>{/if}
            {:else}
                {#if col.selected}<span class="opacity-90" style="color: oklch(var(--bc));">{fmtCost(customCostUsd)}</span>{:else}<span class="opacity-70">{col.bm?.cost_per_l != null ? fmtCost(col.bm.cost_per_l / 50000) : '—'}</span>{/if}
            {/if}
        </td>
    {/snippet}

    <!-- "Add mix" rail — a thin frozen column pinned between the rightmost mix and
         the rest of the table, clickable along its FULL height to add a mix. The ＋
         rides the sticky header so it stays in view; every body cell is a click
         target too, and the whole column lights up together on hover (railHovered).
         Omitted entirely when onAddMix isn't wired. -->
    {#snippet railHeaderCell()}
        {#if onAddMix}
            <th class="bench-custcol bench-rail bench-rail--head border-b border-base-300" class:bench-rail--hover={railHovered} data-rail="1" style="--cust-left: {railStickyLeft}px; width: {RAIL_WIDTH}px; min-width: {RAIL_WIDTH}px; background: oklch(var(--b2));">
                <button type="button" class="add-col-rail add-col-rail--col" onclick={() => onAddMix()} title="Add a new Mix column (copy of the selected mix)" aria-label="Add a new Mix column" tabindex="-1">
                    <span class="add-col-rail__plus">＋</span>
                    <span class="add-col-rail__label">add mix</span>
                </button>
            </th>
        {/if}
    {/snippet}
    {#snippet railCell()}
        {#if onAddMix}
            <td class="bench-custcol bench-rail bench-rail--click" class:bench-rail--hover={railHovered} data-rail="1" onclick={() => onAddMix()} title="Add a new Mix column (copy of the selected mix)" style="--cust-left: {railStickyLeft}px; width: {RAIL_WIDTH}px; min-width: {RAIL_WIDTH}px; background: oklch(var(--b2));"></td>
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
    <!-- Designer table with a full-height toggle tab welded to its left edge —
         mirroring the ＋ add-column rail pinned to the right edge. Pressing the tab
         slides a browse drawer out to the tab's left. Only offered when there are
         community compositions to show (none for a signed-out visitor). -->
    <div class="cf-designer-row" class:is-split={focusMode && communityByRecent.length > 0}>
        <!-- The browse drawer opens to the LEFT of the toggle tab, so the tab stays
             welded to the table's left edge (right beside the reagent-category
             column) in both states. The tab — or, when open, the drawer — supplies
             the table's rounded left corners; the table card itself is squared on the
             left so the pieces read as one. -->
        {#if focusMode && communityByRecent.length > 0}
            <!-- Fullscreen: the contributions get the whole left half, with wide,
                 taller text boxes for reading long rationales. -->
            <aside class="cf-comm-rail cf-comm-rail--wide" aria-label="Community compositions, newest first">
                {@render commList(true)}
            </aside>
        {:else if showCommunityRail && communityByRecent.length > 0}
            <aside class="cf-comm-rail" aria-label="Community compositions, newest first">
                {@render commList(false)}
            </aside>
        {/if}
        {#if communityByRecent.length > 0 && !focusMode}
            <button
                type="button"
                class="cf-comm-toggle-rail"
                aria-pressed={showCommunityRail}
                onclick={() => (showCommunityRail = !showCommunityRail)}
                title="Browse community compositions and click one to load it into the table"
                aria-label={showCommunityRail ? 'Hide community compositions' : 'Show community compositions'}
            >
                <span class="cf-comm-toggle-rail__label"
                    >{showCommunityRail
                        ? 'Hide'
                        : `Community · ${communityByRecent.length} by ${plural(communityContributorCount, 'user')}`}</span>
            </button>
        {/if}

        <div class="cf-designer-main">
    <!-- The table is its own rounded, bordered card (the section is now just a
         transparent spacing wrapper — no white background). overflow-auto clips the
         opaque sticky cells to all four rounded corners. w-fit + max-w-full makes the
         card hug the table's own width (no white side gutters) but still scroll when
         the grid is wider than the viewport. Radius tracks var(--r) to match the
         sibling .panel sections; bg-base-100 keeps the grid opaque. -->
    <div class="bench-scroll pb-3 pr-3 overflow-auto max-h-[78vh] isolate border border-base-300 bg-base-100 w-fit max-w-full mx-auto {communityByRecent.length > 0 ? 'rounded-r-[var(--r,5px)]' : 'rounded-[var(--r,5px)]'}" bind:this={tableScrollEl} onscroll={hideSynopsisHover}>
        <!-- Flex rail wrapper: the table plus a thin full-height "add column" button
             pinned to its right edge, so you can add a comparison column the moment
             you scroll to the edge. -->
        <div class="flex items-stretch w-max mx-auto">
            <!-- border-separate (not collapse): collapse breaks position:sticky on
                 the thead (ghost/duplicate rows) and drops per-cell box-shadows.
                 Separated borders with 0 spacing render identically but make the
                 sticky header + frozen columns + seam shadows reliable. -->
            <table class="self-start text-[11px] border-separate border-spacing-0" onmouseover={onTableHover} onmouseleave={clearTableHover}>
                <!-- One <col> per column, in visual order, so a single width value
                     sizes every cell in a column (header + body + summary rows).
                     The group column and the reference/literature columns keep their
                     content-driven sizing; the customizer columns are drag-resizable
                     via colWidths (see startColResize / colResizeHandle). -->
                <colgroup>
                    <col style="width: 32px;" />
                    <col style={colColStyle('rcol', COL_DEFAULTS.rcol)} />
                    {#each resolvedMixColumns as _col, i (i)}
                        <col style={colColStyle('mix:' + i, COL_DEFAULTS.custom)} />
                    {/each}
                    {#if onAddMix}
                        <col style="width: {RAIL_WIDTH}px;" />
                    {/if}
                    {#if showComparison}
                        <col style={colColStyle('comparison', COL_DEFAULTS.comparison)} />
                    {/if}
                    {#if showClosestMatch}
                        <col style={colColStyle('closest', COL_DEFAULTS.closest)} />
                    {/if}
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
                            <!-- With the group row present the corner spans both header
                                 rows, so the fullscreen icon sits in the table's true
                                 top-left corner. -->
                            {@render cornerCell(2)}
                            <!-- The whole frozen experimental group (mixes + add-mix rail
                                 + optional comparison / closest reference columns) sits
                                 immediately right of the reagent names as one blank frozen
                                 spacer; enabled reference groups append to its right. No
                                 group label — it just blends with the header surface. -->
                            <th
                                colspan={resolvedMixColumns.length + (onAddMix ? 1 : 0) + (showComparison ? 1 : 0) + (showClosestMatch ? 1 : 0)}
                                class="bench-vsep bench-custcol border-b"
                                style="--cust-left: {customStickyLeft}px; background: oklch(var(--b2)); border-color: oklch(var(--bc) / 0.12);"
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
                    {/if}
                    <tr>
                        <!-- Corner cell spans both the rotated group-label column AND
                             the reagent-name column. Intentionally empty + fully opaque
                             (no element-level opacity) so scrolling value cells can't
                             show through it. -->
                        {#if !displayColumnGroups.length}{@render cornerCell(1)}{/if}
                        <!-- Mix batch — every custom mix is an equal peer that stays in
                             its creation slot. The selected mix renders editable steppers;
                             the rest are read-only snapshots. Every header carries the same
                             second-row actions in this exact order: ✕ ↺ ＋. -->
                        {#each resolvedMixColumns as col (col.id)}{@render mixHeaderCell(col)}{/each}
                        {@render railHeaderCell()}
                        <!-- Comparison Mix header holds the view-only reference
                             dropdown; sits right of the mix batch + rail. Off by default
                             (toggled via "Comparison"). -->
                        {#if showComparison}
                        <th class="bench-custcol text-center px-2 py-2 border-b border-base-300 align-top" style="--cust-left: {comparisonStickyLeft}px; min-width: 64px; background: oklch(var(--b2));">
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
                                    title="Reference formulation to diff the active mix against"
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
                            <th class="bench-custcol text-center px-2 py-2 border-b border-base-300 align-top" style="--cust-left: {closestStickyLeft}px; min-width: 64px; background: oklch(var(--b2));">
                                <div class="font-semibold text-[10px] leading-tight">Closest Match</div>
                                {#if closestMatch}
                                    <div class="text-[9px] leading-tight mt-0.5 font-semibold" style="color: #4a5560;">{closestNameParts.main}{#if closestNameParts.sub}<br/><span class="font-normal opacity-70">{closestNameParts.sub}</span>{/if}</div>
                                    <div class="text-[9px] opacity-55 leading-tight">{(closestMatch.score * 100).toFixed(0)}% similar</div>
                                {:else}
                                    <div class="text-[9px] opacity-55 leading-tight mt-0.5">design a mix</div>
                                {/if}
                                {@render colResizeHandle('closest', COL_DEFAULTS.closest, COL_FLOOR.value, COL_MAX.value)}
                            </th>
                        {/if}
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
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">yield / activity</span></td>
                        {#each resolvedMixColumns as col (col.id)}{@render mixSummaryCell(col, 'yield')}{/each}
                        {@render railCell()}
                        {#if showComparison}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));">{@render yieldCell(comparisonBm)}</td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));">{@render yieldCell(closestMatch?.bm)}</td>
                        {/if}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};">{@render yieldCell(bm)}</td>
                        {/each}
                    </tr>
                    {#if showSupplementNl}
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">$/g protein</span></td>
                        {#each resolvedMixColumns as col (col.id)}{@render mixSummaryCell(col, 'costg')}{/each}
                        {@render railCell()}
                        {#if showComparison}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{fmtCost(comparisonBm?.cost_per_g)}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{fmtCost(closestMatch?.bm?.cost_per_g)}</span></td>
                        {/if}
                        {#each displayFormulations as bm}
                            <td class="text-center py-1 font-mono" style="background: oklch(var(--b2)); box-shadow: {colOutline(selectedKey === bm.key)};"><span class="opacity-70">{fmtCost(bm.cost_per_g)}</span></td>
                        {/each}
                    </tr>
                    <!-- Direct reagent cost per mL of reaction. The Custom Mix cell is
                         computed live by the parent from the current design volumes ×
                         per-mL catalog costs (autonomous-cfps models.py); reference
                         columns show each formulation's published cost_per_l ÷ 1000. -->
                    <tr class="text-[9px]">
                        <td colspan="2" class="text-right pr-3 py-1 sticky left-0 z-40" style="background: oklch(var(--b2)); "><span class="opacity-60">reagent cost ($/mL)</span></td>
                        {#each resolvedMixColumns as col (col.id)}{@render mixSummaryCell(col, 'costml')}{/each}
                        {@render railCell()}
                        {#if showComparison}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{comparisonBm?.cost_per_l != null ? fmtCost(comparisonBm.cost_per_l / 1000) : '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.cost_per_l != null ? fmtCost(closestMatch.bm.cost_per_l / 1000) : '—'}</span></td>
                        {/if}
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
                        {#each resolvedMixColumns as col (col.id)}{@render mixSummaryCell(col, 'cost20')}{/each}
                        {@render railCell()}
                        {#if showComparison}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{comparisonBm?.cost_per_l != null ? fmtCost(comparisonBm.cost_per_l / 50000) : '—'}</span></td>
                        {/if}
                        {#if showClosestMatch}
                            <td class="bench-custcol text-center py-1 font-mono" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-70">{closestMatch?.bm.cost_per_l != null ? fmtCost(closestMatch.bm.cost_per_l / 50000) : '—'}</span></td>
                        {/if}
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
                    {#each reagentGroups as group, groupIndex}
                        {#each group.reagents as paperName, reagentIndex}
                            {@const alias = reagentAliases[paperName]}
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
                            {@const syn = synopsisFor(paperName)}
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
                                        {#if syn}
                                            <!-- Light blue = recently added reagent (see synopsisFor). title="" stops the
                                                 browser showing the cell's own tooltip on top of the hover popup. -->
                                            <button
                                                type="button"
                                                class="text-[10px] leading-none px-1 py-0.5 rounded {isNewReagent(syn) ? 'bench-info--new' : 'text-base-content/40 hover:text-base-content hover:bg-base-content/10'}"
                                                title=""
                                                onclick={(e) => { e.stopPropagation(); hideSynopsisHover(); activeSynopsis = { name: paperName, synopsis: syn }; }}
                                                onpointerenter={(e) => queueSynopsisHover(e, paperName)}
                                                onpointerleave={leaveSynopsisHover}
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
                                {#each resolvedMixColumns as col (col.id)}{@render mixBodyCell(col, paperName)}{/each}
                                {@render railCell()}
                                {#if showComparison}
                                    <td class="bench-custcol text-center px-1 py-1 font-mono leading-tight" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));">
                                        {@render refValueDelta(paperName, compVal)}
                                    </td>
                                {/if}
                                {#if showClosestMatch}
                                    <td class="bench-custcol text-center px-1 py-1 font-mono leading-tight" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));">
                                        {@render refValueDelta(paperName, closestComponents?.[paperName])}
                                    </td>
                                {/if}
                                {#each displayFormulations as bm}
                                    {@const val = applyAll(bm).components[paperName]}
                                    {@const isSel = selectedKey === bm.key}
                                    {#if val == null}
                                        <!-- Reagent unused in this formulation — leave the cell blank
                                             (but still draw the column outline through it when selected). -->
                                        <td style="background: oklch(var(--b2)); box-shadow: {colOutline(isSel)};"></td>
                                    {:else}
                                        {@const feas = feasibilityFor(paperName, val, { aliases: reagentAliases })}
                                        {@const style = feasibilityCellStyle(feas)}
                                        {@const ratioInferred = bm.ratioInferred?.includes(paperName)}
                                        {@const baseTooltip = feas.status === 'missing'
                                            ? `${paperName}: ${val} ${alias?.unit ?? ''} — theoretical (${feas.reason || 'not in stock; add to order list to run this formulation'})`
                                            : feas.status === 'over-baseline'
                                                ? feas.reason
                                                : (feas.baseContribution > 0
                                                    ? `${paperName}: ${val} ${alias.unit} target. Base buffer contributes ${feas.baseContribution} → supplement ${feas.neededSupplementMm.toFixed(1)} ${alias.unit} (${feas.pctHeadroom.toFixed(0)}% of add-budget).`
                                                    : `${paperName}: ${val} ${alias.unit} → ${feas.pctHeadroom.toFixed(0)}% of reagent-add budget`)}
                                        {@const tooltip = ratioInferred ? `${baseTooltip}\n\n* The paper specifies "phosphate" but not the dibasic:monobasic ratio; assigned to the 1.6:1 dibasic:monobasic mix (buffers to ~pH 7.0 at cell-free ionic strength, matching the reported reaction pH).` : baseTooltip}
                                        <td
                                            class="text-center px-1 py-1 font-mono cursor-help leading-tight"
                                            style="background: {style.bg}; color: {style.text}; box-shadow: {colOutline(isSel)};"
                                            title={tooltip}
                                        >
                                            <div>{fmt(val)}{#if ratioInferred}<span class="opacity-60" style="color: #6f4bd0;" title="Ratio not specified in the paper — assigned to the 1.6:1 dibasic:monobasic mix.">*</span>{/if}</div>
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
                        {#each resolvedMixColumns as col (col.id)}{@render mixWaterCell(col)}{/each}
                        {@render railCell()}
                        {#if showComparison}
                            {#if comparisonBm}
                                {@const compWaterUl = waterFillNlForFormulation(comparisonBm, { aliases: reagentAliases }) / 1000}
                                {@const compWaterPct = pctDiff(compWaterUl, customWaterUl)}
                                <td class="bench-custcol text-center px-1 py-1 font-mono leading-tight" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));">
                                    <div class="opacity-80 leading-tight">{compWaterUl.toFixed(2)}</div>
                                    {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(compWaterPct)}">{pctLabel(compWaterPct)}</div>{/if}
                                </td>
                            {:else}
                                <td class="bench-custcol text-center px-1 py-1 font-mono" style="--cust-left: {comparisonStickyLeft}px; background: oklch(var(--b2));"><span class="opacity-30">—</span></td>
                            {/if}
                        {/if}
                        {#if showClosestMatch}
                            {@const closestWaterUl = closestMatch ? waterFillNlForFormulation(applyAll(closestMatch.bm), { aliases: reagentAliases }) / 1000 : null}
                            <td class="bench-custcol text-center px-1 py-1 font-mono leading-tight" style="--cust-left: {closestStickyLeft}px; background: oklch(var(--b2));">
                                {#if closestWaterUl != null}
                                    {@const closestWaterPct = pctDiff(closestWaterUl, customWaterUl)}
                                    <div class="opacity-80 leading-tight">{closestWaterUl.toFixed(2)}</div>
                                    {#if showSupplementNl}<div class="text-[8px] leading-tight {pctClass(closestWaterPct)}">{pctLabel(closestWaterPct)}</div>{/if}
                                {:else}<span class="opacity-30">—</span>{/if}
                            </td>
                        {/if}
                        {#each displayFormulations as bm}
                            {@const waterNl = waterFillNlForFormulation(applyAll(bm), { aliases: reagentAliases })}
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
        </div>
        </div><!-- /.cf-designer-main -->
    </div><!-- /.cf-designer-row -->

    <div class="bench-toolbar flex flex-col items-center gap-2 px-3 pt-3 pb-1">
        <!-- Table settings: conventional on/off switches grouped by what they affect,
             a segmented picker for the salt preset, and the exports. -->
        {#snippet settingSwitch(label, on, toggle, title)}
            <button type="button" role="switch" aria-checked={on} class="bench-switch" onclick={toggle} {title}>
                <span class="bench-switch__track" aria-hidden="true"><span class="bench-switch__thumb"></span></span>
                {label}
            </button>
        {/snippet}
        <div class="bench-settings" role="group" aria-label="Table settings">
            <span class="bench-settings__lbl">Columns</span>
            <div class="bench-settings__items">
                {@render settingSwitch('Reference plates', showReferencePlates, () => (showReferencePlates = !showReferencePlates), "Show Ginkgo's reference-plate formulations")}
                {@render settingSwitch('Ginkgo', showGinkgo, () => (showGinkgo = !showGinkgo), "Show Ginkgo's autonomous (GPT-5 / Smith et al.) reactions")}
                {@render settingSwitch('Literature', showLiterature, () => (showLiterature = !showLiterature), 'Show published literature formulations')}
                {@render settingSwitch('Closest match', showClosestMatch, () => (showClosestMatch = !showClosestMatch), 'Show the known reaction the active mix most resembles')}
            </div>
            <span class="bench-settings__lbl">View</span>
            <div class="bench-settings__items">
                {@render settingSwitch('Details', showSupplementNl, toggleSupplementMode, 'Show per-reagent supplement volumes (nL) and the $/g cost row')}
                <span class="bench-settings__sub" id="bench-salt-lbl">Salt optima</span>
                <div
                    class="bench-seg"
                    role="radiogroup"
                    aria-labelledby="bench-salt-lbl"
                    title="Override K(Glu) and Mg(Glu)2 across all formulations to a target's salt optimum"
                >
                    {#each Object.entries(SALT_OPTIMA) as [key, opt]}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={saltOptima === key}
                            class:is-on={saltOptima === key}
                            onclick={() => (saltOptima = key)}
                        >{opt.label}</button>
                    {/each}
                </div>
            </div>
            <div class="bench-settings__export">
                <span class="bench-settings__lbl">Export</span>
                <button type="button" class="bench-settings__act" onclick={downloadCSV} title="Download concentrations as CSV">↓ CSV</button>
                <button
                    type="button"
                    class="bench-settings__act"
                    onclick={downloadTableImage}
                    disabled={isDownloading}
                    title="Download table as PNG"
                >{isDownloading ? 'Saving…' : '↓ PNG'}</button>
            </div>
        </div>
        {#if submitRow}
            <div class="flex items-center flex-wrap justify-center">
                {@render submitRow()}
            </div>
        {/if}
    </div>

    <!-- ── Design notices (live) + export panels ─────────────────────────── -->
    <!-- Hidden in fullscreen focus mode, which is just the designs + toggle bar. -->
    {#if !focusMode}
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
            <!-- Half-width, aligned under the "reagent supplement JSON" (right)
                 column by reusing the export panels' 2-col grid; the empty left
                 cell is just a spacer. Styled as a blueprint .panel so its
                 background matches the JSON panel it sits under. -->
            <div class="cfps-2col">
                <div class="snap-spacer" aria-hidden="true"></div>
                <div class="panel">
                    <div class="panel__hd">
                        <span class="label" style="color: var(--amber);">snap rounding ≥3% off target · {discrepancies.length} reagent{discrepancies.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="panel__bd">
                        <table class="cfps-table">
                            <thead>
                                <tr>
                                    <th style="width:40%;">Reagent</th>
                                    <th style="width:25%; text-align:right;">Intended</th>
                                    <th style="width:25%; text-align:right;">Achievable</th>
                                    <th style="width:10%; text-align:right;">Δ%</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each discrepancies as d}
                                    <tr>
                                        <td>{d.name}</td>
                                        <td style="text-align:right; color: var(--muted);">{d.intendedLabel}</td>
                                        <td style="text-align:right;">{d.achievableLabel}</td>
                                        <td style="text-align:right; color: var(--amber);">{d.pct.toFixed(1)}%</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        {/if}
    </div>
    {/if}

</section>

<svelte:window onkeydown={handleSynopsisKeydown} onscroll={hideSynopsisHover} onresize={hideSynopsisHover} />
<svelte:document onfullscreenchange={onFullscreenChange} />

<!-- Reagent summary body, shared by the click modal and the hover popover.
     `compact` shrinks the structure image for the popover. -->
{#snippet synopsisBody(name, synopsis, compact)}
    {#if isNewReagent(synopsis)}
        <p class="bench-info-note">
            {synopsis.addedOn
                ? `New — added to the designer on ${fmtAddedOn(synopsis.addedOn)}.`
                : 'New — auto-added from the live reagent catalog; not yet given a curated row.'}
        </p>
    {/if}
    {#if synopsis.mol}
        <div class="flex justify-center rounded-md bg-white border border-base-300/70 p-2">
            <img
                src={molImageUrl(synopsis.mol)}
                alt={`2D structure of ${name}`}
                loading="lazy"
                class="{compact ? 'h-[110px]' : 'h-[180px]'} w-auto object-contain"
                onerror={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
            />
        </div>
    {/if}
    <p>{synopsis.role}</p>
    {#if synopsis.proteins}
        <div class="space-y-2 pt-1 border-t border-base-300/50">
            {#each Object.entries(synopsis.proteins) as [protein, note]}
                <div>
                    <span class="text-xs font-semibold uppercase tracking-wide text-base-content/40">{protein === 'sfgfp' ? 'sfGFP' : protein === 'petase' ? 'PETase' : protein === 'reteplase' ? 'Reteplase' : protein}</span>
                    <p class="text-xs text-base-content/65 mt-0.5">{note}</p>
                </div>
            {/each}
        </div>
    {/if}
    {#if synopsis.mol || synopsis.wiki}
        <div class="pt-1 border-t border-base-300/50">
            <a
                href={pubchemUrl(synopsis.mol ?? synopsis.wiki)}
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >Look up on PubChem →</a>
        </div>
    {/if}
{/snippet}

{#if activeSynopsis}
    <!-- z-[200]: same layer as the page's other modals, above the fullscreen designer. -->
    <div
        class="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
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
                {@render synopsisBody(activeSynopsis.name, activeSynopsis.synopsis, false)}
            </div>
        </div>
    </div>
{/if}

{#if hoverStars}
    <div
        class="cf-star-who"
        style="left: {hoverStars.left}px; {hoverStars.top != null ? `top: ${hoverStars.top}px` : `bottom: ${hoverStars.bottom}px`};"
        role="tooltip"
    >
        <div class="cf-star-who__hd">Starred by {hoverStars.names.length}</div>
        <ul>{#each hoverStars.names as n}<li>{n}</li>{/each}</ul>
    </div>
{/if}

{#if hoverSynopsis && !activeSynopsis}
    <div
        class="fixed z-[210] overflow-auto rounded-lg shadow-xl border border-base-300 bg-base-100"
        style="left: {hoverSynopsis.left}px; {hoverSynopsis.top != null ? `top: ${hoverSynopsis.top}px` : `bottom: ${hoverSynopsis.bottom}px`}; width: {SYN_POP_W}px; max-height: {hoverSynopsis.maxH}px;"
        onpointerenter={() => clearTimeout(synHideTimer)}
        onpointerleave={leaveSynopsisHover}
        role="tooltip"
    >
        <div class="px-3.5 py-2 border-b border-base-300 bg-base-200/60 flex items-baseline justify-between gap-3">
            <h3 class="text-[13px] font-semibold text-base-content/80">{hoverSynopsis.name}</h3>
            <span class="text-[9px] uppercase tracking-wider text-base-content/40 whitespace-nowrap">click ⓘ to expand</span>
        </div>
        <div class="px-3.5 py-3 space-y-2.5 text-[12.5px] text-base-content/80 leading-relaxed">
            {@render synopsisBody(hoverSynopsis.name, hoverSynopsis.synopsis, true)}
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

    /* ── Community-composition browse rail + designer, side by side ──────────── */
    /* gap:0 so the tab welds to the table's left edge. The whole drawer+tab+table
       unit is centred by the row; the table wrapper is shrink-to-fit (not flex-grow)
       so the table hugs the tab instead of centring inside leftover space (which was
       leaving a gap between the tab and the reagent-category column). */
    .cf-designer-row { display: flex; align-items: stretch; justify-content: center; gap: 0; max-width: 100%; }
    .cf-designer-main { flex: 0 1 auto; min-width: 0; display: flex; }
    /* Slim full-height toggle tab welded to the table's left edge (mirrors the ＋
       add-column rail on the right). Its right border is pulled 1px into the table so
       the two share one seam. Closed, it is the leftmost edge and carries the table's
       rounded left corners; open, the drawer to its left owns the rounding, so the tab
       squares off on both sides to sit between the drawer and the table. */
    .cf-comm-toggle-rail {
        flex: 0 0 24px; align-self: stretch; max-height: 78vh;
        display: flex; align-items: center; justify-content: center;
        padding: 6px 0; cursor: pointer;
        border: 1px solid var(--hair);
        border-radius: var(--r, 5px) 0 0 var(--r, 5px);
        margin-right: -1px; position: relative; z-index: 1;
        background: var(--surface-2); color: var(--muted);
        transition: background .15s ease, color .15s ease, border-color .15s ease;
    }
    .cf-comm-toggle-rail:hover { background: #fff; color: var(--teal); border-color: var(--teal); }
    .cf-comm-toggle-rail[aria-pressed="true"] { background: var(--teal-wash); color: var(--teal-ink); border-color: var(--teal); border-radius: 0; }
    .cf-comm-toggle-rail__label {
        writing-mode: vertical-rl; transform: rotate(180deg);
        font: 500 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; white-space: nowrap;
    }
    .cf-comm-rail {
        flex: 0 0 248px; align-self: stretch; max-height: 78vh; min-width: 0;
        margin-right: -1px; position: relative; z-index: 2;
        display: flex; flex-direction: column;
        /* Open, the drawer is the leftmost edge of the table unit: round its left
           corners, square the right so it welds flush to the tab (and so to the table). */
        border: 1px solid var(--hair); border-radius: var(--r, 5px) 0 0 var(--r, 5px);
        background: var(--surface-2); overflow: hidden;
    }
    .cf-comm-rail__hd { padding: 7px 9px; border-bottom: 1px solid var(--hair); background: var(--surface); flex: 0 0 auto; }
    .cf-comm-rail__hd .label {
        font: 500 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
    }
    .cf-comm-rail__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 7px; display: flex; flex-direction: column; gap: 6px; }
    .cf-comm-card {
        display: flex; flex-direction: column; gap: 5px; width: 100%;
        text-align: left; cursor: pointer;
        padding: 8px 9px; border: 1px solid var(--hair); border-radius: var(--r-sm);
        background: var(--surface-2); color: var(--ink-2);
        transition: border-color .12s, background .12s;
    }
    .cf-comm-card:hover { border-color: var(--teal); background: #fff; }
    .cf-comm-card.is-active { border-color: var(--teal); background: var(--teal-wash); }
    .cf-comm-card__top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .cf-comm-card__name {
        min-width: 0; flex: 0 1 auto;
        font: 600 11.5px/1.2 var(--sans); color: var(--ink);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cf-comm-card__badge {
        flex: 0 0 auto; max-width: 45%;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font: 500 8.5px/1.3 var(--mono); letter-spacing: .04em;
        color: var(--teal-ink); background: var(--teal-wash);
        border: 1px solid var(--teal); border-radius: var(--r-sm); padding: 2px 5px;
    }
    .cf-comm-card__desc {
        margin: 0; padding: 6px 7px; font: 10px/1.4 var(--mono); color: var(--ink-2);
        max-height: 68px; overflow-y: auto; overflow-wrap: anywhere; word-break: break-word;
        border: 1px solid var(--hair); border-radius: var(--r-sm); background: var(--surface);
    }
    .cf-comm-card__foot {
        display: flex; align-items: center; gap: 6px; margin-top: 1px;
        font: 9px/1.3 var(--mono); color: var(--muted);
    }
    .cf-comm-card__by { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cf-comm-card__date { margin-left: auto; flex: 0 0 auto; color: var(--faint); }
    /* Batch card in the community rail: a group of compositions submitted together.
       A left accent + a count chip + one tag per distinct protein target inside it. */
    .cf-comm-card--batch { border-left: 3px solid var(--teal); }
    .cf-comm-card__count {
        flex: 0 0 auto; font: 700 9px/1.3 var(--mono); letter-spacing: .04em;
        color: var(--teal-ink); background: var(--teal-wash);
        border: 1px solid var(--teal); border-radius: var(--r-sm); padding: 2px 5px;
    }
    .cf-comm-card__tags { display: flex; flex-wrap: wrap; gap: 4px; }
    /* The star sits right after the name; the target badge / batch count pins right. */
    .cf-comm-card__top > .cf-comm-card__badge,
    .cf-comm-card__top > .cf-comm-card__count { margin-left: auto; }
    .cf-comm-card:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
    .cf-star {
        flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px;
        padding: 2px 4px; margin: -2px 0; border: 1px solid transparent; border-radius: var(--r-sm);
        background: none; color: var(--faint); cursor: pointer;
        font: 600 9.5px/1 var(--mono);
        transition: color .12s, background .12s, border-color .12s;
    }
    .cf-star:hover { color: #c98a00; background: #fff8e6; border-color: #f0d590; }
    .cf-star.is-on { color: #d99a00; }
    .cf-star__n { color: var(--muted); }
    .cf-star.is-on .cf-star__n { color: #a87600; }
    .cf-star-who {
        position: fixed; z-index: 215; width: max-content; max-width: 220px; max-height: 240px; overflow: auto;
        padding: 6px 9px; border: 1px solid var(--hair); border-radius: var(--r-sm);
        background: #fff; box-shadow: 0 6px 18px rgba(27, 31, 37, .18);
        font: 11px/1.45 var(--mono); color: var(--ink-2); pointer-events: none;
    }
    .cf-star-who__hd {
        font: 500 9px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
        margin-bottom: 3px;
    }
    .cf-star-who ul { margin: 0; padding: 0; list-style: none; }
    /* Contributions header: label, search, filter tabs, totals. */
    .cf-comm-rail__hd { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
    .cf-comm-tabs__n { opacity: .65; font-size: .9em; }
    .cf-comm-search { flex: 1 0 100%; min-width: 0; }
    .cf-comm-rail__meta { flex: 1 0 100%; font: 9.5px/1.35 var(--mono); color: var(--muted); }
    /* Comment threads on contribution cards (mirrors the community-reagent threads). */
    .cf-thread {
        display: flex; flex-direction: column; gap: 7px; cursor: default;
        margin-top: 2px; padding-top: 7px; border-top: 1px dashed var(--hair);
    }
    .cf-thread__empty { margin: 0; font: 10px var(--mono); color: var(--faint); }
    .cf-thread__err { margin: 0; font: 10px/1.35 var(--mono); color: #b42318; }
    .cf-comment { display: flex; flex-direction: column; gap: 2px; }
    .cf-comment__meta { display: flex; align-items: center; gap: 5px; }
    .cf-comment__who { font: 600 10px var(--mono); color: var(--ink-2); }
    .cf-comment__when { font: 9px var(--mono); color: var(--faint); }
    .cf-comment__del { margin-left: auto; font-size: 10px; line-height: 1; color: var(--faint); background: transparent; border: none; cursor: pointer; padding: 0 2px; }
    .cf-comment__del:hover { color: var(--err); }
    .cf-comment__body { margin: 0; font: 10.5px/1.45 var(--mono); color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
    .cf-comm-rail--wide .cf-comment__body { font: 12px/1.55 var(--sans); }
    .cf-compose { position: relative; display: flex; flex-direction: column; gap: 5px; }
    .cf-compose__in {
        width: 100%; box-sizing: border-box; min-height: 40px; resize: vertical;
        padding: 15px 7px 5px; font: 11px/1.4 var(--mono); color: var(--ink);
        background: #fff; border: 1px solid var(--hair); border-radius: var(--r-sm); outline: none;
    }
    .cf-compose__in:focus { border-color: var(--teal); }
    .cf-compose__count { position: absolute; right: 7px; top: 4px; font: 9px var(--mono); color: var(--faint); pointer-events: none; }
    .cf-compose__count.is-over { color: var(--err); }
    .cf-compose__btn {
        align-self: flex-end; font: 500 10px/1 var(--mono); padding: 4px 9px; cursor: pointer;
        color: var(--teal-ink); background: var(--surface-2); border: 1px solid var(--teal); border-radius: var(--r-sm);
    }
    .cf-compose__btn:disabled { opacity: .45; cursor: default; }
    .cf-comm-err { padding: 5px 9px; font: 10px/1.35 var(--mono); color: #b42318; background: #fef3f2; border-bottom: 1px solid #fecdca; }
    .cf-comm-empty { margin: 8px 4px; font: 10.5px/1.5 var(--mono); color: var(--muted); }
    /* Wide-pane-only extras: a batch member's own rationale, acknowledgements, AI model. */
    .cf-comm-card__member { display: flex; flex-direction: column; gap: 4px; padding-left: 8px; border-left: 2px solid var(--hair); }
    .cf-comm-card__ack { margin: 0; font: 10.5px/1.45 var(--sans); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .cf-comm-card__ai {
        flex: 0 0 auto; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--faint); padding: 1px 5px; border: 1px solid var(--hair); border-radius: var(--r-sm);
    }

    /* ── Fullscreen focus mode ─────────────────────────────────────────────── */
    /* The section pins over the viewport as a column: slim header, the designer
       row filling the middle (contributions | table, 50/50), toggle bar at the
       bottom. z-index sits under the page modals (200) so they still open on top. */
    .bench-focus {
        position: fixed; inset: 0; z-index: 150;
        margin: 0; padding: 10px 14px 4px;
        display: flex; flex-direction: column; gap: 10px;
        background: var(--paper-2);
    }
    .bench-focus__hd { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; }
    .bench-focus__ttl { font: 600 14px/1.2 var(--sans); color: #fff; }
    .bench-focus__sub { font: 500 9.5px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: rgba(255, 255, 255, .5); }
    .bench-focus__hd .btn-bp { margin-left: auto; }
    .bench-focus .cf-designer-row { flex: 1 1 auto; min-height: 0; }
    .bench-focus .cf-designer-row.is-split {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px;
    }
    .bench-focus .cf-designer-main { min-height: 0; min-width: 0; }
    .bench-focus .bench-scroll { max-height: none; border-radius: var(--r, 5px); }
    .bench-focus .bench-toolbar { flex: 0 0 auto; padding-top: 0; }
    @media (max-width: 900px) {
        .bench-focus .cf-designer-row.is-split { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 2fr) minmax(0, 3fr); }
    }
    /* Wide contributions pane: full-height, roomier cards, and tall text boxes in a
       readable proportional face that keep the author's line breaks. */
    .cf-comm-rail--wide { max-height: none; margin-right: 0; border-radius: var(--r, 5px); }
    .cf-comm-rail--wide .cf-comm-rail__list { padding: 10px; gap: 10px; }
    .cf-comm-rail--wide .cf-comm-card { padding: 11px 13px; gap: 8px; }
    .cf-comm-rail--wide .cf-comm-card__name { font-size: 13px; }
    .cf-comm-rail--wide .cf-comm-card__badge { font-size: 9.5px; }
    .cf-comm-rail--wide .cf-comm-card__desc {
        max-height: 22em; padding: 9px 11px;
        font: 12.5px/1.6 var(--sans); white-space: pre-wrap;
    }
    .cf-comm-rail--wide .cf-comm-card__member .cf-comm-card__desc { max-height: 12em; font-size: 12px; }
    .cf-comm-rail--wide .cf-comm-card__foot { font-size: 10px; }
    /* The batch's one overarching hypothesis reuses .cf-comm-card__desc so it reads the
       same as a single card's description (no darker/offset treatment). */
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
    /* ＋ in the Custom Mix header reads as an action, not a faint glyph. */
    .cust-add { opacity: 0.6; font-weight: 600; }

    /* Mix column header: a truncating name (a link-styled button on non-selected
       mixes), the same ✕ ↺ ＋ actions, and a per-column protein target. */
    .cust-mix-name {
        max-width: 72px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    /* Non-selected mix name — a link-styled button; clicking selects (makes
       editable) the mix in place, it does NOT move. */
    .cust-mix-name--btn {
        border: 0;
        background: none;
        padding: 0;
        color: oklch(var(--p));
        cursor: pointer;
        text-decoration: underline dotted oklch(var(--p) / 0.45);
        text-underline-offset: 2px;
    }
    .cust-mix-name--btn:hover {
        text-decoration-color: oklch(var(--p) / 0.9);
    }
    /* "click to edit" hint under a non-selected mix. */
    .cust-mix-hint {
        letter-spacing: 0.02em;
    }
    /* Selected mix — the editable one. A soft accent ring on both edges marks it
       as active without moving it from its creation slot. Kept deliberately subtle
       (thin, low-opacity) so it reads as a gentle highlight, not a hard outline. */
    .cust-mix-col--sel {
        box-shadow: inset 1px 0 0 oklch(var(--p) / 0.3), inset -1px 0 0 oklch(var(--p) / 0.3);
    }
    /* Non-selected mixes are click-to-select: the whole column is a target. */
    .cust-mix-col--pick { cursor: pointer; }
    /* Whole-column hover cue (set from the table's bubbling mouseover): a faint ring
       on both edges — fainter than the selected ring — signalling "click to select". */
    .cust-mix-col--hover {
        box-shadow: inset 1px 0 0 oklch(var(--p) / 0.18), inset -1px 0 0 oklch(var(--p) / 0.18);
    }
    /* Per-column protein-target picker — every Mix column carries its own target. */
    .cust-mix-target {
        display: block;
        margin: 2px auto 0;
        width: 100%;
        min-width: 0;
        max-width: 88px;
        text-align: center;
        text-overflow: ellipsis;
        font: 500 9px/1.3 var(--mono);
        color: oklch(var(--bc) / 0.75);
        background: oklch(var(--b1));
        border: 1px solid oklch(var(--bc) / 0.2);
        border-radius: var(--r-sm, 3px);
        padding: 1px 3px;
    }
    /* "Add mix" rail column — a thin frozen divider pinned between the rightmost
       mix and the reference columns. A dashed left border reads as the batch/
       reference boundary; the header cell holds the ＋ button, body cells are blank. */
    .bench-rail {
        padding: 0 !important;
        border-left: 1px dashed oklch(var(--bc) / 0.2);
    }
    /* Every rail cell is a click target, so the whole column (full table height) adds
       a mix — not just the ＋ in the sticky header. */
    .bench-rail--click { cursor: pointer; }
    /* Whole-rail hover (set from the table's bubbling mouseover): the full-height
       column lights up as one, matching the right-edge add-column rail's affordance. */
    .bench-rail--hover {
        background: oklch(var(--p) / 0.08) !important;
        border-left-color: oklch(var(--p) / 0.5);
    }
    .bench-rail--hover .add-col-rail--col,
    .bench-rail--hover .add-col-rail__plus,
    .bench-rail--hover .add-col-rail__label {
        color: oklch(var(--p));
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
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
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
        padding: 6px 0 0;
    }
    .add-col-rail__label {
        position: sticky;
        top: calc(45% + 22px);
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        font: 500 8.5px/1 var(--mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 4px 0;
    }
    /* Column variant — the ＋ lives in the rail's frozen header cell rather than a
       full-height flex sibling, so it fills that cell and drops the sticky offsets. */
    .add-col-rail--col {
        flex: none;
        width: 100%;
        align-self: auto;
        border-left: 0;
        min-height: 2.4em;
        padding: 4px 0;
    }
    .add-col-rail--col .add-col-rail__plus,
    .add-col-rail--col .add-col-rail__label {
        position: static;
        top: auto;
    }
    .add-col-rail--col .add-col-rail__plus {
        padding: 0;
        font-size: 15px;
    }

    /* Toggle buttons: ON is a filled dark accent pill (white text on --teal) so it
       stands clearly apart from the OFF state, which keeps the standard white .btn-bp
       look like the CSV/PNG buttons. Scoped with .btn-bp to outrank the global
       aria-pressed rule. */
    /* ── Table settings bar (below the table) ──────────────────────────────── */
    /* Two rows (Columns / View) with their labels in a left column, and the
       exports in a right column spanning both rows. */
    .bench-settings {
        display: grid; grid-template-columns: max-content max-content max-content;
        align-items: center; gap: 6px 14px; padding: 8px 14px; max-width: 100%;
        border: 1px solid var(--hair); border-radius: var(--r, 5px);
        background: var(--surface-2); box-shadow: var(--shadow-1);
    }
    .bench-settings__items { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
    .bench-settings__export {
        grid-column: 3; grid-row: 1 / span 2; align-self: stretch;
        display: flex; align-items: center; gap: 8px; padding-left: 14px; border-left: 1px solid var(--hair);
    }
    @media (max-width: 760px) {
        .bench-settings { grid-template-columns: max-content minmax(0, 1fr); }
        .bench-settings__export { grid-column: 1 / -1; grid-row: auto; padding: 6px 0 0; border-left: 0; border-top: 1px solid var(--hair); }
    }
    .bench-settings__lbl {
        font: 500 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
    }
    .bench-settings__sub { font: 500 11.5px/1 var(--mono); color: var(--ink-2); margin-left: 2px; }
    /* Switch: a small track + thumb, teal when on (role="switch" / aria-checked). */
    .bench-switch {
        display: inline-flex; align-items: center; gap: 6px; padding: 3px 0;
        font: 500 11.5px/1 var(--mono); color: var(--ink-2);
        background: none; border: 0; cursor: pointer;
    }
    .bench-switch:hover { color: var(--ink); }
    .bench-switch:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; border-radius: 3px; }
    .bench-switch__track {
        position: relative; flex: 0 0 auto; width: 24px; height: 14px; border-radius: 999px;
        background: var(--recess); border: 1px solid var(--groove);
        transition: background .15s ease, border-color .15s ease;
    }
    .bench-switch__thumb {
        position: absolute; top: 1px; left: 1px; width: 10px; height: 10px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 2px rgba(27, 31, 37, .3); transition: transform .15s ease;
    }
    .bench-switch[aria-checked="true"] .bench-switch__track { background: var(--teal); border-color: var(--teal); }
    .bench-switch[aria-checked="true"] .bench-switch__thumb { transform: translateX(10px); }
    /* Segmented picker (salt optima) and the plain export actions. */
    .bench-seg { display: inline-flex; border: 1px solid var(--groove); border-radius: var(--r-sm); overflow: hidden; }
    .bench-seg button {
        font: 500 10.5px/1 var(--mono); padding: 4px 8px; cursor: pointer;
        color: var(--ink-2); background: var(--surface-2); border: 0;
    }
    .bench-seg button + button { border-left: 1px solid var(--groove); }
    .bench-seg button:hover { color: var(--ink); background: #fff; }
    .bench-seg button.is-on { color: #fff; background: var(--teal); }
    .bench-settings__act {
        font: 500 11px/1 var(--mono); padding: 4px 8px; cursor: pointer;
        color: var(--ink-2); background: var(--surface-2);
        border: 1px solid var(--groove); border-radius: var(--r-sm);
    }
    .bench-settings__act:hover { color: var(--ink); border-color: var(--ink-2); }
    .bench-settings__act:disabled { opacity: .5; cursor: default; }
    /* Recently added reagents: light-blue ⓘ, and a matching note atop their popup. */
    .bench-info--new { color: #3d9be9; }
    .bench-info--new:hover { color: #1f7fd0; background: rgba(61, 155, 233, 0.12); }
    .bench-info-note {
        margin: 0; padding: 4px 8px; border-radius: 4px;
        font: 600 11px/1.4 var(--mono); color: #1f6fb5;
        background: #e8f3fd; border: 1px solid #b9dcf7;
    }
    /* Fullscreen toggle pinned in the table's top-left header corner. */
    .bench-corner { vertical-align: top; text-align: left; }
    .bench-fs-btn {
        display: inline-grid; place-items: center; width: 22px; height: 22px; margin: 6px 0 0 6px;
        color: var(--muted); background: var(--surface-2);
        border: 1px solid var(--groove); border-radius: var(--r-sm); cursor: pointer;
        transition: color .12s, border-color .12s, background .12s;
    }
    .bench-fs-btn:hover { color: var(--ink); border-color: var(--ink-2); background: #fff; }
    .bench-fs-btn.is-on { color: #fff; background: var(--teal); border-color: var(--teal); }

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

<script>
    import { onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import { generateGrid } from '../automation-art/generateGrid.js';
    import { PLACE_PLATES } from '$lib/place.js';
    import { current_well_colors_import, well_colors } from '$lib/proteins.js';
    import { rowLabel1536 } from '$lib/echo-grid.js';

    const SIMULATION_ENABLED = false;
    const SIMULATION_PLACEMENTS_PER_SECOND = 22;
    const ERASE_CONTRIBUTION_KEY = '__erase__';
    const PLAYBACK_INTERVAL_MS = 5;

    let { data } = $props();

    const BASE_POINTS = generateGrid('Echo384', 0, 0, '', []);
    const PLATE_WIDTH_MM = 128;
    const PLATE_HEIGHT_MM = 86;
    const SIMULATION_COLORS = Object.entries(current_well_colors_import)
        .filter(([name, enabled]) => enabled && name !== 'Erase' && name !== 'White')
        .map(([name]) => name);
    const paletteColors = SIMULATION_COLORS.filter((name) => well_colors[name]);
    const contributionBarColors = [...paletteColors, ERASE_CONTRIBUTION_KEY];

    let placements = $derived(Array.isArray(data?.placements) ? data.placements : []);
    let simulatedPlacements = $state([]);
    let allPlacements = $derived([...placements, ...simulatedPlacements]);

    let currentStep = $state(0);
    let isPlaying = $state(false);
    let showOutlines = $state(true);

    $effect(() => {
        currentStep = allPlacements.length;
    });

    function roundPoint(value) {
        return Math.round(Number(value) * 1000) / 1000;
    }

    function normalizeClassicEchoKey(key) {
        const [xRaw, yRaw] = String(key).split(',').map((part) => Number(part.trim()));
        if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
        return `${roundPoint(xRaw).toFixed(3)}, ${roundPoint(yRaw).toFixed(3)}`;
    }

    function parseQuadrantKey(key) {
        if (!key) return null;

        const raw = String(key).trim();
        let plateId = '';
        let coordinatePart = '';

        if (raw.includes('|')) {
            [plateId, coordinatePart] = raw.split('|');
        } else {
            return null;
        }

        const normalizedCoords = normalizeClassicEchoKey(coordinatePart);
        if (!normalizedCoords) return null;

        const [xRaw, yRaw] = normalizedCoords.split(',').map((part) => Number(part.trim()));

        return {
            plateId: plateId.trim().toUpperCase(),
            x: xRaw,
            y: yRaw,
            normalizedKey: `${plateId.trim().toUpperCase()}|${normalizedCoords}`
        };
    }

    function platePointLeftPercent(x) {
        return (Number(x) / PLATE_WIDTH_MM * 105) + 2.8;
    }

    function platePointTopPercent(y) {
        return (Number(y) / PLATE_HEIGHT_MM * 105) + 4.1;
    }

    function formatTimestamp(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function currentSearchSuffix() {
        if (!browser) return '';
        return window.location.search || '';
    }

    function randomItem(list) {
        if (!Array.isArray(list) || list.length === 0) return null;
        return list[Math.floor(Math.random() * list.length)] || null;
    }

    function formatQuadrantKey(plateId, x, y) {
        return `${plateId}|${roundPoint(x).toFixed(3)}, ${roundPoint(y).toFixed(3)}`;
    }

    function createRandomSimulatedPlacement(stepIndex) {
        const point = randomItem(BASE_POINTS);
        const plate = randomItem(PLACE_PLATES);
        const color = randomItem(SIMULATION_COLORS);
        if (!point || !plate || !color) return null;

        return {
            id: `sim-${stepIndex}`,
            point_key: formatQuadrantKey(plate.id, point.x, point.y),
            color,
            action: 'place',
            created: new Date(Date.now() + stepIndex).toISOString()
        };
    }

    let simulationInterval = null;
    let playbackInterval = null;

    $effect(() => {
        if (!SIMULATION_ENABLED || SIMULATION_PLACEMENTS_PER_SECOND <= 0) {
            if (simulationInterval) {
                clearInterval(simulationInterval);
                simulationInterval = null;
            }
            simulatedPlacements = [];
            return;
        }

        if (simulationInterval) clearInterval(simulationInterval);

        const intervalMs = Math.max(50, Math.round(1000 / SIMULATION_PLACEMENTS_PER_SECOND));
        simulationInterval = setInterval(() => {
            const placement = createRandomSimulatedPlacement(simulatedPlacements.length);
            if (!placement) return;
            simulatedPlacements = [...simulatedPlacements, placement];
        }, intervalMs);

        return () => {
            if (simulationInterval) {
                clearInterval(simulationInterval);
                simulationInterval = null;
            }
        };
    });

    onDestroy(() => {
        if (simulationInterval) {
            clearInterval(simulationInterval);
            simulationInterval = null;
        }
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
    });

    $effect(() => {
        if (!isPlaying || allPlacements.length <= 0) {
            if (playbackInterval) {
                clearInterval(playbackInterval);
                playbackInterval = null;
            }
            return;
        }

        if (playbackInterval) clearInterval(playbackInterval);

        playbackInterval = setInterval(() => {
            currentStep = currentStep >= allPlacements.length ? 0 : currentStep + 1;
        }, PLAYBACK_INTERVAL_MS);

        return () => {
            if (playbackInterval) {
                clearInterval(playbackInterval);
                playbackInterval = null;
            }
        };
    });

    let point_colors = $derived.by(() => {
        const state = {};

        for (let i = 0; i < currentStep; i += 1) {
            const placement = allPlacements[i];
            const parsed = parseQuadrantKey(placement?.point_key);
            if (!parsed) continue;

            if (placement?.action === 'erase' || !placement?.color) {
                delete state[parsed.normalizedKey];
            } else {
                state[parsed.normalizedKey] = placement.color;
            }
        }

        return state;
    });

    let currentPlacement = $derived(currentStep > 0 ? allPlacements[currentStep - 1] : null);
    let contributionRows = $derived.by(() => {
        const contributionMap = new Map();

        for (let i = 0; i < currentStep; i += 1) {
            const placement = allPlacements[i];
            const username = String(placement?.username || '').trim();
            const action = String(placement?.action || '').trim();
            const color = action === 'erase'
                ? ERASE_CONTRIBUTION_KEY
                : String(placement?.color || '').trim();

            if (!username || !color) continue;

            const existing = contributionMap.get(username) || {
                username,
                total: 0,
                colors: {}
            };

            existing.total += 1;
            existing.colors[color] = (Number(existing.colors[color]) || 0) + 1;
            contributionMap.set(username, existing);
        }

        return Array.from(contributionMap.values()).sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            return a.username.localeCompare(b.username);
        });
    });

    function contributionCountFor(row, color) {
        return Number(row?.colors?.[color]) || 0;
    }

    function contributionPercentFor(row, color) {
        const total = Number(row?.total) || 0;
        if (total <= 0) return 0;
        return contributionCountFor(row, color) / total * 100;
    }

    function contributionBarColor(color) {
        if (color === ERASE_CONTRIBUTION_KEY) return '#6b7280';
        return well_colors[color] || 'transparent';
    }

    function contributionBarLabel(color) {
        return color === ERASE_CONTRIBUTION_KEY ? 'Deletes' : color;
    }

    function displayContributionUsername(value) {
        return String(value || '').replace(/^2026a-/i, '');
    }

    function contributionProfileUrl(value) {
        const username = String(value || '').trim();
        if (!/^2026a-/i.test(username)) return '';
        return `https://pages.htgaa.org/${encodeURIComponent(username)}`;
    }

    function trophyColorForRank(rankIndex) {
        if (rankIndex === 0) return '#f4c542';
        if (rankIndex === 1) return '#c0c7d1';
        if (rankIndex === 2) return '#cd7f32';
        return '';
    }

    function togglePlayback() {
        if (allPlacements.length <= 0) return;
        isPlaying = !isPlaying;
    }

    function toggleOutlines() {
        showOutlines = !showOutlines;
    }

    function rowLabel384(index) {
        return String.fromCharCode(65 + Math.max(0, Math.min(15, index)));
    }

    function echo384IndicesFromPoint(x, y) {
        const row = Math.max(0, Math.min(15, Math.round(Number(y) / 5)));
        const col = Math.max(0, Math.min(23, Math.round(Number(x) / 5)));
        return { row, col };
    }

    function echo384WellFromPoint(x, y) {
        const { row, col } = echo384IndicesFromPoint(x, y);
        return `${rowLabel384(row)}${col + 1}`;
    }

    function stitched1536WellFromQuadrantPoint(plateId, x, y) {
        const { row, col } = echo384IndicesFromPoint(x, y);
        const rowOffset = plateId === 'Q3' || plateId === 'Q4' ? 16 : 0;
        const colOffset = plateId === 'Q2' || plateId === 'Q4' ? 24 : 0;
        return `${rowLabel1536(row + rowOffset)}${col + colOffset + 1}`;
    }

    function pointColorEntriesForDownload(mode) {
        return Object.entries(point_colors)
            .map(([key, color]) => {
                const parsed = parseQuadrantKey(key);
                if (!parsed || !color) return null;

                const well = mode === 'full1536'
                    ? stitched1536WellFromQuadrantPoint(parsed.plateId, parsed.x, parsed.y)
                    : `${parsed.plateId} ${echo384WellFromPoint(parsed.x, parsed.y)}`;

                return {
                    plateId: parsed.plateId,
                    x: parsed.x,
                    y: parsed.y,
                    color: String(color),
                    well
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.well.localeCompare(b.well, undefined, { numeric: true }));
    }

    function downloadCurrentMapping(mode) {
        if (!browser) return;

        const rows = pointColorEntriesForDownload(mode);
        const csv = rows.map(({ well, color }) => `${well},${color}`).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const modeLabel = mode === 'full1536' ? '1536' : 'quadrant-384';
        anchor.href = url;
        anchor.download = `1536-history-step-${currentStep}-${modeLabel}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }
</script>

<svelte:head>
    <title>1536 History</title>
</svelte:head>

<article class="prose w-full mx-auto mt-5 px-5">
    <h2 class="text-base-content text-center">1536 History</h2>
</article>

<div class="relative w-full max-w-[90vw] sm:max-w-[440px] mx-auto pt-0">
    <div class="items-center flex flex-row gap-1 opacity-70 h-4 text-xs whitespace-nowrap">
        <span class="invisible">Q1 · A1</span>
    </div>

    <button
        class="absolute left-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center opacity-60 transition-opacity hover:opacity-100"
        type="button"
        onclick={toggleOutlines}
        aria-label={showOutlines ? 'Hide well outlines' : 'Show well outlines'}
        title={showOutlines ? 'Hide well outlines' : 'Show well outlines'}
    >
        {#if showOutlines}
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="24" height="24" opacity="0"></rect>
                <circle cx="12" cy="12" r="1.5"></circle>
                <path d="M21.87 11.5c-.64-1.11-4.16-6.68-10.14-6.5-5.53.14-8.73 5-9.6 6.5a1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25c5.53-.14 8.74-5 9.6-6.5a1 1 0 0 0 0-1zm-9.87 4a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z"></path>
            </svg>
        {:else}
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="24" height="24" opacity="0"></rect>
                <circle cx="12" cy="12" r="1.5"></circle>
                <path d="M15.29 18.12L14 16.78l-.07-.07-1.27-1.27a4.07 4.07 0 0 1-.61.06A3.5 3.5 0 0 1 8.5 12a4.07 4.07 0 0 1 .06-.61l-2-2L5 7.87a15.89 15.89 0 0 0-2.87 3.63 1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25a9.48 9.48 0 0 0 3.23-.67z"></path>
                <path d="M8.59 5.76l2.8 2.8A4.07 4.07 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 4.07 4.07 0 0 1-.06.61l2.68 2.68.84.84a15.89 15.89 0 0 0 2.91-3.63 1 1 0 0 0 0-1c-.64-1.11-4.16-6.68-10.14-6.5a9.48 9.48 0 0 0-3.23.67z"></path>
                <path d="M20.71 19.29L19.41 18l-2-2-9.52-9.53L6.42 5 4.71 3.29a1 1 0 0 0-1.42 1.42L5.53 7l1.75 1.7 7.31 7.3.07.07L16 17.41l.59.59 2.7 2.71a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42z"></path>
            </svg>
        {/if}
    </button>

    <a
        class="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center opacity-60 transition-opacity hover:opacity-100"
        href={`/1536${currentSearchSuffix()}`}
        aria-label="View artwork grid"
        title="Artwork"
    >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 4h7v7H4V4Zm2 2v3h3V6H6Zm7-2h7v7h-7V4Zm2 2v3h3V6h-3ZM4 13h7v7H4v-7Zm2 2v3h3v-3H6Zm7-2h7v7h-7v-7Zm2 2v3h3v-3h-3Z"></path>
        </svg>
    </a>
</div>

<div class="mb-2 flex items-center mx-auto w-full max-w-[94vw] sm:max-w-[460px] aspect-[3/2] mt-2 rounded-xl">
    <div class="relative border border-neutral mx-auto w-full max-w-[90vw] sm:max-w-[440px] aspect-[128/86] rounded overflow-hidden">
        <div class="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0 bg-base-300/10">
            {#each PLACE_PLATES as plate}
                <div class="relative overflow-hidden bg-transparent">
                    {#each BASE_POINTS as point (`${plate.id}-${point.x}-${point.y}`)}
                        <input
                            type="checkbox"
                            class={`checkbox absolute rounded-[2px] sm:rounded-[3px] w-[6px] h-[6px] sm:w-[8px] sm:h-[8px] [--chkfg:invisible] transition-[box-shadow] duration-200 ease-in-out ${point_colors[`${plate.id}|${point.x}, ${point.y}`] ? 'border-0' : 'opacity-10'} ${!showOutlines ? 'border-0' : point_colors[`${plate.id}|${point.x}, ${point.y}`] ? 'border' : 'border border-white opacity-10'}`}
                            style={`
                                left: ${platePointLeftPercent(point.x)}%;
                                top: ${platePointTopPercent(point.y)}%;
                                transform: translate(-50%, -50%);
                                background-color: ${well_colors[point_colors[`${plate.id}|${point.x}, ${point.y}`]] || 'transparent'};
                                border: ${!showOutlines ? 'none' : point_colors[`${plate.id}|${point.x}, ${point.y}`] ? `1px solid ${well_colors[point_colors[`${plate.id}|${point.x}, ${point.y}`]]}` : '1px solid white'};
                            `}
                            draggable="false"
                            aria-hidden="true"
                        />
                    {/each}
                </div>
            {/each}
        </div>

        <div class="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-white/15 -translate-x-1/2"></div>
        <div class="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-white/15 -translate-y-1/2"></div>
    </div>
</div>

<div class="w-full max-w-[90vw] sm:max-w-[440px] mx-auto px-5 pb-12">
    <input
        class="range range-xs h-1.5 w-full opacity-50 [--range-bg:theme(colors.base-300)] [--range-fill:theme(colors.neutral)]"
        type="range"
        min="0"
        max={allPlacements.length}
        step="1"
        bind:value={currentStep}
        aria-label="Place history timeline"
    />

    <div class="mt-2 flex items-center justify-between gap-3 text-xs opacity-70">
        <span>Start</span>
        <div class="flex items-center gap-2">
            <button
                class="flex h-5 w-5 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 disabled:opacity-30"
                type="button"
                onclick={togglePlayback}
                disabled={allPlacements.length === 0}
                aria-label={isPlaying ? 'Pause history playback' : 'Play history playback'}
                title={isPlaying ? 'Pause' : 'Play'}
            >
                {#if isPlaying}
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"></path>
                    </svg>
                {:else}
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 5v14l11-7L8 5Z"></path>
                    </svg>
                {/if}
            </button>
            <span>{currentStep} / {allPlacements.length}</span>
            <div class="join">
                <button
                    class="btn btn-xs join-item h-5 min-h-0 px-1.5 text-[10px] bg-base-300 text-base-content/70 hover:bg-neutral-700 hover:text-base-content disabled:opacity-30"
                    type="button"
                    onclick={() => { downloadCurrentMapping('quadrant384'); }}
                    disabled={Object.keys(point_colors).length === 0}
                    aria-label="Download quadrant 384 color mapping CSV"
                    title="Download quadrant 384 CSV"
                >
                    384
                </button>
                <button
                    class="btn btn-xs join-item h-5 min-h-0 px-1.5 text-[10px] bg-base-300 text-base-content/70 hover:bg-neutral-700 hover:text-base-content disabled:opacity-30"
                    type="button"
                    onclick={() => { downloadCurrentMapping('full1536'); }}
                    disabled={Object.keys(point_colors).length === 0}
                    aria-label="Download stitched 1536 color mapping CSV"
                    title="Download stitched 1536 CSV"
                >
                    1536
                </button>
            </div>
        </div>
        <span>Latest</span>
    </div>

    <div class="mt-3 text-center text-xs opacity-80">
        {#if currentPlacement}
            Showing placement {currentStep} from {formatTimestamp(currentPlacement.created)}
        {:else}
            Showing the blank starting board.
        {/if}
    </div>

    <div class="mt-4 flex flex-col w-full gap-2 mx-auto bg-base-200 rounded px-3 py-3 text-xs opacity-90">
        <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm opacity-100">Rankings</span>
            <span class="text-[11px] opacity-70">
                {contributionRows.length.toLocaleString('en-US')} contributors · {contributionRows.reduce((sum, row) => sum + (Number(row?.total) || 0), 0).toLocaleString('en-US')} contributions
            </span>
        </div>

        {#if contributionRows.length === 0}
            <div class="text-xs opacity-70">No contribution data yet at this point in the timeline.</div>
        {:else}
            <div class="w-full max-h-[25rem] overflow-auto">
                <table class="table table-xs tabular-nums">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th class="text-right">Total</th>
                            <th>Color Mix</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each contributionRows as row, index}
                            <tr>
                                <td class="font-medium">
                                    <div class="flex items-start gap-2">
                                        {#if index < 3}
                                            <svg
                                                class="mt-0.5 w-3.5 h-3.5 shrink-0"
                                                viewBox="0 0 24 24"
                                                fill={trophyColorForRank(index)}
                                                aria-hidden="true"
                                            >
                                                <path d="M18 2H6v3H3v3c0 2.97 2.16 5.43 5 5.91V17H6v2h12v-2h-2v-3.09c2.84-.48 5-2.94 5-5.91V5h-3V2zm-2 10.82V17h-8v-4.18C5.67 12.4 4 10.39 4 8V6h2v2h2V4h8v4h2V6h2v2c0 2.39-1.67 4.4-4 4.82z"></path>
                                            </svg>
                                        {:else}
                                            <span class="mt-0.5 inline-flex min-h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] leading-none opacity-60">
                                                #{index + 1}
                                            </span>
                                        {/if}
                                        {#if contributionProfileUrl(row.username)}
                                            <a
                                                class="block min-w-0 whitespace-normal break-words leading-snug no-underline"
                                                href={contributionProfileUrl(row.username)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {displayContributionUsername(row.username)}
                                            </a>
                                        {:else}
                                            <span class="block min-w-0 whitespace-normal break-words leading-snug">
                                                {displayContributionUsername(row.username)}
                                            </span>
                                        {/if}
                                    </div>
                                </td>
                                <td class="text-right">{row.total}</td>
                                <td>
                                    <div class="flex items-center gap-2 min-w-[9rem]">
                                        <div class="flex h-2.5 w-32 overflow-hidden rounded-full bg-base-300">
                                            {#each contributionBarColors as color}
                                                <div
                                                    style={`width: ${contributionPercentFor(row, color)}%; background-color: ${contributionBarColor(color)};`}
                                                    title={`${contributionBarLabel(color)}: ${contributionCountFor(row, color)} / ${row.total} (${contributionPercentFor(row, color).toFixed(0)}%)`}
                                                ></div>
                                            {/each}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    </div>
</div>

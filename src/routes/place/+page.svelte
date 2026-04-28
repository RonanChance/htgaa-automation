<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import PocketBase from 'pocketbase';
    import { current_well_colors_import, well_colors } from '$lib/proteins.js';
    import { generateGrid } from '../automation-art/generateGrid.js';
    import {
        PLACE_BOARD_ID,
        PLACE_STATE_COLLECTION,
        PLACE_PLATES
    } from '$lib/place.js';

    const BASE_POINTS = generateGrid('Echo384', 0, 0, '', []);
    const PLATE_WIDTH_MM = 128;
    const PLATE_HEIGHT_MM = 86;
    const PLATE_MAX_X = 115;
    const PLATE_MAX_Y = 75;
    const PLATE_SPACING_MM = 5;
    const DRAG_PX = 4;
    const PLACE_COOLDOWN_KEY = 'placeCooldownUntil';
    const PLACE_COOLDOWN_MS = 20_000;
    const PLACE_DELETE_ONLY_MODE = true;

    const PLACE_ALLOWED_COLORS = ['sfGFP', 'mRFP1', 'mKO2', 'mTurquoise2', 'mScarlet_I', 'Electra2'];
    const paletteColors = PLACE_ALLOWED_COLORS.filter((name) => current_well_colors_import[name] && well_colors[name]);
    const ERASE_CONTRIBUTION_KEY = '__erase__';
    const contributionBarColors = [...paletteColors, ERASE_CONTRIBUTION_KEY];

    let point_colors = $state({});
    let baseline_point_colors = $state({});
    let baseline_point_usernames = $state({});
    let current_color = $state(paletteColors[0] || 'sfGFP');
    let author = $state('');
    let username = $state('');
    let inviteId = $state('');
    let inviteVerified = $state(false);
    let verifyingInvite = $state(false);
    let uploading = $state(false);
    let loadingSnapshot = $state(true);
    let currentSnapshotId = $state('');
    let currentSnapshotCreated = $state('');
    let hoverLabel = $state('');
    let hoverColor = $state('');
    let hoverUsername = $state('');
    let cooldownRemainingMs = $state(0);
    let publishStatusMessage = $state('');
    let publishStatusTone = $state('text-success');
    let contributionRows = $state([]);

    let isToastVisible = $state(false);
    let alertMessage = $state('');
    let alertType = $state('alert-success');

    let boardEl;
    let plateElements = {};
    let realtimeClient = null;

    let isPainting = false;
    let rightClickErasing = false;
    let restoreColor = null;
    let didMove = false;
    let downX = 0;
    let downY = 0;
    let downKey = null;
    let lastKey = null;
    let lastPaintClientX = 0;
    let lastPaintClientY = 0;

    function fpbaseUrlFor(protein) {
        return `https://www.fpbase.org/protein/${String(protein).toLowerCase().split('_')[0]}`;
    }

    function currentSearchSuffix() {
        if (!browser) return '';
        return window.location.search || '';
    }

    function showAlert(type = 'alert-success', msg = 'Success!') {
        isToastVisible = true;
        alertMessage = msg;
        alertType = type;
        setTimeout(() => {
            isToastVisible = false;
        }, 3000);
    }

    function roundPoint(value) {
        return Math.round(Number(value) * 1000) / 1000;
    }

    function clampValue(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeClassicEchoKey(key) {
        const [xRaw, yRaw] = String(key).split(',').map((part) => Number(part.trim()));
        if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
        return `${roundPoint(xRaw).toFixed(3)}, ${roundPoint(yRaw).toFixed(3)}`;
    }

    function formatQuadrantKey(plateId, x, y) {
        return `${plateId}|${roundPoint(x).toFixed(3)}, ${roundPoint(y).toFixed(3)}`;
    }

    function parseQuadrantKey(key) {
        if (!key) return null;

        const raw = String(key).trim();
        let plateId = '';
        let coordinatePart = '';

        if (raw.includes('|')) {
            [plateId, coordinatePart] = raw.split('|');
        } else {
            const match = raw.match(/^(Q[1-4])[:_\s-]+(.+)$/i);
            if (!match) return null;
            plateId = match[1];
            coordinatePart = match[2];
        }

        const normalizedCoords = normalizeClassicEchoKey(coordinatePart);
        if (!normalizedCoords) return null;

        const [xRaw, yRaw] = normalizedCoords.split(',').map((part) => Number(part.trim()));
        const normalizedPlateId = plateId.trim().toUpperCase();
        if (!PLACE_PLATES.some((plate) => plate.id === normalizedPlateId)) return null;

        return {
            plateId: normalizedPlateId,
            x: xRaw,
            y: yRaw,
            normalizedKey: `${normalizedPlateId}|${normalizedCoords}`
        };
    }

    function normalizeQuadrantPointColors(rawPointColors) {
        const normalized = {};

        for (const [key, color] of Object.entries(rawPointColors || {})) {
            const parsed = parseQuadrantKey(key);
            if (!parsed) continue;
            normalized[parsed.normalizedKey] = color;
        }

        return normalized;
    }

    function platePointLeftPercent(x) {
        return (Number(x) / PLATE_WIDTH_MM * 105) + 2.8;
    }

    function platePointTopPercent(y) {
        return (Number(y) / PLATE_HEIGHT_MM * 105) + 4.1;
    }

    function pointColorForKey(key) {
        const colorName = point_colors[key];
        return well_colors[colorName] || 'transparent';
    }

    function getStoredCooldownUntil() {
        if (!browser) return 0;
        const raw = Number(window.localStorage.getItem(PLACE_COOLDOWN_KEY) || 0);
        return Number.isFinite(raw) ? raw : 0;
    }

    function updateCooldownState() {
        const remaining = Math.max(0, getStoredCooldownUntil() - Date.now());
        cooldownRemainingMs = remaining;
        if (browser && remaining === 0) {
            window.localStorage.removeItem(PLACE_COOLDOWN_KEY);
        }
    }

    function startCooldown() {
        if (!browser) return;
        window.localStorage.setItem(PLACE_COOLDOWN_KEY, String(Date.now() + PLACE_COOLDOWN_MS));
        updateCooldownState();
    }

    function isCooldownActive() {
        return cooldownRemainingMs > 0;
    }

    function formatCooldownRemaining() {
        const totalSeconds = Math.ceil(cooldownRemainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function setPublishStatus(message = '', tone = 'text-success') {
        publishStatusMessage = message;
        publishStatusTone = tone;
    }

    function pendingChangeCount() {
        const keys = new Set([
            ...Object.keys(baseline_point_colors || {}),
            ...Object.keys(point_colors || {})
        ]);
        let count = 0;

        for (const key of keys) {
            if ((baseline_point_colors[key] || null) !== (point_colors[key] || null)) {
                count += 1;
            }
        }

        return count;
    }

    function hasPendingPlacement() {
        return pendingChangeCount() === 1;
    }

    function pendingPlacement() {
        const keys = new Set([
            ...Object.keys(baseline_point_colors || {}),
            ...Object.keys(point_colors || {})
        ]);

        for (const key of keys) {
            const previousColor = baseline_point_colors[key] || null;
            const nextColor = point_colors[key] || null;

            if (previousColor === nextColor) continue;

            const parsed = parseQuadrantKey(key);
            if (!parsed) return null;

            return {
                point_key: parsed.normalizedKey,
                plate_id: parsed.plateId,
                x: parsed.x,
                y: parsed.y,
                color: nextColor,
                action: nextColor ? 'place' : 'erase'
            };
        }

        return null;
    }

    function hasDesign() {
        return Object.keys(point_colors).length > 0;
    }

    function boardSummary() {
        return Object.keys(point_colors).length.toLocaleString('en-US');
    }

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

    function rowLabel384(index) {
        return String.fromCharCode(65 + Math.max(0, Math.min(15, index)));
    }

    function echo384WellFromPoint(x, y) {
        const row = Math.max(0, Math.min(15, Math.round(Number(y) / PLATE_SPACING_MM)));
        const col = Math.max(0, Math.min(23, Math.round(Number(x) / PLATE_SPACING_MM)));
        return `${rowLabel384(row)}${col + 1}`;
    }

    function keyFromClientPoint(clientX, clientY) {
        for (const plate of PLACE_PLATES) {
            const rect = plateElements[plate.id]?.getBoundingClientRect?.();
            if (!rect?.width || !rect?.height) continue;

            if (
                clientX < rect.left ||
                clientX > rect.right ||
                clientY < rect.top ||
                clientY > rect.bottom
            ) {
                continue;
            }

            const relX = clampValue(clientX - rect.left, 0, rect.width);
            const relY = clampValue(clientY - rect.top, 0, rect.height);
            const leftPercent = (relX / rect.width) * 100;
            const topPercent = (relY / rect.height) * 100;
            const rawX = ((leftPercent - 2.8) / 105) * PLATE_WIDTH_MM;
            const rawY = ((topPercent - 4.1) / 105) * PLATE_HEIGHT_MM;
            const x = clampValue(Math.round(rawX / PLATE_SPACING_MM) * PLATE_SPACING_MM, 0, PLATE_MAX_X);
            const y = clampValue(Math.round(rawY / PLATE_SPACING_MM) * PLATE_SPACING_MM, 0, PLATE_MAX_Y);

            return formatQuadrantKey(plate.id, x, y);
        }

        return null;
    }

    function updateHover(key) {
        const parsed = parseQuadrantKey(key);
        if (!parsed) {
            hoverLabel = '';
            hoverColor = '';
            hoverUsername = '';
            return;
        }

        const normalizedKey = parsed.normalizedKey;
        const currentColor = point_colors[normalizedKey] || '';
        const baselineColor = baseline_point_colors[normalizedKey] || '';
        const hasLocalOverride = currentColor !== baselineColor;

        hoverLabel = `${parsed.plateId} · ${echo384WellFromPoint(parsed.x, parsed.y)}`;
        hoverColor = currentColor;
        hoverUsername = !hasLocalOverride && currentColor
            ? String(baseline_point_usernames[normalizedKey] || '').trim()
            : '';
    }

    function paintKey(key) {
        const parsed = parseQuadrantKey(key);
        if (!parsed || parsed.normalizedKey === lastKey || isCooldownActive()) return;
        lastKey = parsed.normalizedKey;
        const nextPointColors = { ...baseline_point_colors };
        const nextColor = PLACE_DELETE_ONLY_MODE ? null : current_color;
        const baselineColor = baseline_point_colors[parsed.normalizedKey] || null;

        if (nextColor === baselineColor) {
            point_colors = nextPointColors;
            updateHover(parsed.normalizedKey);
            return;
        }

        if (nextColor === null) {
            delete nextPointColors[parsed.normalizedKey];
        } else {
            nextPointColors[parsed.normalizedKey] = nextColor;
        }

        point_colors = nextPointColors;
        updateHover(parsed.normalizedKey);
    }

    function toggleKey(key) {
        const parsed = parseQuadrantKey(key);
        if (!parsed || isCooldownActive()) return;
        paintKey(parsed.normalizedKey);
    }

    function paintSegment(fromX, fromY, toX, toY) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const distance = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(distance / 2));

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const key = keyFromClientPoint(fromX + dx * t, fromY + dy * t);
            paintKey(key);
        }
    }

    function handlePointerDown(event) {
        if (isCooldownActive()) {
            return;
        }

        rightClickErasing = false;
        restoreColor = null;

        isPainting = true;
        didMove = false;
        lastKey = null;
        downX = event.clientX;
        downY = event.clientY;
        lastPaintClientX = event.clientX;
        lastPaintClientY = event.clientY;
        downKey = keyFromClientPoint(event.clientX, event.clientY);
        updateHover(downKey);
        boardEl?.setPointerCapture?.(event.pointerId);
    }

    function handlePointerMove(event) {
        const key = keyFromClientPoint(event.clientX, event.clientY);
        updateHover(key);

        if (!isPainting) return;

        if (!didMove) {
            const dx = event.clientX - downX;
            const dy = event.clientY - downY;
            if (dx * dx + dy * dy >= DRAG_PX * DRAG_PX) {
                didMove = true;
                paintKey(downKey);
            }
        }

        if (didMove) {
            paintSegment(lastPaintClientX, lastPaintClientY, event.clientX, event.clientY);
            lastPaintClientX = event.clientX;
            lastPaintClientY = event.clientY;
        }
    }

    function finishPainting(event) {
        if (!isPainting) {
            hoverLabel = '';
            hoverColor = '';
            hoverUsername = '';
            return;
        }

        isPainting = false;
        boardEl?.releasePointerCapture?.(event.pointerId);

        if (!didMove) {
            toggleKey(downKey);
        }

        downKey = null;
        lastKey = null;

        if (rightClickErasing) {
            current_color = restoreColor || paletteColors[0] || 'sfGFP';
            rightClickErasing = false;
            restoreColor = null;
        }
    }

    function applyRealtimePointUpdate(record, action) {
        const parsed = parseQuadrantKey(record?.point_key);
        if (!parsed) return;

        const normalizedKey = parsed.normalizedKey;
        const nextColor = action === 'delete'
            ? null
            : (record?.color ? String(record.color).trim() : null);
        const nextUsername = action === 'delete'
            ? ''
            : String(record?.last_username || '').trim();
        const previousBaselineColor = baseline_point_colors[normalizedKey] || null;
        const currentDraftColor = point_colors[normalizedKey] || null;
        const hasLocalOverride = currentDraftColor !== previousBaselineColor;

        const nextBaseline = { ...baseline_point_colors };
        if (nextColor) {
            nextBaseline[normalizedKey] = nextColor;
        } else {
            delete nextBaseline[normalizedKey];
        }
        baseline_point_colors = nextBaseline;

        const nextBaselineUsernames = { ...baseline_point_usernames };
        if (nextColor && nextUsername) {
            nextBaselineUsernames[normalizedKey] = nextUsername;
        } else {
            delete nextBaselineUsernames[normalizedKey];
        }
        baseline_point_usernames = nextBaselineUsernames;

        if (!hasLocalOverride) {
            const nextPointColors = { ...point_colors };
            if (nextColor) {
                nextPointColors[normalizedKey] = nextColor;
            } else {
                delete nextPointColors[normalizedKey];
            }
            point_colors = nextPointColors;
        }
    }

    async function startRealtimeSubscription() {
        if (!browser || realtimeClient) return;

        realtimeClient = new PocketBase('https://opentrons-art-pb.rcdonovan.com');

        try {
            await realtimeClient.collection(PLACE_STATE_COLLECTION).subscribe('*', (event) => {
                const record = event?.record;
                if (!record || String(record.board_id || '') !== PLACE_BOARD_ID) return;
                applyRealtimePointUpdate(record, event.action);
            }, {
                filter: `board_id="${PLACE_BOARD_ID}"`,
                fields: 'id,board_id,point_key,plate_id,x,y,color,last_username,created,updated'
            });
        } catch (error) {
            console.log('Place realtime subscription failed', error);
        }
    }

    async function stopRealtimeSubscription() {
        if (!realtimeClient) return;

        try {
            await realtimeClient.collection(PLACE_STATE_COLLECTION).unsubscribe('*');
        } catch (error) {
            console.log('Place realtime unsubscribe failed', error);
        }

        realtimeClient = null;
    }

    async function verifyInvite(id = '') {
        const normalizedId = String(id || '').trim();
        inviteId = normalizedId;
        inviteVerified = false;
        username = '';
        author = '';

        if (!normalizedId) {
            return false;
        }

        verifyingInvite = true;

        try {
            const response = await fetch('/verifyPlaceInvite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: normalizedId })
            });
            const result = await response.json();

            if (result?.success && result?.valid) {
                inviteVerified = true;
                username = String(result.username || '').trim();
                author = username;
                inviteId = String(result.inviteId || normalizedId).trim();
                return true;
            }
        } catch (error) {
            console.log('Place invite verification error', error);
        } finally {
            verifyingInvite = false;
        }

        inviteVerified = false;
        username = '';
        author = '';
        return false;
    }

    async function loadSnapshot() {
        loadingSnapshot = true;

        try {
            const response = await fetch('/loadPlace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardId: PLACE_BOARD_ID })
            });

            const result = await response.json();
            if (!result.success) {
                showAlert('alert-warning', 'Unable to load the collaborative board.');
                loadingSnapshot = false;
                return;
            }

            if (!result.record) {
                baseline_point_colors = {};
                baseline_point_usernames = {};
                point_colors = {};
                currentSnapshotId = '';
                currentSnapshotCreated = '';
                loadingSnapshot = false;
                return;
            }

            baseline_point_colors = normalizeQuadrantPointColors(result.record.point_colors);
            baseline_point_usernames = normalizeQuadrantPointColors(result.record.point_usernames);
            point_colors = { ...baseline_point_colors };
            currentSnapshotId = result.record.id || '';
            currentSnapshotCreated = result.record.created || '';
            contributionRows = Array.isArray(result.record.contribution_rows) ? result.record.contribution_rows : [];
        } catch (error) {
            console.log('Quadrant collaborative load error', error);
            showAlert('alert-warning', 'Unable to load the collaborative board.');
        }

        loadingSnapshot = false;
    }

    async function publishSnapshot() {
        const placement = pendingPlacement();

        if (!placement) {
            showAlert('alert-warning', PLACE_DELETE_ONLY_MODE ? 'Remove exactly one point before publishing.' : 'Place exactly one point before publishing.');
            return;
        }

        if (!inviteId || !inviteVerified || !username) {
            showAlert('alert-warning', 'This link is not authorized to publish. Open this page with a valid invite ID.');
            return;
        }

        if (isCooldownActive()) {
            return;
        }

        uploading = true;

        try {
            const response = await fetch('/savePlace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    boardId: PLACE_BOARD_ID,
                    inviteId,
                    placement
                })
            });

            const result = await response.json();
            if (result.success && result.id) {
                currentSnapshotId = result.id;
                if (browser) {
                    const params = new URLSearchParams();
                    params.set('id', inviteId);
                    const nextUrl = `${window.location.pathname}?${params.toString()}`;
                    window.history.replaceState({}, '', nextUrl);
                }
                username = String(result.username || username).trim();
                author = username;
                setPublishStatus(
                    result.duplicate ? 'That pixel already has the same state.' : 'Published to the collaborative artwork.',
                    result.duplicate ? 'text-warning' : 'text-success'
                );
                startCooldown();
                await loadSnapshot();
            } else {
                setPublishStatus('');
                showAlert('alert-error', result.error || 'Publish failed. Please try again.');
            }
        } catch (error) {
            console.log('Quadrant collaborative publish error', error);
            setPublishStatus('');
            showAlert('alert-error', 'Publish failed. Please try again.');
        }

        uploading = false;
    }

    function formattedTimestamp() {
        if (!currentSnapshotCreated) return '';
        const date = new Date(currentSnapshotCreated);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    onMount(async () => {
        updateCooldownState();
        const cooldownInterval = window.setInterval(updateCooldownState, 1000);
        const params = browser ? new URL(window.location.href).searchParams : null;
        const rawId = (params?.get('id') || '').trim();
        const verifiedFromId = rawId ? await verifyInvite(rawId) : false;
        if (rawId && !verifiedFromId) {
            inviteId = rawId;
        }

        await loadSnapshot();
        await startRealtimeSubscription();

        return () => {
            window.clearInterval(cooldownInterval);
            stopRealtimeSubscription();
        };
    });
</script>

<svelte:head>
    <title>Place</title>
</svelte:head>

<article class="prose w-full mx-auto mt-5 px-5">
    <h2 class="flex justify-center items-center gap-2 text-base-content text-center">
        HTGAA: 1536
    </h2>
</article>

<div class="relative w-full max-w-[90vw] sm:max-w-[440px] mx-auto pt-0">
    <div class="items-center flex flex-row gap-1 opacity-70 h-4 text-xs whitespace-nowrap">
        {#if hoverLabel}
            {hoverLabel}
            {#if hoverColor}·{/if}
            <div class="text-xs leading-none" style={`color: ${well_colors[hoverColor] || 'inherit'};`}>{hoverColor}</div>
            {#if hoverUsername}
                <div class="text-xs leading-none opacity-70">
                    ·
                    {#if contributionProfileUrl(hoverUsername)}
                        <a
                            href={contributionProfileUrl(hoverUsername)}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {displayContributionUsername(hoverUsername)}
                        </a>
                    {:else}
                        {displayContributionUsername(hoverUsername)}
                    {/if}
                </div>
            {/if}
        {:else}
            <span class="invisible">Q1 · A1</span>
        {/if}
    </div>

    <a
        class="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center opacity-60 transition-opacity hover:opacity-100"
        href={`/1536-history${currentSearchSuffix()}`}
        aria-label="View history"
        title="History"
    >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 3a9 9 0 1 0 8.95 10h-2.02A7 7 0 1 1 13 5c1.93 0 3.68.78 4.95 2.05L15 10h7V3l-2.63 2.63A8.96 8.96 0 0 0 13 3Zm-1 4v6l4.5 2.67.75-1.23-3.75-2.22V7Z"></path>
        </svg>
    </a>
</div>

<div class="mb-1 flex items-center mx-auto w-full max-w-[94vw] sm:max-w-[460px] aspect-[3/2] mt-1 rounded-xl">
    <div
        bind:this={boardEl}
        class={`touch-none relative border border-neutral mx-auto w-full max-w-[90vw] sm:max-w-[440px] aspect-[128/86] rounded overflow-hidden ${loadingSnapshot ? 'blur' : ''} ${isCooldownActive() ? 'opacity-80' : ''}`}
        role="application"
        aria-label="Quadrant collaborative painting board"
        oncontextmenu={(event) => event.preventDefault()}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={finishPainting}
        onpointercancel={finishPainting}
        onpointerleave={finishPainting}
        onmouseleave={() => {
            if (!isPainting) {
                hoverLabel = '';
                hoverColor = '';
                hoverUsername = '';
            }
        }}
    >
        <div class="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0 bg-base-300/10">
            {#each PLACE_PLATES as plate}
                <div bind:this={plateElements[plate.id]} class="relative overflow-hidden bg-transparent">
                    {#each BASE_POINTS as point (`${plate.id}-${point.x}-${point.y}`)}
                        <input
                            type="checkbox"
                            class={`checkbox absolute rounded-[2px] sm:rounded-[3px] w-[6px] h-[6px] sm:w-[8px] sm:h-[8px] [--chkfg:invisible] transition-[box-shadow] duration-200 ease-in-out ${point_colors[`${plate.id}|${point.x}, ${point.y}`] ? 'border-0' : 'opacity-10 border border-white opacity-10'}`}
                            style={`
                                left: ${platePointLeftPercent(point.x)}%;
                                top: ${platePointTopPercent(point.y)}%;
                                transform: translate(-50%, -50%);
                                background-color: ${pointColorForKey(`${plate.id}|${point.x}, ${point.y}`)};
                                border: ${point_colors[`${plate.id}|${point.x}, ${point.y}`] ? `1px solid ${pointColorForKey(`${plate.id}|${point.x}, ${point.y}`)}` : '1px solid white'};
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

<div class="flex flex-col px-5 gap-1 w-full max-w-[96vw] sm:max-w-[480px] mx-auto mb-[150px]">
    <div class={`min-h-[1.25rem] text-center text-xs ${publishStatusTone}`}>
        {#if isCooldownActive()}
            Please wait {formatCooldownRemaining()} to paint again.
        {:else if publishStatusMessage}
            {publishStatusMessage}
        {/if}
    </div>

    <div class="grid grid-cols-2 gap-3 sm:gap-4 items-start">
        <div class="w-full flex flex-col items-center gap-1">
            <button class="btn btn-sm w-full max-w-[150px] sm:w-auto rounded gap-1 bg-neutral-700 text-base-content hover:bg-neutral-600 hover:text-base-content" type="button" onclick={publishSnapshot} disabled={uploading || loadingSnapshot || !hasPendingPlacement() || isCooldownActive() || verifyingInvite || !inviteVerified}>
                {#if uploading}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 35 35" xmlns="http://www.w3.org/2000/svg"><path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path></svg>
                {/if}
                {PLACE_DELETE_ONLY_MODE ? 'Remove Pixel' : 'Submit Pixel'}
            </button>

            {#if !inviteId && hasPendingPlacement()}
                <div class="w-full max-w-[170px] text-center text-xs text-warning pt-1">
                    No user ID in URL. Check your email!
                </div>
            {:else if verifyingInvite}
                <div class="w-full max-w-[170px] text-center text-xs text-info">
                    Verifying invite link...
                </div>
            {:else if !inviteVerified}
                <!-- <div class="w-full max-w-[170px] text-center text-xs text-warning">
                    This invite link is not valid for publishing.
                </div> -->
            {/if}
        </div>

        {#if PLACE_DELETE_ONLY_MODE}
            <div class="flex flex-col w-full max-w-[170px] sm:max-w-[170px] gap-2 mx-auto items-center justify-center text-center">
                <div class="flex flex-row justify-between w-full">
                    <span class="font-semibold">Mode</span>
                    <span class="opacity-70">Delete</span>
                </div>
                <div class="w-full rounded bg-base-200/80 px-3 py-2 text-xs opacity-80">
                    Remove pixels until nothing remains. <br />
                    Thank you to everyone who contributed!
                </div>
            </div>
        {:else}
            <div class="flex flex-col w-full max-w-[170px] sm:max-w-[170px] gap-2 mx-auto items-center">
                <div class="flex flex-row justify-between w-full">
                    <span class="font-semibold">Protein</span>
                    <a class="opacity-70 underline" href={fpbaseUrlFor(current_color)} target="_blank" rel="noopener noreferrer">{current_color}</a>
                </div>

                <div class="grid grid-cols-3 gap-2 justify-items-center content-start w-fit mx-auto">
                    {#each paletteColors as name}
                        <div
                            role="radio"
                            tabindex="0"
                            aria-checked={current_color === name}
                            onclick={() => {
                                current_color = name;
                            }}
                            onkeydown={(event) => event.key === 'Enter' && (current_color = name)}
                            class="w-[24px] h-[24px] rounded-full cursor-pointer border-[1px] transition outline-none focus:ring-2 ring-offset-2 flex items-center justify-center"
                            style={`background-color: #fffff; border-color: ${well_colors[name]}; box-shadow: ${current_color === name ? '0 0 0 0px #000 inset' : 'none'};`}
                            title={name}
                        >
                            <div
                                class="w-[14px] h-[14px] rounded-full block"
                                style={`background-color: ${current_color === name ? well_colors[name] : 'transparent'};`}
                            ></div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    <div class="flex flex-col w-full mt-3 gap-1 mx-auto bg-base-200 rounded px-3 py-2 text-xs opacity-80">
        <span class="font-semibold text-sm opacity-100">Summary</span>
        <span>
            A real-time, global, collaborative fluorescent protein artwork canvas designed by the <a class="underline" href="https://2026a.htgaa.org" target="_blank" rel="noopener noreferrer">How To Grow (Almost) Anything</a> (HTGAA) community.
        </span>
        <br />
        <span>
            {#if PLACE_DELETE_ONLY_MODE}
                HTGAA students and TAs can remove one pixel at a time from the shared artwork, then wait 20 seconds before removing another.
            {:else}
                HTGAA students and TAs can place one pixel at a time, publish it to the shared artwork, then wait 20 seconds before placing another.
            {/if}
        </span>
        <br />
        <span>
            The artwork will be used in a cell-free protein synthesis optimization experiment designed by HTGAA students.
        </span>
        <br />
        <span>
            Experimental details: <a class="underline" href="https://docs.google.com/presentation/d/1bz0xRXS7tOcje75Xs0dpeOOQpOwgRL1ld1DvPv3yrfU" target="_blank" rel="noopener noreferrer">2026 HTGAA Cloud Lab Recitation</a>
            <br />
            Inspiration credit: <a class="underline" href="https://en.wikipedia.org/wiki/R/place" target="_blank" rel="noopener noreferrer">r/place</a>
        </span>
    </div>

    <div class="flex flex-col w-full mt-2 gap-2 mx-auto bg-base-200 rounded px-3 py-3 text-xs opacity-90">
        <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm opacity-100">Top Contributors</span>
            <span class="text-[11px] opacity-70">
                {contributionRows.length.toLocaleString('en-US')} contributors · {contributionRows.reduce((sum, row) => sum + (Number(row?.total) || 0), 0).toLocaleString('en-US')} contributions
            </span>
        </div>

        {#if contributionRows.length === 0}
            <div class="text-xs opacity-70">No contribution data yet.</div>
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

{#if isToastVisible}
    <div role="alert" class={`alert ${alertType} fixed left-1/2 top-4 z-30 max-w-[85vw] -translate-x-1/2 shadow-lg`}>
        <span>{alertMessage}</span>
    </div>
{/if}

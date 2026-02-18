<script>
    import { onMount, tick } from 'svelte';
    import { browser } from '$app/environment';
    import { digest, enzymes, lambda_dna } from '$lib/digest.js';
    import { page } from '$app/stores';

    let columns = $state(11);
    let selected_column = $state(null);
    let stack_mode = $state(false);
    let top_layer_selected = $state(true);
    let current_enzymes = $state(enzymes.map(e => ({ ...e })));
    
    let uploading = $state(false);
    let title = $state('');
    let author = $state('');

    let isToastVisible = $state(false);
    let alertMessage = $state('');
    let alertType = $state('');
    let loadingURLRecord = $state(false);

    onMount(() => {
        if (!browser) return;

        let loadRecordId = $page.url.searchParams.get('id');
        if (loadRecordId) {
            loadRecord(loadRecordId);
        }

        const modal = document.getElementById('upload_modal');
        const handleDown = (e) => {
            if (e.key === "Shift") {
                top_layer_selected = false;
            }
        };

        const handleUp = (e) => {
            if (e.key === "Shift") {
                top_layer_selected = true;
            }
        };
        window.addEventListener("keydown", handleDown);
        window.addEventListener("keyup", handleUp);

        window.addEventListener('keydown', event => {
            if (modal.open) {
                return;
            }
            const directions = {
                    ArrowUp: 'up',
                    ArrowDown: 'down',
                    ArrowLeft: 'left',
                    ArrowRight: 'right',
                };

            if (event.key === 'Escape') {
                event.preventDefault();
                selected_column = null;
            }

            if (event.key === 'Backspace') {
                event.preventDefault();
                if (bands[selected_column]) {
                    bands[selected_column] = {
                        ...bands[selected_column],
                        digestList: buildDigestList(),
                        enzymesUsed: [],
                        currentBands: [],
                        index: 0,
                        isLadder: false,
                    };
                    bands = { ...bands };
                }
            }

            if (event.key === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                randomizeBands();
            }

            if (event.key === 'c' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                resetBands();
            }

            if (event.key === 's') {
                event.preventDefault();
                stack_mode = !stack_mode;
            }

            if (event.code === 'Space') {
                event.preventDefault();
                if (bands[selected_column]) {
                    bands[selected_column] = {
                        ...bands[selected_column],
                        digestList: buildDigestList(),
                        enzymesUsed: [],
                        currentBands: [...LADDER],
                        index: 0,
                        isLadder: true,
                    };
                    bands = { ...bands };
                }
            }

            if (selected_column === null) return;

            const direction = directions[event.key];
            if (!direction) return;

            if (direction === 'left') {
                event.preventDefault();
                selected_column = (selected_column - 1 + columns) % columns;
            }

            if (direction === 'right') {
                event.preventDefault();
                selected_column = (selected_column + 1) % columns;
            }

            if (direction === 'up' || direction === 'down') {
                event.preventDefault();
                const { fragments, newIndex, enzymesUsed } = iterateDigest(selected_column, lambda_dna, direction);
                if (top_layer_selected) {
                    bands = {
                        ...bands,
                        [selected_column]: {
                            ...bands[selected_column],
                            currentBands: fragments,
                            index: newIndex,
                            enzymesUsed,
                            isLadder: false
                        }
                    };
                } else {
                    bottom_bands = {
                        ...bottom_bands,
                        [selected_column]: {
                            ...bottom_bands[selected_column],
                            currentBands: fragments,
                            index: newIndex,
                            enzymesUsed,
                            isLadder: false
                        }
                    };
                }
            }

        });
    });

    function enzymeCombinations(list, k) {
        const out = [];
        function rec(start, prev) {
            if (prev.length === k) {
                out.push([...prev]);
                return;
            }
            for (let i = start; i < list.length; i++) {
                prev.push(list[i]);
                rec(i + 1, prev);
                prev.pop();
            }
        }
        rec(0, []);
        return out;
    }

    export function buildDigestList() {
        const singles = enzymeCombinations(current_enzymes, 1);
        const doubles = enzymeCombinations(current_enzymes, 2);
        // const triples = enzymeCombinations(enzymes, 3);

        return [...singles, ...doubles];
    }

    const LADDER = [15000, 10000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100];

    function bpToPx(bp, height = 250, bandH = 5) {
        const log = (x) => Math.log10(x);
        const maxLog = log(LADDER[0]);
        const minLog = log(LADDER[LADDER.length - 1]);
        const bpLog = log(bp);

        if (bpLog >= maxLog) return 0;
        if (bpLog <= minLog) return height - bandH;

        const t = (maxLog - bpLog) / (maxLog - minLog);
        return t * (height - bandH);
    }

    let bands = $state(
        Object.fromEntries(
            Array.from({ length: 13 }, (_, i) => [
                i,
                { index: -1, digestList: buildDigestList(), enzymesUsed: [], isLadder: false }
            ])
        )
    );
    
    let bottom_bands = $state(
        Object.fromEntries(
            Array.from({ length: 13 }, (_, i) => [
                i,
                { index: -1, digestList: buildDigestList(), enzymesUsed: [], isLadder: false }
            ])
        )
    );

    function iterateDigest(column, DNA, direction) {
        const col = top_layer_selected ? bands[column] : bottom_bands[column];
        const max = col.digestList.length;

        let newIndex = col.index;
        if (direction === 'up') newIndex = (newIndex - 1 + max) % max;
        if (direction === 'down') newIndex = (newIndex + 1) % max;

        // Filter out disabled enzymes
        const selectedEnzymes =
            col.digestList[newIndex].filter(e => e.enabled !== false);

        const enzymesUsed = selectedEnzymes.map(e => e.name);

        return {
            fragments: digest(DNA, selectedEnzymes),
            newIndex,
            enzymesUsed
        };
    }

    function randomizeBands() {
        const digestList = buildDigestList();
        const max = digestList.length;

        for (let c = 0; c < columns; c++) {
            const pick = Math.floor(Math.random() * (max + 1));

            if (pick === max) {
                bands[c] = {
                    ...bands[c],
                    digestList,
                    enzymesUsed: [],
                    currentBands: [...LADDER],
                    index: 0,
                    isLadder: true
                };
            } else {
                // Filter disabled enzymes
                const enzymesSet =
                    digestList[pick].filter(e => e.enabled !== false);

                const frags = digest(lambda_dna, enzymesSet);

                bands[c] = {
                    ...bands[c],
                    digestList,
                    enzymesUsed: enzymesSet.map(e => e.name),
                    currentBands: frags,
                    index: pick,
                    isLadder: false
                };
            }
        }

        for (let c = 0; c < columns; c++) {
            const pick = Math.floor(Math.random() * (max + 1));

            if (pick === max) {
                bottom_bands[c] = {
                    ...bottom_bands[c],
                    digestList,
                    enzymesUsed: [],
                    currentBands: [...LADDER],
                    index: 0,
                    isLadder: true
                };
            } else {
                // Filter disabled enzymes
                const enzymesSet =
                    digestList[pick].filter(e => e.enabled !== false);

                const frags = digest(lambda_dna, enzymesSet);

                bottom_bands[c] = {
                    ...bottom_bands[c],
                    digestList,
                    enzymesUsed: enzymesSet.map(e => e.name),
                    currentBands: frags,
                    index: pick,
                    isLadder: false
                };
            }
        }

        bands = { ...bands };
        bottom_bands = { ...bottom_bands };
    }


    function resetBands() {
        bands = Object.fromEntries(
            Array.from({ length: columns }, (_, i) => [
                i,
                { index: -1, digestList: buildDigestList(), enzymesUsed: [], isLadder: false }
            ])
        )
        bottom_bands = Object.fromEntries(
            Array.from({ length: columns }, (_, i) => [
                i,
                { index: -1, digestList: buildDigestList(), enzymesUsed: [], isLadder: false }
            ])
        )
    }

    function calculateWater(sum) {
            const totalVolume = 20;
            return totalVolume - sum;
        }
            const totalVolume = 20; // µL

    function bufferVolume(enzymes) {
        if (enzymes.length === 0 || enzymes[0] === 'Ladder') return 0;
        return 2;
    }

    function dnaVolume() {
        return 3; 
    }

    function ladderVolume() {
        return 1;
    }

    function waterVolume(enzymes) {
        if (enzymes.length === 0 || enzymes[0] === 'Ladder') return 0;
        const enzymeVol = enzymes.length * 1; // 1 μL per enzyme
        const bufferVol = bufferVolume(enzymes);
        const dnaVol = dnaVolume();
        return totalVolume - enzymeVol - bufferVol - dnaVol;
    }

    function showAlert(type = "alert-success", msg = "Success!") {
		isToastVisible = true;
        alertMessage = msg;
        alertType = type;
		setTimeout(() => { isToastVisible = false; }, 3000);
	}

    async function loadRecord(id) {
        try {
            loadingURLRecord = true;
            const response = await fetch('/loadGel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'id': id })
            });
            const r = await response.json();
            columns = r.record.columns;
            stack_mode = r.record.stack_mode;
            current_enzymes = r.record.current_enzymes;
            bands = r.record.bands;
            bottom_bands = r.record.bottom_bands;
            showAlert("alert-success", "Loaded design successfully!");
        } catch (error) {
            showAlert("alert-warning", "Failed to load design.");
        }
        loadingURLRecord = false;
    }

    async function saveToGallery() {
        uploading = true;
        const response = await fetch('/save-gel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                author,
                columns,
                stack_mode,
                bands,
                bottom_bands,
                current_enzymes
            })
        });
        let r = await response.json();
        
        if (r.success && !r.duplicate) {
            showAlert("alert-success", "Added to gallery!");
        } else if (r.duplicate) {
            showAlert("alert-warning", "Duplicate submission.");
        } else {
            showAlert("alert-error", "Error: try again later.");
        }
        uploading = false;
        // close the popup modal
        const modal = document.getElementById('upload_modal');
        modal.close();
    }
</script>

<article class="prose w-full mx-auto mt-5">
    <h2 class="flex justify-center items-center gap-2 text-base-content">
        DNA Gel Art Interface
    </h2>
</article>

<div class="flex flex-row w-full max-w-[100vw] sm:max-w-[490px] mx-auto px-5 pt-3">
    <div class="mr-auto items-center flex flex-row gap-2 opacity-70 invisible">
        <label class="swap mr-auto">
            <svg class="swap-on w-6 h-6 text-neutral" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g data-name="Layer 2"> <g data-name="eye"> <rect width="24" height="24" opacity="0"></rect> <circle cx="12" cy="12" r="1.5"></circle> <path d="M21.87 11.5c-.64-1.11-4.16-6.68-10.14-6.5-5.53.14-8.73 5-9.6 6.5a1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25c5.53-.14 8.74-5 9.6-6.5a1 1 0 0 0 0-1zm-9.87 4a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z"></path> </g> </g> </g></svg>
            <svg class="swap-off w-6 h-6 text-neutral" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g data-name="Layer 2"> <g data-name="eye-off"> <rect width="24" height="24" opacity="0"></rect> <circle cx="12" cy="12" r="1.5"></circle> <path d="M15.29 18.12L14 16.78l-.07-.07-1.27-1.27a4.07 4.07 0 0 1-.61.06A3.5 3.5 0 0 1 8.5 12a4.07 4.07 0 0 1 .06-.61l-2-2L5 7.87a15.89 15.89 0 0 0-2.87 3.63 1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25a9.48 9.48 0 0 0 3.23-.67z"></path> <path d="M8.59 5.76l2.8 2.8A4.07 4.07 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 4.07 4.07 0 0 1-.06.61l2.68 2.68.84.84a15.89 15.89 0 0 0 2.91-3.63 1 1 0 0 0 0-1c-.64-1.11-4.16-6.68-10.14-6.5a9.48 9.48 0 0 0-3.23.67z"></path> <path d="M20.71 19.29L19.41 18l-2-2-9.52-9.53L6.42 5 4.71 3.29a1 1 0 0 0-1.42 1.42L5.53 7l1.75 1.7 7.31 7.3.07.07L16 17.41l.59.59 2.7 2.71a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42z"></path> </g> </g> </g></svg>
        </label>
    </div>
    <a href='/gel-gallery' class="mr-0 flex flex-row gap-2 items-center opacity-70 text-sm"> Gallery <svg class="w-5 h-5" fill="currentColor" viewBox="0 -0.5 33 33" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>pictures1</title> <path d="M26.604 29.587l-2.624-0.72-0.006-7.258 2.51 0.706 3.619-13.509-18.332-4.912-1.208 4.506h-2.068l1.863-6.952 22.193 5.946-5.947 22.193zM23.039 32h-23.039v-22.977h23.039v22.977zM21.041 11.021h-19.043v13.985h19.043v-13.985zM7.849 20.993l2.283-3.692 2.283 2.301 3.139-4.727 3.283 8.134h-14.556l1.855-3.71 1.713 1.694zM6.484 17.086c-0.828 0-1.499-0.67-1.499-1.498s0.671-1.498 1.499-1.498 1.498 0.67 1.498 1.498-0.67 1.498-1.498 1.498z"></path> </g></svg></a>
</div>

<div class="flex flex-col w-full max-w-[90vw] sm:max-w-[525px] mx-auto px-5 pt-5">
    <div class="flex flex-row mx-auto w-full rounded-md pt-1 pb-2">
        <div class="flex flex-col flex-1">
            <p class="text-center text-gray-500 invisible pb-[2px] w-[35px] text-xs">L</p>
            <div class="relative h-[275px] flex mt-2 text-right mr-1">
                {#each LADDER as bp}
                    <div class="absolute left-1 right-1 h-[5px] text-[6px]" style="top:{bpToPx(bp)}px"> {bp >= 1000 ? `${Math.round(bp / 1000)} kb` : `${bp} bp`} </div>
                {/each}
            </div>
        </div>
        {#each Array.from({ length: columns }) as _, column}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="flex flex-col flex-1">
                    <p class="text-center text-gray-500 pb-1 text-xs">
                        {#if column + 1 === 1}
                            M
                        {:else}
                            {column}
                        {/if}
                    </p>
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- Regular bottom border -->
                <div class="relative h-[275px] bg-gray-600 {selected_column === column ? 'ring-1 ring-inset ring-gray-700 rounded-sm' : ''}" 
                    onclick={() => { selected_column = column; }}>

                <!-- Offset bottom “border” -->
                {#if stack_mode}
                    <div class="absolute bottom-[-6px] w-full h-[6px] bg-gray-60 left-[-6px]" style="width: calc(100% + 6px);"></div>
                {:else}
                    <div class="absolute bottom-[-3px] w-full h-[3px] bg-gray-60 left-[-3px]" style="width: calc(100% + 3px);"></div>
                {/if}

                <!-- Offset left “border” (only for first column) -->
                {#if stack_mode && column + 1 === 1}
                    <div class="absolute top-0 left-[-6px] h-full w-[6px] bg-gray-60"></div>
                {:else if column + 1 === 1}
                    <div class="absolute top-0 left-[-3px] h-full w-[3px] bg-gray-60"></div>
                {/if}

                <!-- Bands for top layer -->
                {#if bands[column]?.currentBands?.length > 0}
                    {#each bands[column].currentBands as bp}
                        <div
                            class="absolute left-1 right-1 h-[12px] mt-0.5 rounded-full"
                            style="
                                top:{bpToPx(bp)}px;
                                mask-image: radial-gradient(100% 40% at 50% 100%, black 60%, transparent 100%);
                                -webkit-mask-image: radial-gradient(100% 40% at 50% 100%, black 40%, transparent 100%);
                                background: linear-gradient(to right,
                                    rgba(156,163,175,0) 0%,
                                    rgba(156,163,175,0.85) 25%,
                                    rgba(156,163,175,0.95) 50%,
                                    rgba(156,163,175,0.85) 75%,
                                    rgba(156,163,175,0) 100%);
                            "
                        ></div>
                    {/each}
                {/if}

                <!-- Bands for bottom layer, if stacking -->
                {#if stack_mode}
                    {#if bottom_bands[column]?.currentBands?.length > 0}
                        {#each bottom_bands[column].currentBands as bp}
                            <div
                                class="absolute left-1 right-1 h-[12px] mt-0.5 rounded-full opacity-30"
                                style="
                                    top:{bpToPx(bp)}px;
                                    mask-image: radial-gradient(100% 40% at 50% 100%, black 60%, transparent 100%);
                                    -webkit-mask-image: radial-gradient(100% 40% at 50% 100%, black 40%, transparent 100%);
                                    background: linear-gradient(to right,
                                        rgba(156,163,175,0) 0%,
                                        rgba(156,163,175,0.85) 25%,
                                        rgba(156,163,175,0.95) 50%,
                                        rgba(156,163,175,0.85) 75%,
                                        rgba(156,163,175,0) 100%);
                                "
                            ></div>
                        {/each}
                    {/if}
                {/if}

                </div>
                {#if selected_column === column}
                    <div class="flex flex-col items-center w-full z-20 {stack_mode ? 'pt-[-6px]' : 'pt-[-3px]'}">
                       <div class="flex flex-row w-full max-w-full justify-between">
                            <button
                                class="btn btn-xs flex-1 px-0 py-0 bg-gray-600 hover:bg-neutral hover:text-white rounded"
                                onclick={() => {
                                    const { fragments, newIndex, enzymesUsed } = iterateDigest(selected_column, lambda_dna, 'up');
                                    if (top_layer_selected) {
                                        bands = {
                                            ...bands,
                                            [selected_column]: {
                                                ...bands[selected_column],
                                                currentBands: fragments,
                                                index: newIndex,
                                                enzymesUsed,
                                                isLadder: false
                                            }
                                        };
                                    } else {
                                        bottom_bands = {
                                            ...bottom_bands,
                                            [selected_column]: {
                                                ...bottom_bands[selected_column],
                                                currentBands: fragments,
                                                index: newIndex,
                                                enzymesUsed,
                                                isLadder: false
                                            }
                                        };
                                    }
                                }}
                            >
                                &uarr;
                            </button>
                            <button
                                class="btn btn-xs flex-1 px-0 py-0 bg-gray-600 hover:bg-neutral hover:text-white rounded"
                                onclick={() => {
                                    const { fragments, newIndex, enzymesUsed } = iterateDigest(selected_column, lambda_dna, 'down');
                                    if (top_layer_selected) {
                                        bands = {
                                            ...bands,
                                            [selected_column]: {
                                                ...bands[selected_column],
                                                currentBands: fragments,
                                                index: newIndex,
                                                enzymesUsed,
                                                isLadder: false
                                            }
                                        };
                                    } else {
                                        bottom_bands = {
                                            ...bottom_bands,
                                            [selected_column]: {
                                                ...bottom_bands[selected_column],
                                                currentBands: fragments,
                                                index: newIndex,
                                                enzymesUsed,
                                                isLadder: false
                                            }
                                        };
                                    }
                                }}
                            >
                                &darr;
                            </button>
                        </div>
                        <div class="flex flex-col w-full max-w-full justify-between">
                            <!-- switch layer -->
                            {#if stack_mode}
                                <button class="btn btn-xs flex-1 px-0 py-0 bg-gray-600 w-full hover:bg-neutral hover:text-white gap-1. rounded5"
                                    onclick={() => {top_layer_selected = !top_layer_selected;}}>
                                    <svg class="w-4 h-4" height="200px" width="200px"  viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="10"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M7.75432 1.81954C7.59742 1.72682 7.4025 1.72682 7.24559 1.81954L1.74559 5.06954C1.59336 5.15949 1.49996 5.32317 1.49996 5.5C1.49996 5.67683 1.59336 5.84051 1.74559 5.93046L7.24559 9.18046C7.4025 9.27318 7.59742 9.27318 7.75432 9.18046L13.2543 5.93046C13.4066 5.84051 13.5 5.67683 13.5 5.5C13.5 5.32317 13.4066 5.15949 13.2543 5.06954L7.75432 1.81954ZM7.49996 8.16923L2.9828 5.5L7.49996 2.83077L12.0171 5.5L7.49996 8.16923ZM2.25432 8.31954C2.01658 8.17906 1.70998 8.2579 1.56949 8.49564C1.42901 8.73337 1.50785 9.03998 1.74559 9.18046L7.24559 12.4305C7.4025 12.5232 7.59742 12.5232 7.75432 12.4305L13.2543 9.18046C13.4921 9.03998 13.5709 8.73337 13.4304 8.49564C13.2899 8.2579 12.9833 8.17906 12.7456 8.31954L7.49996 11.4192L2.25432 8.31954Z" fill="currentColor"></path> </g></svg>
                                    {#if top_layer_selected}
                                        1
                                    {:else}
                                        2
                                    {/if}
                                </button>
                            {/if}
                            <!-- trash/delete -->
                            <button class="btn btn-xs flex-1 px-0 py-0 bg-gray-600 w-full hover:bg-neutral hover:text-white rounded"
                                onclick={() => {
                                    bands[selected_column] = {
                                        ...bands[selected_column],
                                        digestList: buildDigestList(),
                                        enzymesUsed: [],
                                        currentBands: [],
                                        index: 0,
                                        isLadder: false,
                                    };
                                    bands = { ...bands };
                                    selected_column = null;
                                }}>
                                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" stroke="currentColor"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M22,5a1,1,0,0,1-1,1H3A1,1,0,0,1,3,4H8V3A1,1,0,0,1,9,2h6a1,1,0,0,1,1,1V4h5A1,1,0,0,1,22,5ZM4.934,21.071,4,8H20l-.934,13.071a1,1,0,0,1-1,.929H5.931A1,1,0,0,1,4.934,21.071ZM15,18a1,1,0,0,0,2,0V12a1,1,0,0,0-2,0Zm-4,0a1,1,0,0,0,2,0V12a1,1,0,0,0-2,0ZM7,18a1,1,0,0,0,2,0V12a1,1,0,0,0-2,0Z"></path></g></svg>
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        {/each}
        <div class="flex flex-col flex-1">
            <p class="text-center text-gray-500 invisible pb-[2px] w-[35px] text-xs">L</p>
            <div class="relative h-[275px] flex mt-2 text-left">
                {#each LADDER as bp}
                    <div class="absolute left-1 right-1 h-[5px] text-[6px]" style="top:{bpToPx(bp)}px"> {bp >= 1000 ? `${Math.round(bp / 1000)} kb` : `${bp} bp`} </div>
                {/each}
            </div>
        </div>
    </div>
    <div class="flex flex-row justify-between">
        <div class="pt-3 join">
            <button class="btn btn-xs sm:btn-xs text-xs rounded-l rounded-r-none bg-neutral-800 hover:bg-neutral-70" onclick={() => { if (!uploading) {upload_modal.showModal()}}}>
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>upload1</title> <path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path> </g></svg>
                Publish
            </button>
            <button class="join-item btn btn-xs sm:btn-xs text-xs rounded-r-none bg-neutral-800 hover:bg-neutral-700"
                    onclick={() => { 
                        if (bands[selected_column]) {
                            bands[selected_column] = {
                                ...bands[selected_column],
                                digestList: buildDigestList(),
                                enzymesUsed: [],
                                currentBands: [...LADDER],
                                index: 0,
                                isLadder: true,
                            };
                            bands = { ...bands };
                        }}}>
                <svg viewBox="0 0 16 16" class="w-3.5 h-3.5 rounded-sm" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M2 0V16H4V14H12V16H14V0H12V2H4V0H2ZM4 4V7H12V4H4ZM12 12H4V9H12V12Z" fill="currentColor"></path> </g></svg>
                Ladder
            </button>
            <button class="join-item text-white btn btn-xs sm:btn-xs text-xs rounded-r-none bg-neutral-800 hover:bg-neutral-700" onclick={randomizeBands}>
                <svg class="w-3.5 h-3.5" height="200px" width="200px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" xml:space="preserve" fill="#fff"><g id="SVGRepo_bgCarrier2" stroke-width="0"></g><g id="SVGRepo_tracerCarrier2" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css"> .st0{fill:#fff;} </style> <g> <path class="st0" d="M454.609,111.204L280.557,6.804C272.992,2.268,264.503,0,255.999,0c-8.507,0-16.995,2.268-24.557,6.796 L57.391,111.204c-5.346,3.202-9.917,7.369-13.556,12.192l207.904,124.708c2.622,1.575,5.9,1.575,8.519,0L468.16,123.396 C464.524,118.573,459.951,114.406,454.609,111.204z M157.711,130.313c-10.96,7.611-28.456,7.422-39.081-0.452 c-10.618-7.859-10.342-20.413,0.618-28.031c10.964-7.626,28.46-7.422,39.081,0.438C168.95,110.134,168.674,122.68,157.711,130.313z M274.159,131.021c-10.594,7.362-27.496,7.166-37.762-0.429c-10.263-7.596-9.992-19.727,0.599-27.089 c10.591-7.362,27.492-7.174,37.759,0.43C285.018,111.528,284.75,123.659,274.159,131.021z M391.908,132.702 c-10.964,7.618-28.461,7.414-39.085-0.444c-10.617-7.86-10.343-20.42,0.621-28.046c10.957-7.61,28.456-7.422,39.078,0.452 C403.147,112.523,402.868,125.076,391.908,132.702z"></path> <path class="st0" d="M246.136,258.366L38.007,133.523c-2.46,5.802-3.798,12.117-3.798,18.62v208.084 c0,16.773,8.797,32.311,23.182,40.946l174.051,104.392c5.829,3.497,12.204,5.629,18.714,6.435V265.464 C250.156,262.556,248.63,259.858,246.136,258.366z M75.845,369.736c-12.056-6.57-21.829-21.671-21.829-33.727 c0-12.056,9.773-16.502,21.829-9.932c12.056,6.571,21.826,21.671,21.826,33.728C97.671,371.861,87.901,376.307,75.845,369.736z M75.845,247.87c-12.056-6.579-21.829-21.679-21.829-33.728c0-12.056,9.773-16.502,21.829-9.931 c12.056,6.57,21.826,21.671,21.826,33.728C97.671,249.987,87.901,254.44,75.845,247.87z M197.715,436.158 c-12.052-6.57-21.826-21.671-21.826-33.728c0-12.048,9.773-16.494,21.826-9.924c12.056,6.571,21.826,21.671,21.826,33.72 C219.541,438.284,209.771,442.729,197.715,436.158z M197.715,314.292c-12.052-6.571-21.826-21.671-21.826-33.728 s9.773-16.502,21.826-9.931c12.056,6.57,21.826,21.671,21.826,33.727C219.541,316.417,209.771,320.862,197.715,314.292z"></path> <path class="st0" d="M473.993,133.523l-208.13,124.843c-2.494,1.492-4.02,4.19-4.02,7.099V512 c6.511-0.806,12.886-2.938,18.714-6.435l174.052-104.392c14.38-8.635,23.182-24.173,23.182-40.946V152.142 C477.791,145.64,476.453,139.325,473.993,133.523z M370.478,355.11c-19.287,10.512-34.922,3.398-34.922-15.892 c0-19.282,15.635-43.447,34.922-53.951c19.293-10.519,34.925-3.406,34.925,15.884C405.403,320.434,389.771,344.598,370.478,355.11z "></path> </g> </g></svg>
                Randomize
            </button>
            <button class="join-item btn btn-xs sm:btn-xs text-xs rounded-r bg-neutral-800 hover:bg-neutral-700 {stack_mode ? 'bg-neutral text-white' : ''} hover:bg-neutral hover:text-white" onclick={() => {stack_mode = !stack_mode;}}>
                <svg class="w-4 h-4" height="200px" width="200px"  viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="10"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M7.75432 1.81954C7.59742 1.72682 7.4025 1.72682 7.24559 1.81954L1.74559 5.06954C1.59336 5.15949 1.49996 5.32317 1.49996 5.5C1.49996 5.67683 1.59336 5.84051 1.74559 5.93046L7.24559 9.18046C7.4025 9.27318 7.59742 9.27318 7.75432 9.18046L13.2543 5.93046C13.4066 5.84051 13.5 5.67683 13.5 5.5C13.5 5.32317 13.4066 5.15949 13.2543 5.06954L7.75432 1.81954ZM7.49996 8.16923L2.9828 5.5L7.49996 2.83077L12.0171 5.5L7.49996 8.16923ZM2.25432 8.31954C2.01658 8.17906 1.70998 8.2579 1.56949 8.49564C1.42901 8.73337 1.50785 9.03998 1.74559 9.18046L7.24559 12.4305C7.4025 12.5232 7.59742 12.5232 7.75432 12.4305L13.2543 9.18046C13.4921 9.03998 13.5709 8.73337 13.4304 8.49564C13.2899 8.2579 12.9833 8.17906 12.7456 8.31954L7.49996 11.4192L2.25432 8.31954Z" fill="currentColor"></path> </g></svg>
                Stack
            </button>
        </div>
        <div class="ml-auto join pt-3">
            <button class="btn btn-xs sm:btn-xs text-xs rounded-r-none rounded-l bg-neutral-800 hover:bg-neutral-700" onclick={resetBands}>
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path transform="scale(1.2) translate(-3 -2.5)" fill-rule="evenodd" clip-rule="evenodd" d="M15.0722 3.9967L20.7508 9.83395L17.0544 13.5304L13.0758 17.5H21.0041V19H7.93503L4.00195 15.0669L15.0722 3.9967ZM10.952 17.5L15.4628 12.9994L11.8268 9.3634L6.12327 15.0669L8.55635 17.5H10.952Z" fill="currentColor"></path> </g></svg>
            </button>
            <button class="join-item btn btn-xs text-xs sm:btn-xs text-xs rounded-r-none bg-neutral-800 hover:bg-neutral-700"
                    onclick={() => {
                        if (columns > 1) columns -= 1;
                    }}>
                -
            </button>
            <button class="join-item btn btn-xs sm:btn-xs text-xs rounded-r bg-neutral-800 hover:bg-neutral-700"
                    onclick={() => {
                        const newIndex = columns; // next index
                        bands = {
                            ...bands,
                            [newIndex]: {
                                index: 0,
                                digestList: buildDigestList(),
                                enzymesUsed: []
                            }
                        };
                        bottom_bands = {
                            ...bottom_bands,
                            [newIndex]: {
                                index: 0,
                                digestList: buildDigestList(),
                                enzymesUsed: []
                            }
                        };
                        columns += 1;
                    }}>
                +
            </button>
        </div>
    </div>
</div>

<!-- Put controls here -->
<!-- <div class="flex flex-col w-full max-w-[90vw] sm:max-w-[525px] mx-auto px-5 pt-5">
    <div class="flex flex-row mx-auto w-full bg-gray-100 rounded text-sm px-2">
        <div class="">
            arrow
        </div>
        <div class="">

        </div>
    </div>
</div> -->

<article class="prose w-full mx-auto mt-5 pt-5 sm:max-w-[700px] px-5">
    <h4 class="flex flex-row justify-between text-white mb-1 inline">
        Restriction Enzymes
        <div>
            <div class="join">
                <button
                    class="btn join-item btn-xs sm:btn-xs text-xs rounded-l rounded-r-none bg-neutral-800 hover:bg-neutral-700"
                    onclick={() => {
                        current_enzymes.forEach(e => e.enabled = true);
                        current_enzymes = [...current_enzymes];
                    }}
                >All On</button>

                <button
                    class="btn join-item btn-xs sm:btn-xs text-xs rounded-r bg-neutral-800 hover:bg-neutral-700"
                    onclick={() => {
                        current_enzymes.forEach(e => e.enabled = false);
                        current_enzymes = [...current_enzymes];
                    }}
                >All Off</button>
            </div>
    </div>
    </h4>
    <hr class="pb-3" />
</article>
<div class="flex flex-col w-full max-w-[100vw] sm:max-w-[700px] mx-auto px-5">
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {#each current_enzymes as enzyme, i}
            <label class="flex items-center justify-between px-2 py-1 border-b text-sm">
                <span>{enzyme.name}</span>

                <input
                    type="checkbox"
                    bind:checked={enzyme.enabled}
                    onchange={() => {
                        current_enzymes = [...current_enzymes];
                    }}
                    class="checkbox checkbox-sm"
                />
            </label>
        {/each}
    </div>
</div>

<!-- Top Level Gel Restriction Digests -->
<div class="flex flex-col w-full max-w-[100vw] sm:max-w-[700px] mx-auto px-5">
    <article class="prose w-full mx-auto mt-5">
        <h4 class="text-left text-white mb-1">
            {#if stack_mode}
                Top Gel Restriction Digests
            {:else}
                Restriction Digests
            {/if}
        </h4>
        <hr class="pb-3" />
    </article>
    <table class="border border-gray-300 my-2 w-full table-fixed">
        <thead>
            <tr class="bg-gray-600">
                <th class="px-1 py-1 text-xs"></th>
                {#each Array.from({ length: columns }) as _, col}
                    <th class="px-3 py-1 text-[10px]">
                        {#if col + 1 === 1}
                            {#if stack_mode}
                                M.1
                            {:else}
                                M
                            {/if}
                        {:else}
                            {#if stack_mode}
                                {col}.1
                            {:else}
                                {col}
                            {/if}
                        {/if}
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody>

        <!-- Water -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">Water</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bands[col].isLadder}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {calculateWater(ladderVolume())} μL
                        </span>
                    {:else if bands[col]?.enzymesUsed.length > 0}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {calculateWater(bands[col].enzymesUsed.length + bufferVolume(bands[col].enzymesUsed) + dnaVolume())} μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- CutSmart Buffer -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">CutSmart Buffer</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bands[col].isLadder}
                        <p class="opacity-25">-</p>
                    {:else if bands[col]?.enzymesUsed.length >= 1}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            2 μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- Lambda DNA -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">λ DNA</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bands[col].isLadder}
                        <p class="opacity-25">-</p>
                    {:else if bands[col]?.enzymesUsed.length > 0 || bands[col]?.currentBands?.length === LADDER.length}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {dnaVolume()} μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- Enzymes -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">Enzyme(s)</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bands[col].index} 
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bands[col].isLadder}
                            <span
                                class="cursor-pointer"
                                onclick={e => {
                                    if (e.currentTarget.classList.contains('line-through')) {
                                        e.currentTarget.classList.remove('line-through', 'opacity-50');
                                    } else {
                                        e.currentTarget.classList.add('line-through', 'opacity-50');
                                    }
                                }}
                            >
                                1 μL Ladder
                            </span>
                    {:else if bands[col]?.enzymesUsed.length >= 1}
                        {#each bands[col].enzymesUsed as enzyme}
                            <span
                                class="cursor-pointer"
                                onclick={e => {
                                    if (e.currentTarget.classList.contains('line-through')) {
                                        e.currentTarget.classList.remove('line-through', 'opacity-50');
                                    } else {
                                        e.currentTarget.classList.add('line-through', 'opacity-50');
                                    }
                                }}
                            >
                                1 μL {enzyme}
                            </span>
                            <br class="pb-1" />
                        {/each}
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

    </tbody>
    </table>
</div>

<!-- Bottom Level Gel Restriction Digests -->
{#if stack_mode}
<div class="flex flex-col w-full max-w-[100vw] sm:max-w-[700px] mx-auto px-5">
    <article class="prose w-full mx-auto mt-5">
        <h4 class="text-left text-neutral mb-1 text-white">Bottom Gel Digest</h4>
        <hr class="pb-3" />
    </article>
    <table class="border border-gray-300 my-2 w-full table-fixed">
        <thead>
            <tr class="bg-gray-600">
                <th class="px-1 py-1 text-xs"></th>
                {#each Array.from({ length: columns }) as _, col}
                    <th class="px-3 py-1 text-[10px]">
                        {#if col + 1 === 1}
                            {#if stack_mode}
                                M.2
                            {:else}
                                M
                            {/if}
                        {:else}
                            {col}.2
                        {/if}
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody>

        <!-- Water -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">Water</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bottom_bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bottom_bands[col].isLadder}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {calculateWater(ladderVolume())} μL
                        </span>
                    {:else if bottom_bands[col]?.enzymesUsed.length > 0}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {calculateWater(bottom_bands[col].enzymesUsed.length + bufferVolume(bottom_bands[col].enzymesUsed) + dnaVolume())} μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- CutSmart Buffer -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">CutSmart Buffer</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bottom_bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bottom_bands[col].isLadder}
                        <p class="opacity-25">-</p>
                    {:else if bottom_bands[col]?.enzymesUsed.length >= 1}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            2 μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- Lambda DNA -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">λ DNA</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bottom_bands[col].index}
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bottom_bands[col].isLadder}
                        <p class="opacity-25">-</p>
                    {:else if bottom_bands[col]?.enzymesUsed.length > 0 || bottom_bands[col]?.currentBands?.length === LADDER.length}
                        <span
                            class="cursor-pointer"
                            onclick={e => {
                                if (e.currentTarget.classList.contains('line-through')) {
                                    e.currentTarget.classList.remove('line-through', 'opacity-50');
                                } else {
                                    e.currentTarget.classList.add('line-through', 'opacity-50');
                                }
                            }}
                        >
                            {dnaVolume()} μL
                        </span>
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

        <!-- Enzymes -->
        <tr>
            <td class="px-2 py-1 font-semibold text-[8px] border border-gray-300/30">Enzyme(s)</td>
            {#each Array.from({ length: columns }) as _, col}
                {#key bottom_bands[col].index} 
                <td class="px-1 py-1 text-[8px] border border-gray-300/30">
                    {#if bottom_bands[col].isLadder}
                            <span
                                class="cursor-pointer"
                                onclick={e => {
                                    if (e.currentTarget.classList.contains('line-through')) {
                                        e.currentTarget.classList.remove('line-through', 'opacity-50');
                                    } else {
                                        e.currentTarget.classList.add('line-through', 'opacity-50');
                                    }
                                }}
                            >
                                1 μL Ladder
                            </span>
                    {:else if bottom_bands[col]?.enzymesUsed.length >= 1}
                        {#each bottom_bands[col].enzymesUsed as enzyme}
                            <span
                                class="cursor-pointer"
                                onclick={e => {
                                    if (e.currentTarget.classList.contains('line-through')) {
                                        e.currentTarget.classList.remove('line-through', 'opacity-50');
                                    } else {
                                        e.currentTarget.classList.add('line-through', 'opacity-50');
                                    }
                                }}
                            >
                                1 μL {enzyme}
                            </span>
                            <br class="pb-1" />
                        {/each}
                    {:else}
                        <p class="opacity-25">-</p>
                    {/if}
                </td>
                {/key}
            {/each}
        </tr>

    </tbody>
    </table>
</div>
{/if}

<div class="flex flex-col w-full max-w-[100vw] sm:max-w-[750px] mx-auto px-5">
    <article class="prose w-full mx-auto mt-5">
        <h4 class="text-left text-white mb-1">Restriction Digest Parameters</h4>
        <hr class="pb-3" />
    </article>
    <div class="text-sm text-center">
        37°C for 60 minutes (incubation) <br />
        80°C for 20 minutes (heat inactivation) <span class="opacity-40">(optional)</span>
    </div>
</div>

<div class="flex flex-col w-full max-w-[100vw] sm:max-w-[750px] mx-auto px-5 pt-3 pb-20">
    <article class="prose w-full mx-auto mt-5">
        <h4 class="text-left text-white mb-1">DNA Gel Electrophoresis</h4>
        <hr class="pb-3" />
    </article>

    <span class="opacity-40 text-xs text-center italic">Goal: 100-150 ng of DNA per lane!</span>

    <!-- HAND CAST -->
    <div class="text-center font-bold mb-1 pt-2"> Hand-Cast Gel </div>
    <div class="flex flex-row justify-around bg-gray-800 rounded-sm mx-10 py-1 mb-2">
        <div class="flex-1 text-[10px] text-center">
            <div class="font-bold">Digest</div>
            14.7 μL Water <br />
            3.3 μL Loading Dye <br />
            2 μL Digest <br />
        </div>
        <div class="flex-1 text-[10px] text-center">
            <div class="font-bold">Ladder</div>
            6.6 μL Water <br />
            3.3 μL Loading Dye <br />
            10 μL Ladder (15 ng/μL Stock) <br />
        </div>
    </div>

    <!-- E-GEL -->
    <div class="text-center font-bold mb-1"> E-Gel </div>
    <div class="flex flex-row justify-around bg-gray-900 rounded-sm mx-10 py-1" >
        <div class="flex-1 text-[10px] text-center">
            <div class="font-bold">Digest</div>
            18 μL Water <br />
            2 μL Digest <br />
        </div>
        <div class="flex-1 text-[10px] text-center">
            <div class="font-bold">Ladder</div>
            10 μL Water <br />
            10 μL Ladder (15 ng/μL Stock) <br />
        </div>
    </div>

    <!-- Benchling Link -->
    <article class="prose w-full mx-auto mt-5">
        <h4 class="text-left text-white mb-1">Documentation</h4>
        <hr class="pb-3" />
    </article>
    <span class="text-xs text-center italic">Take lots of pictures and document both good & bad gels on your website!</span>
    <div class="flex flex-row mx-auto">
    <div class="text-sm px-4 mt-2">
        <div class="max-w-[160px] mx-auto pt-3">
            <a href="https://benchling.com/editor" target="_blank" rel="noopener noreferrer" data-value="benchling" style="border-radius:2px;" class="py-2 px-3 pr-2 text-blue-800 flex justify-center items-center bg-gray-100 hover:text-blue-700 hover:bg-black hover:text-white transition ease-in duration-100 text-center text-sm font-semibold shadow-md focus:outline-none">
                <svg class="w-5 h-5" version="1.1" id="Layer_1" xmlns:x="ns_extend;" xmlns:i="ns_ai;" xmlns:graph="ns_graphs;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 30.8 43.6" style="enable-background:new 0 0 30.8 43.6;" xml:space="preserve">
            <style type="text/css">
            .st0{fill:currentColor;}
            </style>
            <metadata>
            <sfw xmlns="ns_sfw;">
            <slices>
            </slices>
            <sliceSourceBounds bottomLeftOrigin="true" height="43.6" width="30.8" x="-119.7" y="-181.1">
            </sliceSourceBounds>
            </sfw>
            </metadata>
            <g>
            <path class="st0 w-5 h-5" d="M13.1,39.4c-0.6,0.6-1,1.1-1.2,1.9H19c-0.2-0.7-0.6-1.3-1.2-1.9H13.1z M19.7,35.8c-0.6,0.4-1.3,0.7-2,1.1
                    L17.5,37l0.2,0.1c2.2,1.3,3.2,3.1,3.2,5.4c0,0.6,0.5,1.1,1.1,1.1c0.6,0,1.1-0.5,1.1-1.1c0-2.7-1.1-4.9-3.3-6.6L19.7,35.8L19.7,35.8
                    z M11.8,28.5c0.2,0.7,0.6,1.3,1.2,1.9h4.6c0.6-0.6,1-1.1,1.2-1.9H11.8z M13.1,24c-0.6,0.6-1,1.1-1.2,1.9H19
                    c-0.2-0.7-0.6-1.3-1.2-1.9H13.1z M7.8,11.7c0-0.7,0.6-1.3,1.3-1.3c0.7,0,1.3,0.6,1.3,1.3c0,0.7-0.6,1.3-1.3,1.3
                    C8.3,13,7.8,12.4,7.8,11.7z M20.4,11.7c0-0.7,0.6-1.3,1.3-1.3c0.7,0,1.3,0.6,1.3,1.3c0,0.7-0.6,1.3-1.3,1.3
                    C21,13,20.4,12.4,20.4,11.7z M2.8,11c-0.1,0.5-0.2,1-0.3,1.2c-0.8,2.2-2,3.3-2,3.3C0.2,15.7,0,16,0,16.3v0.3c0,0,0,0.1,0,0.1
                    c0.1,0.4,0.5,0.8,0.9,0.8c5.9,0.6,9.2,1.4,11.4,2.1c-3.1,1.8-4.7,4.3-4.7,7.5c0,3.3,1.7,5.9,4.9,7.7c-3.2,1.8-4.9,4.4-4.9,7.7
                    c0,0.6,0.5,1.1,1.1,1.1c0.6,0,1.1-0.5,1.1-1.1c0-3.9,3.1-5.6,5.5-6.5c0.1,0,0.2-0.1,0.3-0.1c0.8-0.3,1.6-0.6,2.3-1
                    c3.4-1.8,5.1-4.4,5.1-7.8c0-2.5-1-4.6-2.9-6.3l0,0h0c-0.9,0.2-1.8,0.5-2.5,0.7l-0.2,0.1l0.2,0.1c2.2,1.3,3.2,3.1,3.2,5.4
                    c0,3.9-3.1,5.6-5.5,6.4C13,32.6,9.9,31,9.9,27.1s3.1-5.6,5.5-6.5l0.2,0c0.5-0.2,1.3-0.6,2.7-0.9c2.2-0.7,5.6-1.5,11.7-2.1
                    c0.5,0,0.8-0.4,0.9-0.8c0.1-0.4-0.1-0.9-0.5-1.1c0,0-1.1-1.1-2-3.3c-0.1-0.3-0.2-0.7-0.3-1.2C27.2,7.7,25.3,0,15.4,0
                    C5.6,0,3.6,7.7,2.8,11z">
            </path>
            </g>
            </svg>
                Benchling
            </a>
        </div>
    </div>
    <div class="text-sm px-4 mt-2">
        <div class="max-w-[160px] mx-auto pt-3">
            <a href="https://www.ncbi.nlm.nih.gov/nuccore/J02459.1" target="_blank" rel="noopener noreferrer" data-value="github" style="border-radius:2px;" class="py-2 px-3 text-black flex justify-center items-center bg-gray-100 hover:text-gray-700 hover:bg-black hover:text-white transition ease-in duration-100 text-center text-sm font-semibold shadow-md focus:outline-none">
                λ Phage DNA
            </a>
        </div>
    </div>
    </div>
</div>

<!-- Upload Modal -->
 <dialog id="upload_modal" class="modal modal-middle">
    <div class="modal-box">
        <h3 class="text-lg font-bold">Ready to publish?</h3>
        <p class="pt-3 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M63.99805,140.002a7.99955,7.99955,0,0,1-8,8h-.00049l-44.00147-.0039a8,8,0,0,1-6.3955-12.80469A67.81463,67.81463,0,0,1,33.02783,113.5127,39.99241,39.99241,0,1,1,99.29492,76.50293a7.99971,7.99971,0,0,1-3.78515,8.37695,64.36027,64.36027,0,0,0-27.85889,33.7959A63.645,63.645,0,0,0,63.99805,140.002Zm186.39941-4.81054a67.81009,67.81009,0,0,0-27.42676-21.68067A39.99246,39.99246,0,1,0,156.70361,76.5a8.00092,8.00092,0,0,0,3.78467,8.37695,64.367,64.367,0,0,1,27.85938,33.79688A63.64448,63.64448,0,0,1,192,140a8.00039,8.00039,0,0,0,8.001,8l44.001-.00391a8,8,0,0,0,6.39551-12.80468ZM157.16162,178.0896a48,48,0,1,0-58.32324,0,71.66776,71.66776,0,0,0-35.59522,34.40454A7.9997,7.9997,0,0,0,70.43457,223.999H185.56543a8.00017,8.00017,0,0,0,7.19141-11.50488A71.66776,71.66776,0,0,0,157.16162,178.0896Z"></path> </g></svg>
            Publicly viewable
        </p>
        <p class="pt-2 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="5.12"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M225.25439,82.74512a51.65924,51.65924,0,0,1-15.22949,36.76953L181.74072,147.7998a52.0625,52.0625,0,0,1-73.54,0,8.00053,8.00053,0,0,1,11.31446-11.31445,36.04088,36.04088,0,0,0,50.91211,0l28.2832-28.28515A35.99926,35.99926,0,0,0,147.79932,57.29L128.00049,77.08887A8.00053,8.00053,0,1,1,116.686,65.77441l19.79882-19.79882a51.99951,51.99951,0,0,1,88.76953,36.76953Zm-97.25488,96.166L108.20068,198.71A35.99926,35.99926,0,1,1,57.28955,147.7998l28.2832-28.28515a36.03821,36.03821,0,0,1,50.91211,0,8.00053,8.00053,0,1,0,11.31446-11.31445,52.0625,52.0625,0,0,0-73.54,0L45.9751,136.48535a52.00031,52.00031,0,0,0,73.54,73.53906L139.314,190.22559a8.00053,8.00053,0,0,0-11.31445-11.31446Z"></path> </g></svg>
            Shareable link
        </p>
        <p class="pt-2 flex flex-row gap-2 items-center">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 256.00 256.00" id="Flat" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="5.12"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M80.34375,115.668A8,8,0,0,1,86,102.01074h34V40a8,8,0,0,1,16,0v62.01074h34a8,8,0,0,1,5.65625,13.65723l-42,41.98926a7.99945,7.99945,0,0,1-11.3125,0ZM216,144a8.00039,8.00039,0,0,0-8,8v56H48V152a8,8,0,0,0-16,0v56a16.01833,16.01833,0,0,0,16,16H208a16.01833,16.01833,0,0,0,16-16V152A8.00039,8.00039,0,0,0,216,144Z"></path> </g></svg>
            Access on any device
        </p>

        <div class="flex flex-col w-full gap-2 pt-5">
            <label class="input input-bordered flex items-center gap-2">
                <svg class="h-4 w-4 opacity-70" fill="currentColor" height="200px" width="200px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" enable-background="new 0 0 512 512" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M46.5,0v139.6h23.3c0-23.3,0-69.8,23.3-93.1c23.2-23.3,46.5-23.3,69.8-23.3h46.5v395.6c0,34.9-11.6,69.8-46.5,69.8l-22.8,0 l-0.5,23.2h232.7v-23.3h-23.3c-34.9,0-46.5-34.9-46.5-69.8V23.3h46.5c23.3,0,46.5,0,69.8,23.3s23.3,69.8,23.3,93.1h23.3V0H46.5z"></path> </g></svg>
                <input type="text" class="grow no-autofill" placeholder="Title (optional)" autocomplete="off" maxlength="120" bind:value={title} />
            </label>
            <label class="input input-bordered flex items-center gap-2">
                <svg class="h-4 w-4 opacity-70" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M8 7C9.65685 7 11 5.65685 11 4C11 2.34315 9.65685 1 8 1C6.34315 1 5 2.34315 5 4C5 5.65685 6.34315 7 8 7Z" fill="currentColor"></path> <path d="M14 12C14 10.3431 12.6569 9 11 9H5C3.34315 9 2 10.3431 2 12V15H14V12Z" fill="#000000"></path> </g></svg>
                <input type="text" class="grow no-autofill" placeholder="Name (optional)" autocomplete="off" maxlength="25" bind:value={author} />
            </label>
        </div>

        <p class="pt-2 flex flex-row gap-2 items-center justify-center italic text-xs">
            Note: designs are posted the 'All' tab until approved by an admin
        </p>

        <div class="modal-action">
            <form method="dialog">
                <button type="button" class="btn" onclick={saveToGallery}>
                    {#if !uploading}
                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 -1.5 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>upload1</title> <path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path> </g></svg>
                    {:else}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Publish
                </button>
            </form>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
</dialog>
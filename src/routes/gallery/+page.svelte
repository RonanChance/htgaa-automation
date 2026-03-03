<script>
    import GalleryCard from '$lib/components/GalleryCard.svelte';
    import PlateImage from '$lib/components/PlateImage.svelte';
    import OmniTrayImage from '$lib/components/OmniTrayImage.svelte';
    import OmniTrayPicture from '$lib/components/OmniTrayPicture.svelte';
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { well_colors, old_well_colors } from '$lib/proteins.js';
    import { page } from '$app/stores';

    const props = $props();
    let images = props.data.images;

    const filter_list = ['Approved', 'Media Lab', 'Off']
    
    let filter = $state(3);
    let record_load_iteration = $state(0);
    let loadingRecords = $state(true);
    let loadedRecords = $state([]);
    let container;
    // -1 = Image/Video
    // 0 = HTGAA
    // 3 = SBS

    onMount(() => {
        if (browser) {
            if ($page.url.searchParams.get('htgaa')){
                filter = 0;
            }
            loadGallery();
        }
    });

    async function loadGallery() {
        if (filter !== -1) {
            loadingRecords = true;
            const response = await fetch('../loadGallery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ record_load_iteration, filter })
            });
            const r = await response.json();
            loadedRecords = [...loadedRecords, ...r.records];
            record_load_iteration += 1;
            loadingRecords = false;
        }
    }

    function handleMouseMove(event) {
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        const rotateX = (-y / rect.height) * 125;
        const rotateY = (x / rect.width) * 125;

        container.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    }

    function resetTilt() {
        container.style.transform = 'rotateX(0deg) rotateY(0deg)';
    }
</script>

<article class="prose w-full mx-auto mt-5">
    <h2 class="flex justify-center items-center gap-2 text-base-content">
        <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor" >
            <path id="Layer" class="" d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
        </svg>
        Automation Art Gallery
    </h2>
</article>

<div class="flex flex-row w-full max-w-[100vw] sm:max-w-[500px] mx-auto px-5 opacity-70">
    <a class="flex flex-row gap-1 text-base-content items-center" href="/" aria-label="back">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.7071 4.29289C12.0976 4.68342 12.0976 5.31658 11.7071 5.70711L6.41421 11H20C20.5523 11 21 11.4477 21 12C21 12.5523 20.5523 13 20 13H6.41421L11.7071 18.2929C12.0976 18.6834 12.0976 19.3166 11.7071 19.7071C11.3166 20.0976 10.6834 20.0976 10.2929 19.7071L3.29289 12.7071C3.10536 12.5196 3 12.2652 3 12C3 11.7348 3.10536 11.4804 3.29289 11.2929L10.2929 4.29289C10.6834 3.90237 11.3166 3.90237 11.7071 4.29289Z" fill="currentColor"></path> </g></svg> 
    </a>
    <div class="mx-auto p-4 rounded-box ">
        <div class="tabs tabs-bordered">
            <input type="radio" name="tab" class="tab" aria-label="Images" onclick={() => {filter = -1;}} />
            <input type="radio" name="tab" class="tab" aria-label="Designs" onclick={() => {if ($page.url.searchParams.get('htgaa')){filter = 0} else {filter = 3}; record_load_iteration = 0; loadedRecords = []; loadGallery();}} checked />
        </div>
    </div>
</div>

{#if filter === -1}
    <div class="grid grid-cols-[repeat(auto-fit,115px)] sm:grid-cols-[repeat(auto-fit,150px)] justify-center gap-2 pt-3 mb-10">
        {#each images as img, i}
            <OmniTrayPicture {img} />
        {/each}
    </div>
{/if}

{#if !loadingRecords}
    <!-- HTGAA Plates -->
    {#if filter === 0}
        <div class="flex flex-row flex-wrap w-full mx-auto justify-center pt-3 gap-0 mb-10">
            {#each loadedRecords as record, i}
                <a class="max-w-[110px] sm:max-w-[120px] my-auto" href="/?id={record.id}">
                    {#if record.grid_style === 'Echo384' || record.grid_style === 'Echo384Image' || record.grid_style === 'Echo1536' || record.grid_style === 'Echo1536Image'}
                        <OmniTrayImage {record} {i} {well_colors} {old_well_colors} />
                    {:else}
                        <PlateImage {record} {i} {well_colors} {old_well_colors} />
                    {/if}
                </a>
            {/each}
        </div>
    <!-- SBS Plates -->
    {:else if filter === 3} 
        <div class="grid grid-cols-[repeat(auto-fit,115px)] sm:grid-cols-[repeat(auto-fit,150px)] justify-center gap-2 pt-3 mb-10">
            {#each loadedRecords as record, i}
                {#if record.grid_style === 'Echo384' || record.grid_style === 'Echo384Image' || record.grid_style === 'Echo1536' || record.grid_style === 'Echo1536Image'}
                <a class="aspect-[3/2]" href="/?id={record.id}">
                    <OmniTrayImage {record} {i} {well_colors} {old_well_colors} />
                </a>
                {/if}
            {/each}
        </div>
    {/if}
{:else}
    <!-- LOADING HTGAA Plates -->
    {#if filter === 0}
        <div class="flex flex-row flex-wrap w-full mx-auto justify-center mb-10 pt-3">
            {#each Array(100).fill(0) as _, i}
                <div class="skeleton w-[75px] h-[75px] sm:w-[100px] sm:h-[100px] rounded-full"></div>
            {/each}
        </div>
    <!-- LOADING SBS Plates -->
    {:else if filter === 3} 
        <div class="flex flex-row flex-wrap w-full mx-auto justify-center mb-10 pt-3 gap-2">
            {#each Array(100).fill(0) as _, i}
                <div class="skeleton w-[110px] sm:w-[120px] sm:h-[75px] sm:h-[85px] my-auto rounded-md"></div>
            {/each}
        </div>
    {/if}
{/if}

<!-- <div class="flex flex-col max-w-[99%] mx-auto gap-3">
    <span class="font-semibold text-center underline">Lab Video (2025)</span>
    <iframe
    class="mx-auto w-full md:max-w-[500px] lg:max-w-[750px] xl:max-w-[900px] rounded-lg aspect-video"
    src={`https://drive.google.com/file/d/1MHXiPh85IKux6wNkvq7fSiePwY7eT-WN/preview`}
    title="Opentrons"
    allowfullscreen
    ></iframe>
</div>

<div class="flex flex-col max-w-[99%] mx-auto mt-3 gap-3 pb-10">
    <span class="font-semibold text-center underline">Student Designs (2025)</span>
    <img src={`/2025_images/2025_Student_Grid_11x6.png`} alt={`question mark illustration`} class="mx-auto w-full md:max-w-[500px] lg:max-w-[750px] xl:max-w-[900px] rounded-lg"/>
</div> -->
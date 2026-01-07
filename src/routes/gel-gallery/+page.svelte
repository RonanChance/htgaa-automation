<script>
    import GalleryCard from '$lib/components/GalleryCard.svelte';
    import PlateImage from '$lib/components/PlateImage.svelte';
    import OmniTrayImage from '$lib/components/OmniTrayImage.svelte';
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { well_colors, old_well_colors } from '$lib/proteins.js';
    import GelImage from '$lib/components/GelImage.svelte';

    const filter_list = ['Approved', 'Media Lab', 'Off']
    let filter = $state(0);
    let record_load_iteration = $state(0);
    let loadingRecords = $state(true);
    let loadedRecords = $state([]);

    onMount(async () => {
        if (browser) {
            loadGelGallery();
        }
    });

    async function loadGelGallery() {
        if (filter !== -1) {
            loadingRecords = true;
            const response = await fetch('../loadGelGallery', {
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
</script>

<article class="prose w-full mx-auto mt-5">
    <h2 class="text-center">Gel Electrophoresis Gallery</h2>
</article>

<div class="flex flex-row w-full max-w-[100vw] sm:max-w-[500px] mx-auto px-5 opacity-70">
    <a class="flex flex-row gap-1 items-center text-base-content" href="/gel-art" aria-label="back" fill="currentColor">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path fill-rule="evenodd" clip-rule="evenodd" d="M11.7071 4.29289C12.0976 4.68342 12.0976 5.31658 11.7071 5.70711L6.41421 11H20C20.5523 11 21 11.4477 21 12C21 12.5523 20.5523 13 20 13H6.41421L11.7071 18.2929C12.0976 18.6834 12.0976 19.3166 11.7071 19.7071C11.3166 20.0976 10.6834 20.0976 10.2929 19.7071L3.29289 12.7071C3.10536 12.5196 3 12.2652 3 12C3 11.7348 3.10536 11.4804 3.29289 11.2929L10.2929 4.29289C10.6834 3.90237 11.3166 3.90237 11.7071 4.29289Z" fill="currentColor"></path> </g></svg> 
    </a>
<div class="mx-auto bg-base-100 p-4 rounded-box">
    <div class="tabs tabs-bordered">
        <!-- <input type="radio" name="tab" class="tab" aria-label="Images" onclick={() => {filter = -1;}} /> -->
        <input type="radio" name="tab" class="tab" aria-label="Gallery" onclick={() => {filter = 0; record_load_iteration = 0; loadedRecords = []; loadGelGallery();}} checked />
     </div>
</div>


</div>

<!-- {#if filter === -1}
    <div class="flex flex-col max-w-[99%] mx-auto gap-3">
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
    </div>
{/if} -->

{#if !loadingRecords}
    {#if filter === 0}
        <div class="flex flex-row flex-wrap w-full mx-auto justify-center pt-3 gap-2 mb-10">
            {#each loadedRecords as record, i}
                <a class="w-[115px] h-[90px] sm:w-[160px] sm:h-[105px] my-auto flex items-center justify-center" href="/gel-art?id={record.id}">
                    <GelImage {record} class="w-full h-full" />
                </a>
            {/each}
        </div>
{/if}
{:else}
    {#if filter === 0}
        <div class="flex flex-row flex-wrap w-full mx-auto justify-center mb-10 pt-3 gap-2">
            {#each Array(100).fill(0) as _, i}
                <div class="skeleton w-[115px] h-[90px] sm:w-[160px] sm:h-[105px] rounded">
                </div>
            {/each}
        </div>
    {:else if filter !== -1}
        <div class="flex flex-row flex-wrap w-full max-w-[100vw] sm:max-w-[1000px] mx-auto gap-3 pt-3 justify-center mb-10">
            {#each Array(15).fill(0) as _, i}
                <div class="skeleton min-h-[275px] min-w-[175px] px-3 py-3">
                </div>
            {/each}
        </div>
    {/if}
{/if}
<script>
  import OmniTrayImage from '$lib/components/OmniTrayImage.svelte';
  import { well_colors, old_well_colors } from '$lib/proteins.js';

  const { data } = $props();
  const records = data.records || [];

  function sourceLabel(source) {
    return source === 'official' ? 'Official' : 'Regular';
  }
</script>

<article class="prose w-full mx-auto mt-5">
  <h2 class="flex justify-center items-center gap-2 text-base-content">SBS Combined Gallery</h2>
</article>

<div class="max-w-[1100px] mx-auto px-4 pb-8">
  <p class="text-xs opacity-70 text-center mb-4">{records.length} records (official + regular)</p>

  <div class="grid grid-cols-[repeat(auto-fit,150px)] justify-center gap-3">
    {#each records as record, i}
      <div class="relative">
        <a class="aspect-[3/2] block" href="/?id={record.id}">
          <OmniTrayImage {record} {i} {well_colors} {old_well_colors} />
        </a>
        <div class="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">
          {sourceLabel(record._source)}
        </div>
      </div>
    {/each}
  </div>
</div>

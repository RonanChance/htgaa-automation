<script>
  let { data = {} } = $props();

  const designs = Array.isArray(data?.designs) ? data.designs : [];

  function pieSlices(design) {
    const slices = (design?.reagents || [])
      .filter((r) => (Number(r.volumeNl) || 0) > 0)
      .sort((a, b) => (Number(b.volumeNl) || 0) - (Number(a.volumeNl) || 0));

    const total = slices.reduce((sum, slice) => sum + (Number(slice.volumeNl) || 0), 0);
    if (total <= 0) return [];

    let start = -Math.PI / 2;
    return slices.map((slice, idx) => {
      const volumeNl = Number(slice.volumeNl) || 0;
      const angle = (volumeNl / total) * Math.PI * 2;
      const end = start + angle;
      const color = `hsl(${(idx * 47) % 360} 70% 60%)`;
      const result = { ...slice, start, end, color };
      start = end;
      return result;
    });
  }

  function arcPath(cx, cy, r, start, end) {
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = end - start > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }
</script>

<div class="min-h-screen px-4 py-6 text-base-content">
  <div class="mx-auto w-full max-w-3xl lg:max-w-[50vw]">
    <div class="mb-4 flex items-center justify-between gap-2">
      <h1 class="text-lg font-semibold">CFPS Design Gallery</h1>
      <a href="/cfps" class="btn btn-xs btn-ghost">Back to Designer</a>
    </div>

    {#if !designs.length}
      <div class="rounded-md bg-base-200/60 p-4 text-sm text-base-content/70">No CFPS designs found.</div>
    {:else}
      <div class="space-y-1.5">
        {#each designs as design}
          <a
            href={`/cfps?design=${design.id}`}
            class="flex items-center gap-2 rounded-md bg-base-200/50 px-2 py-1.5 text-[11px] transition hover:bg-base-200"
          >
            <div class="flex min-w-0 items-center gap-2">
              <svg viewBox="0 0 100 100" class="h-8 w-8 shrink-0">
                {#if pieSlices(design).length === 0}
                  <circle cx="50" cy="50" r="32" class="fill-base-300" />
                {:else}
                  {#each pieSlices(design) as slice}
                    <path d={arcPath(50, 50, 32, slice.start, slice.end)} fill={slice.color} />
                  {/each}
                {/if}
              </svg>

              <div class="min-w-0">
                <p class="truncate font-medium">{design.title}</p>
                <p class="truncate text-base-content/60">
                  {#if design.author && design.rationale}
                    {design.author} · {design.rationale}
                  {:else if design.author}
                    {design.author}
                  {:else if design.rationale}
                    {design.rationale}
                  {:else}
                    unknown author
                  {/if}
                </p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>

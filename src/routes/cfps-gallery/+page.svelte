<script>
  let { data = {} } = $props();

  const designs = Array.isArray(data?.designs) ? data.designs : [];
  const nodeColumns = [
    { short: 'MIT / Harvard', location: '(Cambridge, USA)' },
    { short: 'BioClub Tokyo', location: '(Tokyo, Japan)' },
    { short: 'Biopunk Lab', location: '(San Francisco, USA)' },
    { short: 'Designer Cells at Yonsei University', location: '(Incheon, South Korea)' },
    { short: 'Genspace', location: '(New York, USA)' },
    { short: 'Lifefabs Institute', location: '(London, UK)' },
    { short: 'Ottawa Bio Science', location: '(ON, Canada)' },
    { short: 'USFQ', location: '(Quito, Ecuador)' },
    { short: 'Victoria Makerspace', location: '(BC, Canada)' },
    { short: 'Baltimore Underground Science Space', location: '(Baltimore, MD, USA)' },
    { short: 'Duke', location: '(Durham, NC, USA)' },
    { short: 'Iowa State', location: '(Ames, IA, USA)' },
    { short: 'William & Mary', location: '(Williamsburg, VA, USA)' },
    { short: 'Chitown Bio', location: '(Chicago, IL, USA)' },
    { short: 'Hartnell College', location: '(Salinas, CA, USA)' }
  ];
  const designsByNode = nodeColumns.map((node) => ({
    ...node,
    designs: designs.filter((design) => (design.htgaa_node || '').trim() === node.short)
  }));
  const totalNodes = nodeColumns.length;
  const totalSubmissions = designs.length;

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
  <div class="mx-auto w-full max-w-[1800px]">
    <article class="prose w-full mx-auto mt-2 mb-4">
      <h2 class="flex justify-center items-center gap-2 text-base-content">
        <svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1514 1527" width="20" height="20" fill="currentColor">
          <path d="m1151.8 146.1l-11.2 11.2c-22.4 18.7-52.2 26.1-78.3 14.9l-82-33.6c-26.1-11.2-44.7-37.3-44.7-67.1v-18.7c0-29.8-26.1-52.2-52.2-52.2h-227.4c-29.8 0-52.2 22.4-52.2 52.2v18.7c0 29.8-18.6 55.9-44.7 67.1l-82 33.6c-26.1 11.2-59.6 3.8-78.3-14.9l-11.1-11.2c-22.4-18.7-52.2-18.7-74.6 0l-167.7 160.5c-18.7 18.6-22.4 52.2 0 74.6l11.2 11.2c18.6 22.4 26 52.2 14.9 78.4l-33.6 82.1c-11.2 26.1-37.3 44.7-67.1 44.7h-18.6c-29.8 0-52.2 26.2-52.2 52.3v227.6c0 29.9 22.4 52.3 52.2 52.3h18.6c29.8 0 55.9 18.6 67.1 44.7l33.6 82.1c11.1 26.2 3.7 59.8-14.9 78.4l-11.2 11.2c-18.7 22.4-18.7 52.2 0 74.6l160.3 160.5c18.6 18.7 52.1 22.4 74.5 0l11.2-11.2c22.3-18.7 52.2-26.1 78.3-14.9l82 33.6c26.1 11.2 44.7 37.3 44.7 67.1v18.7c0 29.8 26.1 52.2 52.2 52.2h227.4c29.8 0 52.1-22.4 52.1-52.2v-18.7c0-29.8 18.7-55.9 44.8-67.1l82-33.6c26.1-11.2 59.6-3.8 78.2 14.9l11.2 11.2c22.4 18.7 52.2 18.7 74.6 0l52.2-52.2-290.8-291.1c-37.3-37.3-123-123.2-234.8-11.2-33.6 33.6-55.9 78.4-89.5 111.9-78.2 78.4-171.4 41.1-208.7-33.5-22.4-44.8-14.9-48.6-37.3-89.6-26.1-41.1-70.8-70.9-85.7-123.2-11.2-52.2 14.9-67.1 14.9-93.2 0-26.2-26.1-56-18.6-93.3 3.7-29.9 26.1-48.5 29.8-63.5 3.7-14.9 3.7-26.1 7.4-48.5 14.9-67.2 78.3-100.7 134.2-63.4 37.3 26.1 119.3 115.7 130.5 104.5 11.2-11.2-78.3-93.3-104.4-130.6-37.3-56-3.7-123.2 63.4-134.4 22.3-3.7 37.3-3.7 48.4-7.5 15-7.4 29.9-26.1 63.4-29.8 37.3-7.5 70.8 18.7 93.2 18.7 26.1 0 44.7-26.2 93.2-15 52.2 11.2 82 59.7 123 85.9 41 26.1 41 18.6 89.4 37.3 74.6 37.3 115.6 130.6 33.6 208.9-33.6 33.6-78.3 52.3-111.8 89.6-111.9 112-22.4 197.8 11.2 235.1l290.7 291.1 52.2-52.3c18.6-18.6 22.3-52.2 0-74.6l-11.2-11.2c-18.6-22.4-26.1-52.2-14.9-78.4l33.5-82.1c11.2-26.1 37.3-44.7 67.1-44.7h18.7c29.8 0 52.1-26.2 52.1-52.3v-227.6c0-29.9-22.3-52.3-52.1-52.3h-18.7c-29.8 0-55.9-18.6-67.1-44.7l-33.5-82.1c-11.2-26.2-3.7-59.7 14.9-78.4l11.2-11.2c18.6-22.4 18.6-52.2 0-74.6l-160.3-160.5c-3.7-29.9-37.3-29.9-55.9-11.2z"/>
        </svg>
        CFPS Design Gallery
      </h2>
    </article>

    <section class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-base-200/40 px-3 py-2 text-xs">
      <a href="/cfps" class="rounded-md bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600">Back to Designer</a>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-base-content/80">
        <span><span class="text-base-content/60">Nodes</span> {totalNodes}</span>
        <span><span class="text-base-content/60">Total Submissions</span> {totalSubmissions}</span>
      </div>
      <div class="w-[76px]"></div>
    </section>

    {#if !designs.length}
      <div class="rounded-md bg-base-200/60 p-4 text-sm text-base-content/70">No CFPS designs found.</div>
    {:else}
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {#each designsByNode as nodeGroup}
          <section class="rounded-md bg-neutral-900 p-2">
            <h2 class="mb-2 text-xs font-semibold leading-tight">
              <span class="text-primary">{nodeGroup.short}</span>
              <span class="text-base-content/50"> {nodeGroup.location}</span>
            </h2>
            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {#if nodeGroup.designs.length === 0}
                <p class="rounded bg-neutral-900 px-2 py-1.5 text-[11px] text-base-content/50">No submissions yet.</p>
              {:else}
                {#each nodeGroup.designs as design}
                  <a
                    href={`/cfps?design=${design.id}`}
                    class="flex items-center gap-2 rounded-md bg-neutral-700 px-2 py-1.5 text-[11px] transition hover:bg-neutral-600"
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
                        <p class="truncate font-medium">{design.author || 'unknown author'}</p>
                        <p class="truncate text-base-content/60">
                          {#if design.rationale}
                            {design.rationale}
                          {:else}
                            no rationale provided
                          {/if}
                        </p>
                      </div>
                    </div>
                  </a>
                {/each}
              {/if}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>

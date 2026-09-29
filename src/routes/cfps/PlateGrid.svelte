<script>
  // A single 384-well plate render for one timepoint grid. Static by default
  // (inline card); pass interactive to make wells hoverable / clickable (modal).
  import { cellColor, fmtVal } from './plateReader.js';

  let {
    grid = [],
    wells = [],
    rows = 16,
    cols = 24,
    scale = { lo: 0, hi: 1 },
    kind = 'od',
    interactive = false,
    showValues = false,
    axis = false,
    // Well indices to spotlight (a composition's replicate wells). When non-empty
    // the highlighted wells get a phosphor ring and the rest of the plate dims, so
    // "which wells is this sample?" reads at a glance.
    highlightIdx = null,
    onhover = null,
    onwellclick = null,
  } = $props();

  const ROWL = 'ABCDEFGHIJKLMNOP';

  let highlightSet = $derived(new Set(highlightIdx ?? []));
  let hasHighlight = $derived(highlightSet.size > 0);

  function idxFromEvent(e) {
    const cell = e.target.closest('[data-idx]');
    return cell ? Number(cell.dataset.idx) : null;
  }
  function move(e) {
    if (!interactive) return;
    const idx = idxFromEvent(e);
    onhover?.(idx == null ? null : { idx, x: e.clientX, y: e.clientY });
  }
  function leave() {
    if (interactive) onhover?.(null);
  }
  function click(e) {
    if (!interactive) return;
    const idx = idxFromEvent(e);
    if (idx != null) onwellclick?.(idx);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="pg"
  class:pg--axis={axis}
  class:pg--interactive={interactive}
  class:pg--dim={hasHighlight}
  style="--cols:{cols};"
  role={interactive ? 'group' : 'presentation'}
  onmousemove={move}
  onmouseleave={leave}
  onclick={click}
  onkeydown={() => {}}
>
  {#if axis}
    <span class="pg-corner"></span>
    {#each Array.from({ length: cols }) as _, c}
      <span class="pg-ax pg-ax--col">{c + 1}</span>
    {/each}
  {/if}
  {#each Array.from({ length: rows }) as _, r}
    {#if axis}<span class="pg-ax pg-ax--row">{ROWL[r]}</span>{/if}
    {#each Array.from({ length: cols }) as _, c}
      {@const idx = r * cols + c}
      {@const v = grid[idx]}
      <i
        data-idx={idx}
        class="pg-well"
        class:empty={v == null || Number.isNaN(v)}
        class:loadable={interactive && wells[idx]?.recipe}
        class:hl={highlightSet.has(idx)}
        style="--wc:{cellColor(v, scale)};"
        aria-hidden="true"
      >
        {#if showValues && v != null && !Number.isNaN(v)}
          <span class="pg-wv">{fmtVal(v, kind)}</span>
        {/if}
      </i>
    {/each}
  {/each}
</div>

<style>
  .pg {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 0;
    align-items: center;
  }
  .pg--axis {
    grid-template-columns: 14px repeat(var(--cols), 1fr);
  }
  .pg-corner {
    width: 14px;
  }
  .pg-ax {
    font: 7.5px var(--mono, monospace);
    color: var(--faint, #5b666c);
    text-align: center;
    line-height: 1;
  }
  .pg-ax--row {
    text-align: right;
    padding-right: 2px;
  }
  .pg-well {
    aspect-ratio: 1;
    border-radius: 0;
    display: block;
    position: relative;
    background: var(--wc);
    /* Extend each well by its own colour so sub-pixel rounding of the 1fr grid
       columns can't leave hairline seams that show the surface behind. */
    box-shadow: 0 0 0 0.75px var(--wc);
  }
  .pg--interactive .pg-well.loadable {
    cursor: pointer;
    outline: 0.5px solid rgba(255, 255, 255, 0.14);
    outline-offset: -0.5px;
  }
  .pg-well.empty {
    opacity: 0.4;
  }
  /* Spotlight a composition's wells: dim the rest of the plate, ring the members
     in phosphor so replicate wells jump out even at 384-well density. */
  .pg--dim .pg-well:not(.hl) {
    opacity: 0.22;
  }
  .pg-well.hl {
    z-index: 2;
    outline: 1.25px solid var(--phosphor, #4fd1c5);
    outline-offset: -0.5px;
    box-shadow:
      0 0 0 1px var(--phosphor, #4fd1c5),
      0 0 5px 1px color-mix(in srgb, var(--phosphor, #4fd1c5) 65%, transparent);
  }
  .pg-wv {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 5px var(--mono, monospace);
    color: #fff;
    text-shadow: 0 0 1.5px rgba(0, 0, 0, 0.85);
    line-height: 1;
    overflow: hidden;
  }
</style>

<script>
  // "Where to start": the main levers of cell-free protein synthesis, one card per
  // layer (energy, transcription, translation, ions/pH, redox, folding, cofactors,
  // exploratory, strategy). Collapsed, every card is the same size and shows just
  // the layer and what it controls; "More info" opens the first experiment to try,
  // the levers, a caution, the reagents on our list (plain, copy-friendly text) and
  // verified reading. Content lives in $lib/cfpsPrimer.js. Human-facing only — the
  // agent instructions deliberately don't include it.
  import { PRIMER, doiUrl } from '$lib/cfpsPrimer.js';

  // field name → display name, for reagents that are approved AND in stock. Reagent
  // lists are drawn only from this map, so an unusable reagent never shows up here.
  let { approvedNames = {} } = $props();

  let open = $state({});
  const allOpen = $derived(PRIMER.every((l) => open[l.key]));
  function toggle(key) {
    open = { ...open, [key]: !open[key] };
  }
  function close(key, card) {
    open = { ...open, [key]: false };
    // Keep the closed card in view if the long expanded body pushed it off-screen.
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function toggleAll() {
    const next = !allOpen;
    open = Object.fromEntries(PRIMER.map((l) => [l.key, next]));
  }
</script>

<div class="panel primer">
  <div class="panel__hd">
    <span class="label">levers of cell-free synthesis · pick a layer to focus on</span>
    <span class="spacer"></span>
    <button type="button" class="btn-bp" onclick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
  </div>
  <div class="panel__bd">
    <p class="primer__intro">
      A cell-free reaction is a stack of layers, from making ATP to folding the final protein. Most good experiments change
      one layer at a time — choose the one you have a hypothesis about, start from a reference recipe, and test a few levels.
    </p>
    <div class="primer__grid">
      {#each PRIMER as layer, i (layer.key)}
        {@const names = layer.reagents.filter((f) => approvedNames[f]).map((f) => approvedNames[f])}
        {@const isOpen = !!open[layer.key]}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Esc-to-close for keyboard users inside an open card) -->
        <article
          class="inset primer__card"
          class:is-open={isOpen}
          onkeydown={(e) => { if (e.key === 'Escape' && isOpen) { e.stopPropagation(); close(layer.key, e.currentTarget); } }}
        >
          <!-- Fixed-height head: the toggle is pinned to its bottom edge, so it sits in
               exactly the same place whether the card is open or closed. -->
          <div class="primer__head">
            <div class="primer__top">
              <span class="primer__n">{String(i + 1).padStart(2, '0')}</span>
              <h3 class="primer__title">{layer.title}</h3>
            </div>
            <p class="primer__what">{layer.what}</p>
            <button
              type="button"
              class="primer__toggle"
              aria-expanded={isOpen}
              aria-controls={`primer-${layer.key}`}
              onclick={() => toggle(layer.key)}
            >{isOpen ? 'Less info ▴' : 'More info ▾'}</button>
          </div>
          {#if isOpen}
            <!-- Fixed-height body: every open card is the same size; long content
                 scrolls inside, with Close pinned below the scroller. -->
            <div class="primer__body" id={`primer-${layer.key}`}>
              <div class="primer__scroll">
                <p class="primer__try"><span class="primer__k">Try first</span>{layer.tryFirst}</p>
                <ul class="primer__levers">
                  {#each layer.levers as lever}<li>{lever}</li>{/each}
                </ul>
                <p class="primer__watch"><span class="primer__k">Watch out</span>{layer.watchOut}</p>
                {#if names.length}
                  <p class="primer__plain"><span class="primer__k">Reagents on our list</span>{names.join(', ')}</p>
                {/if}
                {#if layer.refs.length}
                  <div class="primer__plain">
                    <span class="primer__k">Reading</span>
                    <ul class="primer__refs">
                      {#each layer.refs as r}<li>{r.label} — <a href={doiUrl(r.doi)} target="_blank" rel="noopener noreferrer">{doiUrl(r.doi)}</a></li>{/each}
                    </ul>
                  </div>
                {/if}
              </div>
              <div class="primer__foot">
                <button type="button" class="primer__close" onclick={(e) => close(layer.key, e.currentTarget.closest('article'))}>Close ▴</button>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </div>
</div>

<style>
  .primer__intro { margin: 0 0 12px; font: 11px/1.55 var(--mono); color: var(--ink-2); max-width: 110ch; }
  /* Equal-width columns; cards top-aligned so an opened card grows on its own
     without stretching its neighbours. */
  .primer__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; align-items: start; }
  /* Uniform cards: a fixed-height head (toggle pinned to its bottom) and, when
     open, a fixed-height body — so closed cards match each other, open cards match
     each other, and the toggle never moves. */
  .primer__card { display: flex; flex-direction: column; padding: 10px 12px; box-sizing: border-box; }
  .primer__head { display: flex; flex-direction: column; gap: 6px; height: 108px; }
  .primer__card.is-open { border-color: var(--teal); }
  .primer__top { display: flex; align-items: baseline; gap: 8px; }
  .primer__n { font: 600 10px var(--mono); color: var(--teal); letter-spacing: .06em; }
  .primer__title { margin: 0; font: 600 13px/1.25 var(--sans); color: var(--ink); }
  .primer__what { margin: 0; font: 11px/1.5 var(--mono); color: var(--ink-2); }
  .primer__toggle {
    margin-top: auto; align-self: flex-start; padding: 4px 0; cursor: pointer;
    font: 500 10.5px/1 var(--mono); letter-spacing: .04em; color: var(--teal-ink);
    background: none; border: 0;
  }
  .primer__toggle:hover { text-decoration: underline; }
  .primer__body {
    display: flex; flex-direction: column; height: 400px;
    margin-top: 6px; padding-top: 8px; border-top: 1px dashed var(--hair);
  }
  /* Soft fade at the bottom edge hints that the body scrolls; the bottom padding
     lets the last line scroll clear of the fade. */
  .primer__scroll {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
    padding: 0 4px 16px 0;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 20px), transparent);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 20px), transparent);
  }
  .primer__foot { flex: 0 0 auto; display: flex; justify-content: flex-end; padding-top: 8px; }
  .primer__try, .primer__watch, .primer__plain { margin: 0; font: 10.5px/1.55 var(--mono); color: var(--ink-2); }
  .primer__try { padding: 6px 8px; border-left: 2px solid var(--teal); background: var(--teal-wash); border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .primer__watch { padding: 6px 8px; border-left: 2px solid var(--amber, #c98a00); background: #fff8e6; border-radius: 0 var(--r-sm) var(--r-sm) 0; }
  .primer__k { display: block; font: 600 8.5px/1.4 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
  .primer__levers { margin: 0; padding-left: 16px; list-style: disc; display: flex; flex-direction: column; gap: 4px; font: 10.5px/1.5 var(--mono); color: var(--ink-2); }
  .primer__refs { margin: 0; padding-left: 16px; list-style: disc; display: flex; flex-direction: column; gap: 3px; }
  .primer__refs a { color: var(--teal); overflow-wrap: anywhere; }
  .primer__refs a:hover { text-decoration: underline; }
  .primer__close {
    padding: 4px 10px; cursor: pointer;
    font: 500 10.5px/1 var(--mono); color: var(--ink-2);
    background: var(--surface-2); border: 1px solid var(--groove); border-radius: var(--r-sm);
  }
  .primer__close:hover { color: var(--ink); border-color: var(--ink-2); }
</style>

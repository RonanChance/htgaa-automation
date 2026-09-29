<script>
  // ─────────────────────────────────────────────────────────────────────────
  // SAVED CONCEPT — "pixelated biochemistry" ambient background.
  //
  // This page parks the PixelField experiment that briefly lived on /cfps: a
  // gridded, performant field of WHITE procedural "molecular machines" (one per
  // reagent) that breathe / sway / drift, with substrate motes drawn toward them.
  // Each machine is DRAGGABLE (soft, jelly-like trailing) and CLICKABLE (opens an
  // info card). We pulled it off the main designer because it made the page busy —
  // kept here so we can reimplement it later. See:
  //   • ./PixelField.svelte     — the canvas field (motion + drag + hit-testing)
  //   • ./pixelMolecule.js      — the deterministic per-reagent pixel pattern
  // ─────────────────────────────────────────────────────────────────────────
  import PixelField from '../PixelField.svelte';
  import { moleculeDataUrl } from '../pixelMolecule.js';
  import { REAGENT_SYNOPSES } from '$lib/reagent-synopses.js';

  // Build demo items straight from the synopsis table (id seeds the pixel pattern).
  const items = Object.keys(REAGENT_SYNOPSES).map((name) => ({ id: name, name }));

  let active = $state(null); // { id, name, synopsis } | null
  function openInfo(id) {
    const name = id;
    active = { id, name, synopsis: REAGENT_SYNOPSES[name] ?? null };
  }
  function close() { active = null; }
</script>

<svelte:head><title>PixelField — saved concept</title></svelte:head>

<div class="demo">
  <PixelField {items} onPick={openInfo} />

  <header class="demo__hero">
    <p class="demo__eyebrow">saved concept · not shipped</p>
    <h1 class="demo__title">Pixelated biochemistry</h1>
    <p class="demo__lede">
      A field of procedural "molecular machines," one per reagent. They breathe and
      drift like a living solution; substrate motes are drawn toward the nearest one.
    </p>
    <p class="demo__hint">
      <b>Drag</b> a machine to move it (it trails softly, still alive) ·
      <b>Click</b> one to inspect it · scroll to roam the field ↓
    </p>
  </header>

  <div class="demo__filler" aria-hidden="true"></div>
</div>

{#if active}
  <div class="demo-modal-ov" role="presentation" onclick={close}>
    <div class="demo-modal" role="dialog" aria-label={active.name} onclick={(e) => e.stopPropagation()}>
      <button type="button" class="demo-modal__x" onclick={close} aria-label="Close">×</button>
      <img class="demo-modal__img" src={moleculeDataUrl(active.id)} alt={`Pixel machine for ${active.name}`} />
      <b class="demo-modal__name">{active.name}</b>
      {#if active.synopsis?.role}
        <p class="demo-modal__role">{active.synopsis.role}</p>
      {:else}
        <p class="demo-modal__role demo-modal__role--muted">No synopsis on file for this reagent.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .demo {
    position: relative;
    z-index: 0;                 /* stacking context so PixelField (z-index:-1) layers correctly */
    min-height: 300vh;          /* give the field a tall world to populate below the hero */
    background: radial-gradient(120% 80% at 50% 0%, #12161c 0%, #0a0d11 60%, #06080b 100%);
    color: #eaf0f6;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    overflow: hidden;
  }
  .demo__hero {
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px;
    text-align: center;
  }
  .demo__eyebrow {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #7c8aa0;
  }
  .demo__title {
    margin: 0;
    font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(34px, 6vw, 64px);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .demo__lede { margin: 0; font-size: 14px; line-height: 1.6; color: #b9c4d3; }
  .demo__hint { margin: 8px 0 0; font-size: 12px; color: #8a97ab; }
  .demo__hint b { color: #eaf0f6; font-weight: 600; }
  .demo__filler { height: 20vh; }

  .demo-modal-ov {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(4, 6, 9, 0.62);
    backdrop-filter: blur(3px);
  }
  .demo-modal {
    position: relative;
    width: min(400px, 94vw);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px 24px 26px;
    background: #0f141b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    text-align: center;
  }
  .demo-modal__x {
    position: absolute;
    top: 8px; right: 10px;
    background: none;
    border: none;
    color: #7c8aa0;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .demo-modal__x:hover { color: #eaf0f6; }
  .demo-modal__img {
    width: 150px;
    height: 150px;
    image-rendering: pixelated;
    border-radius: 12px;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
  }
  .demo-modal__name {
    font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
    font-size: 18px;
  }
  .demo-modal__role { margin: 0; font-size: 12.5px; line-height: 1.6; color: #b9c4d3; }
  .demo-modal__role--muted { color: #7c8aa0; font-style: italic; }
</style>

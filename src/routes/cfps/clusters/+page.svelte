<script>
  // CFPS Clusters: which coopetition designs the model expects to succeed or
  // fail together, why each group is a group, and a round-1 run plan.
  //
  // The page is built elsewhere (Clinton Monteiro's CFPS Arena, export_clusters.js
  // --web --ronan) and lands in static/cfps/clusters-data/ as four files: the
  // styles, the script, the view itself (clusters.json.gz, unpacked in the
  // browser) and the designs download. This route only gives it a place to load.
  // The same files run week 4.5 of https://pages.htgaa.org/2026b/clinton-monteiro/.
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { loginHref } from '../loginHref.js';

  let { data } = $props();

  const BASE = '/cfps/clusters-data/';

  onMount(() => {
    // The stylesheet and this script are public (the implementation); the two
    // data files they pull are Keycloak-gated by
    // src/routes/cfps/clusters-data/[file], so there is nothing to load for a
    // signed-out visitor.
    if (data.locked) return;
    // the script fills #cfps-arena and finds its data next to itself
    const s = document.createElement('script');
    s.src = BASE + 'clusters_page.js';
    document.body.appendChild(s);
    return () => s.remove();
  });
</script>

<svelte:head>
  <title>CFPS Clusters · CFPS</title>
  <link rel="stylesheet" href="{BASE}clusters.css" />
</svelte:head>

<div class="clp-page">
  <!-- Own wrapper rather than centring #cfps-arena directly: the arena's own
       stylesheet also targets .cfa, and at equal specificity it loaded last and
       won, pinning the board to the left. -->
  <div class="clp-inner">
    <a class="clp-back" href="/cfps">← Designer</a>
  {#if data.locked}
    <div class="clp-locked">
      <h1>Sign in to see the CFPS Clusters</h1>
      <p>
        The clusters name every submitted design, its author and the model’s forecast for it,
        so they’re visible to signed-in participants only.
      </p>
      <a class="clp-signin" href={loginHref(page.url)}>Sign in</a>
    </div>
    {:else}
      <div id="cfps-arena" class="cfa">
        <p class="clp-wait">Loading the CFPS Clusters…</p>
      </div>
    {/if}
  </div>
</div>

<style>
  /* The arena's own ground: its styles assume this near-black page. */
  .clp-page {
    min-height: 100vh;
    background: #04060c;
    color: #eaf2ff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    padding: 16px;
  }
  .clp-inner { max-width: 1240px; margin: 0 auto; }
  /* The arena fills the centred column; its own sheet otherwise leaves it
     flush left inside a wider page. */
  .clp-inner > :global(#cfps-arena) { width: 100%; margin: 0 auto; }
  .clp-back { display: block; font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 8px; }
  .clp-back:hover { color: #fff; }
  .clp-wait { color: #9fb4c6; }
  .clp-locked { max-width: 560px; margin: 14vh auto 0; text-align: center; }
  .clp-locked h1 { font-size: 20px; font-weight: 600; margin: 0 0 10px; }
  .clp-locked p { color: #9fb4c6; font-size: 13px; line-height: 1.7; margin: 0 0 18px; }
  .clp-signin {
    display: inline-block; padding: 8px 18px; border: 1px solid rgba(255,255,255,0.35);
    border-radius: 5px; color: #eaf2ff; font-size: 13px; text-decoration: none;
  }
  .clp-signin:hover { background: rgba(255,255,255,0.08); }
</style>

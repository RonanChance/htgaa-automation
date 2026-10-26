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

  const BASE = '/cfps/clusters-data/';

  onMount(() => {
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
  <a class="clp-back" href="/cfps">← Designer</a>
  <div id="cfps-arena" class="cfa">
    <p class="clp-wait">Loading the CFPS Clusters…</p>
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
  .clp-page > :global(*) { max-width: 1240px; margin-left: auto; margin-right: auto; }
  .clp-back { display: block; font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 8px; }
  .clp-back:hover { color: #fff; }
  .clp-wait { color: #9fb4c6; }
</style>

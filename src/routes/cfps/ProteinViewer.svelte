<script>
  import { onMount, onDestroy } from 'svelte';

  let { pdbUrl, color = 'chainid' } = $props();

  let container = $state(null);
  let stage = null;

  onMount(async () => {
    const NGL = await import('ngl');
    stage = new NGL.Stage(container, {
      backgroundColor: 'white',
      quality: 'medium'
    });
    stage.handleResize();
    const comp = await stage.loadFile(pdbUrl, { defaultRepresentation: false });
    comp.addRepresentation('cartoon', { color, smoothSheet: true });
    comp.autoView();
  });

  onDestroy(() => {
    if (stage) {
      stage.dispose();
      stage = null;
    }
  });
</script>

<div bind:this={container} class="w-full h-full rounded" style="min-height:200px;"></div>

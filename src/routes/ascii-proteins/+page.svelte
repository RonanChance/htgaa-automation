<script>
  import AsciiProteins from '$lib/components/AsciiProteins.svelte';
</script>

<div class="full">
  <div class="box">
    <AsciiProteins height="min(88vw, 88vh)" />
  </div>
</div>

<style>
  :global(body) { margin: 0; background: #000; }

  .full {
    width: 100vw;
    height: 100vh;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .box {
    width: min(88vw, 88vh); /* square-ish stage, centered */
  }
</style>

<script>
    let { data } = $props();
    import PlaceHistory from '../place-history/+page.svelte';
</script>

<PlaceHistory data={{ ...data, canvasHref: '/synbiobeta' }} />

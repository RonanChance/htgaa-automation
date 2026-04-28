<script>
    import PlacePage from '../place/+page.svelte';
    let { data = {} } = $props();
</script>

<PlacePage {data} />

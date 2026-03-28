
<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { flip } from 'svelte/animate';

    export let record;
    export let i;
    export let well_colors;
    export let old_well_colors;
    let flipped = false;
    let canvas;
    let container;

    onMount(async () => {
        if (browser) {
            drawPoints();
        }
    });

    function handleMouseMove(event) {
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        const rotateX = (-y / rect.height) * 125;
        const rotateY = (x / rect.width) * 125;

        container.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    }

    function resetTilt() {
        container.style.transform = 'rotateX(0deg) rotateY(0deg)';
    }

    function drawPoints() {
        if (!canvas || !record?.point_colors) return;

        const ctx = canvas.getContext('2d');
        const radius_px = record.radius_mm * 4;
        canvas.width = radius_px;
        canvas.height = radius_px;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const center = radius_px / 2;
        const scale = center / record.radius_mm - (0.1);
        const isEcho6144 = record.grid_style === 'Echo6144' || record.grid_style === 'Echo6144Image';
        const pointRadius = isEcho6144
            ? Math.max(0.75, (Number(record.point_size) || 1) * 0.7)
            : Math.max(record.point_size, 1.5);

        for (const [key, colorName] of Object.entries(record.point_colors)) {
        const [x, y] = key.split(', ').map(Number);
        const color = well_colors[colorName] || old_well_colors[colorName] || 'transparent';

        ctx.beginPath();
        ctx.arc(center + x * scale, center - y * scale, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        }
    }
</script>

<div bind:this={container} on:mousemove={handleMouseMove} on:mouseleave={resetTilt} class="tilt-effect rounded-full overflow-hidden aspect-square mx-auto bg-base-200 border border-neutral/70" aria-label="Art Circle" role="button" tabindex="0">
    <canvas bind:this={canvas} class="w-full h-full rounded-full overflow-hidden"></canvas>
</div>

<style>
    .tilt-effect {
        transition: transform 0.1s ease;
        transform-style: preserve-3d;
        transform-origin: center;
        will-change: transform;
    }
</style>

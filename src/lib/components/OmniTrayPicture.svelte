<script>
    export let img;

    function openBlackViewer() {
        const url = `${img}.jpeg`; // full-res
        const viewer = window.open('', '_blank');
        viewer.document.write(`
            <html>
            <head>
                <title>Artwork</title>
                <style>
                    body {
                        margin: 0;
                        background: black;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                    }
                    img {
                        max-width: 100%;
                        max-height: 100%;
                    }
                </style>
            </head>
            <body>
                <img src="${url}" />
            </body>
            </html>
        `);
        viewer.document.close();
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={container}
    onmousemove={handleMouseMove}
    onmouseleave={resetTilt}
    class="w-[115px] sm:w-[150px] tilt-effect rounded-md overflow-hidden bg-base-200 border border-neutral/70 aspect-[3/2]"
    onclick={openBlackViewer}
    style="cursor:pointer;"
>
    <img
        src={`${img}_small.jpeg`}
        alt="Artwork"
        class="tilt-effect w-full h-full object-cover"
        loading="lazy"
    />
</div>

<style>
    .tilt-effect {
        transition: transform 0.1s ease;
        transform-style: preserve-3d;
        transform-origin: center;
        will-change: transform;
    }
</style>


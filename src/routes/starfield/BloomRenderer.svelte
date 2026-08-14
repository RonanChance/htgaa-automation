<script>
    // Installs a postprocessing EffectComposer that replaces Threlte's default
    // render call each frame — adds a bloom pass that turns dots into glowing
    // stars. Renders nothing directly.
    import { useTask, useThrelte } from '@threlte/core';
    import { EffectComposer, EffectPass, RenderPass, BloomEffect, BlendFunction } from 'postprocessing';
    import { onMount, onDestroy } from 'svelte';

    const { renderer, scene, camera, size, autoRender, renderMode, renderStage } = useThrelte();

    let composer;
    let unsubSize;

    onMount(() => {
        // Take over the render loop
        autoRender.set(false);
        renderMode.set('always');

        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera.current));
        composer.addPass(new EffectPass(
            camera.current,
            new BloomEffect({
                intensity: 1.4,
                luminanceThreshold: 0.02,
                luminanceSmoothing: 0.35,
                mipmapBlur: true,
                blendFunction: BlendFunction.ADD
            })
        ));

        // Size handling: subscribe to Threlte's size store so composer resizes
        // when the canvas changes dimensions. NOTE: postprocessing's setSize
        // takes CSS pixels (like three.js renderer.setSize) — it applies DPR
        // internally. Multiplying by DPR here caused the render to occupy only
        // 1/dpr² of the canvas on Retina displays.
        const applySize = ({ width, height }) => {
            composer.setSize(width, height, false);
        };
        applySize(size.current);
        unsubSize = size.subscribe(applySize);
    });

    onDestroy(() => {
        unsubSize?.();
        autoRender.set(true);
        renderMode.set('on-demand');
        composer?.dispose?.();
    });

    // Render each frame via composer, in Threlte's render stage
    useTask(
        (delta) => {
            composer?.render(delta);
        },
        { stage: renderStage, autoInvalidate: false }
    );
</script>

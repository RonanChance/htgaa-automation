<script>
    // Runs inside <Canvas>. Handles:
    //   - pointer raycasting against the Points mesh for hover
    //   - click → set selectedSlug + kick off a camera focus tween
    //   - focusTargetSlug prop (from URL / lineage chip) also triggers a tween
    import { useTask, useThrelte } from '@threlte/core';
    import { Raycaster, Vector2, Vector3 } from 'three';
    import { onMount } from 'svelte';

    let {
        data,
        slugToIdx,
        pointsMesh,
        focusTargetSlug = null,
        hoveredSlug = $bindable(null),
        selectedSlug = $bindable(null)
    } = $props();

    const { camera, renderer, invalidate } = useThrelte();

    const raycaster = new Raycaster();
    raycaster.params.Points = { threshold: 1.6 };
    const pointer = new Vector2();
    let pointerActive = false;
    let controls; // OrbitControls instance, resolved from camera children on mount

    // Camera tween state
    let tween = null;

    onMount(() => {
        const canvas = renderer.domElement;
        console.log('[starfield] onMount, canvas =', canvas, 'in DOM?', document.body.contains(canvas));

        // Locate the OrbitControls that was attached to the camera by <OrbitControls>
        // (Threlte adds it as a child so we can find it via traversal)
        camera.current?.parent?.traverse?.((obj) => {
            // Look for objects with .target and .enableDamping — that's OrbitControls
            if (obj?.target && typeof obj.enableDamping !== 'undefined') controls = obj;
        });

        const onMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            pointerActive = true;
        };
        const onLeave = () => {
            pointerActive = false;
            hoveredSlug = null;
        };
        // Track down position — used to distinguish a click from a camera drag.
        // Browsers only fire "click" if the pointer stayed relatively still,
        // but on touch or with slow drags Chrome can still emit click; belt +
        // suspenders.
        let downX = 0, downY = 0;
        const onDown = (e) => {
            downX = e.clientX;
            downY = e.clientY;
        };
        // Use "click" for selection (fires on both mouse + pointer + touch,
        // browsers already drop it if the pointer moved significantly).
        const onClick = (e) => {
            const dragDist = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (dragDist > 6) return;
            // Refresh raycaster with the click's own coordinates (in case the
            // pointer moved between the last useTask and this event).
            const rect = canvas.getBoundingClientRect();
            pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            if (pointsMesh && camera.current) {
                raycaster.setFromCamera(pointer, camera.current);
                const hits = raycaster.intersectObject(pointsMesh, false);
                if (hits.length && hits[0].index != null) {
                    const node = data.nodes[hits[0].index];
                    if (node) {
                        selectedSlug = node.slug;
                        startFocusTween(node.slug);
                    }
                }
            }
        };

        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerleave', onLeave);
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('click', onClick);

        return () => {
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerleave', onLeave);
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('mousedown', onDown);
            canvas.removeEventListener('click', onClick);
        };
    });

    // React to external focus requests (e.g. from lineage chip in the panel)
    $effect(() => {
        if (focusTargetSlug && data) {
            selectedSlug = focusTargetSlug;
            startFocusTween(focusTargetSlug);
        }
    });

    function startFocusTween(slug) {
        const i = slugToIdx.get(slug);
        if (i == null || !camera.current || !controls) return;
        const node = data.nodes[i];
        const targetPos = new Vector3(node.x, node.y, node.z);
        const currentTarget = controls.target.clone();
        // Camera position offset preserves current viewing angle & distance
        const offset = camera.current.position.clone().sub(currentTarget);
        // Nudge closer if we're far away — clamp offset length to reasonable range
        const offsetLen = offset.length();
        const desiredLen = Math.min(Math.max(offsetLen, 22), 45);
        offset.setLength(desiredLen);
        const endCamPos = targetPos.clone().add(offset);
        tween = {
            startTs: performance.now(),
            duration: 750,
            startCamPos: camera.current.position.clone(),
            endCamPos,
            startTarget: currentTarget,
            endTarget: targetPos
        };
        // Kill auto-rotate on focus
        if (controls && controls.autoRotate) controls.autoRotate = false;
    }

    // Per-frame: raycast + camera tween integration
    useTask(() => {
        // Raycast for hover (only when pointer is over canvas)
        if (pointerActive && pointsMesh && camera.current) {
            raycaster.setFromCamera(pointer, camera.current);
            const hits = raycaster.intersectObject(pointsMesh, false);
            if (hits.length) {
                // Take the closest-to-camera hit; if multiple close, prefer smallest screen distance
                const hit = hits[0];
                const idx = hit.index;
                if (idx != null) {
                    const node = data.nodes[idx];
                    if (node) hoveredSlug = node.slug;
                }
            } else {
                hoveredSlug = null;
            }
        }

        // Camera tween
        if (tween && camera.current && controls) {
            const now = performance.now();
            const t = Math.min(1, (now - tween.startTs) / tween.duration);
            // Cubic ease-out
            const e = 1 - Math.pow(1 - t, 3);
            camera.current.position.lerpVectors(tween.startCamPos, tween.endCamPos, e);
            controls.target.lerpVectors(tween.startTarget, tween.endTarget, e);
            controls.update();
            invalidate();
            if (t >= 1) tween = null;
        }
    });
</script>

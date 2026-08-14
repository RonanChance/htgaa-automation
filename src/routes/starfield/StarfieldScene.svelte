<script>
    import { T, Canvas } from '@threlte/core';
    import { OrbitControls } from '@threlte/extras';
    import {
        BufferGeometry,
        BufferAttribute,
        AdditiveBlending,
        NormalBlending,
        ShaderMaterial
    } from 'three';
    import BloomRenderer from './BloomRenderer.svelte';
    import SceneInteractions from './SceneInteractions.svelte';

    let {
        data,
        hoveredSlug = $bindable(null),
        selectedSlug = $bindable(null),
        focusTargetSlug = null
    } = $props();

    function base64ToFloat32(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Float32Array(bytes.buffer);
    }

    // Star geometry with per-vertex highlight attribute (mutated on hover/select)
    const starGeometry = $derived.by(() => {
        const nodes = data.nodes;
        const N = nodes.length;
        const positions = new Float32Array(N * 3);
        const colors = new Float32Array(N * 3);
        const sizes = new Float32Array(N);
        const highlights = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const n = nodes[i];
            positions[i * 3 + 0] = n.x;
            positions[i * 3 + 1] = n.y;
            positions[i * 3 + 2] = n.z;
            colors[i * 3 + 0] = n.color[0];
            colors[i * 3 + 1] = n.color[1];
            colors[i * 3 + 2] = n.color[2];
            const bright = Math.max(0, Math.min(1, (n.brightness ?? 30) / 100));
            const base = 8 + 22 * Math.sqrt(bright);
            sizes[i] = n.isSun ? base * 2.0 : base;
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(positions, 3));
        g.setAttribute('color', new BufferAttribute(colors, 3));
        g.setAttribute('size', new BufferAttribute(sizes, 1));
        g.setAttribute('highlight', new BufferAttribute(highlights, 1));
        return g;
    });

    const edgeGeometry = $derived.by(() => {
        const positions = base64ToFloat32(data.edgePositions);
        const alphas = base64ToFloat32(data.edgeAlphas);
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(positions, 3));
        g.setAttribute('alpha', new BufferAttribute(alphas, 1));
        return g;
    });

    const slugToIdx = $derived(new Map(data.nodes.map((n, i) => [n.slug, i])));

    // Update highlight buffer whenever hover/select changes
    $effect(() => {
        const attr = starGeometry.getAttribute('highlight');
        if (!attr) return;
        attr.array.fill(0);
        if (hoveredSlug != null) {
            const i = slugToIdx.get(hoveredSlug);
            if (i != null) attr.array[i] = 1.0;
        }
        if (selectedSlug != null && selectedSlug !== hoveredSlug) {
            const i = slugToIdx.get(selectedSlug);
            if (i != null) attr.array[i] = 0.75;
        }
        attr.needsUpdate = true;
    });

    const starMaterial = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
            pixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 }
        },
        vertexShader: /* glsl */ `
            attribute float size;
            attribute vec3 color;
            attribute float highlight;
            varying vec3 vColor;
            varying float vHighlight;
            uniform float pixelRatio;
            void main() {
                vColor = color;
                vHighlight = highlight;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float boost = 1.0 + highlight * 0.9;
                gl_PointSize = size * boost * pixelRatio * (60.0 / -mvPosition.z);
                gl_PointSize = clamp(gl_PointSize, 1.0, 96.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */ `
            varying vec3 vColor;
            varying float vHighlight;
            void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv) * 2.0;
                if (d > 1.0) discard;
                float core = 1.0 - smoothstep(0.0, 0.15, d);
                float halo = 1.0 - smoothstep(0.15, 1.0, d);
                float alpha = core + halo * 0.35;
                vec3 col = vColor * (1.0 + core * 1.5);
                float ring = smoothstep(0.55, 0.75, d) * (1.0 - smoothstep(0.75, 0.95, d));
                col += vec3(1.0, 1.0, 0.9) * ring * vHighlight * 1.5;
                alpha += ring * vHighlight * 0.6;
                gl_FragColor = vec4(col, alpha);
            }
        `
    });

    const edgeMaterial = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
        vertexShader: /* glsl */ `
            attribute float alpha;
            varying float vAlpha;
            void main() {
                vAlpha = alpha;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            varying float vAlpha;
            void main() {
                gl_FragColor = vec4(0.55, 0.65, 0.85, vAlpha);
            }
        `
    });

    // Reference to the Points mesh (populated by Threlte via ref binding),
    // shared with SceneInteractions for raycasting.
    let pointsMesh = $state(null);
</script>

<div style="position: absolute; inset: 0; width: 100%; height: 100%;">
    <Canvas>
        <T.PerspectiveCamera makeDefault fov={50} near={0.5} far={800} position={[60, 40, 140]}>
            <OrbitControls
                enableDamping
                dampingFactor={0.08}
                enablePan={false}
                minDistance={12}
                maxDistance={220}
                minPolarAngle={Math.PI * 0.08}
                maxPolarAngle={Math.PI * 0.92}
                autoRotate
                autoRotateSpeed={0.25}
                target={[0, 0, 0]}
            />
        </T.PerspectiveCamera>

        <T.LineSegments geometry={edgeGeometry} material={edgeMaterial} />
        <T.Points
            oncreate={(ref) => { pointsMesh = ref; console.log('[starfield] points mesh mounted', ref); }}
            geometry={starGeometry}
            material={starMaterial}
        />

        <SceneInteractions
            {data}
            {slugToIdx}
            {pointsMesh}
            {focusTargetSlug}
            bind:hoveredSlug
            bind:selectedSlug
        />
        <BloomRenderer />
    </Canvas>
</div>

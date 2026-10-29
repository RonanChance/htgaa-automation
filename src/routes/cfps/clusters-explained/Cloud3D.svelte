<script>
  // A rotatable point cloud. The parent decides where every point sits and how
  // it looks; this only draws, tweens between layouts, and reports hovers.
  //
  //   points  [{ p: [x, y, z], c: css colour, s: size px, a: alpha, shape: 0 dot | 1 diamond }]
  //   label   (i) => text for the hover card, or null
  //   axes    three axis captions, or null to hide the axes
  //   height  px, or any CSS length (e.g. a clamp() that follows the viewport)
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

  let { points = [], label = null, axes = null, height = 440, autoRotate = true } = $props();

  let host = $state(null);
  let hover = $state(null);
  let axisPos = $state([]);
  let renderer, scene, camera, controls, geom, mat, raf, ro, io;
  let visible = true;
  let n = 0;
  // current (drawn) and target buffers, tweened between on every change
  let cur = null, from = null, to = null, t0 = 0;
  const DUR = 900;

  const VERT = `
    attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aShape;
    varying vec3 vColor; varying float vAlpha; varying float vShape;
    uniform float uScale;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uScale / -mv.z;
      vColor = aColor; vAlpha = aAlpha; vShape = aShape;
    }`;
  const FRAG = `
    varying vec3 vColor; varying float vAlpha; varying float vShape;
    void main() {
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float d = vShape > 0.5 ? abs(q.x) + abs(q.y) : length(q);
      if (d > 1.0) discard;
      float rim = vShape > 0.5 ? 1.0 : smoothstep(1.0, 0.7, d);
      gl_FragColor = vec4(vColor * (0.82 + 0.18 * (1.0 - d)), vAlpha * rim);
    }`;

  // Centre the layout and scale it so most points sit inside the unit sphere;
  // the odd far outlier is allowed past it rather than shrinking everything.
  function normalise(pts) {
    const m = [0, 0, 0];
    for (const q of pts) for (let k = 0; k < 3; k++) m[k] += q.p[k] / pts.length;
    const r = pts.map((q) => Math.hypot(q.p[0] - m[0], q.p[1] - m[1], q.p[2] - m[2])).sort((a, b) => a - b);
    const s = 1 / (r[Math.floor(r.length * 0.95)] || 1);
    // only the first three components are drawn; points may carry more for the 2-D view
    return pts.map((q) => [0, 1, 2].map((k) => (q.p[k] - m[k]) * s));
  }

  const color = new THREE.Color();
  function pack(pts) {
    const pos = normalise(pts);
    const out = {
      pos: new Float32Array(pts.length * 3),
      col: new Float32Array(pts.length * 3),
      size: new Float32Array(pts.length),
      alpha: new Float32Array(pts.length),
      shape: new Float32Array(pts.length)
    };
    pts.forEach((q, i) => {
      out.pos.set(pos[i], i * 3);
      color.setStyle(q.c || '#58c4dd');
      out.col.set([color.r, color.g, color.b], i * 3);
      out.size[i] = q.s ?? 7;
      out.alpha[i] = q.a ?? 1;
      out.shape[i] = q.shape ?? 0;
    });
    return out;
  }

  function attach() {
    geom.setAttribute('position', new THREE.BufferAttribute(cur.pos, 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(cur.col, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(cur.size, 1));
    geom.setAttribute('aAlpha', new THREE.BufferAttribute(cur.alpha, 1));
    geom.setAttribute('aShape', new THREE.BufferAttribute(cur.shape, 1));
    geom.computeBoundingSphere();
  }

  function setPoints(pts) {
    if (!geom || !pts.length) return;
    const next = pack(pts);
    if (pts.length !== n || !cur) {
      n = pts.length;
      cur = pack(pts);
      from = to = null;
      attach();
      return;
    }
    // Tween from wherever the points are right now.
    from = {
      pos: cur.pos.slice(), col: cur.col.slice(), size: cur.size.slice(), alpha: cur.alpha.slice()
    };
    to = next;
    cur.shape.set(next.shape);
    geom.attributes.aShape.needsUpdate = true;
    t0 = performance.now();
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function step(now) {
    if (!to) return;
    const t = Math.min(1, (now - t0) / DUR);
    const e = ease(t);
    for (const k of ['pos', 'col', 'size', 'alpha']) {
      const a = from[k], b = to[k], c = cur[k];
      for (let i = 0; i < c.length; i++) c[i] = a[i] + (b[i] - a[i]) * e;
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.aColor.needsUpdate = true;
    geom.attributes.aSize.needsUpdate = true;
    geom.attributes.aAlpha.needsUpdate = true;
    if (t >= 1) { to = from = null; geom.computeBoundingSphere(); }
  }

  const v3 = new THREE.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    const r = host.getBoundingClientRect();
    return [(v3.x * 0.5 + 0.5) * r.width, (-v3.y * 0.5 + 0.5) * r.height, v3.z];
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    step(now);
    controls.update();
    renderer.render(scene, camera);
    if (axes) axisPos = [[1.25, 0, 0], [0, 1.25, 0], [0, 0, 1.25]].map((p) => project(...p));
  }

  // Hover by screen distance — steadier than raycasting into point sprites.
  function onMove(ev) {
    if (!label || !cur) return;
    const r = host.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < n; i++) {
      if (cur.alpha[i] < 0.15) continue;
      const [x, y, z] = project(cur.pos[i * 3], cur.pos[i * 3 + 1], cur.pos[i * 3 + 2]);
      if (z > 1) continue;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const text = best >= 0 ? label(best) : null;
    hover = text ? { text, x: mx, y: my } : null;
  }

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(2.2, 1.5, 3.1);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.6;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 9;
    // Any touch hands rotation to the reader for good.
    controls.addEventListener('start', () => (controls.autoRotate = false));

    const axisMat = new THREE.LineBasicMaterial({ color: 0x3a414c });
    for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...d.map((v) => -v * 1.2)), new THREE.Vector3(...d.map((v) => v * 1.2))
      ]);
      const line = new THREE.Line(g, axisMat);
      line.visible = !!axes;
      line.userData.axis = true;
      scene.add(line);
    }

    geom = new THREE.BufferGeometry();
    mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 300 } }
    });
    scene.add(new THREE.Points(geom, mat));

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // aSize is in CSS px at the starting camera distance
      mat.uniforms.uScale.value = renderer.getPixelRatio() * camera.position.length();
    };
    ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(host);
    setPoints(points);
    raf = requestAnimationFrame(frame);
    // Teardown here rather than onDestroy, which also runs during SSR.
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      controls?.dispose();
      geom?.dispose();
      mat?.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss?.();
    };
  });

  $effect(() => { setPoints(points); });
  $effect(() => {
    const on = !!axes;
    scene?.children.forEach((c) => { if (c.userData.axis) c.visible = on; });
  });

</script>

<div class="cloud" bind:this={host} style="height:{typeof height === 'number' ? `${height}px` : height}"
  onpointermove={onMove} onpointerleave={() => (hover = null)} role="img"
  aria-label="Three-dimensional view of the designs; drag to rotate, scroll to zoom">
  {#if axes}
    {#each axisPos as [x, y, z], k}
      {#if z < 1}<span class="axl" style="left:{x}px; top:{y}px">{axes[k]}</span>{/if}
    {/each}
  {/if}
  {#if hover}
    <div class="tip" style="left:{hover.x + 14}px; top:{hover.y + 10}px">{hover.text}</div>
  {/if}
  <span class="hint">drag to rotate · scroll to zoom</span>
</div>

<style>
  .cloud { position: relative; width: 100%; cursor: grab; touch-action: none; }
  .cloud:active { cursor: grabbing; }
  .cloud :global(canvas) { display: block; }
  .axl {
    position: absolute; transform: translate(-50%, -50%); pointer-events: none;
    font: 10px var(--mono); color: var(--faint); white-space: nowrap;
  }
  .tip {
    position: absolute; pointer-events: none; z-index: 2; max-width: 260px;
    padding: 6px 9px; border-radius: 4px; background: rgba(10, 12, 16, .94);
    border: 1px solid var(--line); font: 11px/1.45 var(--mono); color: var(--text); white-space: pre-line;
  }
  .hint {
    position: absolute; right: 8px; bottom: 6px; pointer-events: none;
    font: 10px var(--mono); color: var(--faint);
  }
</style>

<script>
  // Cubee — a tiny isometric cube mascot that peeks from the bottom-right corner
  // and watches the cursor. The "alive" feel is a direct port of the ambient-motion
  // model in smontlouis/bible-strong-avatar-lab (packages/avatar-core/ambientMotion.ts):
  //   • slow-drift body wander via value-noise (smoothNoise/hash/smoothstep)
  //   • micro-saccades on the eyes (quick ~140 ms darts every ~1.1 s)
  //   • organic, randomly-timed blinks
  //   • cursor eye-tracking + a gentle lean toward the pointer
  // Everything runs on a single rAF loop, paused when off-screen or reduced-motion.
  let cube = $state(null);   // the whole cube <g> (drift + lean)
  let eyes = $state(null);   // eye group (blink via scaleY)
  let pupils = $state(null); // pupils group (gaze + saccade)
  let shadow = $state(null); // ground shadow (breathes with the bob)
  let host = $state(null);   // root, for visibility observation

  // ── ambientMotion.ts helpers, ported verbatim ───────────────────────────
  const smoothstep = (v) => v * v * (3 - 2 * v);
  const hash = (v) => {
    const raw = Math.sin(v * 127.1 + 311.7) * 43758.5453;
    return (raw - Math.floor(raw)) * 2 - 1;
  };
  const smoothNoise = (t, axis, seed, interval) => {
    const progress = t / interval;
    const step = Math.floor(progress);
    const blend = smoothstep(progress - step);
    const prev = hash(step * 3 + axis + seed);
    const next = hash((step + 1) * 3 + axis + seed);
    return prev + (next - prev) * blend;
  };
  const saccade = (t, axis, seed) => {
    const interval = 1100, duration = 140;
    if (t <= 0) return 0;
    const step = Math.floor(t / interval);
    const progress = (t - step * interval) / duration;
    const blend = smoothstep(Math.min(progress, 1));
    const prev = step === 0 ? 0 : hash((step - 1) * 2 + axis + seed);
    const next = hash(step * 2 + axis + seed);
    return prev + (next - prev) * blend;
  };

  const SEED = 17.29;        // eye micro-saccade seed (EYE_MOTION_SEED)
  const BODY_SEED = 4.13;    // arbitrary per-instance body seed

  $effect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let mx = 0, my = 0, haveCursor = false;
    const onMove = (e) => { mx = e.clientX; my = e.clientY; haveCursor = true; };
    window.addEventListener('mousemove', onMove, { passive: true });

    // Organic blinking: pick the next blink time at a random interval, then play
    // a ~130 ms close/open. Matches the lab's blinkDueAt scheduling feel.
    let nextBlinkAt = 900 + Math.random() * 2500;
    let blinkStart = -1;
    const BLINK_MS = 130;

    const start = performance.now();
    let raf = 0;
    const frame = (now) => {
      const t = now - start;

      // Body: slow drift (headX/headY/headZ) + position wander, per ambientMotion.
      const drift = BODY_SEED;
      const headX = smoothNoise(t, 0, drift, 2600) * 0.8;
      const headY = smoothNoise(t, 1, drift, 3300) * 1.15;
      const headZ = smoothNoise(t, 2, drift, 4100) * 0.45; // → subtle tilt
      const bodyX = smoothNoise(t, 3, drift, 2900) * 1.45;
      const bodyY = smoothNoise(t, 4, drift, 3700) * 1.1;
      const bob = Math.sin(t / 1700) * 2.4; // gentle breathing bob

      // Lean toward the cursor (only once we've seen it move).
      let leanX = 0, gazeX = 0, gazeY = 0;
      if (haveCursor && host) {
        const r = host.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = mx - cx, dy = my - cy;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 240); // saturate gaze once the cursor is far
        gazeX = (dx / d) * k;
        gazeY = (dy / d) * k;
        leanX = gazeX;
      }

      // Eyes: micro-saccades layered on the cursor gaze.
      const sx = saccade(t, 0, SEED) * 1.5;
      const sy = saccade(t, 1, SEED) * 0.9;

      // Blink scheduling.
      if (blinkStart < 0 && t >= nextBlinkAt) blinkStart = t;
      let lid = 1; // 1 = fully open
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / BLINK_MS;
        if (p >= 1) {
          blinkStart = -1;
          nextBlinkAt = t + 1600 + Math.random() * 3800;
          // occasional quick double-blink
          if (Math.random() < 0.18) nextBlinkAt = t + 180;
        } else {
          // 0→1→0 triangle → close then open
          lid = 1 - Math.sin(p * Math.PI) * 0.92;
        }
      }

      if (cube) {
        cube.style.transform =
          `translate(${(headX + bodyX).toFixed(2)}px, ${(headY + bodyY + bob).toFixed(2)}px) ` +
          `rotate(${(headZ + leanX * 3).toFixed(2)}deg)`;
      }
      if (pupils) {
        pupils.style.transform =
          `translate(${(gazeX * 2.4 + sx).toFixed(2)}px, ${(gazeY * 2.4 + sy).toFixed(2)}px)`;
      }
      if (eyes) eyes.style.transform = `scaleY(${lid.toFixed(3)})`;
      if (shadow) {
        const s = 1 - (bob + 2.4) / 24; // shrink shadow as it lifts
        shadow.style.transform = `scale(${s.toFixed(3)})`;
        shadow.style.opacity = (0.55 + s * 0.25).toFixed(3);
      }
      raf = requestAnimationFrame(frame);
    };

    // Only animate while on-screen — decorative motion shouldn't burn frames when scrolled away.
    let running = false;
    const play = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { if (running) { running = false; cancelAnimationFrame(raf); } };
    let io;
    if (host && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), { threshold: 0.01 });
      io.observe(host);
    } else {
      play();
    }

    return () => {
      window.removeEventListener('mousemove', onMove);
      stop();
      io?.disconnect();
    };
  });
</script>

<div class="cubee" bind:this={host} aria-hidden="true">
  <svg viewBox="0 0 100 108" width="100%" height="100%">
    <ellipse class="cubee-shadow" bind:this={shadow} cx="50" cy="100" rx="24" ry="4.5" />
    <g class="cubee-cube" bind:this={cube}>
      <!-- three iso faces -->
      <polygon class="face face--top" points="50,20 78,36 50,52 22,36" />
      <polygon class="face face--left" points="22,36 50,52 50,86 22,70" />
      <polygon class="face face--right" points="78,36 50,52 50,86 78,70" />
      <polygon class="gloss" points="50,20 78,36 64,44 50,36" />
      <g class="cubee-eyes" bind:this={eyes}>
        <ellipse class="eye" cx="40" cy="60" rx="6" ry="6.8" />
        <ellipse class="eye" cx="60" cy="60" rx="6" ry="6.8" />
        <g class="cubee-pupils" bind:this={pupils}>
          <circle class="pupil" cx="40" cy="61" r="2.7" />
          <circle class="pupil" cx="60" cy="61" r="2.7" />
          <circle class="glint" cx="41.1" cy="59.6" r="0.9" />
          <circle class="glint" cx="61.1" cy="59.6" r="0.9" />
        </g>
      </g>
      <path class="mouth" d="M43 71 Q50 76 57 71" />
    </g>
  </svg>
</div>

<style>
  .cubee {
    position: absolute;
    right: 12px;
    bottom: 10px;
    width: 72px;
    height: 78px;
    pointer-events: none; /* never block selecting the prompt text behind it */
    z-index: 2;
  }
  /* transform-origin so drift/lean pivot around the cube's mass, blink around eye line */
  .cubee-cube { transform-origin: 50% 62%; }
  .cubee-eyes { transform-box: fill-box; transform-origin: center; }
  .cubee-pupils { transform-box: fill-box; transform-origin: center; }
  .cubee-shadow { transform-box: fill-box; transform-origin: center; }
  .face--top { fill: #56bfc6; }
  .face--right { fill: #1c8f97; }
  .face--left { fill: #0e6068; }
  .gloss { fill: rgba(255, 255, 255, 0.18); }
  .eye { fill: #f5fafb; }
  .pupil { fill: #0a2a2d; }
  .glint { fill: rgba(255, 255, 255, 0.9); }
  .mouth { fill: none; stroke: #0a2a2d; stroke-width: 2; stroke-linecap: round; }
  .cubee-shadow { fill: rgba(12, 40, 44, 0.16); }

  /* Reduced-motion: sit still, centred, no tracking or drift. */
  @media (prefers-reduced-motion: reduce) {
    .cubee-cube, .cubee-eyes, .cubee-pupils, .cubee-shadow { transform: none !important; }
  }
</style>

<script>
  // PixelField — an ambient "pixelated biochemistry" backdrop for the dark region
  // below the hero. One fixed, viewport-sized <canvas> (like the #bg-ascii canvas
  // on ascii-text.webflow.io): we only ever paint the viewport and offset by
  // scrollY, so cost is independent of page height.
  //
  //   • each reagent is a WHITE procedural "molecular machine" — a symmetric pixel
  //     cluster whose cells are drawn live each frame so the whole thing breathes,
  //     sways and drifts (malleable / biological, not a rigid static tile)
  //   • SUBSTRATE motes drift through the solution and are drawn toward the nearest
  //     machine — the machines look like they're working on something
  //   • machines are DRAGGABLE: press + move to grab one (it softly trails the
  //     cursor, still breathing); a plain click opens that reagent's info modal
  //
  // Purely decorative: the canvas is pointer-events:none at z-index -1, so
  // hit-testing is manual and gated by elementFromPoint so panel clicks win.

  import { moleculeCells } from './pixelMolecule.js';

  let { items = [], onPick } = $props();

  let canvas = $state(null);

  const rng = (seed) => { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  const CELL = 4.6;   // px per machine cell
  const HALF = 3;     // grid centre (GLYPH 7 → centre index 3)

  $effect(() => {
    if (typeof window === 'undefined' || !canvas || !items.length) return;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let dpr = 1, vw = 0, vh = 0, worldW = 0, worldTop = 0, worldBottom = 0;
    let machines = [];
    let substrates = [];

    // Build machines (jittered grid, below the hero) + a solution of substrate motes.
    function place() {
      worldW = document.documentElement.clientWidth;
      const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight);
      worldTop = window.innerHeight * 0.9;   // start below the black hero
      worldBottom = docH - 30;
      const STEP = 150;
      const rand = rng(1234567);

      machines = [];
      let idx = 0;
      for (let y = worldTop; y < worldBottom; y += STEP) {
        for (let x = 30; x < worldW - 30; x += STEP) {
          if (rand() < 0.5) continue;
          const item = items[idx % items.length];
          const r = rng((idx + 1) * 2654435761);
          idx++;
          // per-cell polar geometry (offset from blob centre, in px)
          const cells = moleculeCells(item.id).cells.map((c, i) => {
            const ox = (c.x - HALF) * CELL, oy = (c.y - HALF) * CELL;
            return { ang: Math.atan2(oy, ox), dist: Math.hypot(ox, oy), core: c.core, ph: r() * Math.PI * 2, i };
          });
          machines.push({
            item, cells,
            bx: x + (r() - 0.5) * 80, by: y + (r() - 0.5) * 80,
            // slow but clearly visible wander (periods ~8–18s)
            ampX: 9 + r() * 13, ampY: 7 + r() * 11,
            spdX: 0.34 + r() * 0.34, spdY: 0.3 + r() * 0.32,
            phX: r() * 6.283, phY: r() * 6.283,
            breatheSpd: 0.55 + r() * 0.6, breathePh: r() * 6.283,   // soft-body pulse
            wobSpd: 1.1 + r() * 1.0, swaySpd: 0.8 + r() * 0.7,      // per-cell jiggle
            rotSpd: 0.18 + r() * 0.22, rotPh: r() * 6.283,
            base: 0.55 + r() * 0.32,
            wx: 0, wy: 0, br: 1, rot: 0, rect: null,
            drag: false, dragX: 0, dragY: 0
          });
        }
      }

      // Substrate: a modest solution of motes, count scaled to the region area.
      const area = Math.max(1, (worldBottom - worldTop) * worldW);
      const N = Math.min(150, Math.max(40, Math.round(area / 24000)));
      const sr = rng(98765);
      substrates = Array.from({ length: N }, () => ({
        x: sr() * worldW,
        y: worldTop + sr() * (worldBottom - worldTop),
        vx: (sr() - 0.5) * 8, vy: (sr() - 0.5) * 8,
        seed: sr() * 1000, br: 0.2
      }));
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      vw = window.innerWidth; vh = window.innerHeight;
      canvas.width = vw * dpr; canvas.height = vh * dpr;
      canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      place();
      schedule(); // repaint (matters for the static / reduced-motion path)
    }

    function drawGrid(sy) {
      // faint gridded pixel texture, only below the hero (the hero is painted by
      // the page's own background, which sits beneath this canvas).
      const G = 26;
      const heroEnd = window.innerHeight * 0.86;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      const offX = -(window.scrollX % G), offY = -(sy % G);
      for (let y = offY; y < vh; y += G) {
        if (y + sy < heroEnd) continue;
        for (let x = offX; x < vw; x += G) ctx.fillRect(x, y, 1, 1);
      }
    }

    // ── drag state ───────────────────────────────────────────────────────────
    let dragging = null;                 // machine being dragged, or null
    let dragTargetX = 0, dragTargetY = 0; // world coords the grabbed point should sit at
    let grabOX = 0, grabOY = 0;          // offset from machine centre to grab point
    let downX = 0, downY = 0, dragMoved = false, suppressClick = false;
    let forceLoop = false;               // keep the rAF loop alive while dragging

    let lastNow = 0;
    function frame(now) {
      const dt = reduce ? 0 : Math.min(0.05, (now - lastNow) / 1000 || 0);
      lastNow = now;
      const t = reduce ? 0 : now / 1000;
      const sx = window.scrollX, sy = window.scrollY;

      ctx.clearRect(0, 0, vw, vh);
      drawGrid(sy);

      // 1 · advance each machine's current world position + breathing pulse.
      for (const m of machines) {
        if (m.drag) {
          // ease toward the cursor so the machine trails softly (jelly-like)
          m.dragX += (dragTargetX - m.dragX) * 0.3;
          m.dragY += (dragTargetY - m.dragY) * 0.3;
          m.wx = m.dragX; m.wy = m.dragY;
        } else {
          m.wx = m.bx + Math.sin(t * m.spdX + m.phX) * m.ampX;
          m.wy = m.by + Math.cos(t * m.spdY + m.phY) * m.ampY;
        }
        m.br = 1 + Math.sin(t * m.breatheSpd + m.breathePh) * 0.16;
        m.rot = Math.sin(t * m.rotSpd + m.rotPh) * 0.16;
      }

      // 2 · substrate motes: wander + get drawn toward the nearest machine, then
      //     brighten while close (looks like they're being processed).
      const R = 150;
      ctx.fillStyle = '#ffffff';
      for (const s of substrates) {
        if (!reduce) {
          s.vx += Math.cos(t * 0.6 + s.seed) * 0.35;
          s.vy += Math.sin(t * 0.5 + s.seed * 1.3) * 0.35;
          let best = R * R, bx = 0, by = 0, found = false;
          for (const m of machines) {
            const d2 = (m.wx - s.x) * (m.wx - s.x) + (m.wy - s.y) * (m.wy - s.y);
            if (d2 < best) { best = d2; bx = m.wx; by = m.wy; found = true; }
          }
          if (found) {
            const d = Math.sqrt(best) || 1;
            const pull = (1 - d / R) * 0.9;
            s.vx += ((bx - s.x) / d) * pull - ((by - s.y) / d) * pull * 0.5; // attract + orbit
            s.vy += ((by - s.y) / d) * pull + ((bx - s.x) / d) * pull * 0.5;
            s.br = Math.min(1, s.br + 0.05);
          } else {
            s.br = Math.max(0.18, s.br - 0.02);
          }
          s.vx *= 0.93; s.vy *= 0.93;
          const sp = Math.hypot(s.vx, s.vy), MAX = 36;
          if (sp > MAX) { s.vx = (s.vx / sp) * MAX; s.vy = (s.vy / sp) * MAX; }
          s.x += s.vx * dt * 60; s.y += s.vy * dt * 60;
          if (s.x < 0) { s.x = 0; s.vx = -s.vx; }
          if (s.x > worldW) { s.x = worldW; s.vx = -s.vx; }
          if (s.y < worldTop) { s.y = worldTop; s.vy = -s.vy; }
          if (s.y > worldBottom) { s.y = worldBottom; s.vy = -s.vy; }
        }
        const scx = s.x - sx, scy = s.y - sy;
        if (scx < -4 || scx > vw + 4 || scy < -4 || scy > vh + 4) continue;
        const sz = 1.2 + s.br * 1.2;
        ctx.globalAlpha = 0.2 + s.br * 0.6;
        ctx.fillRect(scx - sz / 2, scy - sz / 2, sz, sz);
      }

      // 3 · machines: draw each cell live so the blob deforms (malleable, alive).
      const REACH = 3.6 * CELL + 4;
      for (const m of machines) {
        const cxp = m.wx - sx, cyp = m.wy - sy;
        if (cxp < -REACH || cxp > vw + REACH || cyp < -REACH || cyp > vh + REACH) { m.rect = null; continue; }
        for (const c of m.cells) {
          const rwob = reduce ? 0 : Math.sin(t * m.wobSpd + c.ph) * 1.25;      // radial ripple
          const a = c.ang + (reduce ? 0 : Math.sin(t * m.swaySpd + c.ph * 1.5) * 0.2 + m.rot);
          const rr = c.dist * m.br + rwob;
          const px = cxp + Math.cos(a) * rr;
          const py = cyp + Math.sin(a) * rr;
          const shimmer = reduce ? 0.85 : 0.6 + 0.4 * Math.sin(t * 0.9 + c.ph * 2);
          ctx.globalAlpha = Math.min(1, m.base * shimmer * (c.core ? 1.25 : 0.92));
          ctx.fillRect(px - CELL / 2, py - CELL / 2, CELL - 0.4, CELL - 0.4);
        }
        m.rect = { x: cxp - REACH, y: cyp - REACH, w: REACH * 2, h: REACH * 2 };
      }
      ctx.globalAlpha = 1;
    }

    // Single scheduler: run continuously when animated, or on demand (reduced
    // motion) — and always while a machine is being dragged.
    let raf = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(loop); }
    function loop(now) {
      raf = 0;
      frame(now);
      if (!reduce || forceLoop) schedule();
    }

    // A machine is grabbable/clickable only where the dark background shows through
    // (not under a card or control) — panel clicks always win.
    const overMachine = (cx, cy) => {
      for (let i = machines.length - 1; i >= 0; i--) {
        const r = machines[i].rect;
        if (r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return machines[i];
      }
      return null;
    };
    const BLOCK = '.panel, .cf-card, .cf-viewer, .cf-std, table, button, a, label,'
      + ' input, textarea, select, dialog, .ck-modal__panel, .ck-modal-ov,'
      + ' .brand-hero, footer, [role="dialog"], [role="button"]';
    const isBackground = (cx, cy) => {
      const el = document.elementFromPoint(cx, cy);
      return !el || !el.closest(BLOCK);
    };

    let moveRaf = 0, lastX = 0, lastY = 0;
    const onDown = (e) => {
      suppressClick = false;
      const hit = overMachine(e.clientX, e.clientY);
      if (!hit || !isBackground(e.clientX, e.clientY)) return;
      e.preventDefault(); // no text/image selection while grabbing
      dragging = hit; hit.drag = true;
      hit.dragX = hit.wx; hit.dragY = hit.wy;
      const pwx = e.clientX + window.scrollX, pwy = e.clientY + window.scrollY;
      grabOX = hit.wx - pwx; grabOY = hit.wy - pwy;
      dragTargetX = hit.wx; dragTargetY = hit.wy;
      downX = e.clientX; downY = e.clientY; dragMoved = false;
      document.body.style.cursor = 'grabbing';
      forceLoop = true; schedule();
    };
    const onMove = (e) => {
      lastX = e.clientX; lastY = e.clientY;
      if (dragging) {
        dragTargetX = e.clientX + window.scrollX + grabOX;
        dragTargetY = e.clientY + window.scrollY + grabOY;
        if (!dragMoved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) dragMoved = true;
        document.body.style.cursor = 'grabbing';
        return;
      }
      if (moveRaf) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        const hit = overMachine(lastX, lastY);
        document.body.style.cursor = hit && isBackground(lastX, lastY) ? 'grab' : '';
      });
    };
    const onUp = () => {
      if (!dragging) return;
      const m = dragging; dragging = null;
      // resume the drift smoothly from the drop point (no snap-back)
      const t = lastNow / 1000;
      m.bx = m.dragX - Math.sin(t * m.spdX + m.phX) * m.ampX;
      m.by = m.dragY - Math.cos(t * m.spdY + m.phY) * m.ampY;
      m.drag = false;
      forceLoop = false;
      if (dragMoved) suppressClick = true; // a drag shouldn't also open the modal
      document.body.style.cursor = 'grab';
    };
    const onClick = (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const hit = overMachine(e.clientX, e.clientY);
      if (hit && isBackground(e.clientX, e.clientY)) {
        document.body.style.cursor = '';
        onPick?.(hit.item.id);
      }
    };

    resize();
    schedule();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp, { passive: true });
    window.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(raf); if (moveRaf) cancelAnimationFrame(moveRaf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('click', onClick);
      document.body.style.cursor = '';
    };
  });
</script>

<canvas class="pixelfield" bind:this={canvas} aria-hidden="true"></canvas>

<style>
  .pixelfield {
    position: fixed;
    inset: 0;
    z-index: -1;          /* above the page's dark gradient, below all content */
    pointer-events: none; /* clicks are hit-tested manually so panels always win */
  }
</style>

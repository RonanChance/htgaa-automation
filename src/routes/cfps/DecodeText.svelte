<script>
  // Cinematic "programmer decode": the line arrives scrambled in random glyphs
  // and resolves left-to-right into the real text the first time it scrolls into
  // view. Respects prefers-reduced-motion (shows the final text immediately).
  import { onMount } from 'svelte';

  let { text = '', duration = 2600 } = $props();

  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&<>/\\|=+*·:;';
  const rnd = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
  const isStable = (c) => c === ' ' || c === '\n' || c === '—' || c === '–';

  let el = $state(null);
  let display = $state(text);   // SSR + pre-hydration render the real text
  let done = $state(false);
  let played = false;

  function run() {
    if (played) return;
    played = true;
    const chars = Array.from(text);
    const n = chars.length;
    // stagger each character's settle time L→R across the window, with a little
    // jitter so the resolve reads organic rather than a hard sweeping wipe.
    const denom = Math.max(1, n - 1);
    const settle = chars.map(
      (_, i) => (i / denom) * duration * 0.82 + Math.random() * (duration * 0.18)
    );
    const start = performance.now();
    const tick = (nowT) => {
      const t = nowT - start;
      let out = '';
      let allDone = true;
      for (let i = 0; i < n; i++) {
        const c = chars[i];
        if (isStable(c) || t >= settle[i]) out += c;
        else { out += rnd(); allDone = false; }
      }
      display = out;
      if (allDone) { display = text; done = true; }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onMount(() => {
    if (typeof window === 'undefined') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { display = text; done = true; return; }
    // hold the line fully scrambled until it enters view, then decode once
    display = Array.from(text).map((c) => (isStable(c) ? c : rnd())).join('');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { run(); io.disconnect(); break; }
        }
      },
      { threshold: 0.55 }
    );
    if (el) io.observe(el);
    return () => io.disconnect();
  });
</script>

<p bind:this={el} class="decode-text" class:decode-text--done={done} aria-label={text}>
  <span aria-hidden="true">{display}</span><span class="decode-caret" aria-hidden="true"></span>
</p>

<style>
  .decode-text {
    margin: 0;
    font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
    font-size: clamp(13px, 1.85vw, 22px);
    line-height: 1.55;
    letter-spacing: 0.02em;
    color: #eaf6ee;
    text-shadow: 0 0 18px rgba(75, 224, 143, 0.28);
    /* keep the box height stable while glyphs flicker */
    white-space: pre-wrap;
    word-break: break-word;
  }
  .decode-caret {
    display: inline-block;
    width: 0.55ch;
    height: 1.05em;
    margin-left: 0.12em;
    vertical-align: text-bottom;
    background: #4be08f;
    box-shadow: 0 0 12px rgba(75, 224, 143, 0.7);
    animation: decode-caret-blink 1s steps(1, end) infinite;
  }
  .decode-text--done .decode-caret { opacity: 0.5; }
  @keyframes decode-caret-blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .decode-text { text-shadow: none; }
    .decode-caret { animation: none; opacity: 0.5; }
  }
</style>

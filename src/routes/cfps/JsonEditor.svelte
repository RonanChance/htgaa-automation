<script>
  // Plain monospace JSON textarea shared by the reagent and literature JSON views:
  // Tab / Shift+Tab indent by two spaces instead of moving focus, no spellcheck.
  import { tick } from 'svelte';

  let { value = $bindable(''), invalid = false, height = 420, label = 'JSON' } = $props();
  let el = $state(null);

  // Scroll to the LAST occurrence of `needle` and put the caret right after it —
  // used after appending a blank entry so it lands in view, ready to type into.
  export async function revealLast(needle) {
    await tick();
    if (!el) return;
    const i = el.value.lastIndexOf(needle);
    if (i < 0) return;
    const pos = i + needle.length;
    el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
    const line = el.value.slice(0, pos).split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
    el.scrollTop = Math.max(0, (line - 1) * lineHeight - el.clientHeight / 3);
  }

  function onkeydown(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value: v } = el;
    if (e.shiftKey) {
      const lineStart = v.lastIndexOf('\n', a - 1) + 1;
      if (v.slice(lineStart, lineStart + 2) !== '  ') return;
      value = v.slice(0, lineStart) + v.slice(lineStart + 2);
      queueMicrotask(() => el.setSelectionRange(Math.max(lineStart, a - 2), Math.max(lineStart, b - 2)));
      return;
    }
    value = v.slice(0, a) + '  ' + v.slice(b);
    queueMicrotask(() => el.setSelectionRange(a + 2, a + 2));
  }
</script>

<textarea
  class="cf-in json-ed"
  bind:this={el}
  class:invalid
  style:height={`${height}px`}
  bind:value
  {onkeydown}
  spellcheck="false"
  autocomplete="off"
  aria-label={label}
></textarea>

<style>
  .json-ed {
    width: 100%; min-height: 140px; resize: vertical; box-sizing: border-box;
    padding: 8px 10px; font: 11px/1.5 var(--mono); tab-size: 2; white-space: pre; overflow: auto;
  }
  .json-ed.invalid { border-color: var(--err); }
</style>

<script>
  // Small ⚠ marker for a composition that trips the autonomous-cfps range checks
  // ($lib/cfpsRangeChecks.js). Hover / focus shows the findings. The popover is
  // position:fixed (placed from the badge's rect) so it isn't clipped by the
  // comparison table's horizontal scroller or sticky header cells.
  //
  // alerts: { warnCount, infoCount, lines: [{ kind: 'warn' | 'info', text, name?, bullets?, group? }] } | null
  // A line with name + bullets shows as a bold reagent name over short bullets; otherwise as text.
  import { SITE_BAND } from '$lib/cfpsRangeChecks.js';
  let { alerts = null, compact = false } = $props();

  let open = $state(false);
  let pos = $state({ top: 0, left: 0, above: false });
  let badgeEl = $state(null);

  const POP_W = 320;
  const popId = `rab-${Math.random().toString(36).slice(2, 9)}`;

  function show() {
    if (!badgeEl) return;
    const r = badgeEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - POP_W / 2, vw - POP_W - 8));
    const above = r.bottom + 220 > vh && r.top > 220;
    pos = { top: above ? r.top - 6 : r.bottom + 6, left, above };
    open = true;
  }
  function hide() {
    open = false;
  }

  // Click copies the alert as plain text (title, design headers, name + bullets).
  let copied = $state(false);
  function alertText() {
    const out = [alerts.warnCount ? `Far outside reference range (${alerts.warnCount})` : 'Range notes'];
    alerts.lines.forEach((l, i) => {
      if (l.group && l.group !== alerts.lines[i - 1]?.group) out.push('', l.group);
      if (l.bullets) out.push(l.name, ...l.bullets.map((b) => `  - ${b}`));
      else out.push(`- ${l.text}`);
    });
    return out.join('\n');
  }
  async function copy(e) {
    e.stopPropagation();
    const text = alertText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // non-secure origin or blocked permission: fall back to a hidden textarea
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // Render the popover as a child of <body>: sticky table headers create their own
  // stacking contexts, which would otherwise paint cells over a fixed popover.
  function portal(node) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

{#if alerts && (alerts.warnCount || alerts.infoCount)}
  {@const warn = alerts.warnCount > 0}
  <!-- title="" stops the browser inheriting an ancestor's native tooltip (e.g. a
       community card's rationale) on top of this popover. -->
  <button
    type="button"
    title=""
    bind:this={badgeEl}
    class="rab"
    class:rab--info={!warn}
    class:rab--compact={compact}
    aria-describedby={open ? popId : undefined}
    aria-label={warn
      ? `${alerts.warnCount} range alert${alerts.warnCount === 1 ? '' : 's'}`
      : `${alerts.infoCount} range note${alerts.infoCount === 1 ? '' : 's'}`}
    onmouseenter={show}
    onmouseleave={hide}
    onfocus={show}
    onblur={hide}
    onclick={copy}
    onkeydown={(e) => e.key === 'Escape' && hide()}
  >{warn ? '⚠' : 'ⓘ'}{#if !compact && warn}<span class="rab__n">{alerts.warnCount}</span>{/if}</button>
  {#if open}
    <div
      use:portal
      id={popId}
      class="rab-pop"
      class:rab-pop--above={pos.above}
      style="top:{pos.top}px;left:{pos.left}px;width:{POP_W}px;"
      role="tooltip"
    >
      <b class="rab-pop__ttl">
        {warn
          ? `Far outside reference range (${alerts.warnCount})`
          : 'Range notes'}
      </b>
      <ul class="rab-pop__list">
        {#each alerts.lines as line, i}
          {#if line.group && line.group !== alerts.lines[i - 1]?.group}
            <li class="rab-pop__grp rab-pop__design">{line.group}</li>
          {/if}
          <li class:rab-pop__info={line.kind !== 'warn'} class:rab-pop__grp={line.bullets}>
            {#if line.bullets}
              <b>{line.name}</b>
              <ul class="rab-pop__sub">
                {#each line.bullets as b}<li>{b}</li>{/each}
              </ul>
            {:else}{line.text}{/if}
          </li>
        {/each}
      </ul>
      <p class="rab-pop__foot">Only flags missing essentials or values over {SITE_BAND.high}× the reference controls.</p>
      <p class="rab-pop__foot rab-pop__copy">{copied ? 'Copied ✓' : 'Click to copy'}</p>
    </div>
  {/if}
{/if}

<style>
  .rab {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 5px;
    height: 16px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 16px;
    font-weight: 600;
    color: #8a5a00;
    background: #fff3d1;
    border: 1px solid #f0c860;
    cursor: help;
    font-family: inherit;
    white-space: nowrap;
    vertical-align: middle;
    user-select: none;
  }
  .rab:focus-visible {
    outline: 2px solid #f0c860;
    outline-offset: 1px;
  }
  .rab--info {
    color: #3c5a72;
    background: #eef4f8;
    border-color: #b9cfdd;
  }
  .rab--compact {
    padding: 0 3px;
  }
  .rab__n {
    font-variant-numeric: tabular-nums;
  }
  .rab-pop {
    position: fixed;
    z-index: 1000;
    padding: 8px 10px;
    background: #fffdf6;
    border: 1px solid #f0d590;
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
    font-size: 11px;
    line-height: 1.4;
    color: #2b2b2b;
    text-align: left;
    white-space: normal;
    pointer-events: none;
  }
  .rab-pop--above {
    transform: translateY(-100%);
  }
  .rab-pop__ttl {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    color: #8a5a00;
  }
  .rab-pop__list {
    margin: 0;
    padding-left: 14px;
  }
  .rab-pop__list li + li {
    margin-top: 3px;
  }
  .rab-pop__grp {
    list-style: none;
    margin-left: -14px;
  }
  .rab-pop__copy {
    margin-top: 2px;
    color: #8a5a00;
  }
  .rab-pop__design {
    margin-top: 4px;
    font-size: 10px;
    color: #8b8b8b;
    overflow-wrap: anywhere;
  }
  .rab-pop__sub {
    margin: 1px 0 0;
    padding-left: 14px;
    list-style: disc;
  }
  .rab-pop__info {
    color: #5b6b78;
  }
  .rab-pop__foot {
    margin: 6px 0 0;
    font-size: 10px;
    color: #8b8b8b;
  }
</style>

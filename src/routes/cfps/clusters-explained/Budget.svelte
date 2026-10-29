<script>
  // Chapter 8's punchline: every design submitted, against the compositions the model
  // actually schedules, against the wells there are.
  import { PLATES_PER_TARGET, PER_PLATE } from '../plateMap.js';
  import { ROLE_STYLE } from './colors.js';

  let { totals, target } = $props();
  const CAP = PLATES_PER_TARGET * PER_PLATE;

  const parts = $derived([
    { key: 'first', n: totals.firstRuns },
    { key: 'check', n: totals.checkRuns },
    { key: 'independent', n: totals.independentRuns },
    { key: 'sweep', n: totals.sweepRuns }
  ]);
  const max = $derived(Math.max(totals.designs, CAP));
  const w = (v) => `${(v / max) * 100}%`;
</script>

<div class="budget">
  <div class="brow">
    <span class="lbl">designs submitted</span>
    <div class="track"><i style="width:{w(totals.designs)}; background:var(--blue); opacity:.45"></i>
      <span class="cap" style="left:{w(CAP)}"></span></div>
    <b>{totals.designs}</b>
  </div>
  <div class="brow">
    <span class="lbl">tested compositions</span>
    <div class="track">
      {#each parts as p}
        <i style="width:{w(p.n)}; background:{ROLE_STYLE[p.key].color}" title="{ROLE_STYLE[p.key].label}: {p.n}"></i>
      {/each}
      <span class="cap" style="left:{w(CAP)}"></span>
    </div>
    <b class:y={totals.runsInAll <= CAP}>{totals.runsInAll}</b>
  </div>
  <div class="brow capnote">
    <span></span>
    <div class="capline"><span style="left:{w(CAP)}">{CAP} designs fit: {PLATES_PER_TARGET} plates × {PER_PLATE}, 4 replicates each</span></div>
    <span></span>
  </div>
  <ul class="fig-legend">
    {#each parts as p}
      <li><i class="sw" style="background:{ROLE_STYLE[p.key].color}"></i>{p.n} {ROLE_STYLE[p.key].label}s</li>
    {/each}
  </ul>
  <p class="fig-note">
    {totals.designs - totals.runsInAll} {target} designs don’t need a run of their own: their group’s runs are
    expected to speak for them, or someone else submitted the identical composition.
    {totals.runsInAll <= CAP ? `The plan fits, with ${CAP - totals.runsInAll} to spare.` : `That is ${totals.runsInAll - CAP} more than fits, so the planner has to trim.`}
  </p>
</div>

<style>
  .brow { display: grid; grid-template-columns: 9.5em 1fr 3.5em; gap: 10px; align-items: center; margin: 8px 0; }
  .lbl { font: 12px var(--sans); color: var(--dim); }
  .track { position: relative; display: flex; height: 22px; background: var(--fig-2); border-radius: 3px; }
  .track i { display: block; height: 100%; transition: width .8s var(--ease); }
  .cap { position: absolute; top: -5px; bottom: -5px; width: 2px; background: var(--white); }
  .brow b { font: 600 15px var(--mono); text-align: right; }
  .capnote { margin-top: -4px; }
  .capline { position: relative; height: 16px; font: 10.5px var(--mono); color: var(--faint); }
  .capline span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
</style>

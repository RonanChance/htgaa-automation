<script>
  // Chapter 8: how one group's designs become tested compositions.
  //   view 'odds'    every member by its odds of beating Ginkgo's best; the
  //                  best is the first test
  //   'info'         spread across by new information, 1 − r² with the first
  //                  run, recomputed here from the model
  //   'checks'       what the model thinks matters in the group, and the
  //                  check test as the member furthest from the first test on it
  import { link } from '$lib/clusterMath.js';
  import { ROLE_STYLE } from './colors.js';

  // `pick` (the group) is owned by the page so it survives moving between this
  // chapter's steps; `reagent` is the deck's shared reagent.
  let { model, data, ds, view = 'odds', pick = $bindable(null), reagent = null, setReagent = null } = $props();

  const gp = $derived(model.gp);
  const S = $derived(model.settings);
  // Groups worth looking at: several distinct compositions and at least one check.
  const choices = $derived(
    data.groups.map((g, gi) => ({ ...g, gi }))
      .filter((g) => g.members.length >= 4 && g.checks.length)
      .sort((a, b) => b.members.length - a.members.length)
  );
  $effect(() => { if (pick == null || !choices.some((c) => c.gi === pick)) pick = choices[0]?.gi ?? null; });
  const g = $derived(pick == null ? null : data.groups[pick]);

  const rows = $derived.by(() => {
    if (!g) return [];
    const f = ds[g.first];
    return g.members.map((i) => {
      const r = i === g.first ? 1 : link(gp, S, f, ds[i]).r;
      const d = data.designs[i];
      const chk = g.checks.find((c) => c.i === i);
      return { i, r, info: Math.max(0, 1 - r * r), p: d.p, role: d.role, chk };
    });
  });

  const W = 640, H = 270, PL = 46, PR = 16, PT = 16, PB = 36;
  const pMax = $derived(Math.max(0.02, ...rows.map((r) => r.p)) * 1.12);
  // a little inset so the first test's star clears the y-axis labels
  const sx = (v) => PL + 14 + v * (W - PL - PR - 14);
  const sy = (v) => PT + (1 - v / pMax) * (H - PT - PB);
  // In the odds view everyone sits in one column, jittered so they don't stack.
  const jitter = (i) => (((i * 2654435761) >>> 0) % 1000) / 1000;
  const xOf = (row) => (view === 'odds' ? sx(0.5) + (jitter(row.i) - 0.5) * 160 : sx(row.info));
  let hover = $state(null);
  const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

  const strengthColor = { strong: 'var(--yellow)', moderate: 'var(--teal)', weak: 'var(--blue)', negligible: 'var(--faint)' };
  const cMax = $derived(Math.max(0.3, ...(g?.ingredients ?? []).map((i) => Math.abs(i.coefficient))));

  // The top ingredient's amounts across the group, first test and check marked
  // — or the shared reagent's, when it is one of the group's top two.
  const axis = $derived.by(() => {
    if (!g?.axes?.length) return null;
    const a = g.axes.find((x) => x.reagent === reagent) ?? g.axes[0];
    const k = g.members.indexOf(g.first);
    const firstNl = a.nl[k];
    const chk = g.checks.find((c) => c.ingredient === a.name);
    const max = Math.max(1, ...a.nl) * 1.08;
    return { ...a, firstNl, chk, max };
  });
</script>

{#if !g}
  <p class="fig-note">No group with check tests for this protein.</p>
{:else}
  <div class="fig-controls">
    <label class="grow">group
      <select bind:value={pick}>
        {#each choices as c}
          <!-- ★ marks groups where the deck's reagent is one of the top two ingredients -->
          <option value={c.gi}>{c.axes.some((x) => x.reagent === reagent) ? '★ ' : ''}{c.letter} · {c.name} ({c.members.length})</option>
        {/each}
      </select>
    </label>
  </div>

  {#if view !== 'checks'}
    <svg viewBox="0 0 {W} {H}" class="fig-svg" role="img" aria-label="Members of group {g.letter} by odds and new information">
      {#each [0, 0.25, 0.5, 0.75, 1] as v}
        <line x1={sx(v)} x2={sx(v)} y1={PT} y2={H - PB} class="gl" class:hide={view === 'odds'} />
        {#if view !== 'odds'}<text x={sx(v)} y={H - PB + 14} text-anchor="middle" class="axt">{v * 100}%</text>{/if}
      {/each}
      <text x={PL - 6} y={sy(0) + 4} text-anchor="end" class="axt">0%</text>
      <text x={PL - 6} y={sy(pMax / 1.12) + 4} text-anchor="end" class="axt">{pct(pMax / 1.12)}</text>
      <text x={PL} y={PT - 4} class="axt">odds of beating Ginkgo's best ↑</text>
      {#if view !== 'odds'}<text x={W - PR} y={H - 6} text-anchor="end" class="axt">new information vs the first test, 1 − r² →</text>{/if}
      {#each rows as row (row.i)}
        {@const st = ROLE_STYLE[row.role] ?? ROLE_STYLE.follows}
        <g class="m" style="transform: translate({xOf(row)}px, {sy(row.p)}px)"
          role="button" tabindex="0" aria-label="{st.label}, odds {pct(row.p)}"
          onpointerenter={() => (hover = row)} onpointerleave={() => (hover = null)}>
          {#if row.i === g.first}
            <path d="M0,-10 L2.9,-3.1 10,-3.1 4.3,1.4 6.2,8.5 0,4.3 -6.2,8.5 -4.3,1.4 -10,-3.1 -2.9,-3.1Z" fill={st.color} />
          {:else}
            <circle r={row.chk ? 6.5 : 4.5} fill={row.chk ? 'none' : st.color} stroke={st.color} stroke-width={row.chk ? 2.4 : 0}
              opacity={row.role === 'follows' ? 0.7 : 1} />
          {/if}
        </g>
      {/each}
    </svg>
    <div class="fig-readout">
      {#if hover}
        <span>{(ROLE_STYLE[hover.role] ?? ROLE_STYLE.follows).label}</span>
        <span>odds <b class="y">{pct(hover.p)}</b></span>
        {#if hover.i !== g.first}
          <span>link with first test <b>{hover.r.toFixed(2)}</b></span>
          <span>new information <b>{pct(hover.info)}</b></span>
        {/if}
        {#if hover.chk}<span>checks <b>{hover.chk.ingredient}</b> {hover.chk.from} → {hover.chk.nL} nL</span>{/if}
      {:else}
        <span class="dim">hover a design</span>
      {/if}
    </div>
    <ul class="fig-legend">
      {#each ['first', 'check', 'follows', 'sweep', 'independent'] as r}
        {#if rows.some((x) => x.role === r)}
          <li><i class="sw" style="background:{ROLE_STYLE[r].color}"></i>{ROLE_STYLE[r].label}</li>
        {/if}
      {/each}
    </ul>
  {:else}
    <div class="matters">
      <span class="k">what the model thinks matters in group {g.letter} · from {g.virtualRecipes ?? 160} virtual compositions</span>
      {#each g.ingredients as ing}
        <button type="button" class="brow" class:sel={ing.reagent === reagent}
          title="Show {ing.name} across the deck" onclick={() => setReagent?.(ing.reagent)}>
          <span class="nm">{ing.name}{ing.priceOnly ? ' · price only' : ''}</span>
          <div class="track">
            <span class="mid"></span>
            <i style="{ing.coefficient < 0 ? `right:50%` : `left:50%`}; width:{(Math.abs(ing.coefficient) / cMax) * 50}%; background:{strengthColor[ing.strength] ?? 'var(--faint)'}"></i>
          </div>
          <span class="v">{ing.coefficient > 0 ? '+' : ''}{ing.coefficient.toFixed(2)}</span>
        </button>
      {/each}
      <div class="ends"><span>← more makes it cheaper per gram</span><span>dearer per gram →</span></div>
      {#if g.explains != null}
        <p class="r2">single ingredients account for <b>{pct(g.explains)}</b> of the predicted differences
          {#if g.explains < 0.6}<i class="warn">— the rest is interactions, so one-at-a-time checks can mislead</i>{/if}</p>
      {/if}
    </div>
    {#if axis}
      <svg viewBox="0 0 {W} 94" class="fig-svg" role="img" aria-label="Group members along {axis.name}">
        <line x1={PL} x2={W - PR} y1="44" y2="44" class="gl" />
        {#each axis.nl as v, k}
          <circle cx={PL + (v / axis.max) * (W - PL - PR)} cy="44" r="5" class="mem" />
        {/each}
        <circle cx={PL + (axis.firstNl / axis.max) * (W - PL - PR)} cy="44" r="8" fill="var(--yellow)" />
        <text x={PL + (axis.firstNl / axis.max) * (W - PL - PR)} y="26" text-anchor="middle" class="lab y">first test {axis.firstNl} nL</text>
        {#if axis.chk}
          {@const cx = PL + (axis.chk.nL / axis.max) * (W - PL - PR)}
          <circle cx={cx} cy="44" r="9" fill="none" stroke="var(--teal)" stroke-width="2.4" />
          <text x={cx} y="72" text-anchor={cx > W - 140 ? 'end' : cx < PL + 140 ? 'start' : 'middle'} class="lab t">check test {axis.chk.nL} nL · {axis.chk.gain}% new</text>
        {/if}
        <text x={PL} y="88" class="axt">0 → {Math.round(axis.max)} nL · {axis.name}</text>
      </svg>
    {/if}
  {/if}
{/if}

<style>
  .gl { stroke: var(--line); }
  .gl.hide { opacity: 0; }
  .axt { fill: var(--faint); font: 10.5px var(--mono); }
  .m { transition: transform .9s var(--ease); cursor: help; }
  .m:focus-visible { outline: none; }
  .dim { color: var(--faint); }
  .matters .k { font: 11px var(--mono); color: var(--dim); display: block; margin-bottom: 6px; }
  .matters .brow {
    display: grid; grid-template-columns: minmax(120px, 15em) 1fr 4em; gap: 8px; align-items: center;
    width: 100%; margin: 2px 0; padding: 2px 4px; text-align: left; cursor: pointer;
    background: none; border: 1px solid transparent; border-radius: 3px; color: inherit; font: inherit;
  }
  .matters .brow:hover { border-color: var(--line); }
  .matters .brow.sel { border-color: var(--yellow); }
  .matters .nm { font: 12px var(--sans); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .matters .track { position: relative; height: 12px; background: var(--fig-2); border-radius: 2px; }
  .matters .track i { position: absolute; top: 0; bottom: 0; border-radius: 2px; transition: width .5s; }
  .matters .mid { position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: var(--faint); }
  .matters .v { font: 11px var(--mono); color: var(--dim); text-align: right; }
  .ends { display: flex; justify-content: space-between; font: 10px var(--mono); color: var(--faint); margin: 2px 4em 0 calc(min(15em, 120px) + 8px); }
  .r2 { font: 12.5px/1.5 var(--sans); color: var(--dim); margin: 10px 0 4px; }
  .r2 b { color: var(--text); }
  .warn { color: var(--gold); font-style: normal; }
  .mem { fill: var(--blue); opacity: .55; }
  .lab { font: 11px var(--mono); }
  .lab.y { fill: var(--yellow); }
  .lab.t { fill: var(--teal); }
</style>

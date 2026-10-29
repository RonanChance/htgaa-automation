<script>
  // Chapter 7: how many experiments n linked designs are really worth. For n
  // designs all linked at ρ the participation ratio is n / (1 + (n−1)ρ²); the
  // figure draws n dots, their links, and that many "independent" dots lit.
  import { nEff } from '$lib/clusterMath.js';

  let { R = null, n: N = 0, groups = null, step = 0 } = $props();

  let n = $state(12);
  let rho = $state(0.6);
  const eff = $derived(n / (1 + (n - 1) * rho * rho));

  const C = 150, RAD = 112;
  const at = (i) => [C + RAD * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), C + RAD * Math.sin((2 * Math.PI * i) / n - Math.PI / 2)];

  // Real data: the whole set, and the biggest groups.
  const whole = $derived(R ? nEff(R, N) : null);
  const top = $derived(
    R && groups
      ? groups.map((g) => ({
        letter: g.letter, name: g.name, also: g.also, size: g.members.length, eff: nEff(R, N, g.members),
        link: g.averageLink, untested: g.fromUntested, similar: g.fromSimilar
      }))
        .sort((a, b) => b.size - a.size).slice(0, 10)
      : []
  );
  const maxSize = $derived(Math.max(1, ...top.map((t) => t.size)));
  let hover = $state(null);
  // What a group's "worth" means for planning, in a sentence.
  const runsFor = (eff) => (eff < 1.5 ? 'its first test alone' : eff < 2.5 ? 'a first test and a check test' : `about ${Math.round(eff)} tests`);
</script>

{#if step === 0 || !R}
  <div class="fig-controls">
    <label class="grow">designs n <b class="y">{n}</b>
      <input type="range" min="2" max="30" step="1" bind:value={n} />
    </label>
    <label class="grow">each pair linked ρ <b class="y">{rho.toFixed(2)}</b>
      <input type="range" min="0" max="1" step="0.01" bind:value={rho} />
    </label>
  </div>
  <div class="toy">
    <svg viewBox="0 0 300 300" class="neff-ring" role="img" aria-label="{n} designs, every pair linked {rho.toFixed(2)}">
      {#each Array(n) as _, i}
        {#each Array(n) as _2, j}
          {#if j > i}
            {@const a = at(i)}{@const b = at(j)}
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} class="lk" style="opacity:{rho * rho * 0.5}" />
          {/if}
        {/each}
      {/each}
      {#each Array(n) as _, i}
        {@const p = at(i)}
        <circle cx={p[0]} cy={p[1]} r="8" class="d" class:lit={i < Math.round(eff)} />
      {/each}
    </svg>
    <div class="big">
      <span class="k">worth about</span>
      <b>{eff.toFixed(1)}</b>
      <span class="k">independent experiments</span>
      <p>With ρ = 0 every design is its own experiment. With ρ = 1 they are all the same
        experiment, repeated {n} times. In between, each pair counts by ρ², the share of variance two
        designs have in common.</p>
    </div>
  </div>
{:else}
  <div class="real">
    <div class="big">
      <span class="k">all {N} designs are worth about</span>
      <b>{whole.toFixed(1)}</b>
      <span class="k">independent experiments</span>
    </div>
    <div class="bars">
      <span class="k">the largest groups: designs vs what they are worth · hover a group</span>
      {#each top as t}
        <div class="brow" role="button" tabindex="0" aria-label="Group {t.letter}: {t.size} designs, worth {t.eff.toFixed(1)}"
          onpointerenter={() => (hover = t)} onpointerleave={() => (hover = null)}
          onfocus={() => (hover = t)} onblur={() => (hover = null)}>
          <span class="lt">{t.letter}</span>
          <div class="track">
            <i class="sz" style="width:{(t.size / maxSize) * 100}%"></i>
            <i class="ef" style="width:{(t.eff / maxSize) * 100}%"></i>
          </div>
          <span class="nm">{t.size} → {t.eff.toFixed(1)}</span>
        </div>
      {/each}
      {#if hover}
        <div class="gcard" role="tooltip">
          <b>{hover.letter} · {hover.name}{hover.also ? ` · plus ${hover.also}` : ''}</b>
          <p><span class="y">{hover.size} designs</span> that behave like about
            <span class="y">{hover.eff.toFixed(1)}</span> independent experiment{hover.eff.toFixed(1) === '1.0' ? '' : 's'}.</p>
          <p>{hover.untested > hover.similar
            ? `They share a change no plate ever ran (${hover.untested.toFixed(2)} of their ${hover.link.toFixed(2)} average link), so they rise or fall together on it.`
            : `Their compositions are close to each other (${hover.similar.toFixed(2)} of their ${hover.link.toFixed(2)} average link), so the model expects similar results.`}</p>
          <p>So {runsFor(hover.eff)} should tell you most of what all {hover.size} would.{hover.size / hover.eff > 8 ? ' Many of them are near-copies.' : ''}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .toy, .real { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .neff-ring { width: 300px; max-width: 100%; flex: none; }
  .lk { stroke: var(--teal); stroke-width: 1; }
  .d { fill: var(--fig-2); stroke: var(--blue); stroke-width: 1.5; transition: fill .3s; }
  .d.lit { fill: var(--yellow); stroke: var(--yellow); }
  .big { flex: 1; min-width: 200px; }
  .big b { display: block; font: 600 52px/1.05 var(--mono); color: var(--yellow); }
  .k { font: 11px var(--mono); color: var(--dim); }
  .big p { font: 13px/1.55 var(--sans); color: var(--dim); }
  .bars { flex: 1.4; min-width: 260px; position: relative; }
  .bars .brow { cursor: help; border-radius: 3px; padding: 1px 3px; }
  .bars .brow:hover, .bars .brow:focus-visible { background: var(--fig-2); outline: none; }
  .gcard {
    margin-top: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--fig-2);
    font: 12.5px/1.5 var(--sans); color: var(--dim);
  }
  .gcard b { display: block; font: 600 12px var(--mono); color: var(--text); margin-bottom: 4px; }
  .gcard p { margin: 0 0 4px; }
  .brow { display: grid; grid-template-columns: 2.6em 1fr 6.5em; gap: 8px; align-items: center; margin-top: 5px; }
  .lt { font: 600 11px var(--mono); color: var(--text); }
  .track { position: relative; height: 12px; background: var(--fig-2); border-radius: 2px; }
  .track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; }
  .sz { background: var(--blue); opacity: .3; }
  .ef { background: var(--yellow); }
  .nm { font: 11px var(--mono); color: var(--dim); text-align: right; }
</style>

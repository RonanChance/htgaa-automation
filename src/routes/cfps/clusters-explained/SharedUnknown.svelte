<script>
  // Chapter 4: the part of a link the GP can't see. Two designs from a group
  // held together by an ingredient no plate ever ran, their link split into
  // composition similarity (blue) and the shared unknown (red), with switches to
  // take the shared change away and a dial for how unsure the model is about
  // untested reagents — which regroups every design live.
  import { link, shockVar, completeLinkage, groupsAt } from '$lib/clusterMath.js';
  import { heat } from './colors.js';

  let { model, data, ds, step = 0 } = $props();

  const gp = $derived(model.gp);
  const S = $derived(model.settings);
  const nameOf = (id) => data.novelNames[id] ?? id;

  // Groups whose link is mostly a shared untested change.
  const bets = $derived(
    data.groups
      .map((g, gi) => ({ ...g, gi }))
      .filter((g) => g.fromUntested > 0.3 && g.members.length >= 2)
      .sort((a, b) => b.fromUntested * Math.min(b.members.length, 8) - a.fromUntested * Math.min(a.members.length, 8))
  );
  let pick = $state(null);
  $effect(() => { if (pick == null || !bets.some((b) => b.gi === pick)) pick = bets[0]?.gi ?? null; });
  const group = $derived(pick == null ? null : data.groups[pick]);

  // A: the first test. B: the member whose *composition* is least like A's, yet
  // still linked — the clearest case of "different compositions, same bet".
  const pair = $derived.by(() => {
    if (!group) return null;
    const a = group.first;
    let b = null, best = Infinity;
    for (const i of group.members) {
      if (i === a || data.designs[i].rc === data.designs[a].rc) continue;
      const l = link(gp, S, ds[a], ds[i]);
      if (l.gp < best) { best = l.gp; b = i; }
    }
    return b == null ? null : [a, b];
  });

  const shared = $derived.by(() => {
    if (!pair) return [];
    const [a, b] = pair;
    return ds[a].nd.filter((u) => ds[b].nd.some((w) => w.id === u.id && w.dir === u.dir));
  });
  // Shared changes switched off in B, by "id|dir".
  let off = $state(new Set());
  $effect(() => { pair; off = new Set(); });

  let lambda = $state(1);
  // B with some of its untested changes taken away (variance follows).
  const bLive = $derived.by(() => {
    if (!pair) return null;
    const b = ds[pair[1]];
    const nd = b.nd.filter((u) => !off.has(`${u.id}|${u.dir}`));
    let shock = 0;
    for (const u of nd) shock += shockVar(S, u.w, u.c);
    return { ...b, nd, shock, var: b.gpVar + lambda * shock };
  });
  const aLive = $derived(pair ? { ...ds[pair[0]], var: ds[pair[0]].gpVar + lambda * ds[pair[0]].shock } : null);
  const L = $derived(pair ? link(gp, S, aLive, bLive, lambda) : null);

  // ── regroup everything at this λ ────────────────────────────────────────
  let regroup = $state(null);
  let pending = null;
  const sig = (m) => [...m].sort((x, y) => x - y).join(',');
  const exportSigs = $derived(new Set(data.groups.map((g) => sig(g.members))));
  $effect(() => {
    const lam = lambda;
    if (step < 3) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      const n = ds.length;
      const scaled = ds.map((d) => ({ ...d, var: d.gpVar + lam * d.shock }));
      const R = new Float32Array(n * n);
      for (let a = 0; a < n; a++) {
        R[a * n + a] = 1;
        for (let b = 0; b < a; b++) R[a * n + b] = R[b * n + a] = link(gp, S, scaled[a], scaled[b], lam).r;
      }
      const labels = groupsAt(n, completeLinkage(n, R), 0.5, data.designs.map((d) => d.rc));
      const by = new Map();
      labels.forEach((l, i) => { if (l >= 0) { if (!by.has(l)) by.set(l, []); by.get(l).push(i); } });
      const same = [...by.values()].filter((m) => exportSigs.has(sig(m))).length;
      regroup = { lam, groups: by.size, same, loners: labels.filter((l) => l < 0).length };
    }, 60);
  });

  // Mini heatmaps of the group: composition similarity only vs the full link.
  const members = $derived(group ? group.members.slice(0, 36) : []);
  const mats = $derived.by(() => members.map((i) => members.map((k) => link(gp, S, ds[i], ds[k]))));
  const CELL = $derived(Math.max(4, Math.min(12, Math.floor(200 / Math.max(1, members.length)))));
  const toggle = (u) => {
    const k = `${u.id}|${u.dir}`;
    const next = new Set(off);
    next.has(k) ? next.delete(k) : next.add(k);
    off = next;
  };
  const arrow = (dir) => (dir > 0 ? '↑' : '↓');
</script>

{#if !bets.length}
  <p class="fig-note">No group for this protein is held together mainly by an untested reagent.</p>
{:else}
  <div class="fig-controls">
    <label class="grow">group
      <select bind:value={pick}>
        {#each bets as g}<option value={g.gi}>{g.letter} · {g.name} ({g.members.length})</option>{/each}
      </select>
    </label>
  </div>

  {#if pair && L}
    <div class="pair">
      {#each pair as i, k}
        {@const d = k === 0 ? aLive : bLive}
        <div class="dcard">
          <span class="who" style="color:{k ? 'var(--gold)' : 'var(--blue)'}">{k ? 'B' : 'A'}</span>
          <small>{k ? 'another design in the group' : 'the group’s first test'}</small>
          <div class="uchips">
            {#each ds[i].nd as u}
              {@const isShared = shared.some((w) => w.id === u.id && w.dir === u.dir)}
              {@const isOff = k === 1 && off.has(`${u.id}|${u.dir}`)}
              <span class="uchip" class:shared={isShared} class:off={isOff}>{nameOf(u.id)} {arrow(u.dir)}</span>
            {:else}
              <span class="uchip none">no untested changes</span>
            {/each}
          </div>
          <small class="dim">other changes from Ginkgo’s best: {data.designs[i].vs[3]} within the plates’ range · {data.designs[i].vs[1]} past it</small>
        </div>
      {/each}
    </div>

    <div class="decomp">
      <div class="dlabel"><span>link between A and B</span><b>{L.r.toFixed(2)}</b></div>
      <div class="lstack">
        <i class="gp" style="width:{Math.max(0, L.gp) * 100}%"></i>
        <i class="sh" style="width:{step >= 1 ? Math.max(0, L.shared) * 100 : 0}%"></i>
        <span class="half" title="the 0.5 a group needs"></span>
      </div>
      <div class="dkey">
        <span><i class="sw" style="background:var(--blue)"></i>composition similarity (GP) {L.gp.toFixed(2)}</span>
        {#if step >= 1}<span><i class="sw" style="background:var(--red)"></i>shared untested change {L.shared.toFixed(2)}</span>{/if}
        <span class="dim">│ = 0.5, the bar for a group</span>
      </div>
    </div>

    {#if step >= 2 && shared.length}
      <div class="switches">
        <span class="dim">What if B didn’t make the change too?</span>
        {#each shared as u}
          <button type="button" class="fig-btn" class:is-on={off.has(`${u.id}|${u.dir}`)} onclick={() => toggle(u)}>
            {off.has(`${u.id}|${u.dir}`) ? 'put back' : 'take away'} {nameOf(u.id)} {arrow(u.dir)}
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- only on their own step: the dial step needs the room on short screens -->
  {#if step === 2}
    <div class="minis">
      {#each [['composition similarity only', 'gp'], ['the full link', 'r']] as [title, key]}
        <figure>
          <svg width={members.length * CELL} height={members.length * CELL} role="img" aria-label="{title} heatmap for the group">
            {#each mats as row, a}
              {#each row as l, b}<rect x={b * CELL} y={a * CELL} width={CELL} height={CELL} fill={heat(l[key])} />{/each}
            {/each}
          </svg>
          <figcaption>{title}</figcaption>
        </figure>
      {/each}
    </div>
  {/if}

  {#if step >= 3}
    <div class="fig-controls lam">
      <label class="grow">untested-reagent variance × <b class="y">{lambda.toFixed(2)}</b>
        <input type="range" min="0" max="3" step="0.05" bind:value={lambda} />
      </label>
    </div>
    <div class="fig-readout">
      {#if regroup}
        <span>groups <b class="y">{regroup.groups}</b> <i class="dim">(export: {data.groups.length})</i></span>
        <span>identical to the export’s <b>{regroup.same}</b>/{data.groups.length}</span>
        <span>on their own <b>{regroup.loners}</b></span>
      {:else}
        <span class="dim">regrouping…</span>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .dcard { background: var(--fig-2); border: 1px solid var(--line); border-radius: 5px; padding: 9px 11px; }
  .who { font: 700 18px var(--mono); margin-right: 6px; }
  .dcard small { font: 11px var(--sans); color: var(--dim); }
  .dcard small.dim { display: block; margin-top: 6px; color: var(--faint); font-family: var(--mono); font-size: 10px; }
  .uchips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
  .uchip { font: 11px var(--mono); padding: 2px 6px; border-radius: 3px; border: 1px solid #5a2f2c; color: #f3b6b0; background: #2a1715; }
  .uchip.shared { border-color: var(--red); background: #3d1a17; color: #ffd2cd; }
  .uchip.off { text-decoration: line-through; opacity: .45; }
  .uchip.none { border-color: var(--line); background: none; color: var(--faint); }
  .decomp { margin-top: 14px; }
  .dlabel { display: flex; justify-content: space-between; align-items: baseline; font: 12px var(--sans); color: var(--dim); }
  .dlabel b { font: 600 26px var(--mono); color: var(--text); }
  .lstack { position: relative; display: flex; height: 16px; background: var(--fig-2); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; margin: 4px 0 6px; }
  .lstack i { display: block; height: 100%; transition: width .5s var(--ease); }
  .lstack .gp { background: var(--blue); }
  .lstack .sh { background: var(--red); }
  .half { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--white); opacity: .7; }
  .dkey { display: flex; flex-wrap: wrap; gap: 4px 16px; font: 11px var(--mono); color: var(--dim); }
  .dim { color: var(--faint); }
  .switches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; font: 12px var(--sans); }
  .minis { display: flex; gap: 22px; margin-top: 14px; flex-wrap: wrap; }
  .minis figure { margin: 0; }
  .minis svg { display: block; border: 1px solid var(--line); }
  .minis figcaption { font: 10.5px var(--mono); color: var(--dim); margin-top: 4px; }
  .fig-controls.lam { margin-top: 16px; }
</style>

<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';

  // Unified community reagent section: browse ideas ranked by upvotes, upvote the
  // ones you like, and suggest your own — all in one place. The suggestion payload
  // is a free-form dict (name, pH, concentration, category, link, description)
  // stored server-side. Anyone can browse; Keycloak sign-in is required to vote or
  // suggest, and one vote per user is enforced by a unique index on the votes
  // collection. The ranking is polled from /cfps/suggestions so it reorders in
  // near-real-time as others vote.
  let {
    suggestions: initialSuggestions = [],
    votedSuggestionIds = [],
    kcUser = null,
    kcConfigured = false,
    devMode = false,
    // When embedded (e.g. side-by-side with the reagent prompt) the card fills its
    // grid cell's height and the ranked list scrolls internally instead of growing.
    embedded = false
  } = $props();

  let items = $state(sortByVotes(initialSuggestions));
  let voted = $state(new Set(votedSuggestionIds));
  let busy = $state(new Set());
  let errorMsg = $state('');
  let pollTimer = null;

  // Suggest-a-reagent form state.
  let showSuggestForm = $state(false);
  let submitting = $state(false);
  let suggestMsg = $state('');
  let f = $state({ name: '', concentration: '', category: '', ph: '', link: '', description: '' });

  let kcNotice = $derived(page.url.searchParams.get('kc'));

  const CATEGORIES = ['Salts', 'Energy', 'Nucleotides', 'Cofactors', 'Redox', 'Buffers', 'Other'];

  // Keys rendered specially; everything else becomes a generic attribute tag.
  const TITLE_KEYS = ['name', 'reagent', 'title'];
  const PH_KEYS = ['ph', 'pH'];
  const CONC_KEYS = ['concentration', 'conc', 'stock', 'stock_conc', 'stock_concentration'];
  const CATEGORY_KEYS = ['category', 'cat', 'type', 'class'];
  const LINK_KEYS = ['link', 'url', 'href', 'reference', 'ref'];
  const NOTE_KEYS = ['description', 'notes', 'note', 'rationale', 'why'];
  const PROPOSER_KEYS = ['proposed_by', 'proposer', 'by', 'author'];

  function sortByVotes(list) {
    return [...(list || [])].sort(
      (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || String(a.created).localeCompare(String(b.created))
    );
  }

  function pick(dict, keys) {
    for (const k of Object.keys(dict || {})) {
      if (keys.some((want) => want.toLowerCase() === k.toLowerCase())) {
        const v = dict[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  }

  // Attributes left over after the special-cased keys are pulled out.
  function extraAttrs(dict) {
    const skip = new Set(
      [...TITLE_KEYS, ...PH_KEYS, ...CONC_KEYS, ...CATEGORY_KEYS, ...LINK_KEYS, ...NOTE_KEYS, ...PROPOSER_KEYS].map((k) => k.toLowerCase())
    );
    const out = [];
    for (const [k, v] of Object.entries(dict || {})) {
      if (skip.has(k.toLowerCase())) continue;
      if (v == null || String(v).trim() === '') continue;
      out.push({ k, v: String(v).trim() });
    }
    return out;
  }

  function titleFor(s) { return pick(s.suggestion, TITLE_KEYS) || 'Untitled reagent'; }
  function phFor(s) { return pick(s.suggestion, PH_KEYS); }
  function concFor(s) { return pick(s.suggestion, CONC_KEYS); }
  function categoryFor(s) { return pick(s.suggestion, CATEGORY_KEYS); }
  // Concentration + category as a single clean tag (values only, comma-separated).
  function specFor(s) { return [concFor(s), categoryFor(s)].filter(Boolean).join(', '); }
  function noteFor(s) { return pick(s.suggestion, NOTE_KEYS); }
  function proposerFor(s) { return pick(s.suggestion, PROPOSER_KEYS); }
  function linkFor(s) {
    const l = pick(s.suggestion, LINK_KEYS);
    if (!l) return '';
    return /^https?:\/\//i.test(l) ? l : `https://${l}`;
  }

  function applyData(data) {
    if (Array.isArray(data?.suggestions)) items = sortByVotes(data.suggestions);
    if (Array.isArray(data?.votedSuggestionIds)) voted = new Set(data.votedSuggestionIds);
  }

  async function refresh() {
    try {
      const res = await fetch('/cfps/suggestions', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      applyData(await res.json());
    } catch {
      // Silent — polling is best-effort; keep showing the last good ranking.
    }
  }

  async function toggleVote(s) {
    if (!kcUser || busy.has(s.id)) return;
    errorMsg = '';
    const action = voted.has(s.id) ? 'unvote' : 'vote';
    busy = new Set(busy).add(s.id);
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: s.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) errorMsg = data?.error || 'Could not record your vote.';
      else applyData(data);
    } catch {
      errorMsg = 'Network error — please try again.';
    } finally {
      const next = new Set(busy); next.delete(s.id); busy = next;
    }
  }

  async function submitSuggestion() {
    if (!kcUser || submitting) return;
    suggestMsg = '';
    if (!f.name.trim()) { suggestMsg = 'Reagent name is required.'; return; }
    submitting = true;
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'suggest',
          suggestion: {
            name: f.name, concentration: f.concentration, category: f.category,
            ph: f.ph, link: f.link, description: f.description,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        suggestMsg = data?.error || 'Could not submit your suggestion.';
      } else {
        applyData(data);
        f = { name: '', concentration: '', category: '', ph: '', link: '', description: '' };
        showSuggestForm = false;
      }
    } catch {
      suggestMsg = 'Network error — please try again.';
    } finally {
      submitting = false;
    }
  }

  onMount(() => {
    // Refresh once on mount to sync with any changes since SSR, then poll.
    refresh();
    pollTimer = setInterval(refresh, 12000);
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<div class="panel" class:panel--embed={embedded} style={embedded ? '' : 'margin-top:28px;'}>
  <div class="panel__hd">
    <span class="label">community reagents · vote &amp; suggest</span>
    <span class="spacer"></span>
    {#if kcUser}
      <span class="tag" style="text-transform:none;letter-spacing:0;">signed in · {kcUser.name}</span>
      <form method="POST" action="?/kcLogout" style="display:inline;">
        <button type="submit" class="icon" title="Sign out">⎋</button>
      </form>
    {:else if kcConfigured || devMode}
      <a class="btn-bp" href="/cfps/auth/login" style="text-decoration:none;">Sign in</a>
    {:else}
      <span class="tag" style="color:var(--muted);">login not configured yet</span>
    {/if}
  </div>

  <div class="panel__bd">
    <p style="font:10px/1.5 var(--mono);color:var(--muted);margin:0 0 10px;">
      Reagents the community thinks are worth testing, ranked by upvotes. Anyone can
      browse; sign in to upvote ideas you like or suggest your own. One vote per
      person — the ranking updates live as votes come in.
    </p>

    {#if kcNotice === 'error'}
      <div class="cfps-banner" style="margin-bottom:14px;">
        <span style="color:var(--err);">○</span>
        <div style="flex:1;color:var(--err);">Sign-in failed. Please try again.</div>
      </div>
    {/if}
    {#if errorMsg}
      <p style="font:11px var(--mono);color:var(--err);margin:0 0 10px;">{errorMsg}</p>
    {/if}
    {#if suggestMsg}
      <p style="font:11px var(--mono);color:var(--err);margin:0 0 10px;">{suggestMsg}</p>
    {/if}

    <!-- Suggest a reagent (login-gated) -->
    {#if kcUser}
      <div style="margin-bottom:14px;">
        {#if !showSuggestForm}
          <button type="button" class="btn-bp" onclick={() => (showSuggestForm = true)}>+ Suggest a reagent</button>
        {:else}
          <div class="inset cr-suggest">
            <!-- Header: an always-visible way back to the live vote list. -->
            <div class="cr-suggest__hd">
              <button type="button" class="btn-bp cr-suggest__back" onclick={() => (showSuggestForm = false)}>‹ Vote list</button>
              <span class="label">suggest a reagent</span>
            </div>
            <div class="cr-suggest__grid">
              <label>
                <span class="label">reagent name *</span>
                <input bind:value={f.name} class="cf-in" placeholder="e.g. Spermidine" />
              </label>
              <label>
                <span class="label">stock conc.</span>
                <input bind:value={f.concentration} class="cf-in" placeholder="e.g. 100 mM" />
              </label>
              <label>
                <span class="label">pH</span>
                <input bind:value={f.ph} class="cf-in" placeholder="e.g. 7.4" />
              </label>
              <label>
                <span class="label">category</span>
                <select bind:value={f.category} class="cf-in">
                  <option value="">—</option>
                  {#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
                </select>
              </label>
            </div>
            <label class="cr-suggest__full">
              <span class="label">reference link</span>
              <input bind:value={f.link} class="cf-in" placeholder="https://… (paper, product page)" />
            </label>
            <label class="cr-suggest__full">
              <span class="label">rationale</span>
              <textarea bind:value={f.description} class="cf-in" rows="2" placeholder="Why should this be tested?"></textarea>
            </label>
            <div class="cr-suggest__foot">
              <button type="button" class="btn-bp" disabled={submitting} onclick={submitSuggestion} style="color:var(--teal-ink);border-color:var(--teal);">
                {submitting ? 'Submitting…' : 'Submit ▸'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="cr-list">
    {#if items.length === 0}
      <p style="font:12px var(--mono);color:var(--faint);text-align:center;padding:18px 0;">
        No suggestions yet{#if kcUser} — be the first to add one.{:else} — sign in to add the first.{/if}
      </p>
    {:else}
      <div class="stack" style="gap:5px;">
        {#each items as s, i (s.id)}
          {@const hasVoted = voted.has(s.id)}
          {@const link = linkFor(s)}
          {@const ph = phFor(s)}
          {@const spec = specFor(s)}
          {@const note = noteFor(s)}
          {@const proposer = proposerFor(s)}
          {@const attrs = extraAttrs(s.suggestion)}
          <div class="inset row" style="gap:10px;padding:6px 10px;align-items:center;">
            <!-- rank -->
            <span class="mono" style="min-width:20px;text-align:right;font-size:11px;color:var(--faint);">#{i + 1}</span>

            <!-- vote control -->
            <div style="display:flex;flex-direction:row;align-items:center;gap:5px;min-width:44px;">
              <button
                type="button"
                class="icon"
                disabled={!kcUser || busy.has(s.id)}
                onclick={() => toggleVote(s)}
                title={kcUser ? (hasVoted ? 'Remove your vote' : 'Upvote this reagent') : 'Sign in to vote'}
                style="font-size:12px;line-height:1;width:20px;height:18px;{hasVoted ? 'color:var(--phosphor);border-color:var(--phosphor);' : ''}"
              >▲</button>
              <span class="mono" style="font-size:12px;font-weight:600;color:{hasVoted ? 'var(--phosphor)' : 'var(--ink-2)'};">{s.votes ?? 0}</span>
            </div>

            <!-- details -->
            <div style="flex:1;min-width:0;">
              <div class="row" style="gap:6px;align-items:baseline;flex-wrap:wrap;">
                <span style="font-weight:600;font-size:12px;color:var(--ink);">{titleFor(s)}</span>
                {#if ph}<span class="tag">pH {ph}</span>{/if}
                {#if spec}<span class="tag" style="text-transform:none;letter-spacing:0;">{spec}</span>{/if}
                {#each attrs as a}<span class="tag" style="text-transform:none;letter-spacing:0;">{a.k}: {a.v}</span>{/each}
                {#if link}
                  <a href={link} target="_blank" rel="noopener noreferrer" class="mono" style="font-size:10px;color:var(--teal);">link ↗</a>
                {/if}
              </div>
              {#if note}
                <p style="font:10px/1.4 var(--mono);color:var(--muted);margin:2px 0 0;">{note}</p>
              {/if}
              {#if proposer}
                <p style="font:9px var(--mono);color:var(--faint);margin:2px 0 0;">suggested by {proposer}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
    </div>
  </div>
</div>

<style>
  /* Embedded mode: fill the grid cell and scroll the ranked list internally so the
     card stays the same height as the reagent prompt beside it. */
  .panel--embed { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .panel--embed .panel__bd {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel--embed .cr-list { flex: 1 1 auto; min-height: 0; overflow: auto; }

  /* Compact suggest-a-reagent form — smaller footprint so the live vote list
     stays visible beside it, with a clear header link back to the list. */
  .cr-suggest { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .cr-suggest__hd { display: flex; align-items: center; gap: 8px; }
  .cr-suggest__back { padding: 3px 8px; }
  .cr-suggest__hd .label { margin-left: auto; }
  .cr-suggest__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
  }
  .cr-suggest label { display: flex; flex-direction: column; gap: 3px; }
  .cr-suggest :global(.cf-in) { padding: 4px 6px; font-size: 11px; }
  .cr-suggest textarea:global(.cf-in) { resize: vertical; min-height: 40px; }
  .cr-suggest__foot { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
</style>

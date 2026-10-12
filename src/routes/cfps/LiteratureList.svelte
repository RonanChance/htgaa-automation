<script>
  // Literature research: a shared, ever-growing list of papers/articles relevant to
  // the coopetition, ranked by upvotes so the most useful rise to the top. Anyone
  // signed in can add a paper (a DOI or a link containing one fills in the title,
  // authors, date and venue), upvote, and delete papers they added. Backed by the
  // /cfps/literature JSON endpoint, which AI agents can also call for a user.
  import { onDestroy, onMount, untrack } from 'svelte';

  let {
    items: initialItems = [],
    votedIds: initialVoted = [],
    kcUser = null,
    kcConfigured = false,
    devMode = false
  } = $props();

  // Seeded once from the page load; kept fresh by writes and the live poll.
  let items = $state(untrack(() => initialItems));
  let voted = $state(new Set(untrack(() => initialVoted)));
  let busy = $state(new Set());
  let errorMsg = $state('');
  let query = $state('');
  let sortBy = $state('top'); // 'top' | 'new'
  let confirmDeleteId = $state(null);
  let pollTimer = null;

  // ── add-a-paper form ────────────────────────────────────────────────────
  const EMPTY = { lookup: '', title: '', authors: '', published: '', venue: '', url: '', doi: '', summary: '', tags: '' };
  let showForm = $state(false);
  let editingId = $state(null); // paper id when the form is editing one of yours
  let f = $state({ ...EMPTY });
  let looking = $state(false);
  let adding = $state(false);
  let formMsg = $state('');
  let formErrors = $state([]); // [{ field, message }]

  const SUMMARY_WORD_LIMIT = 500;
  const CHARS_PER_WORD = 15; // same anti-dodge rule as the comment boxes
  function wordCount(t) {
    const s = String(t || '').trim();
    return s ? s.split(/\s+/).reduce((n, tok) => n + Math.max(1, Math.ceil(tok.length / CHARS_PER_WORD)), 0) : 0;
  }

  const summaryWords = $derived(wordCount(f.summary));

  function applyData(data) {
    if (Array.isArray(data?.items)) items = data.items;
    if (Array.isArray(data?.votedIds)) voted = new Set(data.votedIds);
  }

  async function post(payload) {
    const res = await fetch('/cfps/literature', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function refresh() {
    try {
      const res = await fetch('/cfps/literature');
      if (res.ok) applyData(await res.json());
    } catch { /* keep the last list */ }
  }

  async function toggleVote(p) {
    if (!kcUser || busy.has(p.id)) return;
    errorMsg = '';
    busy = new Set(busy).add(p.id);
    try {
      const { ok, data } = await post({ action: voted.has(p.id) ? 'unvote' : 'vote', id: p.id });
      if (!ok) errorMsg = data?.error || 'Could not record your vote.';
      else applyData(data);
    } catch {
      errorMsg = 'Network error — please try again.';
    } finally {
      const next = new Set(busy); next.delete(p.id); busy = next;
    }
  }

  async function deletePaper(p) {
    errorMsg = '';
    busy = new Set(busy).add(p.id);
    try {
      const { ok, data } = await post({ action: 'delete', id: p.id });
      if (!ok) errorMsg = data?.error || 'Could not delete that paper.';
      else { applyData(data); confirmDeleteId = null; }
    } catch {
      errorMsg = 'Network error — please try again.';
    } finally {
      const next = new Set(busy); next.delete(p.id); busy = next;
    }
  }

  // Fill the form from a DOI (or a link that contains one) — only blanks are filled.
  async function lookup() {
    const q = f.lookup.trim() || f.doi.trim() || f.url.trim();
    if (!q) return;
    looking = true;
    formMsg = '';
    formErrors = [];
    try {
      const { ok, data } = await post({ action: 'lookup', doi: q });
      if (!ok) { formMsg = data?.error || 'Lookup failed.'; return; }
      const p = data.paper || {};
      for (const k of ['title', 'authors', 'published', 'venue', 'url', 'doi']) if (!f[k] && p[k]) f[k] = p[k];
      formMsg = p.title ? 'Filled in from the DOI — check it over, add why it matters, and submit.' : 'Found the DOI but it had little metadata — fill in the rest.';
    } catch {
      formMsg = 'Network error — please try again.';
    } finally {
      looking = false;
    }
  }

  function openAdd() {
    editingId = null;
    f = { ...EMPTY };
    formMsg = '';
    formErrors = [];
    showForm = true;
  }
  // Edit one of your own papers: same form, prefilled, saved with action 'update'.
  function openEdit(p) {
    editingId = p.id;
    f = { ...EMPTY, title: p.title, authors: p.authors, published: p.published, venue: p.venue, url: p.url, doi: p.doi, summary: p.summary, tags: (p.tags || []).join(', ') };
    formMsg = '';
    formErrors = [];
    confirmDeleteId = null;
    showForm = true;
  }
  function closeForm() {
    showForm = false;
    editingId = null;
    formMsg = '';
    formErrors = [];
  }

  async function savePaper() {
    adding = true;
    formMsg = '';
    formErrors = [];
    try {
      const doi = f.doi.trim() || (/10\.\d{4,9}\//.test(f.lookup) ? f.lookup.trim() : '');
      const url = f.url.trim() || (!doi && /^https?:|\./.test(f.lookup) ? f.lookup.trim() : '');
      const { ok, status, data } = await post({
        action: editingId ? 'update' : 'add',
        ...(editingId ? { id: editingId } : {}),
        paper: { title: f.title, authors: f.authors, published: f.published, venue: f.venue, url, doi, summary: f.summary, tags: f.tags }
      });
      if (!ok) {
        formMsg = data?.error || (editingId ? 'Could not save your changes.' : 'Could not add that paper.');
        formErrors = Array.isArray(data?.errors) ? data.errors : [];
        if (status === 409 && data?.existing?.id) highlightId = data.existing.id;
        return;
      }
      applyData(data);
      highlightId = data?.added?.id ?? null;
      f = { ...EMPTY };
      closeForm();
    } catch {
      formMsg = 'Network error — please try again.';
    } finally {
      adding = false;
    }
  }
  const fieldError = (field) => formErrors.find((e) => e.field === field)?.message;

  // Briefly ring a paper (the one just added, or the duplicate you tried to add).
  let highlightId = $state(null);
  $effect(() => {
    if (!highlightId) return;
    const id = highlightId;
    const t = setTimeout(() => { if (highlightId === id) highlightId = null; }, 4000);
    return () => clearTimeout(t);
  });

  // ── display helpers ─────────────────────────────────────────────────────
  function shortAuthors(a) {
    const list = String(a || '').split(/\s*,\s*/).filter(Boolean);
    return list.length > 3 ? `${list.slice(0, 3).join(', ')} et al.` : list.join(', ');
  }
  function fmtPublished(p) {
    if (!p) return '';
    const [y, m, d] = p.split('-').map(Number);
    if (!m) return String(y);
    return new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', ...(d ? { day: 'numeric' } : {}), timeZone: 'UTC' });
  }
  function fmtWhen(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  }

  // Search across title / authors / venue / summary / tags / DOI, then rank.
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter((p) => [p.title, p.authors, p.venue, p.summary, p.doi, ...(p.tags || [])].some((v) => String(v || '').toLowerCase().includes(q)))
      : [...items];
    return sortBy === 'new'
      ? list.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
      : list.sort((a, b) => (b.votes - a.votes) || String(b.created || '').localeCompare(String(a.created || '')));
  });

  onMount(() => {
    if (!kcUser) return;
    pollTimer = setInterval(refresh, 12000);
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<div class="panel lit-panel">
  <div class="panel__hd">
    <span class="label">literature research · {items.length} paper{items.length === 1 ? '' : 's'}</span>
    <span class="spacer"></span>
    {#if kcUser}
      <input class="cf-in lit-search" type="search" placeholder="Search title, author, tag…" bind:value={query} aria-label="Search literature" />
      <div class="lit-seg" role="radiogroup" aria-label="Sort literature">
        <button type="button" role="radio" aria-checked={sortBy === 'top'} onclick={() => (sortBy = 'top')}>Top</button>
        <button type="button" role="radio" aria-checked={sortBy === 'new'} onclick={() => (sortBy = 'new')}>Newest</button>
      </div>
    {/if}
  </div>

  <div class="panel__bd">
    <p class="lit-blurb">Papers and articles worth knowing for cell-free protein synthesis — add what you're reading and upvote what helped, so everyone stays current.</p>

    {#if !kcUser}
      <div class="lit-locked">
        <span aria-hidden="true">🔒</span>
        <span>The literature list is members-only.</span>
        {#if kcConfigured || devMode}
          <a class="btn-bp" href="/cfps/auth/login" style="text-decoration:none;">Sign in to read &amp; add</a>
        {/if}
      </div>
    {:else}
      {#if errorMsg}<p class="lit-msg">{errorMsg}</p>{/if}

      {#if showForm}
        <div class="inset lit-form">
          <div class="lit-form__hd">
            <button type="button" class="btn-bp" onclick={closeForm}>‹ List</button>
            <span class="label">{editingId ? 'edit your paper' : 'add a paper'}</span>
          </div>
          <div class="lit-form__lookup">
            <input
              class="cf-in"
              placeholder="Paste a DOI or link (e.g. 10.1101/2024.01.01.123456) to fill in the details"
              bind:value={f.lookup}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }}
            />
            <button type="button" class="btn-bp" onclick={lookup} disabled={looking || !(f.lookup.trim() || f.doi.trim() || f.url.trim())}>{looking ? 'Looking up…' : 'Look up'}</button>
          </div>
          <label class="lit-form__full">
            <span class="label">title *</span>
            <input class="cf-in" class:invalid={fieldError('title')} bind:value={f.title} />
          </label>
          <div class="lit-form__grid">
            <label class="lit-form__wide"><span class="label">authors</span><input class="cf-in" bind:value={f.authors} placeholder="First Author, Second Author, …" /></label>
            <label><span class="label">published</span><input class="cf-in" class:invalid={fieldError('published')} bind:value={f.published} placeholder="2024-03" /></label>
            <label><span class="label">journal / venue</span><input class="cf-in" bind:value={f.venue} placeholder="e.g. Nature Communications" /></label>
            <label class="lit-form__wide"><span class="label">link *</span><input class="cf-in" class:invalid={fieldError('url')} bind:value={f.url} placeholder="https://…" /></label>
            <label><span class="label">DOI</span><input class="cf-in" class:invalid={fieldError('doi')} bind:value={f.doi} placeholder="10.xxxx/…" /></label>
            <label><span class="label">tags</span><input class="cf-in" bind:value={f.tags} placeholder="energy, review" /></label>
          </div>
          <label class="lit-form__full">
            <span class="label">why it's relevant <span class="lit-count" class:lit-count--over={summaryWords > SUMMARY_WORD_LIMIT}>{SUMMARY_WORD_LIMIT - summaryWords}</span></span>
            <textarea class="cf-in" rows="3" bind:value={f.summary} placeholder="Key finding, and how it could help our reactions"></textarea>
          </label>
          {#if formMsg}<p class="lit-msg" class:lit-msg--ok={!formErrors.length && !/fail|error|not|already/i.test(formMsg)}>{formMsg}</p>{/if}
          <div class="lit-form__foot">
            <span class="lit-hint">* a title and a link (or DOI) are required</span>
            <button type="button" class="btn-bp" disabled={adding || summaryWords > SUMMARY_WORD_LIMIT} onclick={savePaper} style="color:var(--teal-ink);border-color:var(--teal);">{adding ? 'Saving…' : editingId ? 'Save changes ▸' : 'Add paper ▸'}</button>
          </div>
        </div>
      {:else}
        <div class="lit-list">
          {#if shown.length === 0}
            <p class="lit-empty">{query ? 'No papers match that search.' : 'No papers yet — add the first one.'}</p>
          {:else}
            <div class="lit-rows">
              {#each shown as p, i (p.id)}
                {@const hasVoted = voted.has(p.id)}
                <article class="inset lit-item" class:lit-item--hl={highlightId === p.id}>
                  <span class="lit-rank">#{i + 1}</span>
                  <div class="lit-vote">
                    <button
                      type="button"
                      class="icon"
                      class:is-on={hasVoted}
                      disabled={busy.has(p.id)}
                      onclick={() => toggleVote(p)}
                      title={hasVoted ? 'Remove your upvote' : 'Upvote — this was useful'}
                      aria-pressed={hasVoted}
                      aria-label={`${hasVoted ? 'Remove upvote from' : 'Upvote'} ${p.title}`}
                    >▲</button>
                    <span class="lit-votes" class:is-on={hasVoted}>{p.votes}</span>
                  </div>
                  <div class="lit-detail">
                    <a class="lit-title" href={p.url} target="_blank" rel="noopener noreferrer">{p.title} <span aria-hidden="true">↗</span></a>
                    <div class="lit-meta">
                      {#if p.authors}<span title={p.authors}>{shortAuthors(p.authors)}</span>{/if}
                      {#if p.venue}<span class="lit-venue">{p.venue}</span>{/if}
                      {#if p.published}<span>{fmtPublished(p.published)}</span>{/if}
                      {#if p.doi}<a class="lit-doi" href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer">doi:{p.doi}</a>{/if}
                    </div>
                    {#if p.summary}<p class="lit-summary">{p.summary}</p>{/if}
                    <div class="lit-foot">
                      {#each p.tags as t}<button type="button" class="tag lit-tag" onclick={() => (query = t)} title={`Show papers tagged ${t}`}>{t}</button>{/each}
                      <span class="lit-by">added by {p.addedBy}{#if p.created} · {fmtWhen(p.created)}{/if}</span>
                    </div>
                  </div>
                  {#if p.mine}
                    {#if confirmDeleteId === p.id}
                      <div class="lit-del-confirm">
                        <span>Delete?</span>
                        <button type="button" class="lit-del-yes" onclick={() => deletePaper(p)} disabled={busy.has(p.id)}>Delete</button>
                        <button type="button" class="lit-del-no" onclick={() => (confirmDeleteId = null)}>Cancel</button>
                      </div>
                    {:else}
                      <div class="lit-own">
                        <button type="button" class="lit-del" onclick={() => openEdit(p)} title="Edit a paper you added" aria-label={`Edit ${p.title}`}>✎</button>
                        <button type="button" class="lit-del lit-del--danger" onclick={() => (confirmDeleteId = p.id)} title="Delete a paper you added" aria-label={`Delete ${p.title}`}>🗑</button>
                      </div>
                    {/if}
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </div>
        <div class="lit-actions">
          <!-- Plain-text copy of the ranked list in a new tab. -->
          <a class="btn-bp" href="/cfps/literature?format=txt" target="_blank" rel="noopener" title="Open the list as plain text" aria-label="Open the literature list as plain text" style="text-decoration:none;">↓</a>
          <button type="button" class="btn-bp" onclick={openAdd}>+ Add a paper</button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .lit-blurb { font: 11px/1.5 var(--mono); color: var(--ink-2); margin: 0 0 12px; }
  .lit-msg { font: 11px/1.45 var(--mono); color: var(--err); margin: 0 0 10px; }
  .lit-msg--ok { color: var(--teal-ink); }
  .lit-empty { font: 12px var(--mono); color: var(--faint); text-align: center; padding: 18px 0; }
  .panel__hd .lit-search { flex: 0 1 220px; width: 220px; max-width: 40vw; padding: 4px 8px; font-size: 11px; }
  .lit-seg { display: inline-flex; border: 1px solid var(--groove); border-radius: var(--r-sm); overflow: hidden; margin-left: 6px; }
  .lit-seg button { font: 500 10px/1 var(--mono); padding: 5px 8px; border: 0; cursor: pointer; color: var(--ink-2); background: var(--surface-2); }
  .lit-seg button + button { border-left: 1px solid var(--groove); }
  .lit-seg button[aria-checked="true"] { color: #fff; background: var(--teal); }
  .lit-locked { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font: 11px var(--mono); color: var(--muted); padding: 6px 0 4px; }

  /* Ranked list: capped height, scrolls in place. Own flex column (NOT DaisyUI's
     `.stack`, which fans successive children narrower and fainter). */
  .lit-list { max-height: 560px; overflow-y: auto; padding-right: 2px; }
  .lit-rows { display: flex; flex-direction: column; gap: 6px; }
  .lit-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; transition: box-shadow .3s; }
  .lit-item--hl { box-shadow: 0 0 0 2px var(--teal); }
  .lit-rank { min-width: 20px; text-align: right; font: 11px var(--mono); color: var(--faint); padding-top: 3px; }
  .lit-vote { display: flex; align-items: center; gap: 5px; min-width: 44px; padding-top: 1px; }
  .lit-vote .icon { font-size: 12px; line-height: 1; width: 20px; height: 18px; }
  .lit-vote .icon.is-on { color: var(--phosphor); border-color: var(--phosphor); }
  .lit-votes { font: 600 12px var(--mono); color: var(--ink-2); }
  .lit-votes.is-on { color: var(--phosphor); }
  .lit-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .lit-title { font: 600 12.5px/1.35 var(--sans); color: var(--ink); }
  .lit-title:hover { color: var(--teal-ink); text-decoration: underline; }
  .lit-meta { display: flex; flex-wrap: wrap; gap: 3px 10px; font: 10px/1.4 var(--mono); color: var(--muted); }
  .lit-venue { font-style: italic; }
  .lit-doi { color: var(--teal); }
  .lit-doi:hover { text-decoration: underline; }
  .lit-summary { margin: 2px 0 0; font: 11px/1.5 var(--mono); color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .lit-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 2px; }
  .lit-tag { cursor: pointer; text-transform: none; letter-spacing: 0; }
  .lit-tag:hover { color: var(--teal-ink); border-color: var(--teal); }
  .lit-by { margin-left: auto; font: 9px var(--mono); color: var(--faint); }
  .lit-del { flex: 0 0 auto; font-size: 11px; line-height: 1; color: var(--faint); background: transparent; border: 1px solid var(--hair); border-radius: var(--r-sm); padding: 3px 6px; cursor: pointer; }
  .lit-del:hover { color: var(--ink); border-color: var(--ink-2); }
  .lit-del--danger:hover { color: var(--err); border-color: var(--err); }
  .lit-own { flex: 0 0 auto; display: flex; gap: 4px; }
  .lit-del-confirm { flex: 0 0 auto; display: flex; align-items: center; gap: 5px; font: 9px var(--mono); color: var(--muted); }
  .lit-del-yes, .lit-del-no { font: 10px var(--mono); border-radius: var(--r-sm); padding: 3px 7px; cursor: pointer; }
  .lit-del-yes { color: #fff; background: var(--err); border: 1px solid var(--err); }
  .lit-del-no { color: var(--muted); background: transparent; border: 1px solid var(--hair); }
  .lit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }

  /* Add-a-paper form */
  .lit-form { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .lit-form__hd { display: flex; align-items: center; gap: 8px; }
  .lit-form__hd .label { margin-left: auto; }
  .lit-form__lookup { display: flex; gap: 6px; }
  .lit-form__lookup :global(.cf-in) { flex: 1; min-width: 0; }
  .lit-form label { display: flex; flex-direction: column; gap: 3px; }
  .lit-form__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .lit-form__wide { grid-column: span 2; }
  @media (max-width: 720px) {
    .lit-form__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .lit-form :global(.cf-in) { padding: 4px 6px; font-size: 11px; }
  .lit-form textarea:global(.cf-in) { resize: vertical; min-height: 48px; }
  .lit-form :global(.cf-in.invalid) { border-color: var(--err); }
  .lit-count { float: right; color: var(--faint); }
  .lit-count--over { color: var(--err); }
  .lit-form__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .lit-hint { font: 9.5px var(--mono); color: var(--faint); }
</style>

<script>
  import { page } from '$app/state';
  import { loginHref } from './loginHref.js';
  // Metascience: how should we decide which compositions go forward to the wet lab?
  // There will be far more submissions than wells, so the choosing is itself an
  // experiment-design problem. Students propose a selection criterion, upvote the
  // ones they'd back, and argue it out in the comments. Same chrome, ranking and
  // auth model as the literature list next to it, minus the citation machinery —
  // backed by /cfps/metascience, which AI agents can also call for a user.
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

  // ── add / edit form ─────────────────────────────────────────────────────
  const EMPTY = { title: '', body: '' };
  let showForm = $state(false);
  let editingId = $state(null); // idea id when the form is editing one of yours
  let f = $state({ ...EMPTY });
  let saving = $state(false);
  let formErrors = $state([]); // [{ field, message }]

  // Same anti-dodge word rule as the comment boxes elsewhere on the page.
  const BODY_WORD_LIMIT = 500;
  const CHARS_PER_WORD = 15;
  function wordCount(t) {
    const s = String(t || '').trim();
    return s ? s.split(/\s+/).reduce((n, tok) => n + Math.max(1, Math.ceil(tok.length / CHARS_PER_WORD)), 0) : 0;
  }
  const bodyWords = $derived(wordCount(f.body));

  // Which idea's comment box is open, and its draft text.
  let openThread = $state(null);
  let draft = $state('');

  function applyData(data) {
    if (Array.isArray(data?.items)) items = data.items;
    if (Array.isArray(data?.votedIds)) voted = new Set(data.votedIds);
  }

  async function post(payload) {
    const res = await fetch('/cfps/metascience', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function refresh() {
    try {
      const res = await fetch('/cfps/metascience');
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
      errorMsg = 'Could not record your vote.';
    } finally {
      const next = new Set(busy); next.delete(p.id); busy = next;
    }
  }

  function openAdd() {
    editingId = null; f = { ...EMPTY }; formErrors = []; errorMsg = ''; showForm = true;
  }
  function openEdit(p) {
    editingId = p.id; f = { title: p.title, body: p.body }; formErrors = []; errorMsg = ''; showForm = true;
  }
  const closeForm = () => { showForm = false; editingId = null; formErrors = []; };

  async function save() {
    if (saving) return;
    saving = true; formErrors = []; errorMsg = '';
    try {
      const { ok, data } = await post(
        editingId
          ? { action: 'update', id: editingId, idea: { title: f.title, body: f.body } }
          : { action: 'add', idea: { title: f.title, body: f.body } }
      );
      if (!ok) {
        formErrors = Array.isArray(data?.errors) ? data.errors : [];
        errorMsg = data?.error || 'Could not save that idea.';
        return;
      }
      applyData(data);
      closeForm();
    } catch {
      errorMsg = 'Could not save that idea.';
    } finally {
      saving = false;
    }
  }

  async function removeIdea(p) {
    busy = new Set(busy).add(p.id);
    try {
      const { ok, data } = await post({ action: 'delete', id: p.id });
      if (!ok) errorMsg = data?.error || 'Could not delete that idea.';
      else applyData(data);
    } finally {
      confirmDeleteId = null;
      const next = new Set(busy); next.delete(p.id); busy = next;
    }
  }

  async function sendComment(p) {
    const text = draft.trim();
    if (!text || busy.has(p.id)) return;
    busy = new Set(busy).add(p.id);
    try {
      const { ok, data } = await post({ action: 'comment', id: p.id, body: text });
      if (!ok) errorMsg = data?.error || 'Could not post that comment.';
      else { applyData(data); draft = ''; }
    } finally {
      const next = new Set(busy); next.delete(p.id); busy = next;
    }
  }

  async function removeComment(c) {
    const { ok, data } = await post({ action: 'delete-comment', commentId: c.id });
    if (!ok) errorMsg = data?.error || 'Could not delete that comment.';
    else applyData(data);
  }

  const fmtWhen = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter((p) => `${p.title} ${p.body} ${p.addedBy}`.toLowerCase().includes(q))
      : [...items];
    return sortBy === 'new'
      ? list.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
      : list.sort((a, b) => (b.votes - a.votes) || String(b.created || '').localeCompare(String(a.created || '')));
  });

  onMount(() => {
    if (kcUser) pollTimer = setInterval(refresh, 12000);
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<div class="panel ms-panel">
  <div class="panel__hd">
    <span class="label">metascience · {items.length} idea{items.length === 1 ? '' : 's'}</span>
    <span class="spacer"></span>
    {#if kcUser && !showForm}
      <input class="cf-in search-in ms-search" type="search" placeholder="Search ideas…" bind:value={query} aria-label="Search metascience ideas" />
      <div class="seg" role="radiogroup" aria-label="Sort ideas">
        <button type="button" role="radio" aria-checked={sortBy === 'top'} onclick={() => (sortBy = 'top')}>Top</button>
        <button type="button" role="radio" aria-checked={sortBy === 'new'} onclick={() => (sortBy = 'new')}>Newest</button>
      </div>
    {/if}
  </div>

  <div class="panel__bd">
    <p class="ms-blurb">
      There will be far more submitted compositions than wells. How should we choose which ones to test on the autonomous lab?
    </p>

    {#if !kcUser}
      <div class="ms-locked">
        <span aria-hidden="true">🔒</span>
        <span>The metascience list is members-only.</span>
        {#if kcConfigured || devMode}
          <a class="btn-bp" href={loginHref(page.url)} style="text-decoration:none;">Sign in to read &amp; add</a>
        {/if}
      </div>
    {:else}
      {#if errorMsg}<p class="ms-msg">{errorMsg}</p>{/if}

      {#if showForm}
        <div class="inset ms-form">
          <div class="ms-form__hd">
            <button type="button" class="btn-bp" onclick={closeForm}>‹ List</button>
            <span class="label">{editingId ? 'edit your idea' : 'propose a criterion'}</span>
          </div>
          <label class="ms-field">
            <span class="label">title</span>
            <input class="cf-in" bind:value={f.title} maxlength="300" placeholder="e.g. Spend half the wells testing the widest parameter space" />
          </label>
          <label class="ms-field">
            <span class="label">
              the idea
              <span class="ms-count" class:is-over={bodyWords > BODY_WORD_LIMIT}>{bodyWords}/{BODY_WORD_LIMIT} words</span>
            </span>
            <textarea class="cf-in ms-ta" rows="6" bind:value={f.body}
              placeholder="How would this criterion pick compositions, and why is that the right call? What would it get right that a simple ranking wouldn't?"></textarea>
          </label>
          {#each formErrors as e}<p class="ms-msg ms-msg--field">{e.field}: {e.message}</p>{/each}
          <div class="ms-actions">
            <button type="button" class="btn-bp" onclick={closeForm}>Cancel</button>
            <button type="button" class="btn-bp" onclick={save} disabled={saving || !f.title.trim() || !f.body.trim()}
              style="color:var(--teal-ink);border-color:var(--teal);">
              {saving ? 'Saving…' : editingId ? 'Save changes ▸' : 'Post idea ▸'}
            </button>
          </div>
        </div>
      {:else}
        <div class="ms-list">
          {#if shown.length === 0}
            <p class="ms-empty">{query ? 'No ideas match that search.' : 'No ideas yet — propose the first one.'}</p>
          {:else}
            <div class="ms-rows">
              {#each shown as p, i (p.id)}
                {@const hasVoted = voted.has(p.id)}
                <article class="inset ms-item">
                  <span class="ms-rank">#{i + 1}</span>
                  <div class="ms-vote">
                    <button
                      type="button"
                      class="icon"
                      class:is-on={hasVoted}
                      disabled={busy.has(p.id)}
                      onclick={() => toggleVote(p)}
                      title={hasVoted ? 'Remove your upvote' : "Upvote — I'd back this"}
                      aria-pressed={hasVoted}
                      aria-label={`${hasVoted ? 'Remove upvote from' : 'Upvote'} ${p.title}`}
                    >▲</button>
                    <span class="ms-votes" class:is-on={hasVoted}>{p.votes}</span>
                  </div>
                  <div class="ms-detail">
                    <h4 class="ms-title">{p.title}</h4>
                    <p class="ms-body">{p.body}</p>
                    <div class="ms-foot">
                      <button type="button" class="ms-cbtn" onclick={() => { openThread = openThread === p.id ? null : p.id; draft = ''; }}
                        aria-expanded={openThread === p.id}>
                        💬 {p.comments.length}{p.comments.length === 1 ? ' comment' : ' comments'}
                      </button>
                      <span class="ms-by">by {p.addedBy}{#if p.created} · {fmtWhen(p.created)}{/if}</span>
                    </div>

                    {#if openThread === p.id}
                      <div class="ms-thread">
                        {#each p.comments as c (c.id)}
                          <div class="ms-comment">
                            <span class="ms-comment__who">{c.author}<span class="ms-comment__when">{fmtWhen(c.created)}</span></span>
                            <p class="ms-comment__body">{c.body}</p>
                            {#if c.mine}
                              <button type="button" class="ms-cdel" onclick={() => removeComment(c)} title="Delete your comment" aria-label="Delete your comment">✕</button>
                            {/if}
                          </div>
                        {/each}
                        <div class="ms-reply">
                          <textarea class="cf-in ms-ta" rows="2" bind:value={draft} placeholder="Add to the argument…"></textarea>
                          <button type="button" class="btn-bp" onclick={() => sendComment(p)} disabled={!draft.trim() || busy.has(p.id)}>Post</button>
                        </div>
                      </div>
                    {/if}
                  </div>
                  {#if p.mine}
                    {#if confirmDeleteId === p.id}
                      <div class="ms-del-confirm">
                        <span>Delete?</span>
                        <button type="button" class="ms-del-yes" onclick={() => removeIdea(p)} disabled={busy.has(p.id)}>Delete</button>
                        <button type="button" class="ms-del-no" onclick={() => (confirmDeleteId = null)}>Cancel</button>
                      </div>
                    {:else}
                      <div class="ms-own">
                        <button type="button" class="ms-del" onclick={() => openEdit(p)} title="Edit an idea you added" aria-label={`Edit ${p.title}`}>✎</button>
                        <button type="button" class="ms-del ms-del--danger" onclick={() => (confirmDeleteId = p.id)} title="Delete an idea you added" aria-label={`Delete ${p.title}`}>🗑</button>
                      </div>
                    {/if}
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </div>
        <div class="ms-actions">
          <a class="btn-bp" href="/cfps/metascience?format=txt" target="_blank" rel="noopener" title="Open the list as plain text" aria-label="Open the metascience list as plain text" style="text-decoration:none;">↓</a>
          <button type="button" class="btn-bp" onclick={openAdd}>+ Propose a criterion</button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .ms-blurb { font: 11px/1.5 var(--mono); color: var(--ink-2); margin: 0 0 12px; }
  .ms-msg { font: 11px/1.45 var(--mono); color: var(--err); margin: 0 0 10px; }
  .ms-msg--field { margin: 0 0 4px; }
  .ms-empty { font: 12px var(--mono); color: var(--faint); text-align: center; padding: 18px 0; }
  .panel__hd .ms-search { flex: 0 1 200px; width: 200px; max-width: 40vw; }
  .ms-locked { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font: 11px var(--mono); color: var(--muted); padding: 6px 0 4px; }

  /* Ranked list: capped height, scrolls in place. Own flex column (NOT DaisyUI's
     `.stack`, which fans successive children narrower and fainter). */
  .ms-list { max-height: 560px; overflow-y: auto; padding-right: 2px; }
  .ms-rows { display: flex; flex-direction: column; gap: 6px; }
  .ms-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; }
  .ms-rank { min-width: 20px; text-align: right; font: 11px var(--mono); color: var(--faint); padding-top: 3px; }
  .ms-vote { display: flex; align-items: center; gap: 5px; min-width: 44px; padding-top: 1px; }
  .ms-vote .icon { font-size: 12px; line-height: 1; width: 20px; height: 18px; }
  .ms-vote .icon.is-on { color: var(--phosphor); border-color: var(--phosphor); }
  .ms-votes { font: 600 12px var(--mono); color: var(--ink-2); }
  .ms-votes.is-on { color: var(--phosphor); }
  .ms-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .ms-title { margin: 0; font: 600 12.5px/1.35 var(--sans); color: var(--ink); }
  .ms-body { margin: 2px 0 0; font: 11px/1.55 var(--mono); color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .ms-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 4px; }
  .ms-by { margin-left: auto; font: 9px var(--mono); color: var(--faint); }
  .ms-cbtn { font: 10px var(--mono); color: var(--muted); background: transparent; border: 0; padding: 0; cursor: pointer; }
  .ms-cbtn:hover { color: var(--teal-ink); }

  /* comment thread */
  .ms-thread { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--hair); display: flex; flex-direction: column; gap: 7px; }
  .ms-comment { position: relative; padding-left: 9px; border-left: 2px solid var(--hair); }
  .ms-comment__who { font: 600 10px var(--mono); color: var(--ink-2); }
  .ms-comment__when { margin-left: 7px; font-weight: 400; color: var(--faint); }
  .ms-comment__body { margin: 2px 0 0; font: 11px/1.5 var(--mono); color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .ms-cdel { position: absolute; top: 0; right: 0; font-size: 10px; line-height: 1; color: var(--faint); background: transparent; border: 0; cursor: pointer; padding: 2px 4px; }
  .ms-cdel:hover { color: var(--err); }
  .ms-reply { display: flex; gap: 6px; align-items: flex-end; }
  .ms-reply .ms-ta { flex: 1; }

  /* add / edit form */
  .ms-form { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px; }
  .ms-form__hd { display: flex; align-items: center; gap: 10px; }
  .ms-field { display: flex; flex-direction: column; gap: 4px; }
  .ms-field .label { display: flex; align-items: baseline; gap: 8px; }
  .ms-count { font: 9px var(--mono); color: var(--faint); text-transform: none; letter-spacing: 0; }
  .ms-count.is-over { color: var(--err); }
  .ms-ta { font: 11px/1.55 var(--mono); resize: vertical; }
  .ms-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }

  /* own-row controls, same affordances as the literature rows */
  .ms-own { display: flex; gap: 4px; }
  .ms-del { flex: 0 0 auto; font-size: 11px; line-height: 1; color: var(--faint); background: transparent; border: 1px solid var(--hair); border-radius: var(--r-sm); padding: 3px 6px; cursor: pointer; }
  .ms-del:hover { color: var(--ink); border-color: var(--ink-2); }
  .ms-del--danger:hover { color: var(--err); border-color: var(--err); }
  .ms-del-confirm { display: flex; align-items: center; gap: 5px; font: 10px var(--mono); color: var(--muted); }
  .ms-del-yes, .ms-del-no { font: 10px var(--mono); border: 1px solid var(--hair); border-radius: var(--r-sm); background: transparent; padding: 3px 6px; cursor: pointer; }
  .ms-del-yes { color: var(--err); border-color: var(--err); }
  .ms-del-no { color: var(--muted); }
</style>

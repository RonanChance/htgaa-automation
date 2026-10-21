<script>
  import { page } from '$app/state';
  import { loginHref } from './loginHref.js';
  // Literature research: a shared, ever-growing list of papers/articles relevant to
  // the coopetition, ranked by upvotes so the most useful rise to the top. Anyone
  // signed in can add a paper (a DOI or a link containing one fills in the title,
  // authors, date and venue), upvote, and delete papers they added. Backed by the
  // /cfps/literature JSON endpoint, which AI agents can also call for a user.
  import { onDestroy, onMount, untrack } from 'svelte';
  import JsonEditor from './JsonEditor.svelte';
  import { serialize, parseEntries } from './jsonEdit.js';

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
  // The add/edit form can also be filled in as JSON (one paper object, or — when
  // adding — an array of them). The chosen mode sticks across opens.
  let formMode = $state('form'); // 'form' | 'json'
  let formJson = $state('');

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
    if (formMode === 'json') formJson = serialize(formToPaper());
    showForm = true;
  }
  // Edit one of your own papers: same form, prefilled, saved with action 'update'.
  function openEdit(p) {
    editingId = p.id;
    f = { ...EMPTY, title: p.title, authors: p.authors, published: p.published, venue: p.venue, url: p.url, doi: p.doi, summary: p.summary, tags: (p.tags || []).join(', ') };
    formMsg = '';
    formErrors = [];
    confirmDeleteId = null;
    if (formMode === 'json') formJson = serialize(formToPaper());
    showForm = true;
  }
  function closeForm() {
    showForm = false;
    editingId = null;
    formMsg = '';
    formErrors = [];
  }

  // The form's fields as a paper object (the shape the API and JSON mode use). A DOI
  // or link typed only into the lookup box counts, the same as on submit.
  function formToPaper() {
    const doi = f.doi.trim() || (/10\.\d{4,9}\//.test(f.lookup) ? f.lookup.trim() : '');
    const url = f.url.trim() || (!doi && /^https?:|\./.test(f.lookup) ? f.lookup.trim() : '');
    const tags = f.tags.split(',').map((t) => t.trim()).filter(Boolean);
    return { title: f.title, authors: f.authors, published: f.published, venue: f.venue, url, doi, summary: f.summary, tags };
  }

  // Switch the form between fields and JSON, carrying the values across. Going back
  // to fields needs JSON that parses to a single paper.
  function setFormMode(mode) {
    if (mode === formMode) return;
    formMsg = '';
    formErrors = [];
    if (mode === 'json') {
      formJson = serialize(formToPaper());
      formMode = 'json';
      return;
    }
    const parsed = parseEntries(formJson);
    if (!parsed.ok) { formMsg = `Fix the JSON first — ${parsed.error}`; return; }
    if (parsed.entries.length > 1) { formMsg = 'The form holds one paper — submit several from JSON.'; return; }
    const e = parsed.entries[0] ?? {};
    const str = (v) => (v == null ? '' : String(v));
    f = {
      ...EMPTY,
      ...Object.fromEntries(['title', 'authors', 'published', 'venue', 'url', 'doi', 'summary'].map((k) => [k, str(e[k])])),
      tags: Array.isArray(e.tags) ? e.tags.join(', ') : str(e.tags)
    };
    formMode = 'form';
  }

  // Live check of the form's JSON: parse errors, and keys that aren't paper fields.
  const formJsonPlan = $derived.by(() => {
    const parsed = parseEntries(formJson);
    if (!parsed.ok) return { ok: false, error: parsed.error, entries: [], ignored: [] };
    const known = new Set([...EDITABLE, 'id', 'added_by', 'votes']);
    const ignored = [...new Set(parsed.entries.flatMap((e) => Object.keys(e).filter((k) => !known.has(k))))];
    const entries = parsed.entries.filter((e) => EDITABLE.some((k) => comparable(e)[k].length));
    return { ok: true, entries, ignored };
  });

  // Submit from JSON mode: one update when editing, otherwise add every entry.
  // Entries that fail stay in the editor with the reasons listed above it.
  async function saveJsonForm() {
    const plan = formJsonPlan;
    formMsg = '';
    formErrors = [];
    if (!plan.ok) { formMsg = plan.error; return; }
    if (!plan.entries.length) { formMsg = 'Nothing to save — add a title and a link or DOI.'; return; }
    if (editingId && plan.entries.length > 1) { formMsg = 'Editing one paper — the JSON should be a single object.'; return; }
    adding = true;
    const failed = [];
    const errors = [];
    let lastAdded = null;
    try {
      for (const e of plan.entries) {
        const { ok, status, data } = await post(editingId
          ? { action: 'update', id: editingId, paper: pickEditable(e) }
          : { action: 'add', paper: pickEditable(e) });
        if (ok) { applyData(data); lastAdded = data?.added?.id ?? lastAdded; continue; }
        failed.push(e);
        errors.push(`${e.title || e.doi || e.url || 'Entry'}: ${data?.error || 'could not save.'}`);
        if (status === 409 && data?.existing?.id) highlightId = data.existing.id;
      }
    } catch {
      formMsg = 'Network error — please try again.';
      adding = false;
      return;
    }
    adding = false;
    if (!failed.length) {
      highlightId = lastAdded;
      f = { ...EMPTY };
      closeForm();
      return;
    }
    formMsg = errors.join(' · ');
    formJson = serialize(failed.length === 1 ? failed[0] : failed);
  }

  async function savePaper() {
    if (formMode === 'json') return saveJsonForm();
    adding = true;
    formMsg = '';
    formErrors = [];
    try {
      const { ok, status, data } = await post({
        action: editingId ? 'update' : 'add',
        ...(editingId ? { id: editingId } : {}),
        paper: formToPaper()
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

  // ── JSON view ───────────────────────────────────────────────────────────
  // The whole list as editable JSON, for contributing from a code-style UI (or
  // pasting what an agent drafted). Objects with an `id` are existing papers —
  // edits are saved only for papers you added; objects without one are added.
  // `added_by` / `votes` are read-only context. Removing an object here does NOT
  // delete the paper (use 🗑 in the list), so a stray cut can't wipe entries.
  const EDITABLE = ['title', 'authors', 'published', 'venue', 'url', 'doi', 'summary', 'tags'];
  const TEMPLATE = { title: '', authors: '', published: '', venue: '', url: '', doi: '', summary: '', tags: [] };
  let view = $state('list'); // 'list' | 'json'
  let jsonText = $state('');
  let jsonBusy = $state(false);
  let jsonResults = $state([]); // [{ ok, message }]

  const ranked = (list) => [...list].sort((a, b) => (b.votes - a.votes) || String(b.created || '').localeCompare(String(a.created || '')));
  function toJsonEntry(p) {
    const out = { id: p.id };
    for (const k of EDITABLE) out[k] = k === 'tags' ? [...(p.tags || [])] : (p[k] ?? '');
    return { ...out, added_by: p.mine ? `${p.addedBy} (you)` : p.addedBy, votes: p.votes };
  }

  function openJson() {
    jsonText = serialize(ranked(items).map(toJsonEntry));
    jsonResults = [];
    closeForm();
    view = 'json';
  }
  // Append a blank paper (to the list JSON, or the add form's JSON) and jump the
  // editor to its title so it's visible and ready to type into.
  let listEditor = $state(null);
  let formEditor = $state(null);
  function appendTemplate() {
    const parsed = parseEntries(jsonText);
    if (!parsed.ok) return; // don't clobber text that doesn't parse
    jsonText = serialize([...parsed.entries, { ...TEMPLATE }]);
    listEditor?.revealLast('"title": "');
  }
  function appendFormTemplate() {
    const parsed = parseEntries(formJson);
    if (!parsed.ok) return;
    formJson = serialize([...parsed.entries, { ...TEMPLATE }]);
    formEditor?.revealLast('"title": "');
  }

  // Comparable form of an entry's editable fields (tags may arrive as "a, b").
  function comparable(e) {
    const out = {};
    for (const k of EDITABLE) {
      out[k] = k === 'tags'
        ? (Array.isArray(e.tags) ? e.tags : String(e.tags ?? '').split(',')).map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean)
        : String(e[k] ?? '').trim();
    }
    return out;
  }
  function pickEditable(e) {
    const out = {};
    for (const k of EDITABLE) if (k in e) out[k] = e[k];
    return out;
  }

  // What Apply would do: new papers to add, your edited papers to update, and
  // problems (edits to someone else's paper, unknown ids) — shown live under the editor.
  const jsonPlan = $derived.by(() => {
    const parsed = parseEntries(jsonText);
    if (!parsed.ok) return { ok: false, error: parsed.error, adds: [], updates: [], problems: [] };
    const byId = new Map(items.map((p) => [p.id, p]));
    const adds = [];
    const updates = [];
    const problems = [];
    parsed.entries.forEach((e, i) => {
      const label = `#${i + 1}${e.title ? ` "${String(e.title).slice(0, 60)}"` : ''}`;
      if (!e.id) {
        if (EDITABLE.some((k) => comparable(e)[k].length)) adds.push({ entry: e, label });
        return;
      }
      const orig = byId.get(e.id);
      if (!orig) { problems.push(`${label}: no paper with id ${e.id} — drop the id to add it as new.`); return; }
      const a = comparable(e);
      const b = comparable(orig);
      const changed = EDITABLE.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (!changed.length) return;
      if (!orig.mine) { problems.push(`${label}: added by ${orig.addedBy} — only papers you added can be edited.`); return; }
      const patch = {};
      for (const k of changed) patch[k] = e[k] ?? '';
      updates.push({ entry: e, id: e.id, patch, label });
    });
    return { ok: true, adds, updates, problems };
  });

  async function applyJson() {
    const plan = jsonPlan;
    if (!plan.ok || plan.problems.length || jsonBusy) return;
    jsonBusy = true;
    jsonResults = [];
    const failed = []; // entries to keep in the editor so they can be fixed
    const results = [];
    try {
      for (const u of plan.updates) {
        const { ok, data } = await post({ action: 'update', id: u.id, paper: u.patch });
        if (ok) { applyData(data); results.push({ ok: true, message: `Updated ${u.label}` }); }
        else { failed.push(u.entry); results.push({ ok: false, message: `${u.label}: ${data?.error || 'could not save.'}` }); }
      }
      for (const a of plan.adds) {
        const { ok, data } = await post({ action: 'add', paper: pickEditable(a.entry) });
        if (ok) { applyData(data); results.push({ ok: true, message: `Added ${data?.added?.title ? `"${data.added.title.slice(0, 60)}"` : a.label}` }); }
        else { failed.push(a.entry); results.push({ ok: false, message: `${a.label}: ${data?.error || 'could not add.'}` }); }
      }
    } catch {
      results.push({ ok: false, message: 'Network error — please try again.' });
    } finally {
      // Rebuild from the fresh list so new papers show their ids, keeping any
      // entries that failed (edited ones in place, new ones at the end) to fix.
      const keepEdits = new Map(failed.filter((e) => e.id).map((e) => [e.id, e]));
      const fresh = ranked(items).map((p) => keepEdits.get(p.id) ?? toJsonEntry(p));
      jsonText = serialize([...fresh, ...failed.filter((e) => !e.id)]);
      jsonResults = results.length ? results : [{ ok: true, message: 'Nothing to save — no changes.' }];
      jsonBusy = false;
    }
  }

  let copied = $state(false);
  async function copyJson() {
    try {
      await navigator.clipboard.writeText(jsonText);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* clipboard blocked — the text is selectable anyway */ }
  }

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
      {#if view === 'list'}
        <input class="cf-in search-in lit-search" type="search" placeholder="Search title, author, tag…" bind:value={query} aria-label="Search literature" />
        <div class="seg" role="radiogroup" aria-label="Sort literature">
          <button type="button" role="radio" aria-checked={sortBy === 'top'} onclick={() => (sortBy = 'top')}>Top</button>
          <button type="button" role="radio" aria-checked={sortBy === 'new'} onclick={() => (sortBy = 'new')}>Newest</button>
        </div>
      {/if}
      <div class="seg" role="radiogroup" aria-label="Literature view">
        <button type="button" role="radio" aria-checked={view === 'list'} onclick={() => (view = 'list')}>List</button>
        <button type="button" role="radio" aria-checked={view === 'json'} onclick={() => view !== 'json' && openJson()} title="Edit the list as JSON">{'{ }'} JSON</button>
      </div>
    {/if}
  </div>

  <div class="panel__bd">
    <p class="lit-blurb">Papers and articles worth knowing for cell-free protein synthesis.</p>

    {#if !kcUser}
      <div class="lit-locked">
        <span aria-hidden="true">🔒</span>
        <span>The literature list is members-only.</span>
        {#if kcConfigured || devMode}
          <a class="btn-bp" href={loginHref(page.url)} style="text-decoration:none;">Sign in to read &amp; add</a>
        {/if}
      </div>
    {:else}
      {#if errorMsg}<p class="lit-msg">{errorMsg}</p>{/if}

      {#if view === 'json'}
        <div class="lit-json">
          <p class="lit-hint lit-json__hint">
            Edit papers you added (keep their <code>id</code>) or append objects without an <code>id</code> to add them —
            a <code>doi</code> alone fills in the rest. Fields: {EDITABLE.join(', ')}. <code>added_by</code> / <code>votes</code> are read-only;
            removing an object here doesn't delete it.
          </p>
          <JsonEditor bind:this={listEditor} bind:value={jsonText} invalid={!jsonPlan.ok || jsonPlan.problems.length > 0} height={460} label="Literature list as JSON" />
          <div class="lit-json__status" role="status">
            {#if !jsonPlan.ok}
              <span class="lit-json__bad">✗ {jsonPlan.error}</span>
            {:else}
              <span class="lit-json__good">✓ valid JSON</span>
              <span>· {jsonPlan.adds.length} to add · {jsonPlan.updates.length} to update</span>
            {/if}
          </div>
          {#each jsonPlan.problems as msg}<p class="lit-msg lit-json__line">{msg}</p>{/each}
          {#each jsonResults as r}<p class="lit-msg lit-json__line" class:lit-msg--ok={r.ok}>{r.ok ? '✓' : '✗'} {r.message}</p>{/each}
          <div class="lit-actions">
            <button type="button" class="btn-bp" onclick={openJson} disabled={jsonBusy} title="Discard edits and reload the current list">Reset</button>
            <button type="button" class="btn-bp" onclick={copyJson}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button type="button" class="btn-bp" onclick={appendTemplate} disabled={jsonBusy || !jsonPlan.ok} title={jsonPlan.ok ? 'Append a blank paper to fill in' : 'Fix the JSON first'}>+ New paper</button>
            <button
              type="button"
              class="btn-bp"
              onclick={applyJson}
              disabled={jsonBusy || !jsonPlan.ok || jsonPlan.problems.length > 0 || !(jsonPlan.adds.length + jsonPlan.updates.length)}
              style="color:var(--teal-ink);border-color:var(--teal);"
            >{jsonBusy ? 'Saving…' : 'Apply changes ▸'}</button>
          </div>
        </div>
      {:else if showForm}
        <div class="inset lit-form">
          <div class="lit-form__hd">
            <button type="button" class="btn-bp" onclick={closeForm}>‹ List</button>
            <span class="label">{editingId ? 'edit your paper' : 'add a paper'}</span>
            <div class="seg" role="radiogroup" aria-label="Form input mode">
              <button type="button" role="radio" aria-checked={formMode === 'form'} onclick={() => setFormMode('form')}>Form</button>
              <button type="button" role="radio" aria-checked={formMode === 'json'} onclick={() => setFormMode('json')}>{'{ }'} JSON</button>
            </div>
          </div>
          {#if formMode === 'json'}
            <p class="lit-hint lit-json__hint">
              {editingId ? 'Edit this paper as JSON.' : 'One paper object — or an array of them to add several at once.'}
              Fields: {EDITABLE.join(', ')}. A <code>doi</code> alone fills in title, authors, date and venue.
            </p>
            <JsonEditor bind:this={formEditor} bind:value={formJson} invalid={!formJsonPlan.ok} height={260} label="Paper as JSON" />
            <div class="lit-json__status" role="status">
              {#if !formJsonPlan.ok}
                <span class="lit-json__bad">✗ {formJsonPlan.error}</span>
              {:else}
                <span class="lit-json__good">✓ valid JSON</span>
                <span>· {formJsonPlan.entries.length} paper{formJsonPlan.entries.length === 1 ? '' : 's'}</span>
                {#if formJsonPlan.ignored.length}<span>· ignored: {formJsonPlan.ignored.join(', ')}</span>{/if}
              {/if}
            </div>
          {:else}
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
          {/if}
          {#if formMsg}<p class="lit-msg" class:lit-msg--ok={!formErrors.length && !/fail|error|not|already/i.test(formMsg)}>{formMsg}</p>{/if}
          <div class="lit-form__foot">
            <span class="lit-hint">* a title and a link (or DOI) are required</span>
            {#if formMode === 'json' && !editingId}
              <button type="button" class="btn-bp lit-form__more" onclick={appendFormTemplate} disabled={adding || !formJsonPlan.ok} title={formJsonPlan.ok ? 'Add another blank paper to this submission' : 'Fix the JSON first'}>+ Another paper</button>
            {/if}
            <button
              type="button"
              class="btn-bp"
              disabled={adding || (formMode === 'json' ? !formJsonPlan.ok || !formJsonPlan.entries.length : summaryWords > SUMMARY_WORD_LIMIT)}
              onclick={savePaper}
              style="color:var(--teal-ink);border-color:var(--teal);"
            >{adding ? 'Saving…' : editingId ? 'Save changes ▸' : formMode === 'json' && formJsonPlan.entries.length > 1 ? `Add ${formJsonPlan.entries.length} papers ▸` : 'Add paper ▸'}</button>
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
  .panel__hd .lit-search { flex: 0 1 220px; width: 220px; max-width: 40vw; }
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
  .lit-form__more { margin-left: auto; }

  /* JSON view */
  .lit-json { display: flex; flex-direction: column; gap: 6px; }
  .lit-json__hint { margin: 0; line-height: 1.5; color: var(--muted); }
  .lit-json__hint code { font: inherit; color: var(--ink-2); }
  .lit-json__status { display: flex; flex-wrap: wrap; gap: 6px; font: 10px var(--mono); color: var(--muted); }
  .lit-json__good { color: var(--teal-ink); }
  .lit-json__bad { color: var(--err); }
  .lit-json__line { margin: 0; }
</style>

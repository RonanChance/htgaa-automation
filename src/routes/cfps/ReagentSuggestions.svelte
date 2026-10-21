<script>
  import { loginHref } from './loginHref.js';
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import JsonEditor from './JsonEditor.svelte';
  import { serialize, parseEntries } from './jsonEdit.js';

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
  let f = $state({ name: '', concentration: '', category: '', ph: '', link: '', description: '', ai_conversation_link: '' });
  // The suggest form can also be filled in as JSON (one reagent object, or an array
  // to suggest several). JSON can carry keys the form has no field for; switching
  // back to the form keeps them in `fExtra` so they're still submitted.
  let suggestMode = $state('form'); // 'form' | 'json'
  let suggestJson = $state('');
  let fExtra = $state({});

  // Collapsible comment threads: which suggestion ids are expanded, per-row draft
  // text, and which rows have an in-flight comment write.
  let openThreads = $state(new Set());
  let commentDraft = $state({});
  let commenting = $state(new Set());

  // Delete-your-own-suggestion: the suggestion id currently awaiting a confirm click
  // (only set when it has upvotes — a zero-vote suggestion deletes immediately), plus
  // the ids with an in-flight delete.
  let confirmDeleteId = $state(null);
  let deleting = $state(new Set());

  let kcNotice = $derived(page.url.searchParams.get('kc'));

  const CATEGORIES = ['Salts', 'Energy', 'Nucleotides', 'Cofactors', 'Redox', 'Buffers', 'Other'];

  // Keys rendered specially; everything else becomes a generic attribute tag.
  const TITLE_KEYS = ['name', 'reagent', 'title'];
  const PH_KEYS = ['ph', 'pH'];
  const CONC_KEYS = ['concentration', 'conc', 'stock', 'stock_conc', 'stock_concentration'];
  const CATEGORY_KEYS = ['category', 'cat', 'type', 'class'];
  const LINK_KEYS = ['link', 'url', 'href', 'reference', 'ref'];
  // Optional provenance an AI agent can attach: which model, and a public link to
  // the conversation that proposed the reagent.
  const AI_LINK_KEYS = ['ai_conversation_link', 'conversation_link', 'chat_link'];
  const AI_MODEL_KEYS = ['ai_model', 'model'];
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
      [...TITLE_KEYS, ...PH_KEYS, ...CONC_KEYS, ...CATEGORY_KEYS, ...LINK_KEYS, ...AI_LINK_KEYS, ...AI_MODEL_KEYS, ...NOTE_KEYS, ...PROPOSER_KEYS].map((k) => k.toLowerCase())
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
  function aiLinkFor(s) {
    const l = pick(s.suggestion, AI_LINK_KEYS);
    if (!l) return '';
    return /^https?:\/\//i.test(l) ? l : `https://${l}`;
  }
  function aiModelFor(s) { return pick(s.suggestion, AI_MODEL_KEYS); }

  // Comment length is capped at 500 words (enforced again server-side).
  const COMMENT_WORD_LIMIT = 500;
  // Count words, but don't let someone dodge the limit by omitting spaces: any
  // single run of non-space characters longer than CHARS_PER_WORD counts as
  // multiple words. Keep this in sync with countWords() in server/suggestions.js.
  const CHARS_PER_WORD = 15;
  function wordCount(t) {
    const s = String(t || '').trim();
    if (!s) return 0;
    return s.split(/\s+/).reduce((n, tok) => n + Math.max(1, Math.ceil(tok.length / CHARS_PER_WORD)), 0);
  }

  // Short, human date for comment timestamps (e.g. "Sep 18").
  function fmtWhen(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function applyData(data) {
    if (Array.isArray(data?.suggestions)) items = sortByVotes(data.suggestions);
    if (Array.isArray(data?.votedSuggestionIds)) voted = new Set(data.votedSuggestionIds);
  }

  function toggleThread(id) {
    const next = new Set(openThreads);
    if (next.has(id)) next.delete(id); else next.add(id);
    openThreads = next;
  }

  async function postCommentFor(s) {
    const text = (commentDraft[s.id] || '').trim();
    if (!kcUser || !text || commenting.has(s.id)) return;
    errorMsg = '';
    commenting = new Set(commenting).add(s.id);
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'comment', id: s.id, body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) errorMsg = data?.error || 'Could not post your comment.';
      else { applyData(data); commentDraft = { ...commentDraft, [s.id]: '' }; }
    } catch {
      errorMsg = 'Network error — please try again.';
    } finally {
      const next = new Set(commenting); next.delete(s.id); commenting = next;
    }
  }

  async function deleteCommentFor(c) {
    if (!kcUser) return;
    errorMsg = '';
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'uncomment', id: c.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) errorMsg = data?.error || 'Could not delete your comment.';
      else applyData(data);
    } catch {
      errorMsg = 'Network error — please try again.';
    }
  }

  // Delete one of your OWN suggestions. With no upvotes it's removed immediately; with
  // upvotes it takes two clicks (the first arms `confirmDeleteId`, surfacing a confirm
  // button) so a well-liked suggestion isn't dropped by accident. Server re-checks
  // ownership regardless.
  function requestDeleteSuggestion(s) {
    if (!kcUser || !s?.mine || deleting.has(s.id)) return;
    errorMsg = '';
    if ((Number(s.votes) || 0) > 0) {
      confirmDeleteId = s.id; // has upvotes → require explicit confirmation
    } else {
      deleteSuggestionFor(s); // no upvotes → delete right away
    }
  }

  function cancelDeleteSuggestion() { confirmDeleteId = null; }

  async function deleteSuggestionFor(s) {
    if (!kcUser || !s?.mine || deleting.has(s.id)) return;
    errorMsg = '';
    deleting = new Set(deleting).add(s.id);
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: s.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) errorMsg = data?.error || 'Could not delete your suggestion.';
      else applyData(data);
    } catch {
      errorMsg = 'Network error — please try again.';
    } finally {
      const next = new Set(deleting); next.delete(s.id); deleting = next;
      confirmDeleteId = null;
    }
  }

  // Decorative "encrypted" teaser shown to logged-out visitors in place of the real
  // ranking. Generated deterministically (seeded) so SSR and hydration agree — it
  // carries NO real data; the server never sends suggestions to anonymous users.
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&<>/=+*·';
  function scramble(seed, n) {
    let x = (seed * 2654435761) % 2147483647;
    let out = '';
    for (let i = 0; i < n; i++) { x = (x * 48271) % 2147483647; out += GLYPHS[x % GLYPHS.length]; }
    return out;
  }
  // Same field lengths on every row so the rows are all identical width; only the
  // (meaningless) glyph content varies between them.
  const teaserRows = Array.from({ length: 8 }, (_, i) => ({
    name: scramble(i * 7 + 3, 12),
    tag: scramble(i * 11 + 5, 7),
    note: scramble(i * 13 + 9, 46),
    votes: scramble(i * 17 + 2, 2),
  }));

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

  // ── JSON view + JSON suggest mode ────────────────────────────────────────
  // Each suggestion is a flat dict of text values. In JSON, `id` marks an existing
  // suggestion (edits are saved only for your own — the server replaces the whole
  // dict, so a removed key is dropped); `proposed_by` / `votes` are read-only.
  // Removing an object here does NOT delete it (use 🗑 in the list).
  const READONLY = ['id', 'votes', 'proposed_by'];
  const FORM_KEYS = ['name', 'concentration', 'category', 'ph', 'link', 'description', 'ai_conversation_link'];
  let view = $state('list'); // 'list' | 'json'
  let jsonText = $state('');
  let jsonBusy = $state(false);
  let jsonResults = $state([]); // [{ ok, message }]

  function toJsonEntry(s) {
    const { proposed_by, ...fields } = s.suggestion || {};
    const by = proposed_by || 'anonymous';
    return { id: s.id, ...fields, proposed_by: s.mine ? `${by} (you)` : by, votes: s.votes ?? 0 };
  }
  function openJson() {
    jsonText = serialize(items.map(toJsonEntry));
    jsonResults = [];
    showSuggestForm = false;
    view = 'json';
  }
  // Append a blank reagent (to the list JSON, or the suggest form's JSON) and jump
  // the editor to its name so it's visible and ready to type into.
  let listEditor = $state(null);
  let suggestEditor = $state(null);
  const blankReagent = () => Object.fromEntries(FORM_KEYS.map((k) => [k, '']));
  function appendTemplate() {
    const parsed = parseEntries(jsonText);
    if (!parsed.ok) return; // don't clobber text that doesn't parse
    jsonText = serialize([...parsed.entries, blankReagent()]);
    listEditor?.revealLast('"name": "');
  }
  function appendSuggestTemplate() {
    const parsed = parseEntries(suggestJson);
    if (!parsed.ok) return;
    suggestJson = serialize([...parsed.entries, blankReagent()]);
    suggestEditor?.revealLast('"name": "');
  }

  // An entry's submittable fields (read-only keys dropped), plus any value that
  // isn't plain text/number/boolean — those can't be stored in a flat dict.
  function dictOf(e) {
    const dict = {};
    const nested = [];
    for (const [k, v] of Object.entries(e)) {
      if (READONLY.includes(k)) continue;
      if (v != null && typeof v === 'object') nested.push(k);
      else dict[k] = v;
    }
    return { dict, nested };
  }
  // Order-independent form of a dict for change detection (blank values ignored).
  function comparable(dict) {
    const out = {};
    for (const k of Object.keys(dict).sort()) {
      if (k === 'proposed_by' || k.startsWith('_')) continue;
      const v = String(dict[k] ?? '').trim();
      if (v) out[k] = v;
    }
    return JSON.stringify(out);
  }
  const hasContent = (dict) => comparable(dict) !== '{}';
  const labelFor = (e, i) => `#${i + 1}${e.name ? ` "${String(e.name).slice(0, 50)}"` : ''}`;

  // What Apply would do — new suggestions, edits to your own, and problems.
  const jsonPlan = $derived.by(() => {
    const parsed = parseEntries(jsonText);
    if (!parsed.ok) return { ok: false, error: parsed.error, adds: [], updates: [], problems: [] };
    const byId = new Map(items.map((s) => [s.id, s]));
    const adds = [];
    const updates = [];
    const problems = [];
    parsed.entries.forEach((e, i) => {
      const label = labelFor(e, i);
      const { dict, nested } = dictOf(e);
      if (!e.id && !hasContent(dict)) return; // untouched template
      const orig = e.id ? byId.get(e.id) : null;
      if (e.id && !orig) { problems.push(`${label}: no suggestion with id ${e.id} — drop the id to add it as new.`); return; }
      if (orig && comparable(dict) === comparable(orig.suggestion || {})) return; // unchanged
      if (orig && !orig.mine) { problems.push(`${label}: suggested by ${orig.suggestion?.proposed_by || 'someone else'} — only your own can be edited.`); return; }
      if (nested.length) { problems.push(`${label}: ${nested.join(', ')} must be text or a number, not a list/object.`); return; }
      if (!String(dict.name ?? '').trim()) { problems.push(`${label}: "name" is required.`); return; }
      (orig ? updates : adds).push({ entry: e, id: e.id, dict, label });
    });
    return { ok: true, adds, updates, problems };
  });

  async function postSuggestions(payload) {
    const res = await fetch('/cfps/suggestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function applyJson() {
    const plan = jsonPlan;
    if (!kcUser || !plan.ok || plan.problems.length || jsonBusy) return;
    jsonBusy = true;
    jsonResults = [];
    const failed = [];
    const results = [];
    try {
      for (const u of plan.updates) {
        const { ok, data } = await postSuggestions({ action: 'update', id: u.id, suggestion: u.dict });
        if (ok) { applyData(data); results.push({ ok: true, message: `Updated ${u.label}` }); }
        else { failed.push(u.entry); results.push({ ok: false, message: `${u.label}: ${data?.error || 'could not save.'}` }); }
      }
      for (const a of plan.adds) {
        const { ok, data } = await postSuggestions({ action: 'suggest', suggestion: a.dict });
        if (ok) { applyData(data); results.push({ ok: true, message: `Suggested ${a.label}` }); }
        else { failed.push(a.entry); results.push({ ok: false, message: `${a.label}: ${data?.error || 'could not add.'}` }); }
      }
    } catch {
      results.push({ ok: false, message: 'Network error — please try again.' });
    } finally {
      // Rebuild from the fresh list (new suggestions show their ids), keeping any
      // failed entries — edited ones in place, new ones at the end — to fix.
      const keepEdits = new Map(failed.filter((e) => e.id).map((e) => [e.id, e]));
      const fresh = items.map((s) => keepEdits.get(s.id) ?? toJsonEntry(s));
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

  const formToDict = () => ({ ...Object.fromEntries(FORM_KEYS.map((k) => [k, f[k]])), ...fExtra });

  // Switch the suggest form between fields and JSON, carrying the values across.
  function setSuggestMode(mode) {
    if (mode === suggestMode) return;
    suggestMsg = '';
    if (mode === 'json') {
      suggestJson = serialize(formToDict());
      suggestMode = 'json';
      return;
    }
    const parsed = parseEntries(suggestJson);
    if (!parsed.ok) { suggestMsg = `Fix the JSON first — ${parsed.error}`; return; }
    if (parsed.entries.length > 1) { suggestMsg = 'The form holds one reagent — suggest several from JSON.'; return; }
    const { dict, nested } = dictOf(parsed.entries[0] ?? {});
    if (nested.length) { suggestMsg = `${nested.join(', ')} must be text or a number.`; return; }
    const str = (v) => (v == null ? '' : String(v));
    f = Object.fromEntries(FORM_KEYS.map((k) => [k, str(dict[k])]));
    fExtra = Object.fromEntries(Object.entries(dict).filter(([k, v]) => !FORM_KEYS.includes(k) && str(v).trim()));
    suggestMode = 'form';
  }

  const suggestJsonPlan = $derived.by(() => {
    const parsed = parseEntries(suggestJson);
    if (!parsed.ok) return { ok: false, error: parsed.error, entries: [], problems: [] };
    const entries = [];
    const problems = [];
    parsed.entries.forEach((e, i) => {
      const { dict, nested } = dictOf(e);
      if (!hasContent(dict)) return;
      if (nested.length) problems.push(`${labelFor(e, i)}: ${nested.join(', ')} must be text or a number.`);
      else if (!String(dict.name ?? '').trim()) problems.push(`${labelFor(e, i)}: "name" is required.`);
      else entries.push({ entry: e, dict });
    });
    return { ok: true, entries, problems };
  });

  function resetSuggestForm() {
    f = { name: '', concentration: '', category: '', ph: '', link: '', description: '', ai_conversation_link: '' };
    fExtra = {};
    suggestJson = serialize(formToDict());
  }
  function openSuggestForm() {
    suggestMsg = '';
    if (suggestMode === 'json') suggestJson = serialize(formToDict());
    showSuggestForm = true;
  }

  // Submit from JSON mode: suggest every entry; failures stay in the editor.
  async function submitSuggestionJson() {
    const plan = suggestJsonPlan;
    if (!plan.ok) { suggestMsg = plan.error; return; }
    if (plan.problems.length) { suggestMsg = plan.problems.join(' · '); return; }
    if (!plan.entries.length) { suggestMsg = 'Nothing to submit — give the reagent a "name".'; return; }
    submitting = true;
    const failed = [];
    const errors = [];
    try {
      for (const { entry, dict } of plan.entries) {
        const { ok, data } = await postSuggestions({ action: 'suggest', suggestion: dict });
        if (ok) applyData(data);
        else { failed.push(entry); errors.push(`${dict.name}: ${data?.error || 'could not submit.'}`); }
      }
    } catch {
      suggestMsg = 'Network error — please try again.';
      submitting = false;
      return;
    }
    submitting = false;
    if (!failed.length) { resetSuggestForm(); showSuggestForm = false; return; }
    suggestMsg = errors.join(' · ');
    suggestJson = serialize(failed.length === 1 ? failed[0] : failed);
  }

  async function submitSuggestion() {
    if (!kcUser || submitting) return;
    if (suggestMode === 'json') return submitSuggestionJson();
    suggestMsg = '';
    if (!f.name.trim()) { suggestMsg = 'Reagent name is required.'; return; }
    submitting = true;
    try {
      const res = await fetch('/cfps/suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'suggest', suggestion: formToDict() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        suggestMsg = data?.error || 'Could not submit your suggestion.';
      } else {
        applyData(data);
        resetSuggestForm();
        showSuggestForm = false;
      }
    } catch {
      suggestMsg = 'Network error — please try again.';
    } finally {
      submitting = false;
    }
  }

  onMount(() => {
    // Only signed-in users have a real list to keep in sync — anonymous visitors
    // see the static teaser, so there's nothing to poll.
    if (!kcUser) return;
    refresh();
    pollTimer = setInterval(refresh, 12000);
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<div class="panel cr-panel" class:panel--embed={embedded}>
  <div class="panel__hd">
    <span class="label">community reagents · vote &amp; suggest</span>
    <span class="spacer"></span>
    {#if kcUser}
      <div class="seg" role="radiogroup" aria-label="Community reagents view">
        <button type="button" role="radio" aria-checked={view === 'list'} onclick={() => (view = 'list')}>List</button>
        <button type="button" role="radio" aria-checked={view === 'json'} onclick={() => view !== 'json' && openJson()} title="Edit the suggestions as JSON">{'{ }'} JSON</button>
      </div>
      <span class="tag" style="text-transform:none;letter-spacing:0;">signed in · {kcUser.name}</span>
      <form method="POST" action="?/kcLogout" style="display:inline;">
        <button type="submit" class="icon" title="Sign out">⎋</button>
      </form>
    {:else if kcConfigured || devMode}
      <a class="btn-bp" href={loginHref(page.url)} style="text-decoration:none;">Sign in</a>
    {:else}
      <span class="tag" style="color:var(--muted);">login not configured yet</span>
    {/if}
  </div>

  <div class="panel__bd">
    {#if kcNotice === 'error'}
      <div class="cfps-banner" style="margin-bottom:14px;">
        <span style="color:var(--err);">○</span>
        <div style="flex:1;color:var(--err);">Sign-in failed. Please try again.</div>
      </div>
    {/if}
    {#if errorMsg}<p class="cr-msg">{errorMsg}</p>{/if}
    {#if suggestMsg}<p class="cr-msg">{suggestMsg}</p>{/if}

    {#if !kcUser}
      <!-- Members-only: a scrambled teaser + sign-in CTA. The server never sends
           real suggestions to anonymous visitors, so there is nothing to leak. -->
      <div class="cr-teaser">
        <div class="cr-teaser__rows" aria-hidden="true">
          {#each teaserRows as t, i}
            <div class="cr-teaser__row">
              <span class="cr-teaser__rank">#{i + 1}</span>
              <span class="cr-teaser__votes">{t.votes}</span>
              <span class="cr-teaser__body">
                <span class="cr-teaser__name">{t.name}</span>
                <span class="cr-teaser__tag">{t.tag}</span>
                <span class="cr-teaser__note">{t.note}</span>
              </span>
            </div>
          {/each}
        </div>
        <div class="cr-teaser__cta">
          <span class="cr-teaser__lock" aria-hidden="true">🔒</span>
          <p class="cr-teaser__title">Community reagents are members-only</p>
          <p class="cr-teaser__sub">Sign in to browse ideas, upvote, comment, and suggest your own.</p>
          {#if kcConfigured || devMode}
            <a class="btn-bp cr-teaser__btn" href={loginHref(page.url)} style="text-decoration:none;">Sign in to view</a>
          {:else}
            <span class="tag" style="color:var(--muted);">login not configured yet</span>
          {/if}
        </div>
      </div>
    {:else if view === 'json'}
      <div class="cr-json">
        <p class="cr-json__hint">
          Edit your own suggestions (keep their <code>id</code>) or append objects without an <code>id</code> to suggest them.
          <code>name</code> is required; {FORM_KEYS.slice(1).join(', ')} are the usual fields, and any other key is shown as a tag.
          <code>proposed_by</code> / <code>votes</code> are read-only; removing an object here doesn't delete it.
        </p>
        <JsonEditor bind:this={listEditor} bind:value={jsonText} invalid={!jsonPlan.ok || jsonPlan.problems.length > 0} height={embedded ? 300 : 460} label="Community reagent suggestions as JSON" />
        <div class="cr-json__status" role="status">
          {#if !jsonPlan.ok}
            <span class="cr-json__bad">✗ {jsonPlan.error}</span>
          {:else}
            <span class="cr-json__good">✓ valid JSON</span>
            <span>· {jsonPlan.adds.length} to add · {jsonPlan.updates.length} to update</span>
          {/if}
        </div>
        {#each jsonPlan.problems as msg}<p class="cr-msg cr-json__line">{msg}</p>{/each}
        {#each jsonResults as r}<p class="cr-msg cr-json__line" class:cr-msg--ok={r.ok}>{r.ok ? '✓' : '✗'} {r.message}</p>{/each}
        <div class="cr-foot">
          <button type="button" class="btn-bp" onclick={openJson} disabled={jsonBusy} title="Discard edits and reload the current list">Reset</button>
          <button type="button" class="btn-bp" onclick={copyJson}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <button type="button" class="btn-bp" onclick={appendTemplate} disabled={jsonBusy || !jsonPlan.ok} title={jsonPlan.ok ? 'Append a blank reagent to fill in' : 'Fix the JSON first'}>+ New reagent</button>
          <button
            type="button"
            class="btn-bp"
            onclick={applyJson}
            disabled={jsonBusy || !jsonPlan.ok || jsonPlan.problems.length > 0 || !(jsonPlan.adds.length + jsonPlan.updates.length)}
            style="color:var(--teal-ink);border-color:var(--teal);"
          >{jsonBusy ? 'Saving…' : 'Apply changes ▸'}</button>
        </div>
      </div>
    {:else}
      <!-- live ranked list -->
      <div class="cr-list">
        {#if items.length === 0}
          <p class="cr-empty">No suggestions yet — be the first to add one.</p>
        {:else}
          <div class="cr-rows">
            {#each items as s, i (s.id)}
              {@const hasVoted = voted.has(s.id)}
              {@const link = linkFor(s)}
              {@const aiLink = aiLinkFor(s)}
              {@const aiModel = aiModelFor(s)}
              {@const ph = phFor(s)}
              {@const spec = specFor(s)}
              {@const note = noteFor(s)}
              {@const proposer = proposerFor(s)}
              {@const attrs = extraAttrs(s.suggestion)}
              {@const comments = s.comments ?? []}
              {@const open = openThreads.has(s.id)}
              <div class="inset cr-item">
                <div class="cr-item__main">
                  <span class="cr-rank">#{i + 1}</span>
                  <div class="cr-vote">
                    <button
                      type="button"
                      class="icon"
                      disabled={busy.has(s.id)}
                      onclick={() => toggleVote(s)}
                      title={hasVoted ? 'Remove your vote' : 'Upvote this reagent'}
                      style="font-size:12px;line-height:1;width:20px;height:18px;{hasVoted ? 'color:var(--phosphor);border-color:var(--phosphor);' : ''}"
                    >▲</button>
                    <span class="mono cr-votes" style="color:{hasVoted ? 'var(--phosphor)' : 'var(--ink-2)'};">{s.votes ?? 0}</span>
                  </div>

                  <div class="cr-detail">
                    <div class="row" style="gap:6px;align-items:baseline;flex-wrap:wrap;">
                      <span class="cr-name">{titleFor(s)}</span>
                      {#if ph}<span class="tag">pH {ph}</span>{/if}
                      {#if spec}<span class="tag" style="text-transform:none;letter-spacing:0;">{spec}</span>{/if}
                      {#each attrs as a}<span class="tag" style="text-transform:none;letter-spacing:0;">{a.k}: {a.v}</span>{/each}
                      {#if link}
                        <a href={link} target="_blank" rel="noopener noreferrer" class="mono" style="font-size:10px;color:var(--teal);">link ↗</a>
                      {/if}
                      {#if aiLink}
                        <a href={aiLink} target="_blank" rel="noopener noreferrer" class="tag cr-ai" title="Read the AI conversation that proposed this reagent">{aiModel || 'AI'} chat ↗</a>
                      {:else if aiModel}
                        <span class="tag" style="text-transform:none;letter-spacing:0;">{aiModel}</span>
                      {/if}
                    </div>
                    {#if note}<p class="cr-note">{note}</p>{/if}
                    {#if proposer}<p class="cr-by">suggested by {proposer}</p>{/if}
                  </div>

                  <button
                    type="button"
                    class="cbtn cr-cbtn"
                    class:is-on={open}
                    onclick={() => toggleThread(s.id)}
                    title={open ? 'Hide comments' : 'Show comments'}
                    aria-expanded={open}
                  >💬 {comments.length}</button>

                  {#if s.mine}
                    {#if confirmDeleteId === s.id}
                      <div class="cr-del-confirm">
                        <span class="cr-del-confirm__q">Delete? It has {s.votes} upvote{s.votes === 1 ? '' : 's'}.</span>
                        <button type="button" class="cr-del-confirm__yes" onclick={() => deleteSuggestionFor(s)} disabled={deleting.has(s.id)} title="Confirm delete">Delete</button>
                        <button type="button" class="cr-del-confirm__no" onclick={cancelDeleteSuggestion} disabled={deleting.has(s.id)} title="Keep it">Cancel</button>
                      </div>
                    {:else}
                      <button
                        type="button"
                        class="cr-del"
                        onclick={() => requestDeleteSuggestion(s)}
                        disabled={deleting.has(s.id)}
                        title="Delete your suggestion"
                        aria-label="Delete your suggestion"
                      >🗑</button>
                    {/if}
                  {/if}
                </div>

                {#if open}
                  <div class="cr-thread">
                    {#if comments.length === 0}
                      <p class="cr-thread__empty">No comments yet — start the thread.</p>
                    {:else}
                      {#each comments as c (c.id)}
                        <div class="cr-comment">
                          <div class="cr-comment__meta">
                            <span class="cr-comment__who">{c.author}</span>
                            {#if c.created}<span class="cr-comment__when">· {fmtWhen(c.created)}</span>{/if}
                            {#if c.mine}
                              <button type="button" class="cr-comment__del" onclick={() => deleteCommentFor(c)} title="Delete your comment">✕</button>
                            {/if}
                          </div>
                          <p class="cr-comment__body">{c.body}</p>
                        </div>
                      {/each}
                    {/if}
                    {#if kcUser}
                      {@const words = wordCount(commentDraft[s.id])}
                      {@const remaining = COMMENT_WORD_LIMIT - words}
                      <div class="cr-compose">
                        <div class="cr-compose__field">
                          <textarea
                            class="cf-in cr-compose__in"
                            rows="2"
                            placeholder="Add a comment…"
                            bind:value={commentDraft[s.id]}
                          ></textarea>
                          <span class="cr-compose__count" class:cr-compose__count--over={remaining < 0}>{remaining}</span>
                        </div>
                        <div class="cr-compose__actions">
                          <button
                            type="button"
                            class="btn-bp cr-compose__btn"
                            disabled={commenting.has(s.id) || words === 0 || remaining < 0}
                            onclick={() => postCommentFor(s)}
                          >Post</button>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- suggest-a-reagent: anchored bottom-right; opens an inline form -->
      {#if showSuggestForm}
        <div class="inset cr-suggest">
          <div class="cr-suggest__hd">
            <button type="button" class="btn-bp cr-suggest__back" onclick={() => (showSuggestForm = false)}>‹ Vote list</button>
            <span class="label">suggest a reagent</span>
            <div class="seg" role="radiogroup" aria-label="Suggest input mode">
              <button type="button" role="radio" aria-checked={suggestMode === 'form'} onclick={() => setSuggestMode('form')}>Form</button>
              <button type="button" role="radio" aria-checked={suggestMode === 'json'} onclick={() => setSuggestMode('json')}>{'{ }'} JSON</button>
            </div>
          </div>
          {#if suggestMode === 'json'}
            <p class="cr-json__hint">
              One reagent object — or an array to suggest several. <code>name</code> is required; add any other keys
              (e.g. <code>"supplier"</code>) and they're shown as tags. If an AI proposed this, include
              <code>"ai_model"</code> and a public <code>"ai_conversation_link"</code> so others can read the reasoning.
            </p>
            <JsonEditor bind:this={suggestEditor} bind:value={suggestJson} invalid={!suggestJsonPlan.ok || suggestJsonPlan.problems.length > 0} height={200} label="Reagent suggestion as JSON" />
            <div class="cr-json__status" role="status">
              {#if !suggestJsonPlan.ok}
                <span class="cr-json__bad">✗ {suggestJsonPlan.error}</span>
              {:else}
                <span class="cr-json__good">✓ valid JSON</span>
                <span>· {suggestJsonPlan.entries.length} reagent{suggestJsonPlan.entries.length === 1 ? '' : 's'}</span>
              {/if}
            </div>
            {#each suggestJsonPlan.problems as msg}<p class="cr-msg cr-json__line">{msg}</p>{/each}
          {:else}
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
          <label class="cr-suggest__full">
            <span class="label">AI conversation link <span class="cr-opt">optional — if an AI helped</span></span>
            <input bind:value={f.ai_conversation_link} class="cf-in" placeholder="https://… public share link to the chat that proposed this" />
          </label>
          {#if Object.keys(fExtra).length}
            <p class="cr-json__hint">Also submitting from JSON: {Object.keys(fExtra).join(', ')} <span class="cr-json__muted">(edit in JSON)</span></p>
          {/if}
          {/if}
          <div class="cr-suggest__foot">
            {#if suggestMode === 'json'}
              <button type="button" class="btn-bp" onclick={appendSuggestTemplate} disabled={submitting || !suggestJsonPlan.ok} title={suggestJsonPlan.ok ? 'Add another blank reagent to this submission' : 'Fix the JSON first'}>+ Another reagent</button>
            {/if}
            <button
              type="button"
              class="btn-bp"
              disabled={submitting || (suggestMode === 'json' && (!suggestJsonPlan.ok || suggestJsonPlan.problems.length > 0 || !suggestJsonPlan.entries.length))}
              onclick={submitSuggestion}
              style="color:var(--teal-ink);border-color:var(--teal);"
            >
              {submitting ? 'Submitting…' : suggestMode === 'json' && suggestJsonPlan.entries.length > 1 ? `Submit ${suggestJsonPlan.entries.length} ▸` : 'Submit ▸'}
            </button>
          </div>
        </div>
      {:else}
        <div class="cr-foot">
          <!-- Plain-text copy of the ranked list (with comments) in a new tab. -->
          <a class="btn-bp" href="/cfps/suggestions?format=txt" target="_blank" rel="noopener" title="Open the list as plain text" aria-label="Open the reagent suggestions as plain text" style="text-decoration:none;">↓</a>
          <button type="button" class="btn-bp" onclick={openSuggestForm}>+ Suggest a reagent</button>
        </div>
      {/if}
    {/if}
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

  /* JSON view */
  .cr-json { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .cr-json__hint { margin: 0; font: 9.5px/1.5 var(--mono); color: var(--muted); }
  .cr-json__hint code { font: inherit; color: var(--ink-2); }
  .cr-json__muted { color: var(--faint); }
  .cr-json__status { display: flex; flex-wrap: wrap; gap: 6px; font: 10px var(--mono); color: var(--muted); }
  .cr-json__good { color: var(--teal-ink); }
  .cr-json__bad { color: var(--err); }
  .cr-json__line { margin: 0; }
  .cr-msg--ok { color: var(--teal-ink); }
  .cr-suggest__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 8px;
  }
  .cr-suggest label { display: flex; flex-direction: column; gap: 3px; }
  .cr-suggest :global(.cf-in) { padding: 4px 6px; font-size: 11px; }
  .cr-suggest textarea:global(.cf-in) { resize: vertical; min-height: 40px; }
  .cr-suggest__foot { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }

  /* ── messages ─────────────────────────────────────────────────────────────── */
  .cr-msg { font: 11px var(--mono); color: var(--err); margin: 0 0 10px; }
  .cr-opt { color: var(--faint); text-transform: none; letter-spacing: 0; }
  /* Link out to the conversation that proposed a reagent. */
  .cr-ai { text-transform: none; letter-spacing: 0; color: var(--teal-ink); border-color: var(--teal); text-decoration: none; }
  .cr-ai:hover { background: var(--teal-wash); }
  .cr-empty { font: 12px var(--mono); color: var(--faint); text-align: center; padding: 18px 0; }

  /* ── ranked list (full-width): cap height so a long list scrolls in place ──── */
  .cr-list { max-height: 560px; overflow-y: auto; padding-right: 2px; }
  /* Own flex column — NOT DaisyUI's `.stack`, which is a "deck" component that
     scales + fades each successive child (rows funnel narrower and fainter). */
  .cr-rows { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
  .cr-item { display: flex; flex-direction: column; padding: 7px 10px; width: 100%; box-sizing: border-box; }
  .cr-item__main { display: flex; gap: 10px; align-items: center; }
  .cr-rank { min-width: 20px; text-align: right; font-size: 11px; font-family: var(--mono); color: var(--faint); }
  .cr-vote { display: flex; align-items: center; gap: 5px; min-width: 44px; }
  .cr-votes { font-size: 12px; font-weight: 600; }
  .cr-detail { flex: 1; min-width: 0; }
  .cr-name { font-weight: 600; font-size: 12px; color: var(--ink); }
  /* Higher-contrast writeup — was var(--muted); bumped so it's easy to read. */
  .cr-note { font: 11px/1.5 var(--mono); color: var(--ink-2); margin: 3px 0 0; }
  .cr-by { font: 9px var(--mono); color: var(--muted); margin: 2px 0 0; }

  /* ── collapsible comment thread ───────────────────────────────────────────── */
  .cr-cbtn { align-self: flex-start; }
  /* Delete-your-own-suggestion control (only shown on your own rows). */
  .cr-del {
    flex: 0 0 auto; align-self: flex-start; white-space: nowrap;
    font-size: 11px; line-height: 1; color: var(--faint);
    background: transparent; border: 1px solid var(--hair); border-radius: var(--r-sm);
    padding: 3px 6px; cursor: pointer;
  }
  .cr-del:hover:not([disabled]) { color: var(--err); border-color: var(--err); }
  .cr-del[disabled] { opacity: .5; cursor: default; }
  .cr-del-confirm {
    flex: 0 0 auto; align-self: flex-start; display: flex; align-items: center; gap: 5px;
    flex-wrap: wrap;
  }
  .cr-del-confirm__q { font: 9px var(--mono); color: var(--muted); }
  .cr-del-confirm__yes, .cr-del-confirm__no {
    font: 10px var(--mono); border-radius: var(--r-sm); padding: 3px 7px; cursor: pointer;
  }
  .cr-del-confirm__yes { color: #fff; background: var(--err); border: 1px solid var(--err); }
  .cr-del-confirm__no { color: var(--muted); background: transparent; border: 1px solid var(--hair); }
  .cr-del-confirm__yes[disabled], .cr-del-confirm__no[disabled] { opacity: .5; cursor: default; }
  .cr-thread {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px dashed var(--hair);
    display: flex; flex-direction: column; gap: 7px;
  }
  .cr-thread__empty { font: 10px var(--mono); color: var(--faint); margin: 0; }
  .cr-comment { display: flex; flex-direction: column; gap: 2px; }
  .cr-comment__meta { display: flex; align-items: center; gap: 5px; }
  .cr-comment__who { font: 10px var(--mono); font-weight: 600; color: var(--ink-2); }
  .cr-comment__when { font: 9px var(--mono); color: var(--faint); }
  .cr-comment__del {
    margin-left: auto; font-size: 10px; line-height: 1; color: var(--faint);
    background: transparent; border: none; cursor: pointer; padding: 0 2px;
  }
  .cr-comment__del:hover { color: var(--err); }
  .cr-comment__body {
    font: 11px/1.45 var(--mono); color: var(--ink-2); margin: 0;
    white-space: pre-wrap; word-break: break-word;
  }
  .cr-compose { display: flex; flex-direction: column; gap: 6px; }
  .cr-compose__field { position: relative; display: flex; }
  .cr-compose__in { flex: 1; min-width: 0; min-height: 40px; resize: vertical; }
  /* extra top padding leaves room for the countdown pinned in the top-right corner */
  .cr-compose :global(.cf-in) { padding: 16px 7px 5px; font-size: 11px; }
  .cr-compose__count {
    position: absolute; right: 8px; top: 5px;
    font: 9px var(--mono); color: var(--faint); pointer-events: none;
  }
  .cr-compose__count--over { color: var(--err); }
  .cr-compose__actions { display: flex; justify-content: flex-end; }
  .cr-compose__btn { flex: 0 0 auto; }

  /* ── suggest-a-reagent footer (bottom-right) ──────────────────────────────── */
  .cr-foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }

  /* ── members-only teaser (logged out) ─────────────────────────────────────── */
  .cr-teaser {
    position: relative; overflow: hidden;
    border: 1px solid var(--hair); border-radius: var(--r-sm);
    background: var(--surface-2);
  }
  .cr-teaser__rows {
    padding: 10px; display: flex; flex-direction: column; gap: 7px;
    user-select: none; pointer-events: none;
  }
  /* Every row is identical in layout, colour and width — no blur, no fade. */
  .cr-teaser__row {
    display: flex; gap: 10px; align-items: center; width: 100%; box-sizing: border-box;
    padding: 8px 10px; border: 1px solid var(--hair); border-radius: var(--r-sm);
    background: var(--surface-1);
    font-family: var(--mono); letter-spacing: 0.1em; color: var(--muted);
  }
  .cr-teaser__rank { min-width: 20px; font-size: 11px; color: var(--muted); }
  .cr-teaser__votes { min-width: 24px; font-size: 12px; color: var(--muted); }
  .cr-teaser__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .cr-teaser__name { font-size: 12px; font-weight: 600; color: var(--muted); }
  .cr-teaser__tag { font-size: 10px; color: var(--muted); }
  .cr-teaser__note { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cr-teaser__cta {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; text-align: center; padding: 16px;
    background: rgba(248, 249, 251, 0.86);
  }
  .cr-teaser__lock { font-size: 22px; }
  .cr-teaser__title { font: 600 13px var(--sans); color: var(--ink); margin: 0; }
  .cr-teaser__sub { font: 11px/1.45 var(--mono); color: var(--muted); margin: 0; max-width: 340px; }
  .cr-teaser__btn { margin-top: 4px; }
</style>

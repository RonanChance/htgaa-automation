<script>
    import { onMount } from 'svelte';
    import StarfieldScene from './StarfieldScene.svelte';
    import DetailPanel from './DetailPanel.svelte';

    let data = $state(null);
    let error = $state('');

    let hoveredSlug = $state(null);
    let selectedSlug = $state(null);
    let focusTargetSlug = $state(null);   // used to programmatically request a camera focus

    // slug → node lookup + children index
    const bySlug = $derived(data ? new Map(data.nodes.map((n) => [n.slug, n])) : new Map());
    const childrenOf = $derived.by(() => {
        const map = new Map();
        if (!data) return map;
        for (const n of data.nodes) {
            if (!n.parent) continue;
            if (!map.has(n.parent)) map.set(n.parent, []);
            map.get(n.parent).push(n);
        }
        return map;
    });

    const selectedNode = $derived(selectedSlug ? bySlug.get(selectedSlug) : null);
    const selectedParent = $derived(selectedNode?.parent ? bySlug.get(selectedNode.parent) : null);
    const selectedChildren = $derived(selectedSlug ? (childrenOf.get(selectedSlug) || []) : []);
    const hoveredNode = $derived(hoveredSlug ? bySlug.get(hoveredSlug) : null);

    onMount(async () => {
        try {
            const res = await fetch('/starfield.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (err) {
            error = err.message || String(err);
            console.error('Failed to load starfield.json:', err);
        }

        const onKey = (e) => {
            if (e.key === 'Escape' && selectedSlug) {
                selectedSlug = null;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // When a lineage chip is clicked, kick the tween by bumping focusTargetSlug.
    // We stamp with a suffix so identical repeat clicks still fire.
    function focusOn(slug) {
        selectedSlug = slug;
        focusTargetSlug = slug + '#' + Math.random().toString(36).slice(2, 7);
    }

    function closePanel() {
        selectedSlug = null;
    }
</script>

<svelte:head>
    <title>Starfield — Fluorescent Protein Genealogy</title>
</svelte:head>

<div
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #000; color: #fff; overflow: hidden; z-index: 0;"
>
    <!-- Scene -->
    {#if data}
        <div style="position: absolute; inset: 0; width: 100%; height: 100%;">
            <StarfieldScene
                {data}
                bind:hoveredSlug
                bind:selectedSlug
                focusTargetSlug={focusTargetSlug ? focusTargetSlug.split('#')[0] : null}
            />
        </div>
    {:else if error}
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
            <div style="text-align: center; max-width: 24rem;">
                <div style="font-size: 0.875rem; color: #f87171; margin-bottom: 0.25rem;">Failed to load starfield data</div>
                <div style="font-size: 0.75rem; opacity: 0.6;">{error}</div>
                <div style="font-size: 0.625rem; opacity: 0.4; margin-top: 0.75rem;">
                    Run <code style="background: rgba(255,255,255,0.1); padding: 0.125rem 0.375rem; border-radius: 0.25rem;">npm run build:starfield</code>
                </div>
            </div>
        </div>
    {:else}
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.75rem; opacity: 0.6;">
                <div style="width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: #fff;" class="animate-ping"></div>
                <span style="font-size: 0.75rem;">Loading starfield…</span>
            </div>
        </div>
    {/if}

    <!-- Header overlay -->
    <header
        style="position: absolute; top: 0; left: 0; right: 0; z-index: 10; display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; pointer-events: none;"
    >
        <span style="font-size: 0.875rem; font-weight: 600; white-space: nowrap;">Starfield</span>
        <span style="font-size: 0.6875rem; opacity: 0.6; white-space: nowrap;">Fluorescent protein genealogy</span>
        {#if data}
            <span style="margin-left: auto; font-size: 0.625rem; opacity: 0.4; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums;">
                {data.nodeCount} proteins · {data.edgeCount} lineage edges
            </span>
        {/if}
    </header>

    <!-- Hover tooltip: floating label following the cursor's target star -->
    {#if hoveredNode && !selectedNode}
        <div
            style="
                position: absolute; z-index: 15;
                left: 50%; bottom: 3.5rem;
                transform: translateX(-50%);
                background: rgba(6,8,14,0.75);
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 6px 12px;
                border-radius: 999px;
                font-size: 12px;
                pointer-events: none;
                display: flex; align-items: center; gap: 8px;
                font-family: ui-monospace, monospace;
            "
        >
            <span style="width: 8px; height: 8px; border-radius: 999px; background: {'#' + hoveredNode.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}; box-shadow: 0 0 6px {'#' + hoveredNode.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')};"></span>
            {hoveredNode.name}
            <span style="opacity: 0.4;">·</span>
            <span style="opacity: 0.6;">em {hoveredNode.emMax}nm</span>
        </div>
    {/if}

    <!-- Detail panel (right side) -->
    <DetailPanel
        node={selectedNode}
        parentNode={selectedParent}
        childrenNodes={selectedChildren}
        onClose={closePanel}
        onFocus={focusOn}
    />

    <!-- Footer hint -->
    <div
        style="position: absolute; left: 1rem; bottom: 0.75rem; z-index: 10; font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.3; pointer-events: none;"
    >
        drag to orbit · scroll to zoom · click a star to focus · esc to close
    </div>
</div>

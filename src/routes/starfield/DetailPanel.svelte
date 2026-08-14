<script>
    let {
        node = null,          // the currently selected node (or null)
        parentNode = null,    // parent lookup, if any
        childrenNodes = [],   // children lookup
        onClose,              // () => void
        onFocus               // (slug) => void
    } = $props();

    // Render a mini spectrum SVG. Two gaussian bumps at ex_max and em_max,
    // tinted by the emission color.
    function spectrum(exMax, emMax, color) {
        // Domain: 350-750 nm mapped to [0, 400] px width
        const width = 320, height = 60;
        function xFor(nm) { return ((nm - 350) / 400) * width; }
        function gaussian(peak, x, sigma = 22) {
            const dx = x - peak;
            return Math.exp(-(dx * dx) / (2 * sigma * sigma));
        }
        const step = 3;
        let emPath = '', exPath = '';
        for (let x = 0; x <= width; x += step) {
            const nm = 350 + (x / width) * 400;
            const emY = height - gaussian(emMax, nm) * (height - 6);
            const exY = height - gaussian(exMax, nm) * (height - 6);
            emPath += (x === 0 ? 'M' : 'L') + x + ',' + emY + ' ';
            exPath += (x === 0 ? 'M' : 'L') + x + ',' + exY + ' ';
        }
        const hex = '#' + color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        return { emPath, exPath, hex, width, height, xEm: xFor(emMax), xEx: xFor(exMax) };
    }

    const spec = $derived(node ? spectrum(node.exMax, node.emMax, node.color) : null);
    const hex = $derived(node ? '#' + node.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('') : '#fff');

    function fmt(n, digits = 0) {
        return n == null ? '—' : Number(n).toFixed(digits);
    }

    const AGG_LABEL = {
        m: 'monomer', d: 'dimer', td: 'tandem dimer', wd: 'weak dimer',
        t: 'tetramer', wt: 'weak tetramer', '': 'unknown'
    };
</script>

<!--
  Slide-in overlay from the right. Absolute positioned inside the fullscreen
  container. Uses inline styles to sidestep any parent CSS quirks.
-->
<aside
    style="
        position: absolute; top: 0; right: 0; bottom: 0;
        width: 360px; z-index: 20;
        background: rgba(6, 8, 14, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-left: 1px solid rgba(255,255,255,0.08);
        color: #fff;
        transform: translateX({node ? '0' : '100%'});
        transition: transform 480ms cubic-bezier(0.16, 1, 0.3, 1);
        overflow-y: auto;
        overflow-x: hidden;
        pointer-events: {node ? 'auto' : 'none'};
    "
>
    {#if node}
        <!-- Accent bar on the left edge, tinted by emission color -->
        <div style="position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background: {hex}; box-shadow: 0 0 12px {hex};"></div>

        <div style="padding: 20px 22px 24px 22px;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 16px;">
                <div style="min-width: 0;">
                    <div style="font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.1; margin-bottom: 4px;">
                        {node.name}
                    </div>
                    <div style="font-size: 11px; opacity: 0.55; font-family: ui-monospace, monospace;">
                        {node.slug}
                    </div>
                </div>
                <button
                    onclick={onClose}
                    style="background: transparent; border: 0; color: #fff; opacity: 0.5; cursor: pointer; padding: 4px 6px; font-size: 16px; line-height: 1;"
                    aria-label="Close"
                >✕</button>
            </div>

            <!-- Wavelength badge -->
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 18px;">
                <div style="width: 12px; height: 12px; border-radius: 999px; background: {hex}; box-shadow: 0 0 10px {hex};"></div>
                <div style="font-size: 12px;">
                    <span style="opacity: 0.55">ex</span> <span style="font-family: ui-monospace, monospace;">{node.exMax ?? '—'}</span>
                    <span style="opacity: 0.35">→</span>
                    <span style="opacity: 0.55">em</span> <span style="font-family: ui-monospace, monospace;">{node.emMax ?? '—'}</span>
                    <span style="opacity: 0.4;">nm</span>
                </div>
            </div>

            <!-- Spectrum SVG -->
            {#if spec}
                <div style="margin-bottom: 18px;">
                    <svg viewBox="0 0 {spec.width} {spec.height + 12}" style="width: 100%; height: 72px;">
                        <!-- Excitation: dashed -->
                        <path d={spec.exPath} fill="none" stroke={spec.hex} stroke-width="1.2" stroke-dasharray="3 2" opacity="0.55" />
                        <!-- Emission: solid + fill -->
                        <path d={spec.emPath + `L ${spec.width},${spec.height} L 0,${spec.height} Z`} fill={spec.hex} opacity="0.18" />
                        <path d={spec.emPath} fill="none" stroke={spec.hex} stroke-width="1.6" />
                        <!-- Axis ticks -->
                        <g font-family="ui-monospace, monospace" font-size="8" fill="rgba(255,255,255,0.35)">
                            <text x="0" y={spec.height + 10}>350</text>
                            <text x={spec.width * 0.375 - 6} y={spec.height + 10}>500</text>
                            <text x={spec.width * 0.75 - 6} y={spec.height + 10}>650</text>
                            <text x={spec.width - 16} y={spec.height + 10}>750 nm</text>
                        </g>
                    </svg>
                </div>
            {/if}

            <!-- Stats grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin-bottom: 20px; font-size: 11px;">
                <div>
                    <div style="opacity: 0.5; margin-bottom: 2px;">Brightness</div>
                    <div style="font-family: ui-monospace, monospace; font-size: 13px;">{fmt(node.brightness, 1)}</div>
                </div>
                <div>
                    <div style="opacity: 0.5; margin-bottom: 2px;">Quantum yield</div>
                    <div style="font-family: ui-monospace, monospace; font-size: 13px;">{fmt(node.qy, 2)}</div>
                </div>
                <div>
                    <div style="opacity: 0.5; margin-bottom: 2px;">ε (M⁻¹cm⁻¹)</div>
                    <div style="font-family: ui-monospace, monospace; font-size: 13px;">{node.extCoeff ? Number(node.extCoeff).toLocaleString() : '—'}</div>
                </div>
                <div>
                    <div style="opacity: 0.5; margin-bottom: 2px;">Oligomeric</div>
                    <div style="font-size: 12px;">{AGG_LABEL[node.agg] || node.agg || '—'}</div>
                </div>
            </div>

            <!-- PDB handoff -->
            {#if node.pdb && node.pdb.length}
                <div style="margin-bottom: 20px;">
                    <a
                        href={`/protein?search=${encodeURIComponent(node.name)}`}
                        style="
                            display: inline-flex; align-items: center; gap: 6px;
                            padding: 7px 12px; border-radius: 6px;
                            background: rgba(255,255,255,0.08);
                            color: #fff; font-size: 12px; text-decoration: none;
                            transition: background 200ms;
                        "
                        onmouseenter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
                        onmouseleave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
                        </svg>
                        View 3D structure ({node.pdb[0]})
                    </a>
                </div>
            {/if}

            <!-- Lineage: parent + children -->
            {#if parentNode || childrenNodes.length}
                <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px;">
                    <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; margin-bottom: 10px;">
                        Lineage
                        {#if node.lineageSource === 'similarity'}
                            <span style="opacity: 0.65; text-transform: none; letter-spacing: 0; margin-left: 4px;" title="Inferred from sequence similarity — not verified lineage">
                                (inferred)
                            </span>
                        {/if}
                    </div>

                    {#if parentNode}
                        <div style="margin-bottom: 12px;">
                            <div style="font-size: 10px; opacity: 0.5; margin-bottom: 4px;">Parent</div>
                            <button
                                onclick={() => onFocus(parentNode.slug)}
                                style="
                                    display: inline-flex; align-items: center; gap: 6px;
                                    padding: 5px 10px; border-radius: 999px;
                                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                                    color: #fff; font-size: 12px; cursor: pointer;
                                "
                            >
                                <span style="width: 8px; height: 8px; border-radius: 999px; background: {'#' + parentNode.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')};"></span>
                                {parentNode.name}
                            </button>
                        </div>
                    {/if}

                    {#if childrenNodes.length}
                        <div>
                            <div style="font-size: 10px; opacity: 0.5; margin-bottom: 4px;">Descendants ({childrenNodes.length})</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                {#each childrenNodes.slice(0, 24) as c}
                                    <button
                                        onclick={() => onFocus(c.slug)}
                                        style="
                                            display: inline-flex; align-items: center; gap: 5px;
                                            padding: 3px 8px; border-radius: 999px;
                                            background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                                            color: #fff; font-size: 11px; cursor: pointer;
                                        "
                                    >
                                        <span style="width: 6px; height: 6px; border-radius: 999px; background: {'#' + c.color.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')};"></span>
                                        {c.name}
                                    </button>
                                {/each}
                                {#if childrenNodes.length > 24}
                                    <span style="font-size: 10px; opacity: 0.4; padding: 3px 6px;">+{childrenNodes.length - 24} more</span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</aside>

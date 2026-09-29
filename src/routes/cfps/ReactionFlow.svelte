<script>
  // Per-research-team throughput funnel. The screen narrows as the vessels scale
  // up: 1,280 reactions across four 384-well plates (320 per plate) → 80 in a
  // 96-well plate → 20 in 2 mL tubes. Vessels are joined left → right by an
  // arrow connector. Purely presentational; numbers are fixed per the
  // experimental design.
  const stages = [
    {
      key: '384',
      title: '384-well plates',
      plates: 4,
      platesLabel: '4 plates',
      lines: ['1,280 reactions', '320 unique']
    },
    {
      key: '96',
      title: '96-well plates',
      plates: 1,
      platesLabel: '1 plate',
      lines: ['80 reactions', '20 unique']
    },
    {
      key: 'tube',
      title: '2 mL tubes',
      platesLabel: '20 tubes',
      lines: ['20 reactions', '5 unique']
    }
  ];
</script>

<section class="rf" aria-label="Per-team reaction throughput funnel">
  <div class="rf__head">
    <div class="rf__title">Per research team, per round</div>
  </div>

  <div class="rf__flow">
    {#each stages as st, i (st.key)}
      <div class="rf__stage">
        <div class="rf__vessel">
          {#if st.key === 'tube'}
            <div class="rf__tubes">
              {#each Array(20) as _, t (t)}<span class="rf__tube"></span>{/each}
            </div>
          {:else}
            <div class="rf__plates rf__plates--{st.key}">
              {#each Array(st.plates) as _, p (p)}
                <div class="rf__plate rf__plate--{st.key}" style="--i:{p};"></div>
              {/each}
            </div>
          {/if}
        </div>
        <div class="rf__name">{st.title}</div>
        {#if st.platesLabel}<div class="rf__pcount">{st.platesLabel}</div>{/if}
        {#each st.lines as ln (ln)}
          <div class="rf__vlabel">{ln}</div>
        {/each}
      </div>

      {#if i < stages.length - 1}
        <div class="rf__link" aria-hidden="true">
          <div class="rf__track"></div>
          <span class="rf__arrow">▸</span>
        </div>
      {/if}
    {/each}
  </div>

  <div class="rf__foot">
    <a
      class="rf__doclink"
      href="https://docs.google.com/document/d/1hFs2_vGpHP_hZ7UB3lRBsfVlN4xVPOoLy1Hu2INrBoo/edit?tab=t.0"
      target="_blank"
      rel="noopener noreferrer"
    >Coopetition Details</a>
  </div>
</section>

<style>
  .rf {
    margin: 28px 0 0;
    padding: 22px 24px 26px;
    border: 1px solid var(--hair);
    border-radius: var(--r-lg);
    background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 140%);
  }
  .rf__head { margin-bottom: 22px; }
  .rf__title {
    font: 600 13px var(--sans);
    letter-spacing: 0.01em;
    color: var(--ink);
  }

  /* Reference link, centered under the funnel but inside the same card. */
  .rf__foot {
    margin-top: 22px;
    text-align: center;
  }
  .rf__doclink {
    font: 600 12px var(--sans);
    color: var(--teal, #4a5560);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .rf__doclink:hover {
    color: var(--ink);
  }

  /* Row of stations connected by flowing links. The graphic is centered and only
     as wide as it needs to be — the connectors are a fixed span, not stretched. */
  .rf__flow {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 6px;
  }
  .rf__stage {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding-top: 6px;
  }
  .rf__vessel {
    height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Well-plate rendered as a dot grid (each dot = a well) with a fanned stack for
     the four 384-well plates. */
  .rf__plates { position: relative; }
  .rf__plates--384 { width: 132px; height: 92px; }
  .rf__plates--96 { width: 108px; height: 72px; }
  .rf__plate {
    border: 1px solid var(--groove);
    border-radius: 4px;
    background-color: var(--surface-2);
    background-image: radial-gradient(circle, rgba(90, 105, 122, 0.42) 0.8px, transparent 1.3px);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .rf__plate--384 {
    position: absolute;
    width: 120px;
    height: 80px;
    background-size: 5px 5px;
    top: calc(var(--i) * 4px);
    left: calc(var(--i) * 4px);
  }
  .rf__plate--96 {
    width: 108px;
    height: 72px;
    background-size: 9px 9px;
  }

  /* 2 mL tubes — 20 stylised tubes in two rows of ten. */
  .rf__tubes {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 4px 3px;
    width: 118px;
  }
  .rf__tube {
    height: 22px;
    border: 1px solid var(--groove);
    border-top: 2px solid var(--muted);
    border-radius: 1px 1px 3px 3px / 1px 1px 7px 7px;
    background: linear-gradient(180deg, transparent 34%, rgba(74, 85, 96, 0.2) 34%);
  }

  /* Vessel title. */
  .rf__name {
    margin-top: 12px;
    font: 600 12px var(--sans);
    color: var(--ink-2);
  }
  .rf__pcount {
    margin-top: 5px;
    font: 700 14px/1 var(--sans);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .rf__vlabel {
    margin-top: 3px;
    font: 10px/1.4 var(--mono);
    color: var(--muted);
    max-width: 150px;
  }

  /* Connector: a track line with an arrowhead between vessels. */
  .rf__link {
    flex: 0 0 72px;
    min-width: 0;
    position: relative;
    height: 92px;
    margin-top: 6px;
  }
  .rf__track {
    position: absolute;
    left: 2px;
    right: 2px;
    top: 48px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--groove) 18%, var(--groove) 82%, transparent);
  }
  /* Sits at the right end of the track, pointing into the downstream vessel. */
  .rf__arrow {
    position: absolute;
    right: 0;
    top: 48px;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 12px;
  }

  /* Stack vertically on narrow screens; flow becomes top → bottom. */
  @media (max-width: 720px) {
    .rf__flow { flex-direction: column; align-items: center; gap: 4px; }
    .rf__link {
      width: 44px;
      height: 40px;
      min-width: 0;
      margin-top: 0;
    }
    .rf__track {
      left: 50%;
      right: auto;
      top: 2px;
      bottom: 2px;
      width: 1px;
      height: auto;
      transform: translateX(-50%);
      background: linear-gradient(180deg, transparent, var(--groove) 18%, var(--groove) 82%, transparent);
    }
    .rf__arrow {
      top: auto;
      left: auto;
      bottom: -1px;
      right: 50%;
      transform: translateX(50%) rotate(90deg);
    }
  }
</style>

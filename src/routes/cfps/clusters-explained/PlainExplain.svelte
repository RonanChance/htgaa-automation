<script>
  // "In plain terms": the first thing under each step's "more on this step",
  // written for someone with no maths background. What is happening, an
  // everyday comparison, a small worked example where one helps, and why this
  // approach rather than the obvious one. The technical notes follow it on the
  // page under "Going deeper".
  let {
    key, target = 'sfGFP', n = null, clusters = null, eff = null, ls = null,
    tested = null, participants = null, compositions = null
  } = $props();

  // "Why this approach": the rationale, the main alternatives, and the honest
  // downsides, for each step where a method was chosen. Kept short on purpose.
  const WHY = {
    'point.1': {
      title: 'Log-scaling and z-scores',
      why: ['Puts all 30 ingredients on one scale, so no single ingredient dominates the distances.', 'Ratios match chemistry better than raw differences: doubling an ingredient is a similar-sized change whatever its usual amount.'],
      alts: ['Raw nanolitres (simple, but large-volume ingredients swamp everything else).', 'Min–max scaling to 0–1 (simple, but one extreme recipe stretches the whole axis).', 'Letting the model learn a separate scale for each ingredient (more flexible, but needs more data than 78 recipes).'],
      cons: ['“Typical step” comes from Ginkgo’s plates, so an ingredient they barely varied gets a tiny step, and small changes to it look large.']
    },
    'point.2': {
      title: 'Principal components for the picture',
      why: ['Keeps as much of the real spread as three axes can, and doesn’t invent structure.', 'Straight-line projection: distances in the picture are an honest (if partial) view of the real ones.'],
      alts: ['t-SNE or UMAP (show clumps more vividly, but bend distances, so “close” and “far” in the picture can mislead).'],
      cons: ['Hides whatever the three axes don’t capture. It is only a picture; nothing downstream uses it.']
    },
    'gp.0': {
      title: 'A Gaussian process',
      why: ['The starting data is small: 78 measured recipes for 30 ingredients. A GP works well with little data.', 'It assumes similar recipes give similar yields, a reasonable starting belief for chemistry.', 'It gives uncertainty, including how any two predictions’ errors move together. The links in the next chapters are built from exactly that.'],
      alts: ['Linear or quadratic regression (easy to read, but you must guess in advance which ingredient combinations matter).', 'Random forests or boosting (strong predictors, but no reliable uncertainty, and falsely confident beyond the data).', 'Neural networks (very flexible, but need far more data than 78 recipes).'],
      cons: ['It is a smooth fit, so it handles sharp effects badly, like a reaction that suddenly crashes past a magnesium threshold.', 'It uses one length-scale for all 30 ingredients, as if each mattered over the same range.', 'It can’t see ingredients Ginkgo never varied (chapter 4 adds a patch for that).']
    },
    'link.2': {
      title: 'Links from the model’s errors',
      why: ['Asks the question planning needs: “would testing A tell me about B?”', 'Accounts for the measured data: a measurement between two recipes makes them less linked, which plain distance can’t express.'],
      alts: ['Plain recipe distance (simple, but ignores what has been measured and can’t see untested ingredients).', 'Grouping by predicted yield (puts together recipes that merely score alike, even if unrelated).'],
      cons: ['Links are only as good as the model: if the GP’s smoothness assumption is wrong somewhere, so are the links there.']
    },
    'unknown.1': {
      title: 'A shared “shock” for untested ingredients',
      why: ['Without it, the model would treat recipes sharing an untested ingredient as unrelated, missing the biggest open questions.', 'It is the simplest way to say “same unknown, same fate”.'],
      alts: ['Ignore untested ingredients (simple, but blind to the riskiest, most informative bets).', 'Add them as extra dimensions to the GP (but with no data, their scale would be pure guesswork too).'],
      cons: ['How big the shock is, and how likely a collapse is, are assumptions, not measurements. Chapter 4’s dial shows how much the clusters depend on them.']
    },
    'groups.2': {
      title: 'Complete-linkage clustering, cut at 0.5',
      why: ['No need to decide the number of clusters in advance; it falls out of the 0.5 bar.', 'Every pair in a cluster clears the bar, so a cluster can’t drift into a chain of loosely related recipes.', 'Works directly on links, which is what matters for planning.'],
      alts: ['k-means (needs the number of clusters up front and groups by distance, not links).', 'HDBSCAN or other density methods (find clumps of any shape, but can chain and leave many recipes unassigned).', 'Single or average linkage (looser rules; single linkage chains, average linkage allows some weak pairs).'],
      cons: ['A hard cutoff: two recipes linked at 0.49 end up apart, at 0.51 together.', 'One weak pair can keep two otherwise tight clusters separate.', 'Each recipe belongs to exactly one cluster, even when it sits between two.']
    },
    'neff.0': {
      title: 'The participation ratio',
      why: ['A single number that accounts for every pairwise link, not just cluster membership.', 'Behaves sensibly at the extremes: unlinked designs count fully, identical ones count once.'],
      alts: ['Counting clusters plus loners (simpler, but ignores links between clusters and differences in tightness).', 'Counting “large” eigenvalues of the link matrix (needs an arbitrary cutoff).'],
      cons: ['An estimate that inherits every assumption in the links; good for scale, not for exact counts.']
    },
    'runs.0': {
      title: 'The best-odds member as first test',
      why: ['If the cluster’s shared idea works, its strongest member is most likely to show it.', 'It is also the member you would most want to win the competition.'],
      alts: ['The most typical member, the one closest to all the others (a purer test of the shared idea).', 'A random member (unbiased, but wastes the model’s judgement).'],
      cons: ['The best-odds member can be the least typical, so its result may not speak for the rest as well as a central member’s would. Check tests partly cover this.']
    },
    'runs.2': {
      title: 'Virtual recipes and a straight-line fit',
      why: ['Asks the model which ingredient matters inside each cluster, without spending any wells.', 'A Latin hypercube covers the cluster’s range evenly with few points.', 'A straight-line fit gives one easy-to-read number per ingredient.'],
      alts: ['Random or grid sampling (random leaves gaps; a full grid is impossibly large in many dimensions).', 'Variance-based sensitivity methods (capture interactions, but are harder to read).'],
      cons: ['It analyses the model’s own predictions, not lab data, so it inherits the model’s mistakes.', 'A straight line misses interactions; the “single ingredients explain X%” figure says how much is missed.']
    },
    'runs.3': {
      title: 'The most different member as check test',
      why: ['Tests the model’s claim where it is most likely to fail, so a pass is convincing and a fail is informative.'],
      alts: ['A second random member (cheaper to reason about, but often just repeats the first test).', 'The member with the most new information overall, regardless of ingredient (more general, but says less about which ingredient matters).'],
      cons: ['Relies on the regression having picked the right ingredient; if it didn’t, the check probes the wrong thing.']
    }
  };
  const W = $derived(WHY[key] ?? null);

  const N = $derived(n ?? 'hundreds of');
  const C = $derived(clusters ?? 'dozens of');
  const E = $derived(eff != null ? eff.toFixed(1) : 'a few dozen');
</script>

<div class="plain">
  <h3>In plain terms</h3>

  {#if key === 'start.0'}
    <p><b>The problem.</b> {participants ?? 'Over a hundred'} students submitted
      {compositions ? compositions.toLocaleString() : 'hundreds of'} recipes for cell-free protein production, each a guess
      at a better mix of ingredients. Ginkgo can run only so many: for each protein, four plates with room for 80 recipes
      each, every recipe made four times to check it is reproducible. That is 320 recipes per protein, far fewer than were
      submitted.</p>
    <p><b>The question behind the approach.</b> With more ideas than wells, how should the experiments be chosen?</p>
    <ul>
      <li><b>Prioritize individual requests?</b> This is flawed because there are more ideas than spaces on the plate, so
        someone is always left out, and any rule for who gets in (first come, one per person, a vote) is arbitrary. Many
        ideas are also near-duplicates, so slots would go to repeating the same experiment.</li>
      <li><b>Or find the meaningful signal in our collective human-AI intuition</b> and pick the experiments that yield the
        most valuable data for everyone? That is the path we took: using mathematical tools to create a fair
        representation of the HTBAA community in the final plate submission. Every idea is represented, either tested
        directly or through a tested composition the model expects to behave like it.</li>
    </ul>
    <p><b>How each step serves that goal.</b></p>
    <ol>
      <li><b>Map every idea.</b> Each composition becomes a point in a 30-dimensional space, one direction per ingredient
        Ginkgo varied, so ideas can be compared on equal footing.</li>
      <li><b>Predict, with a Gaussian process.</b> Trained on Ginkgo’s 78 measured control wells, it predicts each idea’s
        yield and, crucially, how unsure it is and which ideas’ outcomes are tied together. Ideas that bet on the same
        untested ingredient are recognised as one shared bet.</li>
      <li><b>Cluster.</b> Ideas expected to succeed or fail together are grouped, with every pair strongly linked. Each
        cluster is one shared hypothesis from the community, however many people proposed it, so popular ideas aren’t
        over-weighted and niche ones aren’t crowded out.</li>
      <li><b>First tests.</b> The best-odds idea in each cluster tests the cluster’s shared hypothesis on behalf of every
        member.</li>
      <li><b>Check tests.</b> A second idea from the cluster, the one most different in the ingredient the model thinks
        matters most. It checks that the cluster really behaves as one, which is what lets one test speak for the others,
        and it tests whether the model is right about what drives yield.</li>
      <li><b>Independent tests.</b> Ideas no cluster speaks for are one-of-a-kind directions. Each gets its own well, so
        originality isn’t sacrificed to consensus.</li>
      <li><b>Sweep tests.</b> Submitted series that change one ingredient step by step measure whole response curves for
        the ingredients that matter most, turning the model’s guesses into data for round 2.</li>
    </ol>
    <p>Identical recipes from different people share one well, and everyone who submitted it is credited.
      {#if tested && n}For {target}, {tested} tested compositions speak for all {n} ideas, each well answering a different
      question.{/if}</p>
    <p class="ana"><b>A comparison.</b> A hundred friends each suggest a restaurant, and you can afford thirty dinners. If
      twelve suggestions are pizza places, eating at all twelve teaches you little more than eating at two. Better to sort
      the suggestions into kinds of food, try the best of each kind, check a second place where you’re unsure the places
      are really alike, and still visit the one-of-a-kind suggestions.</p>
    <p class="why"><b>What this is not.</b> The model does not decide which recipe is best; round 1 measures that. It
      decides which experiments will teach the most, before anything has been run.</p>

  <!-- ── overview ─────────────────────────────────────────────────────── -->
  {:else if key === 'overview.0'}
    <p>Each idea is a recipe: a list of how much of each ingredient goes in. If you plot two ingredients as the two sides of
      a graph, every recipe becomes a dot, and recipes with similar amounts land near each other.</p>
    <p class="ana"><b>A comparison.</b> Think of a map where each house is placed by its street address. Houses on the same
      street are neighbours. Here, recipes with similar ingredient amounts are neighbours.</p>
    <p>The white diamonds are recipes Ginkgo has actually made and measured. They are the only places on the map where the
      answer is known; everything else is a guess.</p>
  {:else if key === 'overview.1'}
    <p>To guess how an untested recipe will do, the model looks at the measured recipes near it. Close measurements are a
      good guide; distant ones are not. So it is confident near the white diamonds and unsure far away from them.</p>
    <p class="ana"><b>A comparison.</b> Weather stations. The temperature right next to a station is known well. Halfway
      between two stations it is a reasonable guess. Far out at sea, with no station nearby, it is mostly a guess, and an
      honest forecaster would say so. The halos show that honesty: bigger halo, less sure.</p>
  {:else if key === 'overview.2'}
    <p>A link between two ideas means: <i>if the model is wrong about one, it is probably wrong about the other in the same
      way.</i> There are two reasons this happens.</p>
    <ul>
      <li><b>They are neighbours.</b> If the guess for one house on a street is off, the guess for the house next door is
        probably off too, because both came from the same nearby measurements.</li>
      <li><b>They share an unknown.</b> Two recipes can be far apart but both add an ingredient nobody has measured (red
        dashes). If that ingredient turns out to hurt, both suffer. Like two travellers on different trips who booked the
        same untested airline.</li>
    </ul>
  {:else if key === 'overview.3'}
    <p>Write every link in one table, with a row and a column for each idea; each square holds how linked those two ideas
      are. Shuffled, the table looks like noise. Put linked ideas next to each other and bright squares appear along the
      diagonal: groups of ideas that are all linked to one another.</p>
    <p class="ana"><b>A comparison.</b> The mileage chart in a road atlas lists the distance between every pair of cities.
      Reorder the cities by region and you see the regions as blocks of short distances.</p>
  {:else if key === 'overview.4'}
    <p>Each bright block becomes a cluster. The rule is strict: an idea joins a cluster only if it is linked to
      <i>every</i> member, not just one. That keeps a cluster from drifting, friend-of-a-friend, into ideas that have
      nothing in common.</p>
    <p class="why"><b>Why bother?</b> A cluster is a set of ideas that should succeed or fail together, so testing one tells
      you a lot about the others. Each cluster is one question the plates can answer.</p>
  {:else if key === 'overview.5'}
    <p>From each cluster, two tests: the idea with the best chance of beating Ginkgo’s recipe (★), which tests what the
      cluster has in common, and the idea most different from it (◯), which checks whether the cluster really behaves as
      one. Ideas in no cluster are one of a kind, so each gets its own test. The faded ideas don’t need their own well:
      their result is expected to follow their cluster’s.</p>
    <p class="ana"><b>A comparison.</b> Tasting menus. From each kitchen, try its signature dish, and one very different
      dish to check the kitchen is consistent. Kitchens with a single unusual dish get that dish tasted on its own.</p>

  <!-- ── 1 · a composition is a point ─────────────────────────────────── -->
  {:else if key === 'point.0'}
    <p><b>What a dimension is.</b> A dimension is simply one thing you can change independently. A line has one (how far
      along), a map has two (east–west, north–south), a room has three (add up–down). A recipe with 30 adjustable
      ingredients has 30: each ingredient amount is one coordinate.</p>
    <p>Nobody can picture 30 directions at once, and the model doesn’t need to. The arithmetic that measures distance on a
      map (how far east plus how far north, combined) works the same way with 30 directions: it adds up how different two
      recipes are, ingredient by ingredient.</p>
    <p class="why"><b>Why these 30?</b> They are the ingredients Ginkgo’s control plates varied. The model can only learn
      what an ingredient does if the measured recipes contain different amounts of it.</p>
  {:else if key === 'point.1'}
    <p><b>The problem with raw nanolitres.</b> Ingredients come at very different scales. A change of 50 nL is huge for
      something normally added at 50 nL and tiny for something added at 5,000 nL. Measuring both in plain nanolitres is like
      comparing a change in someone’s height in centimetres with a change in weight in kilograms: the numbers aren’t
      comparable.</p>
    <p><b>Step 1, log-compression.</b> Count changes by ratio instead of by difference, so doubling is doubling whatever the
      starting amount: 25 → 50 nL counts the same as 500 → 1,000 nL. Our senses work this way too; doubling the loudness
      of a quiet sound and of a loud one feel alike.</p>
    <p><b>Step 2, the z-score.</b> Then measure each amount in “typical steps” away from Ginkgo’s usual amount, where a
      typical step is how much Ginkgo’s own recipes varied that ingredient (statisticians call this the standard deviation).</p>
    <p class="ex"><b>Example.</b> Say Ginkgo’s recipes mostly used between 150 and 300 nL of magnesium glutamate. A design
      using about that much sits near 0. A design using far more might sit at +2: two typical steps above normal. Now
      every ingredient is in the same units, and “+2” means the same unusualness for all of them.</p>
  {:else if key === 'point.2'}
    <p>To draw 30 dimensions on a screen, the view is squashed down to three, choosing the three directions in which the
      recipes differ the most. These are the principal components: each is a blend of ingredients that tends to change
      together across the submissions.</p>
    <p class="ana"><b>A comparison.</b> A shadow. A 3-D object casts a 2-D shadow, and if you turn the light the right way
      the shadow shows the object’s shape well. Principal components pick the most revealing “lighting angle”. The
      percentages on the axes say how much of the full picture the shadow keeps.</p>
    <p class="why"><b>One caution.</b> Two dots that look close may be far apart in the directions you can’t see, like two
      stars that look side by side in the sky but are at very different distances. The model always works in the full 30
      dimensions; the picture is just a view.</p>
  {:else if key === 'point.3'}
    <p>Each colour says how much the model can know about a design:</p>
    <ul>
      <li><b>Green, within the plates’ range.</b> The design stays inside amounts Ginkgo has measured. Predicting it is
        filling in between known points, like estimating the temperature at noon from readings at 10 am and 2 pm.</li>
      <li><b>Orange, past the range.</b> It pushes a measured ingredient further than any measured recipe did. The model has
        to extend the trend beyond its data, like guessing adult height by extending a child’s growth chart. It can be
        right, but it is less sure.</li>
      <li><b>Red, never on a plate.</b> It uses an ingredient no measured recipe contained. The model has no information
        about it at all, which is why chapter 4 handles these separately.</li>
    </ul>

  <!-- ── 2 · predicting ───────────────────────────────────────────────── -->
  {:else if key === 'gp.0'}
    <p>A Gaussian process is a careful way of connecting the dots. Given measurements, it draws a smooth best guess between
      them and, just as important, a band showing how far off that guess might be. The band is narrow near measurements
      and wide far from them.</p>
    <p>The name is less scary than it sounds. “Gaussian” refers to the bell curve, the usual way of describing uncertainty
      (most errors small, a few large). “Process” means it guesses a whole curve rather than a single number.</p>
  {:else if key === 'gp.1'}
    <p>The kernel is the rule for “how similar are two recipes?”: 1 if identical, falling smoothly towards 0 as they get
      further apart. The length-scale ℓ sets how fast it falls, which is how far one measurement’s influence reaches.</p>
    <p class="ana"><b>A comparison.</b> Streetlights. A large ℓ is a wide light: it lights the road far away, so predictions
      stay confident between measurements. A small ℓ is a narrow spotlight: bright directly underneath, dark gaps between,
      so the model is unsure in between.</p>
    <p>The model doesn’t pick ℓ by hand. It chooses the reach that best explains Ginkgo’s measurements{#if ls}, which came
      out at ℓ = {ls.toFixed(2)} for {target}, in the “typical steps” units from chapter 1{/if}.</p>
  {:else if key === 'gp.2'}
    <p>Both formulas can be read as sentences.</p>
    <p><b>The prediction μ</b> is a weighted average of the measured yields. Measured recipes close to the new one get big
      weights, distant ones get almost none. The <i>K</i>⁻¹ part handles a subtlety: if three measured recipes sit almost on
      top of each other, they shouldn’t count as three times the evidence, so their weights are shared out.</p>
    <p><b>The uncertainty σ²</b> starts at a, which means “no idea”, and subtracts whatever the nearby measurements explain.
      Next to a measurement almost everything is explained and σ² is small. Far from all of them nothing is subtracted.</p>
    <p class="ex"><b>Symbol glossary.</b> <i>y</i>: the measured yields. <i>K</i>: a table of how similar every pair of measured
      recipes is. <i>k<sub>x</sub></i>: how similar the new recipe is to each measured one. ⊤ and ⁻¹ are bookkeeping that
      line these tables up and untangle overlapping evidence.</p>
  {:else if key === 'gp.3'}
    <p>This picture walks along one ingredient while keeping the other 29 at Ginkgo’s best recipe, like walking down a
      single street in the 30-dimensional city.</p>
    <ul>
      <li><b>Flat line:</b> changing this ingredient barely matters around this recipe, so you could use less and save money.</li>
      <li><b>Steep line:</b> this ingredient matters a lot here.</li>
      <li><b>Narrow band:</b> the model has nearby measurements and is confident. <b>Wide band:</b> it is guessing, usually
        because you have walked past the amounts Ginkgo measured.</li>
    </ul>

  <!-- ── 3 · links ────────────────────────────────────────────────────── -->
  {:else if key === 'link.0'}
    <p>The model doesn’t know the true curve, so it keeps many possible curves in mind, all of which fit the measurements.
      Where they agree the model is sure; where they spread apart it isn’t.</p>
    <p class="ana"><b>A comparison.</b> Hurricane forecasts often show a “spaghetti plot”: dozens of possible storm paths.
      Where the strands bunch together the forecast is reliable; where they fan out, nobody knows yet. The teal curves are
      the model’s spaghetti.</p>
  {:else if key === 'link.1'}
    <p>Pick two recipes, A and B, and ask of every possible curve: is it too high or too low at A, and at B? Plot those two
      answers as one dot per curve.</p>
    <ul>
      <li><b>Dots along a rising line:</b> whenever a curve is too high at A it is too high at B. The two errors move
        together. Like the heights of parents and children: knowing one tells you something about the other.</li>
      <li><b>A round cloud:</b> being high at A says nothing about B. They are independent.</li>
    </ul>
    <p class="why"><b>Why it matters.</b> If the errors move together, testing A will reveal most of what testing B would.</p>
  {:else if key === 'link.2'}
    <p><b>Covariance</b> is a measure of how much two errors move together. On its own it depends on how big the errors are,
      so it is rescaled into a number between −1 and 1 called the correlation. That rescaled number is the link.</p>
    <ul>
      <li><b>1:</b> the two always err together. Testing one is as good as testing both.</li>
      <li><b>0:</b> no connection. Each needs its own test.</li>
      <li><b>Below 0 (rare here):</b> when one is too high the other tends to be too low.</li>
    </ul>
    <p>In words, the formula says: <i>how linked A and B are = how similar they are, minus whatever the measured recipes
      already explain about both.</i> That second part is why a measurement sitting between A and B makes them less linked:
      it pins down each of them separately.</p>
  {:else if key === 'link.3'}
    <p class="ex"><b>Example.</b> If A and B are linked at 0.9, testing A explains about 81% (0.9 × 0.9) of what is uncertain
      about B. Spending a well on B would mostly repeat A. If they are linked at 0.3, A explains only 9% of B, so B is
      worth its own well.</p>
    <p class="why"><b>Why square the link?</b> The share of uncertainty two things have in common is the link times itself.
      It is why a link of 0.5, which sounds like “half”, actually means only a quarter of the uncertainty is shared.</p>
  {:else if key === 'unknown.0'}
    <p>The prediction model only sees the 30 ingredients Ginkgo varied. An ingredient like PEG-8000, which no measured
      recipe contained, is invisible to it. Two recipes that both add PEG-8000 but differ elsewhere look unrelated, even
      though they share the one thing nobody knows about.</p>
    <p class="ana"><b>A comparison.</b> A map that doesn’t show rivers. Two towns on opposite banks look far apart and
      unrelated, but a flood would hit both. The model needs a way to draw the river.</p>
  {:else if key === 'unknown.1'}
    <p>The “shock” is how the model draws the river. In words it says: <i>I don’t know what PEG-8000 does. It might help or
      hurt by some amount, and whatever it does, it does to every recipe that adds it.</i> That shared effect links those
      recipes together.</p>
    <ul>
      <li><b>Spread (σ<sub>N</sub>):</b> how big the unknown effect could be.</li>
      <li><b>Dose (w):</b> the further past measured amounts a recipe goes, the more uncertain it is.</li>
      <li><b>Collapse (p):</b> a small chance the ingredient wrecks the reaction, cutting yield about 50-fold. It is a
        separate risk because a few additives really do shut reactions down.</li>
    </ul>
    <p>Only recipes that make the same change in the same direction share the shock. Adding PEG and removing PEG are
      different unknowns.</p>
  {:else if key === 'unknown.2'}
    <p>Shared unknowns create clusters that recipe similarity alone wouldn’t. These are the most valuable clusters to
      test: the first test settles the open question (does this ingredient help or hurt?) for every recipe in the cluster
      at once.</p>
    <p class="why"><b>Why separate the two kinds?</b> A cluster of look-alike recipes mostly confirms what the measured
      recipes already suggest. A cluster bound by an unknown is a genuine bet, and its result moves the model the most.</p>
  {:else if key === 'unknown.3'}
    <p>How risky an untested ingredient is was set by judgement, not measurement. For example, a well-known additive is
      assumed safer than one that grabs magnesium, which reactions need. The dial asks: <i>what if we had guessed bigger or
      smaller?</i></p>
    <p class="why"><b>How to read it.</b> Clusters that survive turning the dial are robust. Clusters that appear or vanish
      depend on the assumption, so treat them with more caution. This is one reason round 1 matters: it replaces these
      guesses with measurements.</p>

  <!-- ── 5 · the matrix ───────────────────────────────────────────────── -->
  {:else if key === 'matrix.0'}
    <p>This is every link at once: a giant table where row 12, column 340 holds the link between design 12 and design 340.
      Bright means strongly linked, dark means unrelated. The bright diagonal line is each design compared with itself,
      which is always a perfect match.</p>
    <p>In random order, the structure is hidden, the same way a phone book shuffled at random wouldn’t show you which people
      live on the same street.</p>
  {:else if key === 'matrix.1'}
    <p>Reordering only moves rows and columns; no number changes. Once linked designs sit next to each other, bright
      squares appear along the diagonal. Each square is a set of designs that are all linked to each other: a cluster.</p>
    <p class="ana"><b>A comparison.</b> Seating a wedding. Put each family at its own table and the tables are the blocks.
      Bright patches away from the diagonal are like two families who know each other well but sit at different tables.</p>
  {:else if key === 'matrix.2'}
    <p>The two switches split each link into its two reasons: similar recipes (blue) or a shared unknown ingredient (red).</p>
    <p class="why"><b>Why it matters for planning.</b> A block made of similar recipes is close to what Ginkgo has already
      measured; testing it mostly confirms. A block made of a shared unknown is a real open question; testing it teaches
      something new.</p>

  <!-- ── 6 · clustering ───────────────────────────────────────────────── -->
  {:else if key === 'groups.0'}
    <p><b>Agglomerative</b> just means “bottom-up”. Start with every design on its own. Find the two most linked and join
      them. Repeat, each time joining the two closest groups, until everything is joined.</p>
    <p>The <b>dendrogram</b> records this as a family tree: each join is drawn at a height that shows how strongly linked
      the two parts were. Cutting the tree at a chosen height gives the clusters: everything joined below the cut stays
      together.</p>
  {:else if key === 'groups.1'}
    <p>Joining two groups needs a rule for how linked they are. <b>Single linkage</b> uses their single best pair, which
      leads to chaining: A is close to B, B to C, C to D, so A and D end up together even though they have nothing in
      common.</p>
    <p class="ana"><b>A comparison.</b> Friends of friends. Everyone at a party can be linked by a chain of acquaintances,
      but that doesn’t make it one circle of friends.</p>
  {:else if key === 'groups.2'}
    <p><b>Complete linkage</b> uses the weakest pair instead: two groups join only if everyone in one is linked to everyone
      in the other. Everyone knows everyone.</p>
    <p class="why"><b>Why 0.5?</b> With every pair linked at least 0.5, any one design in a cluster explains at least a
      quarter (0.5 × 0.5) of every other’s uncertainty. That is enough for one test to speak meaningfully for the cluster,
      without lumping together designs that barely relate.</p>
  {:else if key === 'groups.3'}
    <p>Several students submitted exactly the same recipe. Identical copies are perfectly linked, so they would always form
      a cluster, but that is one experiment submitted twice, not a question. So a cluster must contain at least two
      different recipes. Identical copies share a single well, and everyone who submitted it gets credit on the plate.</p>
  {:else if key === 'groups.4'}
    <p>On the real {target} designs this produces {C} clusters. The threshold is a trade-off:</p>
    <ul>
      <li><b>Lower τ:</b> bigger, looser clusters. Fewer tests needed, but each test speaks less reliably for its cluster.</li>
      <li><b>Higher τ:</b> smaller, tighter clusters. Each test is very representative, but you need more of them.</li>
    </ul>
    <p>0.5 sits in the middle. The match with the export confirms this page runs exactly the method used to plan round 1.</p>

  <!-- ── 7 · effective count ──────────────────────────────────────────── -->
  {:else if key === 'neff.0'}
    <p>Linked experiments overlap in what they tell you, so they are worth fewer than their count.</p>
    <p class="ana"><b>A comparison.</b> Ten thermometers in the same room aren’t ten independent readings of the weather.
      Ten thermometers in ten cities are.</p>
    <p class="ex"><b>Example.</b> Two designs not linked at all count as 2. Two identical designs count as 1. Two designs
      linked at 0.7 count as about 1.3: the second adds roughly a third of an experiment’s worth of new information.</p>
  {:else if key === 'neff.1'}
    <p>{N} designs for {target} behave like about {E} truly separate experiments. Most of what all of them could teach can
      be learned from far fewer tests, which is what makes clustering worthwhile.</p>
    <p class="why"><b>A caution.</b> The number depends on the model’s assumptions (chapter 4’s dial changes it), so treat
      it as “roughly {eff != null ? Math.round(eff) : 'a few dozen'}”, not an exact count.</p>

  <!-- ── 8 · choosing tests ───────────────────────────────────────────── -->
  {:else if key === 'runs.0'}
    <p>Every cluster’s first test is its member with the best odds of beating Ginkgo’s recipe. If the cluster’s shared idea
      works, its strongest member is the one most likely to show it, and it is the one you would want to win.</p>
    <p><b>How the odds are worked out.</b> The computer replays the competition 4,000 times for each design. Each time it
      picks a plausible true performance from the model’s prediction and uncertainty, runs it through the screening steps
      with realistic measurement noise, and checks whether it beats Ginkgo’s best. The odds are the share of replays it
      wins.</p>
  {:else if key === 'runs.1'}
    <p>Once the first test is chosen, every other member is scored by how much it would add. If its link to the first test
      is r, the first test already explains r × r of its uncertainty; the rest is new information.</p>
    <p class="ex"><b>Example.</b> Linked at 0.9: 81% already explained, 19% new. Linked at 0.5: 25% explained, 75% new.
      Designs near 0% new would mostly repeat the first test, so they “follow” it rather than taking a well.</p>
  {:else if key === 'runs.2'}
    <p>To learn which ingredient drives a cluster, the model invents 160 or more recipes spread across the amounts the
      cluster’s designs use, predicts each one’s cost per gram, and then asks for each ingredient: as it goes up, does cost
      per gram go up or down, and how strongly? That question is answered by a <b>regression</b>, which draws the best
      straight-line trend through the points.</p>
    <p><b>Why a Latin hypercube?</b> Random points clump in some places and leave gaps in others. A Latin hypercube spreads
      them evenly: cut each ingredient’s range into equal slices and use every slice exactly once.</p>
    <p class="ana"><b>A comparison.</b> Seating guests at a grid of tables so that every row and every column has exactly
      one guest: nobody crowded, no empty rows.</p>
  {:else if key === 'runs.3'}
    <p>The check test is the member that differs most from the first test in the ingredient that matters most. It is the
      strongest test of the cluster: if even this distant member behaves as the model predicts, the cluster really does act
      as one. If it doesn’t, the model learns exactly where it was wrong.</p>
    <p class="ana"><b>A comparison.</b> To check a claim like “all the dishes from this kitchen are good”, you taste the
      dish least like the one you already tried.</p>
  {:else if key === 'runs.4'}
    <ul>
      <li><b>Independent tests</b> are designs in no cluster. Nothing else predicts them, so each is its own question and
        gets its own well.</li>
      <li><b>Sweep tests</b> are series of designs that change one ingredient step by step and keep everything else the
        same, like a dose–response experiment. Together they measure the whole curve for that ingredient instead of one
        point, which is exactly what the model most needs to improve.</li>
    </ul>
  {:else if key === 'runs.5'}
    <p>The final plate request is a mix, each part bought for a different reason:</p>
    <ul>
      <li><b>First tests</b> answer each cluster’s shared question.</li>
      <li><b>Check tests</b> confirm each cluster really behaves as one.</li>
      <li><b>Independent tests</b> cover the one-of-a-kind ideas.</li>
      <li><b>Sweep tests</b> measure whole curves for the ingredients that matter most.</li>
    </ul>
    <p>Every test is run four times (in quadruplicate) so that a lucky or unlucky well doesn’t mislead.
      {#if tested}For {target} that is {tested} tested compositions.{/if} The round-1 planner starts from this plan and lets
      the team adjust how deeply each cluster is tested before exporting the plates for Ginkgo.</p>
  {:else if key === 'end.0'}
    <p>After round 1, real yields replace predictions. Each result is added to the model’s measured recipes, so its guesses
      get better, its uncertainty shrinks where tests landed, and the assumptions about untested ingredients are replaced
      by data.</p>
    <p class="why"><b>The point of the whole approach</b> is to make round 1 teach as much as possible: each well asks a
      different question, so round 2 starts from a far better map than the one Ginkgo’s 78 recipes could draw on their own.</p>
  {/if}

  {#if W}
    <div class="alt">
      <p class="alt-h">Why this approach: {W.title}</p>
      <div class="alt-grid">
        <div><b>Chosen because</b><ul>{#each W.why as x}<li>{x}</li>{/each}</ul></div>
        <div><b>Alternatives</b><ul>{#each W.alts as x}<li>{x}</li>{/each}</ul></div>
        <div><b>Downsides</b><ul>{#each W.cons as x}<li>{x}</li>{/each}</ul></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .plain { margin-bottom: 8px; }
  .plain h3 { font: 600 19px var(--sans); color: var(--text); margin: 4px 0 10px; }
  .plain p { margin: 0 0 12px; }
  .plain b { color: var(--text); font-weight: 600; }
  .plain ul, .plain ol { margin: 0 0 14px; padding-left: 20px; }
  .plain ul { list-style: disc; }
  .plain ol { list-style: decimal; }
  .plain li { margin: 0 0 7px; }
  /* the three kinds of aside: a comparison, a worked example, and the "why" */
  .ana, .ex, .why { padding: 10px 14px; border-radius: 6px; border-left: 3px solid; }
  .ana { background: rgba(88, 196, 221, .07); border-color: var(--blue); }
  .ex { background: rgba(255, 216, 102, .06); border-color: var(--yellow); }
  .why { background: rgba(92, 208, 179, .07); border-color: var(--teal); }
  /* the method box: rationale, alternatives, downsides */
  .alt { margin: 18px 0 6px; padding: 12px 14px 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--fig); }
  .alt-h { font: 600 12px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--yellow); margin: 0 0 10px !important; }
  .alt-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .alt-grid b { display: block; font: 600 12.5px var(--sans); margin-bottom: 4px; }
  .alt-grid > div:nth-child(1) b { color: var(--teal); }
  .alt-grid > div:nth-child(2) b { color: var(--blue); }
  .alt-grid > div:nth-child(3) b { color: var(--red); }
  .alt-grid ul { padding-left: 16px; margin: 0 0 8px; font-size: 14px; }
  .alt-grid li { margin: 0 0 6px; }
  @media (max-width: 760px) { .alt-grid { grid-template-columns: 1fr; } }
</style>

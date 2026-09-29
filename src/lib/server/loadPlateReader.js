import { readFileSync, readdirSync } from 'fs';

// Plate-reader kinetic views for the /cfps assay section. This joins two files
// that describe the SAME physical plate from different angles:
//   1. autonomous-cfps reference_results/<run>/<run>_results.json
//        → the complete per-well recipe (reagent_list, nL) for all 384 wells,
//          written column-major (sample index i → row = i % 16, col = i / 16).
//   2. catalyst-agent-skills overview_data.json → targets[T].pipelines[i].assay.quality
//        → the kinetic read: cycle_grids (one flat, ROW-major 384 array per
//          timepoint) + keyframe_t_hours, blank_rfu, posctrl_median_rfu.
// The two are matched by plate barcode: the reference plate's
// metadata.assay_container_id equals the overview pipeline's primary_barcode
// (and ginkgo_plate_id equals its cfps_rxn). So we can scrub the kinetic signal
// AND, on well click, hand back that well's exact reagent combination.
const REF_DIR = '/Users/rdonovan/Desktop/autonomous-cfps/reference_results';
const OVERVIEW_PATH =
  '/Users/rdonovan/Desktop/catalyst-agent-skills/scripts/overview/data/overview_data.json';

const ROWL = 'ABCDEFGHIJKLMNOP';
const wellName = (row, col) => `${ROWL[row]}${String(col + 1).padStart(2, '0')}`;

// One control plate per enzyme target. `prefix` matches the control-run folder
// name; `overviewTarget` is the key under overview_data.json `targets`. The
// physical plate is matched inside that target by barcode (order isn't stable).
const TARGETS = [
  {
    key: 'sfgfp',
    label: 'sfGFP',
    prefix: 'sfGFP',
    overviewTarget: 'sfGFP',
    unit: 'RFU',
    kind: 'rfu', // endpoint fluorescence — large magnitudes, integer
  },
  {
    key: 'petase',
    label: 'PETase',
    prefix: 'PETase',
    overviewTarget: 'PETase',
    unit: 'OD 405',
    kind: 'od', // small magnitudes → 1 decimal place
  },
  {
    key: 'reteplase',
    label: 'Reteplase',
    prefix: 'reteplase',
    overviewTarget: 'Reteplase',
    unit: 'RFU',
    kind: 'rfu', // large magnitudes → integer, comma-grouped
  },
];

const refPath = (run) => `${REF_DIR}/${run}/${run}_results.json`;

// Pick the newest control run for a target: folders are named
// "<Target>_control_<YYYYMMDD>-<lysate lot>", so the newest embedded date is the
// current lysate. Returns the folder name, or null if none match.
function newestRun(prefix) {
  let entries;
  try {
    entries = readdirSync(REF_DIR, { withFileTypes: true });
  } catch {
    return null;
  }
  const rx = new RegExp(`^${prefix}_control_(\\d{8})`, 'i');
  let best = null;
  let bestDate = -1;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(rx);
    if (!m) continue;
    const date = Number(m[1]);
    if (date > bestDate) {
      bestDate = date;
      best = entry.name;
    }
  }
  return best;
}

// Some reference files are dumped with allow_nan=True (bare NaN/Infinity tokens
// JSON.parse rejects) — coerce those value-position tokens to null.
function parseJsonLenient(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw
      .replace(/([:[,]\s*)-Infinity\b/g, '$1null')
      .replace(/([:[,]\s*)Infinity\b/g, '$1null')
      .replace(/([:[,]\s*)NaN\b/g, '$1null');
    return JSON.parse(cleaned);
  }
}

// Reagent fields that are fixed by the reaction backbone (not user-tunable) and
// so are excluded from the recipe handed back on well click — the design panel
// keeps its own base_buffer / lysate / template / water.
const FIXED_FIELDS = new Set(['base_buffer', 'lysate', 'nuclease_free_water']);
const isTemplateField = (f) => f.startsWith('template_');

// Build well → reference sample map (accounts for the plate's array order).
function refWellMap(plate) {
  const nRows = plate.n_rows ?? 16;
  const nCols = plate.n_columns ?? 24;
  const columnMajor = (plate.array_order ?? 'column') === 'column';
  const map = {};
  (plate.samples ?? []).forEach((sample, i) => {
    const row = columnMajor ? i % nRows : Math.floor(i / nCols);
    const col = columnMajor ? Math.floor(i / nRows) : i % nCols;
    map[wellName(row, col)] = sample;
  });
  return map;
}

// Compact, tunable-only recipe for a well: pydantic reagent field → nL, dropping
// the fixed backbone fields, templates, water and any zero doses.
function wellRecipe(sample) {
  const rl = sample?.reagent_list;
  if (!rl) return null;
  const recipe = {};
  for (const [field, nl] of Object.entries(rl)) {
    if (FIXED_FIELDS.has(field) || isTemplateField(field)) continue;
    const v = Number(nl);
    if (Number.isFinite(v) && v > 0) recipe[field] = v;
  }
  return recipe;
}

// Locate the kinetic pipeline for a target by barcode/rxn match, preferring the
// richest kinetic read (most cycle_grids) when several plates match.
function findKineticQuality(overview, target, plate) {
  const t = overview?.targets?.[target.overviewTarget];
  if (!t?.pipelines) return null;
  const md = plate.metadata ?? {};
  const wantBarcode = String(md.assay_container_id ?? '');
  const wantRxn = String(md.ginkgo_plate_id ?? '');
  let best = null;
  for (const p of t.pipelines) {
    const q = p?.assay?.quality;
    const grids = q?.cycle_grids;
    if (!Array.isArray(grids) || grids.length === 0) continue;
    const matches =
      (wantBarcode && String(q.primary_barcode ?? '') === wantBarcode) ||
      (wantRxn && String(p.cfps_rxn ?? '') === wantRxn);
    if (!matches) continue;
    if (!best || grids.length > best.cycle_grids.length) best = q;
  }
  return best;
}

function buildTarget(target, overview) {
  const run = newestRun(target.prefix);
  if (!run) return null;
  let refData;
  try {
    refData = parseJsonLenient(readFileSync(refPath(run), 'utf8'));
  } catch {
    return null;
  }
  const plate = Array.isArray(refData) ? refData[0] : refData;
  if (!plate) return null;

  const q = findKineticQuality(overview, target, plate);
  if (!q) return null;

  const nRows = plate.n_rows ?? 16;
  const nCols = plate.n_columns ?? 24;
  const grids = q.cycle_grids; // row-major 384 arrays, one per timepoint
  const timepoints = (q.keyframe_t_hours ?? []).map((h) => Number(h));

  // Grid cells are row-major (index = row * nCols + col). Align a wells[] array
  // to that same index so the client can look up recipe/label by cell index.
  const refWells = refWellMap(plate);
  const wells = [];
  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < nCols; col++) {
      const well = wellName(row, col);
      const sample = refWells[well];
      const sampleType = sample?.sample_type ?? null;
      const label = sample?.metadata?.condition_label ?? '';
      const experimental = sampleType === 'experimental';
      wells.push({
        well,
        sampleType,
        label,
        recipe: experimental ? wellRecipe(sample) : null,
      });
    }
  }

  return {
    key: target.key,
    label: target.label,
    run,
    unit: target.unit,
    kind: target.kind,
    barcode: String(q.primary_barcode ?? ''),
    assayKind: q.assay_kind ?? 'kinetic',
    rows: nRows,
    cols: nCols,
    blank: Number(q.blank_rfu) || 0,
    posctrl: Number(q.posctrl_median_rfu) || 0,
    spanHours: Number(q.span_hours) || 0,
    timepoints,
    grids: grids.map((g) => g.map((v) => (v == null || Number.isNaN(v) ? null : Number(v)))),
    wells,
  };
}

let cache; // memoized across requests — the overview file is ~6 MB, read once.

// Disk-compute step. Reads the local autonomous-cfps / catalyst-agent-skills
// reference files (absolute paths above) and produces the finished plate-reader
// payload. This runs ONLY during `scripts/pb-publish-plate-data.mjs`, which
// publishes the result into PocketBase; at runtime the app reads the published
// blob via $lib/server/plateStore.js (so it works on any host, no local files).
export function buildPlateReaderData() {
  if (cache !== undefined) return cache;

  let overview;
  try {
    overview = parseJsonLenient(readFileSync(OVERVIEW_PATH, 'utf8'));
  } catch {
    cache = null;
    return cache;
  }

  const targets = TARGETS.map((t) => buildTarget(t, overview)).filter(Boolean);
  cache = targets.length
    ? {
        targets,
        label:
          'Kinetic control reads — catalyst-agent-skills overview · joined to autonomous-cfps reference_results recipes',
      }
    : null;
  return cache;
}

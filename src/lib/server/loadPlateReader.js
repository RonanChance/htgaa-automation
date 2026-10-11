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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse a control-run folder name "<Target>_control_<YYYYMMDD>-<lysate lot>" into
// its date and lysate lot (the suffix after the date — e.g. "27-L", "39-L",
// "DSB"). Returns null for folders that don't match the target's prefix.
function parseRunName(prefix, name) {
  const m = name.match(new RegExp(`^${prefix}_control_(\\d{4})(\\d{2})(\\d{2})-(.+)$`, 'i'));
  if (!m) return null;
  const [, y, mo, d, lot] = m;
  const monIdx = Math.max(0, Math.min(11, Number(mo) - 1));
  return {
    run: name,
    dateNum: Number(`${y}${mo}${d}`),
    dateISO: `${y}-${mo}-${d}`,
    dateShort: `${MONTHS[monIdx]} ${y}`, // compact, distinct chip label per batch
    lysateLot: lot,
  };
}

// Extract the lysate batch identity from a reagent_lots.lysate string. The batch
// id is embedded as a YYYYMMDD-<lot> token — e.g. "20260722-39-L CFPS Standard
// Lysate", "E. coli BL21StarDE3 lysate 20260428-27-L", "20260514-DSB Lysate".
// This date is when the lysate BATCH was made (not when the plate was read), and
// it — not the plate's read date — is what makes a batch current vs previous.
function parseLysate(lysateStr) {
  if (typeof lysateStr !== 'string') return null;
  const m = lysateStr.match(/(\d{8})-([A-Za-z0-9-]+)/);
  if (!m) return null;
  return { batch: `${m[1]}-${m[2]}`, dateNum: Number(m[1]), lot: m[2] };
}

// Every control run for a target, newest first. Each run is one lysate-batch
// control plate; the newest is the "current" lysate and the rest are prior
// batches shown behind a selector.
function listRuns(prefix) {
  let entries;
  try {
    entries = readdirSync(REF_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = parseRunName(prefix, entry.name);
    if (info) runs.push(info);
  }
  runs.sort((a, b) => b.dateNum - a.dateNum); // newest first
  return runs;
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

// Build the self-contained plate payload for ONE control run (one lysate batch):
// the kinetic grids + aligned per-well recipes for that physical plate. Returns
// null if the run's results file is missing or has no matching overview read.
function buildPlate(target, info, overview) {
  let refData;
  try {
    refData = parseJsonLenient(readFileSync(refPath(info.run), 'utf8'));
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

  // The authoritative lysate batch comes from the plate's own reagent_lots, not
  // the folder name (status — current vs previous — is assigned in buildTarget by
  // ordering these batch dates).
  const lysateName = plate?.reagent_lots?.lysate ?? null;
  const lys = parseLysate(lysateName);

  return {
    run: info.run,
    dateISO: info.dateISO,
    dateShort: info.dateShort,
    lysateLot: lys?.lot ?? info.lysateLot,
    lysateName,
    lysateBatch: lys?.batch ?? `${info.dateISO.replace(/-/g, '')}-${info.lysateLot}`,
    lysateBatchDate: lys?.dateNum ?? info.dateNum,
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

// A target = the stable protein identity (key/label/unit/kind) plus every lysate
// batch's control plate under `batches`. Returns null if no batch resolves to a
// kinetic read.
function buildTarget(target, overview) {
  const batches = listRuns(target.prefix)
    .map((info) => buildPlate(target, info, overview))
    .filter(Boolean);
  if (!batches.length) return null;
  // Order by the ACTUAL lysate batch (the prep date embedded in
  // reagent_lots.lysate), not the plate's read date — the newest batch is the
  // current lysate, the next is the previous one. The chip labels follow from
  // this status so the UI reads "current / previous lysate" rather than a date.
  batches.sort((a, b) => b.lysateBatchDate - a.lysateBatchDate);
  batches.forEach((b, i) => {
    b.status = i === 0 ? 'current' : i === 1 ? 'previous' : 'older';
    b.chipLabel = i === 0 ? 'current' : i === 1 ? 'previous' : b.dateShort;
    b.chipLabelLong = i === 0 ? 'current lysate' : i === 1 ? 'previous lysate' : b.dateShort;
  });
  return {
    key: target.key,
    label: target.label,
    unit: target.unit,
    kind: target.kind,
    batches,
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
          'Kinetic control reads per lysate batch — catalyst-agent-skills overview · joined to autonomous-cfps reference_results recipes',
      }
    : null;
  return cache;
}

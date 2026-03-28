const EPSILON = 1e-6;

export const ECHO_1536_PARENT_ROWS = 32;
export const ECHO_1536_PARENT_COLS = 48;
export const ECHO_1536_WELL_PITCH_X = 2.5;
export const ECHO_1536_WELL_PITCH_Y = 2.5;
export const ECHO_1536_SUBDIVISIONS_X = 2;
export const ECHO_1536_SUBDIVISIONS_Y = 2;
export const ECHO_1536_SUBPITCH_X = ECHO_1536_WELL_PITCH_X / ECHO_1536_SUBDIVISIONS_X;
export const ECHO_1536_SUBPITCH_Y = ECHO_1536_WELL_PITCH_Y / ECHO_1536_SUBDIVISIONS_Y;
export const ECHO_1536_SUBPOINT_OFFSET_X = ECHO_1536_SUBPITCH_X / 2;
export const ECHO_1536_SUBPOINT_OFFSET_Y = ECHO_1536_SUBPITCH_Y / 2;
export const ECHO_1536_RENDER_COLS = ECHO_1536_PARENT_COLS * ECHO_1536_SUBDIVISIONS_X;
export const ECHO_1536_RENDER_ROWS = ECHO_1536_PARENT_ROWS * ECHO_1536_SUBDIVISIONS_Y;
export const ECHO_1536_MIN_X = -ECHO_1536_SUBPOINT_OFFSET_X;
export const ECHO_1536_MIN_Y = -ECHO_1536_SUBPOINT_OFFSET_Y;
export const ECHO_1536_MAX_X =
  (ECHO_1536_PARENT_COLS - 1) * ECHO_1536_WELL_PITCH_X + ECHO_1536_SUBPOINT_OFFSET_X;
export const ECHO_1536_MAX_Y =
  (ECHO_1536_PARENT_ROWS - 1) * ECHO_1536_WELL_PITCH_Y + ECHO_1536_SUBPOINT_OFFSET_Y;

const SUBPOINT_DELTAS = Object.freeze([
  Object.freeze({
    xOffset: -ECHO_1536_SUBPOINT_OFFSET_X,
    yOffset: -ECHO_1536_SUBPOINT_OFFSET_Y,
    subRow: 0,
    subCol: 0
  }),
  Object.freeze({
    xOffset: ECHO_1536_SUBPOINT_OFFSET_X,
    yOffset: -ECHO_1536_SUBPOINT_OFFSET_Y,
    subRow: 0,
    subCol: 1
  }),
  Object.freeze({
    xOffset: -ECHO_1536_SUBPOINT_OFFSET_X,
    yOffset: ECHO_1536_SUBPOINT_OFFSET_Y,
    subRow: 1,
    subCol: 0
  }),
  Object.freeze({
    xOffset: ECHO_1536_SUBPOINT_OFFSET_X,
    yOffset: ECHO_1536_SUBPOINT_OFFSET_Y,
    subRow: 1,
    subCol: 1
  })
]);

const ECHO_1536_PARENT_SUBPOINTS = Array.from({ length: ECHO_1536_PARENT_ROWS }, () =>
  Array.from({ length: ECHO_1536_PARENT_COLS }, () => [])
);
const ECHO_1536_POINT_METADATA = [];
const ECHO_1536_POINTS = [];

for (let row = 0; row < ECHO_1536_PARENT_ROWS; row++) {
  for (let col = 0; col < ECHO_1536_PARENT_COLS; col++) {
    const centerX = col * ECHO_1536_WELL_PITCH_X;
    const centerY = row * ECHO_1536_WELL_PITCH_Y;
    const subpoints = [];

    for (const delta of SUBPOINT_DELTAS) {
      const point = Object.freeze({
        x: formatEchoCoordinate(centerX + delta.xOffset),
        y: formatEchoCoordinate(centerY + delta.yOffset),
        row,
        col,
        subRow: delta.subRow,
        subCol: delta.subCol
      });
      subpoints.push(point);
      ECHO_1536_POINT_METADATA.push(point);
      ECHO_1536_POINTS.push(Object.freeze({ x: point.x, y: point.y }));
    }

    ECHO_1536_PARENT_SUBPOINTS[row][col] = Object.freeze(subpoints);
  }
}

export function isEcho1536GridStyle(gridStyle) {
  return gridStyle === 'Echo1536' || gridStyle === 'Echo1536Image';
}

export function isEcho6144GridStyle(gridStyle) {
  return gridStyle === 'Echo6144' || gridStyle === 'Echo6144Image';
}

export function formatEchoCoordinate(value) {
  return Number(value).toFixed(3);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isNearlyInteger(value) {
  return Math.abs(value - Math.round(value)) < EPSILON;
}

export function rowLabel1536(index) {
  let s = '';
  let n = Math.floor(index);

  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }

  return s;
}

export function getEcho1536ParentIndicesFromPoint(x, y) {
  const row = clamp(Math.round(Number(y) / ECHO_1536_WELL_PITCH_Y), 0, ECHO_1536_PARENT_ROWS - 1);
  const col = clamp(Math.round(Number(x) / ECHO_1536_WELL_PITCH_X), 0, ECHO_1536_PARENT_COLS - 1);
  return { row, col };
}

export function getEcho1536DestinationWell(x, y) {
  const { row, col } = getEcho1536ParentIndicesFromPoint(x, y);
  return `${rowLabel1536(row)}${col + 1}`;
}

export function getEcho1536SubpointsForParent(row, col) {
  return ECHO_1536_PARENT_SUBPOINTS[row]?.[col] || [];
}

export function getEcho1536PointMetadata() {
  return ECHO_1536_POINT_METADATA;
}

export function buildEcho1536Points(colorForPoint = null) {
  if (!colorForPoint) {
    return ECHO_1536_POINTS;
  }

  const points = new Array(ECHO_1536_POINT_METADATA.length);
  for (let i = 0; i < ECHO_1536_POINT_METADATA.length; i++) {
    const point = ECHO_1536_POINT_METADATA[i];
    points[i] = {
      x: point.x,
      y: point.y,
      color: colorForPoint(point)
    };
  }

  return points;
}

export function snapEcho1536Point(x, y) {
  const snappedCol = clamp(
    Math.round((Number(x) - ECHO_1536_MIN_X) / ECHO_1536_SUBPITCH_X),
    0,
    ECHO_1536_RENDER_COLS - 1
  );
  const snappedRow = clamp(
    Math.round((Number(y) - ECHO_1536_MIN_Y) / ECHO_1536_SUBPITCH_Y),
    0,
    ECHO_1536_RENDER_ROWS - 1
  );

  return {
    x: ECHO_1536_MIN_X + snappedCol * ECHO_1536_SUBPITCH_X,
    y: ECHO_1536_MIN_Y + snappedRow * ECHO_1536_SUBPITCH_Y
  };
}

export function isLegacyEcho1536AnchorPoint(x, y) {
  return (
    isNearlyInteger(Number(x) / ECHO_1536_WELL_PITCH_X) &&
    isNearlyInteger(Number(y) / ECHO_1536_WELL_PITCH_Y)
  );
}

export function normalizeEcho1536PointColors(pointColors) {
  const normalized = {};

  for (const [rawKey, color] of Object.entries(pointColors || {})) {
    const [xRaw, yRaw] = String(rawKey).split(',').map((part) => Number(part.trim()));
    if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) continue;

    if (isLegacyEcho1536AnchorPoint(xRaw, yRaw)) {
      const row = clamp(Math.round(yRaw / ECHO_1536_WELL_PITCH_Y), 0, ECHO_1536_PARENT_ROWS - 1);
      const col = clamp(Math.round(xRaw / ECHO_1536_WELL_PITCH_X), 0, ECHO_1536_PARENT_COLS - 1);
      for (const point of getEcho1536SubpointsForParent(row, col)) {
        normalized[`${formatEchoCoordinate(point.x)}, ${formatEchoCoordinate(point.y)}`] = color;
      }
      continue;
    }

    const snapped = snapEcho1536Point(xRaw, yRaw);
    normalized[`${formatEchoCoordinate(snapped.x)}, ${formatEchoCoordinate(snapped.y)}`] = color;
  }

  return normalized;
}

import PocketBase from 'pocketbase';
import { PB_EMAIL, PB_PASSWORD } from '$env/static/private';

const pb = new PocketBase('https://opentrons-art-pb.rcdonovan.com');
const COLLECTION = 'cfps_reagent_groups';
const RECORD_ID = 't7a97pyfs8lx67w';

function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeReagent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || raw.reagent_id || raw.slug || raw.key;
  const name = raw.name || raw.reagent_name || raw.label || id;
  if (!id || !name) return null;

  const fixedNlRaw = raw.fixedNl ?? raw.fixed_nl;
  const fixedNl = fixedNlRaw == null ? undefined : toNumber(fixedNlRaw, 0);

  return {
    id: String(id),
    name: String(name),
    concentration: String(raw.concentration ?? raw.units ?? 'N/A'),
    costPerMl: toNumber(raw.costPerMl ?? raw.cost_per_ml ?? raw.cost_per_mL ?? 0, 0),
    molecule_id: raw.molecule_id ?? raw.moleculeId ?? null,
    reagent_id: raw.reagent_id ?? raw.reagentId ?? null,
    entity_type: raw.entity_type ?? raw.entityType ?? null,
    entity_id: raw.entity_id ?? raw.entityId ?? null,
    ...(fixedNl !== undefined ? { fixedNl } : {})
  };
}

function normalizeGrouped(items) {
  return items
    .map((item) => {
      const name = item.name || item.group || item.group_name;
      const reagentsRaw = parseMaybeJson(item.reagents) || parseMaybeJson(item.items) || [];
      if (!name || !Array.isArray(reagentsRaw)) return null;

      const reagents = reagentsRaw.map(normalizeReagent).filter(Boolean);
      if (!reagents.length) return null;

      return {
        name: String(name),
        sort: toNumber(item.sort ?? item.order ?? 0, 0),
        reagents
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort, ...group }) => group);
}

function normalizeFlat(items) {
  const groups = new Map();

  for (const item of items) {
    const groupName = item.group || item.group_name || item.category;
    if (!groupName) continue;

    const reagent = normalizeReagent(item);
    if (!reagent) continue;

    if (!groups.has(groupName)) {
      groups.set(groupName, {
        name: String(groupName),
        sort: toNumber(item.group_sort ?? item.group_order ?? 0, 0),
        reagents: []
      });
    }

    groups.get(groupName).reagents.push(reagent);
  }

  return Array.from(groups.values())
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort, ...group }) => group);
}

function extractGroupsFromRecord(record) {
  if (!record || typeof record !== 'object') return [];

  const arrayCandidates = [
    record.reagentGroups,
    record.reagent_groups,
    record.groups,
    record.data,
    record.json,
    record.payload,
    record.content
  ];

  for (const candidate of arrayCandidates) {
    const parsed = parseMaybeJson(candidate);
    if (Array.isArray(parsed) && parsed.length) {
      const grouped = normalizeGrouped(parsed);
      if (grouped.length) return grouped;
      const flat = normalizeFlat(parsed);
      if (flat.length) return flat;
    }
  }

  // Some schemas store groups under `reagents` field
  const reagentsField = parseMaybeJson(record.reagents);
  if (Array.isArray(reagentsField) && reagentsField.length) {
    const grouped = normalizeGrouped(reagentsField);
    if (grouped.length) return grouped;

    // If `reagents` is a flat reagent array, wrap it as one group
    const singleGroup = normalizeGrouped([
      {
        name: record.name || record.group || 'Reagents',
        reagents: reagentsField
      }
    ]);
    if (singleGroup.length) return singleGroup;
  }

  // Last resort: treat the record itself as a grouped/flat row
  const groupedFromRecord = normalizeGrouped([record]);
  if (groupedFromRecord.length) return groupedFromRecord;
  return normalizeFlat([record]);
}

export async function load() {
  try {
    await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);

    const record = await pb.collection(COLLECTION).getOne(RECORD_ID);
    if (!record) {
      return { success: false, reagentGroups: [] };
    }

    const reagentGroups = extractGroupsFromRecord(record);

    return {
      success: reagentGroups.length > 0,
      reagentGroups
    };
  } catch (error) {
    console.error('Failed to load CFPS reagent groups from PocketBase:', error);
    return {
      success: false,
      reagentGroups: []
    };
  }
}

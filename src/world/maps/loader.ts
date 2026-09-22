// Map registry: bundles the built-in map sources and runs them through
// mapFormat.ts's parser/validator, and resolves the two other places a map can
// come from — the player's own localStorage library (customMaps.ts,
// specs/level-editor.md §2.3) and the transient registry a guest uses to hold
// a host's custom map for the length of a room (§9). SPEC §3.4/§3.5.

import { parseMap, type MapDef } from "./mapFormat";
import { MAP_SOURCES } from "./mapSources";
import { DEBUG_MAP_ID, DEBUG_MAP_TEMPLATE } from "./debugMap";
import { getCustomMap, isCustomMapId, listCustomMaps, type CustomMap } from "./customMaps";
import { hasErrors, validateMapTemplate, type MapProblem } from "./validateMap";

export type { MapDef } from "./mapFormat";
export { MapValidationError, parseMap } from "./mapFormat";

let cache: MapDef[] | null = null;

/** Production maps only — the ones that ship with the game. The debug map
 *  (config.DEBUG) deliberately isn't in this list; fetch it via getMap. */
export function listMaps(): MapDef[] {
  if (cache) return cache;
  const maps: MapDef[] = [];
  for (const { id, name, template } of MAP_SOURCES) {
    try {
      maps.push(parseMap(id, name, template));
    } catch (err) {
      if (import.meta.env.DEV) throw err;
      console.error(err);
    }
  }
  cache = maps;
  return maps;
}

export function isBuiltinMapId(id: string): boolean {
  return MAP_SOURCES.some((m) => m.id === id);
}

// --- Custom maps ------------------------------------------------------------

/** Parsed custom maps, keyed by id and re-parsed only when the stored text
 *  changes — the library re-renders on every action, and re-parsing a 64x64
 *  grid per card per render is pure waste. */
const customCache = new Map<string, { template: string; map: MapDef }>();

function parseCustom(record: CustomMap): MapDef | null {
  const hit = customCache.get(record.id);
  if (hit && hit.template === record.template) return hit.map;
  try {
    const map = parseMap(record.id, record.name, record.template);
    customCache.set(record.id, { template: record.template, map });
    return map;
  } catch {
    customCache.delete(record.id);
    return null;
  }
}

export type CustomMapEntry = {
  record: CustomMap;
  /** null when the stored template doesn't parse — the library still lists
   *  it (with its problems) so it can be opened and fixed. */
  map: MapDef | null;
  problems: MapProblem[];
};

export function listCustomMapEntries(): CustomMapEntry[] {
  return listCustomMaps().map((record) => {
    const map = parseCustom(record);
    const problems = validateMapTemplate(record.template);
    return { record, map: map && !hasErrors(problems) ? map : null, problems };
  });
}

/** Built-ins followed by the custom maps that are actually playable — what
 *  the map library offers for Select and what the room may switch to. */
export function listPlayableMaps(): MapDef[] {
  return [...listMaps(), ...listCustomMapEntries().filter((e) => e.map).map((e) => e.map!)];
}

// --- Transient maps (a guest holding the host's custom map, §9) --------------

const transient = new Map<string, MapDef>();
/** The text each transient map came from — a MapDef doesn't keep it, and the
 *  guest's "Save to my maps" needs the template, not the parsed grid. */
const transientSources = new Map<string, { name: string; template: string }>();

/** Registers a map received over the wire for the length of this room. Never
 *  written to storage: a guest doesn't silently gain maps in their library. */
export function registerTransientMap(id: string, name: string, template: string): MapDef {
  const map = parseMap(id, name, template);
  transient.set(id, map);
  transientSources.set(id, { name, template });
  return map;
}

export function getTransientSource(id: string): { name: string; template: string } | null {
  return transientSources.get(id) ?? null;
}

export function clearTransientMaps() {
  transient.clear();
  transientSources.clear();
}

export function getTransientMap(id: string): MapDef | null {
  return transient.get(id) ?? null;
}

let debugMapCache: MapDef | null = null;

export function getMap(id: string): MapDef {
  if (id === DEBUG_MAP_ID) {
    if (!debugMapCache) debugMapCache = parseMap(DEBUG_MAP_ID, "Debug", DEBUG_MAP_TEMPLATE);
    return debugMapCache;
  }
  if (isCustomMapId(id)) {
    // Transient first: while a guest is in someone else's room, the host's
    // copy of a map is the authoritative one even if the guest happens to
    // have saved their own map under that id.
    const held = transient.get(id);
    if (held) return held;
    const record = getCustomMap(id);
    const map = record && parseCustom(record);
    if (map) return map;
    throw new Error(`unknown map '${id}'`);
  }
  const map = listMaps().find((m) => m.id === id);
  if (!map) throw new Error(`unknown map '${id}'`);
  return map;
}

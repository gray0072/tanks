// Map registry: bundles the built-in map sources and runs them through
// mapFormat.ts's parser/validator. SPEC §3.4/§3.5.

import { parseMap, type MapDef } from "./mapFormat";
import { MAP_SOURCES } from "./mapSources";
import { DEBUG_MAP_ID, DEBUG_MAP_TEMPLATE } from "./debugMap";

export type { MapDef } from "./mapFormat";
export { MapValidationError, parseMap } from "./mapFormat";

let cache: MapDef[] | null = null;

/** Production maps only — what the room-creation picker shows. The debug
 *  map (config.DEBUG) deliberately isn't in this list; fetch it via getMap. */
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

let debugMapCache: MapDef | null = null;

export function getMap(id: string): MapDef {
  if (id === DEBUG_MAP_ID) {
    if (!debugMapCache) debugMapCache = parseMap(DEBUG_MAP_ID, "Debug", DEBUG_MAP_TEMPLATE);
    return debugMapCache;
  }
  const map = listMaps().find((m) => m.id === id);
  if (!map) throw new Error(`unknown map '${id}'`);
  return map;
}

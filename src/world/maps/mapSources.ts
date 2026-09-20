// The list of built-in production maps (SPEC §3.4) — split out from
// loader.ts so the map list can change independently of the registry/parsing
// logic that consumes it. Each is a plain template-literal export (mapFormat.ts's
// format, SPEC §3.5); no Vite-specific import needed since these are regular
// TS modules, not raw text files.

import { CLASSIC_TEMPLATE } from "./classic";
import { CROSSROADS_TEMPLATE } from "./crossroads";
import { SWAMP_TEMPLATE } from "./swamp";

export type MapSource = { id: string; name: string; template: string };

export const MAP_SOURCES: MapSource[] = [
  { id: "classic", name: "Classic", template: CLASSIC_TEMPLATE },
  { id: "crossroads", name: "Crossroads", template: CROSSROADS_TEMPLATE },
  { id: "swamp", name: "Swamp", template: SWAMP_TEMPLATE },
];

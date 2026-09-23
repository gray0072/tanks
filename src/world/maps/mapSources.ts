// The list of built-in production maps (SPEC §3.4) — split out from
// loader.ts so the map list can change independently of the registry/parsing
// logic that consumes it. Each is a plain template-literal export (mapFormat.ts's
// format, SPEC §3.5); no Vite-specific import needed since these are regular
// TS modules, not raw text files.

import { CLASSIC_TEMPLATE } from "./classic";
import { CROSSROADS_TEMPLATE } from "./crossroads";
import { FORTRESS_TEMPLATE } from "./fortress";
import { ICEWORKS_TEMPLATE } from "./iceworks";
import { SWAMP_TEMPLATE } from "./swamp";
import { THICKET_TEMPLATE } from "./thicket";

export type MapSource = {
  id: string;
  name: string;
  template: string;
  /** One line on how the map plays, shown wherever a map is being chosen or
   *  confirmed (the library card and the Create Room map row). Lives with the
   *  map rather than with a screen so the two can't drift apart. */
  blurb: string;
};

export const MAP_SOURCES: MapSource[] = [
  {
    id: "classic",
    name: "Classic",
    template: CLASSIC_TEMPLATE,
    blurb: "Battle City homage: brick mazes, steel spine, water gate at midfield.",
  },
  {
    id: "crossroads",
    name: "Crossroads",
    template: CROSSROADS_TEMPLATE,
    blurb: "Four open lanes meeting in the middle, minimal cover, fast and lethal.",
  },
  {
    id: "swamp",
    name: "Swamp",
    template: SWAMP_TEMPLATE,
    blurb: "Water channels and sand flats — movement is the puzzle.",
  },
  {
    id: "thicket",
    name: "Thicket",
    template: THICKET_TEMPLATE,
    blurb: "Wide and horizontal, bases left and right, dense forest cover.",
  },
  {
    id: "fortress",
    name: "Fortress",
    template: FORTRESS_TEMPLATE,
    blurb: "Walled keeps in opposite corners — a siege from both directions at once.",
  },
  {
    id: "iceworks",
    name: "Iceworks",
    template: ICEWORKS_TEMPLATE,
    blurb: "Broad ice floors either side of a steel spine; nothing stops where you meant it to.",
  },
];

/** A map's blurb, or "" for one of the player's own maps — those carry no
 *  description of their own. */
export function mapBlurb(id: string): string {
  return MAP_SOURCES.find((m) => m.id === id)?.blurb ?? "";
}

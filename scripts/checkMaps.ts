// `npm run maps:check` — SPEC §3.5 "Validation" run outside the browser, so
// a broken map fails CI instead of just getting silently dropped from the
// lobby list in production.

import { parseMap } from "../src/world/maps/mapFormat";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { DEBUG_MAP_ID, DEBUG_MAP_TEMPLATE } from "../src/world/maps/debugMap";

let failed = false;

const jobs = [...MAP_SOURCES, { id: DEBUG_MAP_ID, name: "Debug", template: DEBUG_MAP_TEMPLATE }];

for (const { id, name, template } of jobs) {
  try {
    const map = parseMap(id, name, template);
    console.log(`OK   ${id} (${map.width}x${map.height})`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${id}\n  ${(err as Error).message.replace(/\n/g, "\n  ")}`);
  }
}

process.exit(failed ? 1 : 0);

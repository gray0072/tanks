// The bonus drop rate (SPEC §4.3): a round opens with one bonus already on
// the field, and the room's bonuses-per-minute setting paces the rest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../src/world/sim";
import { createDefaultSlots } from "../src/world/tank";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { parseMap } from "../src/world/maps/mapFormat";
import { BONUS_RATE_OPTIONS, DEFAULT_BONUS_RATE, TICK_DT } from "../src/game/constants";
import { DT } from "./helpers";

function simAt(bonusesPerMinute: number, seed = 1): Sim {
  const src = MAP_SOURCES[0];
  const map = parseMap(src.id, src.name, src.template);
  const slots = createDefaultSlots("host", map.spawns.blue.length, map.spawns.red.length);
  return new Sim(
    map,
    { mapId: map.id, winsTarget: 1, timeLimit: 3600, respawnMult: 999, friendlyFire: false, bonusesPerMinute },
    slots,
    seed,
  );
}

/** Distinct bonuses that appeared over `minutes` of idle tanks. */
function dropsOver(sim: Sim, minutes: number): number {
  const seen = new Set<number>();
  for (const b of sim.bonuses) seen.add(b.id);
  for (let t = 0; t < (minutes * 60) / TICK_DT; t++) {
    sim.step({}, DT);
    for (const b of sim.bonuses) seen.add(b.id);
  }
  return seen.size;
}

test("the setting offers 1..10 per minute, default 6", () => {
  assert.deepEqual(BONUS_RATE_OPTIONS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(DEFAULT_BONUS_RATE, 6);
});

test("a round opens with one bonus already on the field", () => {
  for (const rate of [1, DEFAULT_BONUS_RATE, 10]) {
    assert.equal(simAt(rate).bonuses.length, 1, `rate ${rate}`);
  }
});

test("drops per minute follow the setting", () => {
  // Ten minutes smooths out the ±jitter; the opening bonus is the +1.
  for (const rate of [1, 3, DEFAULT_BONUS_RATE, 10]) {
    const drops = dropsOver(simAt(rate), 10);
    const expected = rate * 10 + 1;
    assert.ok(Math.abs(drops - expected) <= Math.max(2, expected * 0.1), `rate ${rate}: ${drops} drops, ~${expected} expected`);
  }
});

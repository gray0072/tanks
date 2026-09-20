// The map format carries its own dimensions and its own roster size (SPEC
// §3.5), so nothing in the engine is tied to the 33x25 / 5-a-side shape of
// the built-in maps. These tests pin the two ends of that range: the 2x2
// floor still produces a playable Sim, and anything smaller is rejected.

import test from "node:test";
import assert from "node:assert/strict";

import { parseMap, MapValidationError } from "../src/world/maps/mapFormat";
import { MIN_MAP_W, MIN_MAP_H } from "../src/game/config";
import { DT, makeSim } from "./helpers";

// One flag and one spawn per team is all a map strictly needs.
const TINY = "Rb\nrB";

test("a 2x2 map parses, with a roster sized from its spawns", () => {
  const map = parseMap("tiny", "Tiny", TINY);
  assert.equal(map.width, MIN_MAP_W);
  assert.equal(map.height, MIN_MAP_H);
  assert.equal(map.spawns.blue.length, 1);
  assert.equal(map.spawns.red.length, 1);
});

test("a match runs on the smallest legal map", () => {
  const sim = makeSim(TINY);
  assert.equal(sim.slots.length, 2, "one slot per spawn, both teams");
  for (let i = 0; i < 120; i++) sim.step({}, DT);
  assert.equal(sim.rules.ended, false);
  assert.equal(sim.tanks.length, 2);
});

test("a map below the 2x2 floor is rejected", () => {
  assert.throws(() => parseMap("thin", "Thin", "R\nb"), MapValidationError);
  assert.throws(
    () => parseMap("thin", "Thin", "R\nb"),
    /below the 2x2 min map size/,
  );
});

test("teams must be symmetric whatever the map's size", () => {
  assert.throws(() => parseMap("lop", "Lopsided", "Rbb\n...\nr.B"), /2 blue spawns/);
});

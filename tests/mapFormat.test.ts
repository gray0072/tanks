// The map format carries its own dimensions and its own roster size (SPEC
// §3.5), so nothing in the engine is tied to the 33x25 / 5-a-side shape of
// the built-in maps. These tests pin the two ends of that range: the 2x2
// floor still produces a playable Sim, and anything smaller is rejected.

import test from "node:test";
import assert from "node:assert/strict";

import { parseMap, MapValidationError } from "../src/world/maps/mapFormat";
import { CELL, MIN_MAP_W, MIN_MAP_H } from "../src/game/config";
import { DT, makeSim } from "./helpers";

// One flag and one spawn per team is all a map strictly needs.
const TINY = "Rb\nrB";
/** 1 red against 2 blue — legal, since the teams need not match. */
const LOPSIDED = "Rbb\n...\nr.B";

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

/** 16 a side — the level editor's ceiling (EDITOR_MAX_SPAWNS_PER_TEAM), and
 *  the largest roster anything in the game can ask for. */
const BIG = [
  "@".repeat(34),
  "@" + "r".repeat(16) + "..R" + ".".repeat(13) + "@",
  ...Array.from({ length: 6 }, () => "@" + ".".repeat(32) + "@"),
  "@" + "b".repeat(16) + "..B" + ".".repeat(13) + "@",
  "@".repeat(34),
].join("\n");

test("a 16-a-side map parses and plays", () => {
  const map = parseMap("big", "Big", BIG);
  assert.equal(map.spawns.red.length, 16);
  assert.equal(map.spawns.blue.length, 16);

  const sim = makeSim(BIG);
  assert.equal(sim.tanks.length, 32, "one tank per spawn");
  // Every tank gets its own spawn cell — Sim indexes spawns by slot id, so a
  // roster bigger than the spawn list would silently stack tanks.
  const cells = new Set(sim.tanks.map((t) => `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`));
  assert.equal(cells.size, 32);
  for (let i = 0; i < 120; i++) sim.step({}, DT);
  assert.equal(sim.rules.ended, false);
});

test("the teams need not be the same size", () => {
  // 1 red against 2 blue: the parser takes it, and each team's roster is
  // sized from its own spawn count (SPEC 3.5). The level editor warns about
  // it (tests/mapValidation.test.ts), but nothing here blocks it.
  const map = parseMap("lop", "Lopsided", LOPSIDED);
  assert.equal(map.spawns.red.length, 1);
  assert.equal(map.spawns.blue.length, 2);

  const sim = makeSim(LOPSIDED);
  assert.equal(sim.tanks.length, 3, "one tank per spawn, not two equal teams");
  assert.equal(sim.tanks.filter((t) => t.team === "blue").length, 2);
  assert.equal(sim.tanks.filter((t) => t.team === "red").length, 1);
  // Each team's tanks take that team's own spawns, so nobody is stacked.
  const cells = new Set(sim.tanks.map((t) => `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`));
  assert.equal(cells.size, 3);
  for (let i = 0; i < 60; i++) sim.step({}, DT);
  assert.equal(sim.tanks.length, 3);
});

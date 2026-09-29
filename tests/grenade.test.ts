// GRENADE (SPEC §4.3): it used to destroy every enemy alive on pickup. Now it
// is lobbed at the biggest enemy knot, blows up where it lands after a short
// flight, scales its blast with the map, and never takes more than half the
// enemy team.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBonus } from "../src/world/bonus";
import { grenadeKillCap, grenadeRadius, pickGrenadeTarget } from "../src/world/grenade";
import { CELL, BONUS_DURATION } from "../src/game/constants";
import { DT, cells, makeSim, place } from "./helpers";

// One blue against four reds, open ground.
const FIELD = `
@@@@@@@@@@@@@@@@@@@@
@b...............r.@
@..................@
@................r.@
@..................@
@B...............rR@
@................r.@
@@@@@@@@@@@@@@@@@@@@
`;

const reds = (sim: ReturnType<typeof makeSim>) => sim.tanks.filter((t) => t.team === "red");

/** Blue takes a GRENADE; three reds are bunched on the right, one stands
 *  alone closer by. */
function setup() {
  const sim = makeSim(FIELD);
  const blue = sim.tankBySlot(0);
  const [a, b, c, lone] = reds(sim);
  place(blue, cells(2), cells(5));
  place(a, cells(14), cells(2));
  place(b, cells(15), cells(3));
  place(c, cells(14), cells(4));
  place(lone, cells(6), cells(1));
  return { sim, blue, bunch: [a, b, c], lone };
}

function pick(sim: ReturnType<typeof makeSim>) {
  sim.bonuses.push(createBonus("GRENADE", 2, 5, 60));
  sim.step({}, DT);
}

function run(sim: ReturnType<typeof makeSim>, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.step({}, DT);
}

test("the blast radius follows the map's size, within bounds", () => {
  assert.equal(grenadeRadius(10, 10), 3 * CELL, "a small map gets the floor");
  const classic = grenadeRadius(33, 25) / CELL;
  assert.ok(classic > 4 && classic < 5, `33x25 should be ~4.6 cells, got ${classic}`);
  assert.equal(grenadeRadius(64, 64), 8 * CELL, "a huge map gets the ceiling");
  assert.ok(grenadeRadius(40, 40) > grenadeRadius(33, 25));
});

test("one grenade takes at most half the enemy team, rounded up", () => {
  assert.deepEqual([1, 2, 3, 5, 20].map(grenadeKillCap), [1, 1, 2, 3, 10]);
});

test("it aims at the biggest knot, and at the nearest enemy when nobody is bunched", () => {
  const from = { x: 0, y: 0 };
  const knot = [{ x: 500, y: 0 }, { x: 530, y: 20 }, { x: 510, y: 40 }];
  const lone = { x: 100, y: 0 };
  const hit = pickGrenadeTarget(from, [lone, ...knot], 96)!;
  assert.equal(hit.count, 3);
  assert.ok(hit.x > 400, "the knot, not the nearer lone tank");
  const spread = pickGrenadeTarget(from, [{ x: 900, y: 0 }, lone, { x: 0, y: 700 }], 96)!;
  assert.deepEqual([spread.x, spread.y, spread.count], [lone.x, lone.y, 1]);
  assert.equal(pickGrenadeTarget(from, [], 96), null);
});

test("it is not instant: it flies first, then goes off", () => {
  const { sim, bunch } = setup();
  pick(sim);
  assert.equal(sim.grenades.length, 1, "a grenade is in the air");
  assert.ok(bunch.every((t) => t.alive), "nobody dies on pickup any more");
  run(sim, 1.5);
  assert.equal(sim.grenades.length, 0, "and it has landed");
});

test("it hits the knot and spares the rest — never more than half the team", () => {
  const { sim, bunch, lone } = setup();
  pick(sim);
  run(sim, 1.5);
  const dead = bunch.filter((t) => !t.alive).length;
  assert.equal(dead, grenadeKillCap(4), "two of a team of four, although three were in the ring");
  assert.ok(lone.alive, "the lone tank far from the blast lives");
  assert.ok(reds(sim).some((t) => t.alive), "and it is never a wipe");
});

test("a tank that drives out of the ring in time survives", () => {
  const { sim, bunch } = setup();
  pick(sim);
  const g = sim.grenades[0];
  // Everyone in the knot gets clear of the landing point before it lands.
  for (const [i, t] of bunch.entries()) place(t, cells(8), cells(2 + i * 2));
  for (const t of bunch) {
    const d = Math.hypot(t.x + CELL / 2 - g.toX, t.y + CELL / 2 - g.toY);
    assert.ok(d > g.radius, "the scenario really is outside the ring");
  }
  run(sim, 1.5);
  assert.ok(bunch.every((t) => t.alive));
});

test("a helmet absorbs the blast like it absorbs a bullet", () => {
  const { sim, bunch } = setup();
  for (const t of bunch) t.helmetT = BONUS_DURATION.HELMET;
  pick(sim);
  run(sim, 1.5);
  assert.ok(bunch.every((t) => t.alive));
  assert.ok(bunch.some((t) => t.helmetT === 0), "the helmet was spent");
});

// A match must start on pristine terrain. The MapDef a match is built from is
// cached and handed out again for the rematch (world/maps/loader), so a Sim
// that shot holes in it directly would have the next round start on last
// round's wreckage.

import test from "node:test";
import assert from "node:assert/strict";

import { Tile, BRICK_QUARTERS } from "../src/world/grid";
import { Dir } from "../src/util/math";
import { cells, isolate, makeMap, makeSimFromMap, place } from "./helpers";
import type { Sim } from "../src/world/sim";

// A full-height brick wall at column 6, with both spawns and both flags on
// the open left side — whatever row a bullet flies along, it hits brick.
const WALL = `
@@@@@@@@@@@@@@
@b....#......@
@.....#......@
@.....#......@
@B....#.....R@
@.....#......@
@.....#......@
@r....#......@
@@@@@@@@@@@@@@
`;

// The row a bullet from a tank parked at (3,2) flies along.
const TARGET = { cx: 6, cy: 2 };

/** Parks slot 0 in front of the wall and holds fire until the brick in front
 *  of it is gone. Returns the tick it broke on, or null if it never did. */
function shootWallDown(sim: Sim): number | null {
  isolate(sim, 0);
  const tank = sim.tanks.find((t) => t.slot === 0)!;
  place(tank, cells(3), cells(2));
  tank.dir = Dir.Right;
  for (let i = 0; i < 600; i++) {
    sim.step({ 0: { dir: null, fire: true, mine: false } }, 1 / 30);
    if (sim.grid.tileAt(TARGET.cx, TARGET.cy) === Tile.Empty) return i;
  }
  return null;
}

test("shooting a brick damages the match's own grid, not the map it came from", () => {
  const map = makeMap(WALL);
  const sim = makeSimFromMap(map);

  assert.notEqual(shootWallDown(sim), null, "the tank never broke the brick in front of it");

  assert.equal(map.grid.tileAt(TARGET.cx, TARGET.cy), Tile.Brick);
  assert.equal(map.grid.brickQuartersAt(TARGET.cx, TARGET.cy), BRICK_QUARTERS);
});

test("a rematch on the same map starts on undamaged terrain", () => {
  const map = makeMap(WALL);
  const first = makeSimFromMap(map);
  assert.notEqual(shootWallDown(first), null);

  const rematch = makeSimFromMap(map);
  assert.equal(rematch.grid.tileAt(TARGET.cx, TARGET.cy), Tile.Brick);
  assert.equal(rematch.grid.brickQuartersAt(TARGET.cx, TARGET.cy), BRICK_QUARTERS);
  // The whole wall, not just the cell that was shot: a half-damaged brick
  // elsewhere would be just as wrong.
  for (let cy = 1; cy <= 7; cy++) {
    assert.equal(rematch.grid.tileAt(6, cy), Tile.Brick, `wall cell 6,${cy}`);
    assert.equal(rematch.grid.brickQuartersAt(6, cy), BRICK_QUARTERS, `wall quarters 6,${cy}`);
  }
});

test("a shovel wall from one match doesn't turn up as steel in the next", () => {
  const map = makeMap(WALL);
  const first = makeSimFromMap(map);
  first.grid.fortify(6, 6);
  assert.equal(first.grid.tileAt(6, 6), Tile.Steel);

  assert.equal(makeSimFromMap(map).grid.tileAt(6, 6), Tile.Brick);
});

test("the two matches' grids are independent objects", () => {
  const map = makeMap(WALL);
  const a = makeSimFromMap(map);
  const b = makeSimFromMap(map);
  a.grid.damageBrick(6, 5, BRICK_QUARTERS);
  assert.equal(a.grid.tileAt(6, 5), Tile.Empty);
  assert.equal(b.grid.tileAt(6, 5), Tile.Brick);
});

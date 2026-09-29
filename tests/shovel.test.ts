// SHOVEL (SPEC §4.3): rebuilds the flag's pocket in steel — shot-out cells
// included — reverts it to fresh brick, and is never dropped on a map where
// a flag has no pocket to build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Tile } from "../src/world/grid";
import { createBonus } from "../src/world/bonus";
import { BONUS_DURATION } from "../src/game/constants";
import { DT, cells, makeSim, place } from "./helpers";

// Blue's flag at (2,4) in a brick pocket open to the north; red's likewise.
const POCKETS = `
@@@@@@@@@@
@.*..R*..@
@...###..@
@b.....r.@
@.#......@
@#B#.....@
@@@@@@@@@@
`;

const BARE = `
@@@@@@@@@@
@.*..R*..@
@........@
@b.....r.@
@........@
@.B......@
@@@@@@@@@@
`;

/** Blue tank 0 drives onto a SHOVEL dropped at (1,3), right next to it. */
function pickShovel(sim: ReturnType<typeof makeSim>) {
  const tank = sim.tankBySlot(0);
  place(tank, cells(1), cells(3));
  sim.bonuses.push(createBonus("SHOVEL", 1, 3, 60));
  sim.step({}, DT);
}

test("a shovel turns the pocket to steel and rebuilds a shot-out wall", () => {
  const sim = makeSim(POCKETS);
  sim.grid.setTile(3, 5, Tile.Empty); // one side of blue's pocket shot away
  pickShovel(sim);
  for (const [cx, cy] of [[1, 5], [3, 5], [2, 4]]) {
    assert.equal(sim.grid.tileAt(cx, cy), Tile.Steel, `(${cx},${cy}) should be steel`);
  }
});

test("when the shovel runs out the pocket comes back as fresh brick", () => {
  const sim = makeSim(POCKETS);
  sim.grid.setTile(3, 5, Tile.Empty);
  pickShovel(sim);
  for (let i = 0; i < Math.ceil((BONUS_DURATION.SHOVEL + 0.5) / DT); i++) sim.step({}, DT);
  for (const [cx, cy] of [[1, 5], [3, 5], [2, 4]]) {
    assert.equal(sim.grid.tileAt(cx, cy), Tile.Brick, `(${cx},${cy}) should be brick again`);
  }
});

test("a shovel never walls a tank in", () => {
  const sim = makeSim(POCKETS);
  sim.grid.setTile(2, 4, Tile.Empty);
  const red = sim.tankBySlot(1);
  place(red, cells(2), cells(4)); // parked in the gap
  pickShovel(sim);
  assert.equal(sim.grid.tileAt(2, 4), Tile.Empty, "the occupied cell must stay open");
  assert.equal(sim.grid.tileAt(1, 5), Tile.Steel, "the rest of the pocket is still fortified");
});

test("a map whose flag has no pocket never drops a SHOVEL", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const sim = makeSim(BARE, seed);
    const kinds = new Set<string>();
    for (let i = 0; i < (10 * 60) / DT; i++) {
      for (const b of sim.bonuses) kinds.add(b.kind);
      sim.bonuses = []; // keep the field clear so drops keep coming
      sim.step({}, DT);
    }
    assert.ok(kinds.size > 3, "the map should still drop the other bonuses");
    assert.ok(!kinds.has("SHOVEL"), `seed ${seed} dropped a SHOVEL with nothing to build`);
  }
});

test("a map with pockets does drop a SHOVEL", () => {
  const sim = makeSim(POCKETS, 3);
  let seen = false;
  for (let i = 0; i < (10 * 60) / DT && !seen; i++) {
    seen = sim.bonuses.some((b) => b.kind === "SHOVEL");
    sim.bonuses = [];
    sim.step({}, DT);
  }
  assert.ok(seen);
});

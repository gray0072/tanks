// Controls: the input-side rules the touch layer (SPEC §5.3) and the keyboard
// share. Runs headless (`npm test`) — no browser, no PixiJS.

import test from "node:test";
import assert from "node:assert/strict";

import { Dir, DIR_VECTOR, dirFromAngle } from "../src/util/math";
import type { SeatInput } from "../src/world/sim";
import { DT, isolate, makeSim } from "./helpers";

// Open arena, one spawn a side, nothing to bump into.
const OPEN = `
@@@@@@@@@@
@b.......@
@........@
@B......R@
@........@
@r.......@
@@@@@@@@@@
`;

const press = (mine: boolean): SeatInput => ({ dir: null, fire: false, mine });

test("holding the mine control lays exactly one mine", () => {
  const sim = makeSim(OPEN);
  isolate(sim, 0);
  const tank = sim.tankBySlot(0);
  tank.mines = 3;

  // 30 ticks is half a second of a perfectly ordinary button press — long
  // enough that a level-triggered drop would have emptied the whole stock.
  for (let i = 0; i < 30; i++) sim.step({ 0: press(true) }, DT);
  assert.equal(sim.mines.length, 1, "one press must lay one mine, not one per tick");
  assert.equal(tank.mines, 2);
});

test("releasing and pressing again lays a second mine", () => {
  const sim = makeSim(OPEN);
  isolate(sim, 0);
  const tank = sim.tankBySlot(0);
  tank.mines = 3;

  for (let i = 0; i < 10; i++) sim.step({ 0: press(true) }, DT);
  for (let i = 0; i < 10; i++) sim.step({ 0: press(false) }, DT);
  for (let i = 0; i < 10; i++) sim.step({ 0: press(true) }, DT);
  assert.equal(sim.mines.length, 2);
  assert.equal(tank.mines, 1);
});

test("a tank with no mines left lays nothing however long the control is held", () => {
  const sim = makeSim(OPEN);
  isolate(sim, 0);
  sim.tankBySlot(0).mines = 0;
  for (let i = 0; i < 30; i++) sim.step({ 0: press(true) }, DT);
  assert.equal(sim.mines.length, 0);
});

// The touch stick reports a continuous angle; dirFromAngle is the only thing
// standing between it and an 8-way Dir, so every sector needs to land on the
// direction the player actually pointed at.
test("the stick's angle maps onto the Dir whose vector it points along", () => {
  const all: Dir[] = [
    Dir.Up, Dir.UpRight, Dir.Right, Dir.DownRight,
    Dir.Down, Dir.DownLeft, Dir.Left, Dir.UpLeft,
  ];
  for (const dir of all) {
    const v = DIR_VECTOR[dir];
    assert.equal(dirFromAngle(Math.atan2(v.y, v.x)), dir, `dead center of ${Dir[dir]}`);
    // Anywhere inside the sector, not just its center: ±22° is the edge, so
    // ±20° must still resolve the same way.
    const wobble = (20 * Math.PI) / 180;
    const base = Math.atan2(v.y, v.x);
    assert.equal(dirFromAngle(base - wobble), dir, `${Dir[dir]} minus 20°`);
    assert.equal(dirFromAngle(base + wobble), dir, `${Dir[dir]} plus 20°`);
  }
});

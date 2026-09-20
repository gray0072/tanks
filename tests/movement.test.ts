// Tank movement: straight-line travel, collision, turning, and the corner
// assist. Runs headless (`npm test`) — no browser, no PixiJS.

import test from "node:test";
import assert from "node:assert/strict";

import { Dir, DIR_VECTOR } from "../src/util/math";
import {
  CELL,
  TANK_SIZE,
  TANK_HITBOX,
  TANK_MARGIN,
  TANK_SPEED,
  SAND_SPEED_MULT,
  SPEED_BONUS_MULT,
  ICE_SLIDE_TIME,
} from "../src/game/config";
import { tankCenter, tankHitbox } from "../src/world/tank";
import { CARDINALS, DT, crossAxis, dirName, hold, isolate, makeSim, place, step } from "./helpers";

// An empty arena with a steel border. Flags sit in the middle row's two side
// columns; every movement test below stays well clear of them.
const OPEN = `
@@@@@@@@@@@@@@
@b...........@
@............@
@............@
@B..........R@
@............@
@............@
@r...........@
@@@@@@@@@@@@@@
`;

// Row 3 is a solid wall with a single 1-cell gap at column 5 — the classic
// "turn into a same-width corridor" case the corner assist exists for.
const GAP = `
@@@@@@@@@@
@b.......@
@........@
@@@@@.@@@@
@........@
@........@
@B......R@
@........@
@r.......@
@@@@@@@@@@
`;

// Row 4 is a surface strip — sand (cols 2-3), ice (4-5), forest (6-7),
// water (8) — laid out so a tank can drive straight through all of them.
// Row 2 is the plain-ground control lane. Flags are parked out of the way in
// the right-hand column.
const SURFACES = `
@@@@@@@@@@@@
@b.........@
@.........B@
@..........@
@.,,--%%~..@
@..........@
@.........R@
@r.........@
@@@@@@@@@@@@
`;

/** An isolated slot-0 tank parked at an exact pixel position. */
function soloAt(template: string, x: number, y: number, dir: Dir = Dir.Up) {
  const sim = makeSim(template);
  isolate(sim, 0);
  const tank = sim.tankBySlot(0);
  place(tank, x, y);
  tank.dir = dir;
  return { sim, tank };
}

const stepPx = TANK_SPEED * DT;

// --- geometry -------------------------------------------------------------

test("hitbox is centered inside the 32px logical slot", () => {
  const { tank } = soloAt(OPEN, 96, 64);
  const box = tankHitbox(tank);
  const c = tankCenter(tank);
  assert.equal(TANK_MARGIN * 2 + TANK_HITBOX, TANK_SIZE, "margins must account for the whole slot");
  assert.equal(box.x + box.w / 2, c.x);
  assert.equal(box.y + box.h / 2, c.y);
});

// --- straight-line travel -------------------------------------------------

for (const dir of CARDINALS) {
  test(`moving ${dirName(dir)} advances at TANK_SPEED and leaves the cross axis alone`, () => {
    const { sim, tank } = soloAt(OPEN, 5 * CELL, 3 * CELL);
    const start = { x: tank.x, y: tank.y };
    const cross = crossAxis(dir);
    hold(sim, 0, dir, 10);

    const v = DIR_VECTOR[dir];
    const along = dir === Dir.Left || dir === Dir.Right ? "x" : "y";
    const expected = start[along] + (v.x || v.y) * stepPx * 10;
    assert.ok(Math.abs(tank[along] - expected) < 1e-9, `${along}: ${tank[along]} != ${expected}`);
    assert.equal(tank[cross], start[cross], "cross axis drifted");
    assert.equal(tank.dir, dir);
  });
}

test("diagonal travel covers the same distance per tick as a cardinal one", () => {
  const { sim, tank } = soloAt(OPEN, 5 * CELL, 3 * CELL);
  const start = tankCenter(tank);
  hold(sim, 0, Dir.DownRight, 10);
  const end = tankCenter(tank);
  const travelled = Math.hypot(end.x - start.x, end.y - start.y);
  assert.ok(Math.abs(travelled - stepPx * 10) < 1e-6, `diagonal travelled ${travelled}`);
});

test("no input means no movement", () => {
  const { sim, tank } = soloAt(OPEN, 100, 100, Dir.Right);
  hold(sim, 0, null, 30);
  assert.equal(tank.x, 100);
  assert.equal(tank.y, 100);
});

// --- turning: the tank's center must not shift sideways -------------------

test("turning in the open never moves the tank's center on the cross axis", () => {
  // Drive left off the grid lines first — the regression only showed up when
  // the tank was *not* already cell-aligned.
  const { sim, tank } = soloAt(OPEN, 6 * CELL, 3 * CELL, Dir.Left);
  hold(sim, 0, Dir.Left, 7);
  assert.notEqual(tank.x % CELL, 0, "test setup: tank should be off-grid on x");

  const xBefore = tank.x;
  step(sim, 0, Dir.Down);
  assert.equal(tank.x, xBefore, "turning down out of a leftward run shifted x");
  assert.ok(Math.abs(tank.y - (3 * CELL + stepPx)) < 1e-9);

  // …and it must stay put for the whole descent, not creep over time.
  hold(sim, 0, Dir.Down, 20);
  assert.equal(tank.x, xBefore, "x drifted while driving down");
});

for (const from of CARDINALS) {
  for (const to of CARDINALS) {
    if (from === to) continue;
    test(`turn ${dirName(from)} -> ${dirName(to)} keeps the ${crossAxis(to)} center fixed`, () => {
      // Start deliberately misaligned on both axes, so either cross axis
      // would visibly snap if the assist fired without being blocked.
      const { sim, tank } = soloAt(OPEN, 5 * CELL + 7, 3 * CELL + 5, from);
      hold(sim, 0, from, 3);
      const cross = crossAxis(to);
      const before = tank[cross];
      step(sim, 0, to);
      assert.equal(tank[cross], before);
    });
  }
}

test("a blocked turn changes facing without sliding along the wall", () => {
  // Pressed against the top border: turning up can't move the tank past it,
  // and the corner assist must not slide it sideways along a wall it can
  // never pass. The tank's slot overlaps the wall cell by TANK_MARGIN — it's
  // the hitbox, not the slot, that comes to rest against it.
  const { sim, tank } = soloAt(GAP, 2 * CELL + 5, 1 * CELL, Dir.Right);
  hold(sim, 0, Dir.Up, 30);
  const box = tankHitbox(tank);
  assert.ok(box.y >= 1 * CELL, `hitbox overran the border row: ${box.y}`);
  assert.ok(box.y < 1 * CELL + stepPx, "stopped short of the border row");
  assert.equal(tank.x, 2 * CELL + 5, "crept sideways along a solid wall");
  assert.equal(tank.dir, Dir.Up);
});

// --- corner assist --------------------------------------------------------

// The hitbox is narrower than the cell, so a tank fits in column c for any
// x within +/-TANK_MARGIN of that column's grid line; the assist only has to
// close whatever misalignment is left over.
const fitsColumn = (x: number, col: number) =>
  x + TANK_MARGIN >= col * CELL && x + TANK_MARGIN + TANK_HITBOX <= (col + 1) * CELL;

test("a tank misaligned right of a 1-cell gap still gets through it", () => {
  const { sim, tank } = soloAt(GAP, 5 * CELL + 5, 2 * CELL, Dir.Down);
  hold(sim, 0, Dir.Down, 60); // 2 s
  assert.ok(tank.y > 4 * CELL, `tank never passed the wall row (y=${tank.y})`);
  assert.ok(fitsColumn(tank.x, 5), `x=${tank.x} is not inside the gap column`);
  // Nudged just far enough to fit, not snapped all the way to the grid line.
  assert.ok(tank.x > 5 * CELL, `over-corrected to x=${tank.x}`);
});

test("a tank misaligned left of a 1-cell gap still gets through it", () => {
  const { sim, tank } = soloAt(GAP, 5 * CELL - 5, 2 * CELL, Dir.Down);
  hold(sim, 0, Dir.Down, 60);
  assert.ok(tank.y > 4 * CELL, `tank never passed the wall row (y=${tank.y})`);
  assert.ok(fitsColumn(tank.x, 5), `x=${tank.x} is not inside the gap column`);
  assert.ok(tank.x < 5 * CELL, `over-corrected to x=${tank.x}`);
});

test("the assist does not fire when aligning wouldn't open the way", () => {
  // Column 2 of the wall row is solid; aligning to it changes nothing, so
  // the tank must stop dead instead of sliding along the wall.
  const { sim, tank } = soloAt(GAP, 2 * CELL + 5, 2 * CELL, Dir.Down);
  hold(sim, 0, Dir.Down, 60);
  assert.equal(tank.x, 2 * CELL + 5, "tank slid sideways along a solid wall");
  assert.ok(tank.y < 3 * CELL);
});

test("a gap the tank's center isn't lined up with stays unreachable", () => {
  // The center sits in column 4, whose wall cell is solid — the assist
  // targets column 4, not the gap at column 5, so the tank stays blocked.
  const { sim, tank } = soloAt(GAP, 4 * CELL + 10, 2 * CELL, Dir.Down);
  hold(sim, 0, Dir.Down, 60);
  assert.ok(tank.y < 3 * CELL, "tank should not have squeezed through");
});

// --- collision ------------------------------------------------------------

test("steel stops the tank flush against the wall", () => {
  const { sim, tank } = soloAt(OPEN, 5 * CELL, 5 * CELL, Dir.Down);
  hold(sim, 0, Dir.Down, 200);
  const box = tankHitbox(tank);
  // The bottom border is row 8; the hitbox must end at or before its top edge.
  assert.ok(box.y + box.h <= 8 * CELL, `hitbox overruns the wall: ${box.y + box.h}`);
  assert.ok(box.y + box.h > 8 * CELL - stepPx - 1e-9, "stopped short of the wall");
});

test("the world bounds clamp the tank inside the arena", () => {
  const { sim, tank } = soloAt(OPEN, 3 * CELL, 3 * CELL, Dir.Left);
  hold(sim, 0, Dir.Left, 200);
  assert.ok(tank.x >= 0);
  hold(sim, 0, Dir.Up, 200);
  assert.ok(tank.y >= 0);
});

test("water blocks, forest/ice/sand don't", () => {
  const { sim, tank } = soloAt(SURFACES, 1 * CELL, 4 * CELL, Dir.Right);
  hold(sim, 0, Dir.Right, 300);
  const box = tankHitbox(tank);
  assert.ok(box.x > 5 * CELL, `never crossed the sand/ice/forest strip (x=${tank.x})`);
  assert.ok(box.x + box.w <= 8 * CELL, `drove into water (hitbox right edge ${box.x + box.w})`);
});

test("two tanks cannot overlap", () => {
  const sim = makeSim(OPEN);
  const a = sim.tankBySlot(0);
  const b = sim.tankBySlot(1);
  a.invulnT = 0;
  b.invulnT = 0;
  place(a, 3 * CELL, 3 * CELL);
  place(b, 6 * CELL, 3 * CELL);
  b.dir = Dir.Right;
  hold(sim, 0, Dir.Right, 60);
  const ha = tankHitbox(a);
  const hb = tankHitbox(b);
  assert.ok(ha.x + ha.w <= hb.x + 1e-9, `tanks overlapped: ${ha.x + ha.w} vs ${hb.x}`);
  assert.ok(ha.x > 3 * CELL, "the moving tank never actually advanced");
});

// --- surfaces and buffs ---------------------------------------------------

test("sand slows the tank and SPEED speeds it up", () => {
  // Surface speed is decided by the tile under the tank's *center*, so each
  // run starts a full cell into its lane.
  const plain = soloAt(SURFACES, 2 * CELL, 2 * CELL, Dir.Right);
  hold(plain.sim, 0, Dir.Right, 5);
  const plainDist = plain.tank.x - 2 * CELL;
  assert.ok(plainDist > 0);

  const sand = soloAt(SURFACES, 2 * CELL, 4 * CELL, Dir.Right);
  hold(sand.sim, 0, Dir.Right, 5);
  const sandDist = sand.tank.x - 2 * CELL;
  assert.ok(Math.abs(sandDist - plainDist * SAND_SPEED_MULT) < 1e-6, `sand: ${sandDist}`);

  const fast = soloAt(SURFACES, 2 * CELL, 2 * CELL, Dir.Right);
  fast.tank.speedT = 10;
  hold(fast.sim, 0, Dir.Right, 5);
  const fastDist = fast.tank.x - 2 * CELL;
  assert.ok(Math.abs(fastDist - plainDist * SPEED_BONUS_MULT) < 1e-6, `speed: ${fastDist}`);
});

test("ice defers the turn until the slide decays, then keeps sliding", () => {
  // Cells (4,4) and (5,4) of SURFACES are ice.
  const { sim, tank } = soloAt(SURFACES, 4 * CELL, 4 * CELL, Dir.Right);
  step(sim, 0, Dir.Right);
  assert.ok(tank.slideT > 0, "driving on ice should arm the slide");

  step(sim, 0, Dir.Down);
  assert.equal(tank.dir, Dir.Right, "ice must not allow an instant turn");

  // Release: the tank keeps moving in its old direction while slideT burns.
  const xBefore = tank.x;
  hold(sim, 0, null, 2);
  assert.ok(tank.x > xBefore, "should have kept sliding after key release");
  assert.ok(tank.slideT < ICE_SLIDE_TIME);
});

test("a CLOCK-frozen team cannot move", () => {
  const { sim, tank } = soloAt(OPEN, 5 * CELL, 3 * CELL, Dir.Right);
  sim.clockFrozen[tank.team] = 5;
  hold(sim, 0, Dir.Right, 30);
  assert.equal(tank.x, 5 * CELL);
});

test("a dead tank ignores input", () => {
  const { sim, tank } = soloAt(OPEN, 5 * CELL, 3 * CELL, Dir.Right);
  tank.alive = false;
  tank.respawnT = Infinity;
  hold(sim, 0, Dir.Right, 30);
  assert.equal(tank.x, 5 * CELL);
});

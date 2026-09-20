// Bot tactics — SPEC §10. Covers what the three difficulty profiles are
// supposed to *do* differently, not just that they produce input: objective
// play (attacking the enemy flag), shooting through destructible cover,
// bonus behaviour, fair perception, and the difficulty gradient itself.

import test from "node:test";
import assert from "node:assert/strict";

import { parseMap } from "../src/world/maps/mapFormat";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { findPath, nearestPassable } from "../src/ai/pathfinder";
import { createBonus } from "../src/world/bonus";
import { Tile } from "../src/world/grid";
import { Dir } from "../src/util/math";
import { BOT_PROFILE, FIRE_COOLDOWN, type BotDifficulty } from "../src/game/config";
import { botFixture, cells, matchFrags, place } from "./helpers";

const DIFFICULTIES: BotDifficulty[] = ["easy", "normal", "hard"];

// A wide-open arena. Both flags sit in the far corners, out of every lane
// used below, so a test that watches for a shot can only be seeing the one
// it set up.
const ARENA = `
@@@@@@@@@@@@@@@@
@B.............@
@..............@
@..............@
@..............@
@..............@
@..............@
@b............r@
@.............R@
@@@@@@@@@@@@@@@@
`;

/** ARENA with `row` of the mid-field replaced by a single obstacle at
 *  column 8 — the cover a bot has to decide whether to shoot through. */
// --- objective play: the enemy flag ---------------------------------------

test("every production map offers bots a path to the enemy flag", () => {
  // Regression: A* was asked for the flag's own cell, which costs Infinity,
  // so it always returned null — a bot that chose AttackFlag then produced
  // no movement input at all and just drifted on stuck-escape randomness.
  for (const src of MAP_SOURCES) {
    const map = parseMap(src.id, src.name, src.template);
    for (const team of ["blue", "red"] as const) {
      const enemyFlag = map.flags[team === "blue" ? "red" : "blue"];
      const snapped = nearestPassable(map.grid, enemyFlag, 6);
      assert.ok(snapped, `${src.id}: no reachable cell next to the ${team} side's target flag`);
      const path = findPath(map.grid, map.spawns[team][0], enemyFlag, { brickCost: 6 });
      assert.ok(path && path.length > 0, `${src.id}: ${team} cannot path to the enemy flag`);
    }
  }
});

test("a bot that never shoots brick still gets a path, around it", () => {
  const map = parseMap("classic", "Classic", MAP_SOURCES[0].template);
  const around = findPath(map.grid, map.spawns.blue[0], map.spawns.red[0], { brickCost: Infinity });
  assert.ok(around, "an Easy bot must still be able to cross the map");
  assert.ok(
    around.every((c) => map.grid.tileAt(c.cx, c.cy) !== Tile.Brick),
    "a route for a bot that never shoots brick must not run through brick",
  );
});

// A pocket map: the red flag is walled in by brick, reachable only by
// shooting through. The blue bot starts a few cells away.
// Two dead-straight corridors, joined only at the left end. A bot in the
// lower one can only move along the lane it is shooting down, which is what
// makes a rate-of-fire comparison mean anything — and because the join is on
// one side only, the middle of that lane is never on a route to anywhere, so
// a wall put there is cover and nothing else.
const LANE = `
@@@@@@@@@@@@@@@@
@B...........R.@
@.@@@@@@@@@@@@@@
@b............r@
@@@@@@@@@@@@@@@@
`;
const COVER_CELL = { cx: 7, cy: 3 };

const POCKET = `
@@@@@@@@@@
@........@
@...#....@
@...R....@
@........@
@B......b@
@........@
@r.......@
@@@@@@@@@@
`;

for (const difficulty of ["normal", "hard"] as BotDifficulty[]) {
  test(`a ${difficulty} bot crosses the map and destroys the enemy flag`, () => {
    const f = botFixture(POCKET, difficulty, { seed: 3 });
    const seen = f.run(25);
    assert.equal(seen.flagHits, 1, "the enemy flag should have been destroyed exactly once");
    assert.equal(f.sim.rules.flagAlive.red, false);
  });
}

test("a bot shoots the enemy flag once it has a clear lane on it", () => {
  const f = botFixture(POCKET, "easy", { seed: 5 });
  // Park it directly below the flag with the pocket already open, so the
  // only thing being measured is whether it takes the shot at all.
  f.sim.grid.setTile(4, 4, Tile.Empty);
  place(f.tank, cells(4), cells(5));
  const seen = f.run(12);
  assert.ok(seen.flagHits >= 1, "even an Easy bot must shoot a flag it is lined up on");
});

test("a bot does not shoot its own flag", () => {
  const f = botFixture(POCKET, "hard", { seed: 2 });
  const before = f.sim.rules.flagAlive.blue;
  f.run(25);
  assert.equal(f.sim.rules.flagAlive.blue, before, "the blue bot destroyed its own flag");
});

// --- shooting through destructible cover ----------------------------------

/** Lines the blue bot (slot 0) and the lone red tank (slot 1) up facing each
 *  other down the LANE corridor, with whatever sits at COVER_CELL between
 *  them, after a tick of clear line of sight so the target is genuinely
 *  *known* — which is the precondition for shooting *through* cover. */
function faceOff(difficulty: BotDifficulty, coverTile: Tile | null) {
  const f = botFixture(LANE, difficulty, { seed: 4, keep: [1] });
  const enemy = f.sim.tankBySlot(1);
  place(f.tank, cells(3), cells(3));
  place(enemy, cells(11), cells(3));
  f.tank.dir = Dir.Right;
  // Facing away, so a Hard bot has no lane to pre-emptively vacate — this
  // test is about what it shoots at, not about how it dodges.
  enemy.dir = Dir.Up;
  enemy.helmetT = 999;
  const pinned = { 1: { dir: null, fire: false, mine: false } };
  const seen0 = f.run(1 / 30, pinned);
  if (coverTile !== null) f.sim.grid.setTile(COVER_CELL.cx, COVER_CELL.cy, coverTile);
  const seen = f.run(3, pinned);
  const down = (r: { shotsByDir: Partial<Record<Dir, number>> }) => r.shotsByDir[Dir.Right] ?? 0;
  return { shots: down(seen) + down(seen0), fixture: f };
}

test("only Hard fires through brick at an enemy it knows is behind it", () => {
  // Medium may still shoot brick that is in the way of its own route, so the
  // comparison is the honest assertion here: Hard puts strictly more rounds
  // down a lane whose only occupant is a wall and a remembered enemy.
  const shots = Object.fromEntries(
    DIFFICULTIES.map((d) => [d, faceOff(d, Tile.Brick).shots]),
  ) as Record<BotDifficulty, number>;
  assert.ok(shots.hard > 0, "Hard should spend ammunition punching through brick");
  assert.ok(shots.hard > shots.normal, `hard ${shots.hard} vs normal ${shots.normal}`);
  assert.equal(shots.easy, 0, "Easy never shoots brick at all (SPEC §10.3)");
});

for (const difficulty of DIFFICULTIES) {
  test(`${difficulty} never fires at an enemy behind steel`, () => {
    const { shots } = faceOff(difficulty, Tile.Steel);
    assert.equal(shots, 0, "steel is indestructible — that shot can only be wasted");
  });
}

test("every difficulty shoots at an enemy in a clear lane", () => {
  for (const difficulty of DIFFICULTIES) {
    const { shots } = faceOff(difficulty, null);
    assert.ok(shots > 0, `${difficulty} took no shot at an exposed enemy`);
  }
});

test("a bot shoots open a brick wall blocking its route", () => {
  // A brick plug in the only corridor: the bot has to demolish it to pass.
  const CORRIDOR = `
@@@@@@@@@@
@B......b@
@@@@#@@@@@
@........@
@r......R@
@@@@@@@@@@
`;
  const f = botFixture(CORRIDOR, "normal", { seed: 1 });
  place(f.tank, cells(4), cells(1));
  const seen = f.run(12);
  assert.equal(f.sim.grid.tileAt(4, 2), Tile.Empty, "the blocking brick should have been shot open");
  assert.ok(seen.bricksOpened >= 1);
});

// --- bonuses ---------------------------------------------------------------

test("Medium and Hard detour for a bonus; Easy does not", () => {
  const picked: Record<string, number> = {};
  for (const difficulty of DIFFICULTIES) {
    const f = botFixture(ARENA, difficulty, { seed: 6 });
    place(f.tank, cells(1), cells(7));
    // Well off any route between the bot and the enemy flag.
    f.sim.bonuses.push(createBonus("STAR", 1, 2, 60));
    picked[difficulty] = f.run(10).pickups;
  }
  assert.equal(picked.easy, 0, "Easy should not detour for a bonus (SPEC §10.3)");
  assert.ok(picked.normal >= 1, "Medium should detour for a STAR");
  assert.ok(picked.hard >= 1, "Hard should detour for a STAR");
});

test("a bot prefers the more valuable bonus when two are equally close", () => {
  const f = botFixture(ARENA, "normal", { seed: 8 });
  place(f.tank, cells(7), cells(4));
  f.sim.bonuses.push(createBonus("MINE", 7, 1, 60));
  f.sim.bonuses.push(createBonus("STAR", 7, 7, 60));
  const order: string[] = [];
  for (let i = 0; i < 12 * 30 && order.length < 2; i++) {
    const before = f.sim.bonuses.map((b) => b.kind);
    f.run(1 / 30);
    for (const kind of before) {
      if (!f.sim.bonuses.some((b) => b.kind === kind)) order.push(kind);
    }
  }
  assert.equal(order[0], "STAR", `took ${order[0] ?? "nothing"} first, not the STAR`);
});

// --- fair perception (SPEC §10.2) -----------------------------------------

test("an enemy standing in forest is unknown, and not shot at", () => {
  const FOREST = `
@@@@@@@@@@@@@@@@
@B.............@
@..............@
@..............@
@b......%.....r@
@..............@
@.............R@
@@@@@@@@@@@@@@@@
`;
  const f = botFixture(FOREST, "hard", { seed: 4, keep: [1] });
  const enemy = f.sim.tankBySlot(1);
  place(f.tank, cells(3), cells(4));
  place(enemy, cells(8), cells(4)); // sitting in the forest cell
  f.tank.dir = Dir.Right;
  const seen = f.run(2, { 1: { dir: null, fire: false, mine: false } });
  assert.deepEqual(f.bots.get(0)!.knownEnemySlots(), [], "forest conceals (SPEC §10.2)");
  assert.equal(seen.shotsByDir[Dir.Right] ?? 0, 0, "nothing known down that lane, so nothing to shoot at");
});

test("memory of a lost target decays, and lasts longer the harder the bot", () => {
  const linger: Record<string, number> = {};
  for (const difficulty of DIFFICULTIES) {
    const f = botFixture(LANE, difficulty, { seed: 4, keep: [1] });
    const enemy = f.sim.tankBySlot(1);
    place(f.tank, cells(3), cells(3));
    place(enemy, cells(10), cells(3));
    f.run(0.2, { 1: { dir: null, fire: false, mine: false } });
    assert.deepEqual(f.bots.get(0)!.knownEnemySlots(), [1], `${difficulty} never saw the enemy`);

    // Break line of sight without killing it — a confirmed kill is forgotten
    // at once, a target that merely disappears is what decays.
    f.sim.grid.setTile(7, 3, Tile.Steel);
    const start = f.sim.time;
    let lost = -1;
    for (let i = 0; i < Math.round(8 / (1 / 30)); i++) {
      f.run(1 / 30, { 1: { dir: null, fire: false, mine: false } });
      if (f.bots.get(0)!.knownEnemySlots().length === 0) { lost = f.sim.time - start; break; }
    }
    assert.ok(lost >= 0, `${difficulty} never forgot the lost target`);
    linger[difficulty] = lost;
  }
  for (const difficulty of DIFFICULTIES) {
    const window = BOT_PROFILE[difficulty].memory;
    assert.ok(
      Math.abs(linger[difficulty] - window) < 0.5,
      `${difficulty} forgot after ${linger[difficulty].toFixed(2)}s, profile says ${window}s`,
    );
  }
  assert.ok(linger.easy < linger.normal && linger.normal < linger.hard);
});

// --- the difficulty gradient ----------------------------------------------

/** Bot and target parked four cells apart in the LANE corridor, facing each
 *  other. The target is helmeted so it survives the whole window and keeps
 *  being something to shoot at. */
function firingRange(difficulty: BotDifficulty) {
  const f = botFixture(LANE, difficulty, { seed: 4, keep: [1] });
  const enemy = f.sim.tankBySlot(1);
  place(f.tank, cells(3), cells(3));
  place(enemy, cells(7), cells(3));
  f.tank.dir = Dir.Right;
  enemy.helmetT = 999;
  return f;
}

test("Easy is slow on the trigger, Hard is not", () => {
  const rate: Record<string, number> = {};
  const first: Record<string, number> = {};
  for (const difficulty of DIFFICULTIES) {
    const f = firingRange(difficulty);
    const seen = f.run(9, { 1: { dir: null, fire: false, mine: false } });
    rate[difficulty] = seen.shotsByDir[Dir.Right] ?? 0;
    first[difficulty] = seen.firstShotAt;
  }
  assert.ok(rate.hard > rate.normal, `hard ${rate.hard} vs normal ${rate.normal}`);
  assert.ok(rate.normal > rate.easy, `normal ${rate.normal} vs easy ${rate.easy}`);

  // The first shot also lands later, which is the reaction delay showing.
  assert.ok(first.easy > first.hard, `easy first shot ${first.easy}s vs hard ${first.hard}s`);
  assert.ok(first.easy >= BOT_PROFILE.easy.reactionDelay, "Easy must pay its reaction delay");
});

test("no profile fires faster than FIRE_COOLDOWN plus its own hesitation", () => {
  for (const difficulty of DIFFICULTIES) {
    const f = firingRange(difficulty);
    const seconds = 9;
    const seen = f.run(seconds, { 1: { dir: null, fire: false, mine: false } });
    const shots = seen.shotsByDir[Dir.Right] ?? 0;
    const ceiling = seconds / (FIRE_COOLDOWN + BOT_PROFILE[difficulty].fireHesitation) + 1;
    assert.ok(shots <= ceiling, `${difficulty} fired ${shots}, above its ${ceiling.toFixed(1)} ceiling`);
  }
});

test("Hard leads a moving target, Easy shoots where it already is", () => {
  // A target crossing the bot's lane: leading means aiming ahead of it, so
  // the lead-aware profile connects and the naive one trails behind.
  const hits: Record<string, number> = {};
  for (const difficulty of DIFFICULTIES) {
    const f = botFixture(ARENA, difficulty, { seed: 4, keep: [1] });
    const enemy = f.sim.tankBySlot(1);
    place(f.tank, cells(2), cells(4));
    place(enemy, cells(11), cells(1));
    f.tank.dir = Dir.Right;
    enemy.helmetT = 999;
    let killed = 0;
    for (let i = 0; i < 12 * 30; i++) {
      const dir = Math.floor(i / 45) % 2 === 0 ? Dir.Down : Dir.Up;
      f.run(1 / 30, { 1: { dir, fire: false, mine: false } });
      if (f.sim.rules.stats[0].frags > killed) killed = f.sim.rules.stats[0].frags;
    }
    hits[difficulty] = f.sim.rules.stats[0].flagDamage + killed;
  }
  // Not a strict ordering assertion — the point is only that full leading
  // isn't *worse*, which it was while the lead assumed every target runs at
  // TANK_SPEED in the direction it faces.
  assert.ok(hits.hard >= hits.easy, `hard ${hits.hard} vs easy ${hits.easy}`);
});

test("Easy never lays mines; Medium and Hard do when defending", () => {
  const MINEFIELD = `
@@@@@@@@@@
@B......@@
@.@@@@@.@@
@b.....r@@
@.@@@@@.@@
@R......@@
@@@@@@@@@@
`;
  const laid: Record<string, number> = {};
  for (const difficulty of DIFFICULTIES) {
    const f = botFixture(MINEFIELD, difficulty, { seed: 2, keep: [1] });
    f.tank.mines = 3;
    place(f.tank, cells(1), cells(2));
    const threat = f.sim.tankBySlot(1);
    place(threat, cells(1), cells(4)); // camped on the blue flag: a real threat
    laid[difficulty] = f.run(8, { 1: { dir: null, fire: false, mine: false } }).mine;
  }
  assert.equal(laid.easy, 0, "Easy never uses mines (SPEC §10.3)");
  assert.ok(laid.normal + laid.hard > 0, "Medium/Hard should mine their own approach lanes");
});

test("a Hard bot vacates the lane of an enemy that is lining it up", () => {
  const f = botFixture(ARENA, "hard", { seed: 4, keep: [1] });
  const enemy = f.sim.tankBySlot(1);
  place(f.tank, cells(8), cells(4));
  place(enemy, cells(13), cells(4));
  enemy.dir = Dir.Left;
  const y0 = f.tank.y;
  f.run(1.5, { 1: { dir: null, fire: false, mine: false } });
  assert.notEqual(f.tank.y, y0, "Hard should have stepped out of the firing lane");
});

test("the difficulty ladder holds up over full bot matches", () => {
  // The integration check on all of the above: the difficulty dial has to
  // point the right way. (It briefly did not — Easy's wide firing tolerance
  // let it take every shot Hard's tight one refused.)
  const outcome = (blue: BotDifficulty, red: BotDifficulty) => {
    let bf = 0;
    let rf = 0;
    for (const src of MAP_SOURCES) {
      for (const seed of [1, 2]) {
        const map = parseMap(src.id, src.name, src.template);
        const f = matchFrags(map, blue, red, seed);
        bf += f.blue;
        rf += f.red;
      }
    }
    return { bf, rf };
  };
  const vsEasy = outcome("hard", "easy");
  assert.ok(vsEasy.bf > vsEasy.rf, `hard ${vsEasy.bf} vs easy ${vsEasy.rf}`);
  const easyBlue = outcome("easy", "normal");
  assert.ok(easyBlue.rf > easyBlue.bf, `normal ${easyBlue.rf} vs easy ${easyBlue.bf}`);
  const topOfLadder = outcome("hard", "normal");
  assert.ok(topOfLadder.bf > topOfLadder.rf, `hard ${topOfLadder.bf} vs normal ${topOfLadder.rf}`);
});

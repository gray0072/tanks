// Where a tank comes back (SPEC §2.3): at the spawn its slot started the
// round on, not at the team's first spawn point.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { parseMap } from "../src/world/maps/mapFormat";
import { CELL, RESPAWN_DELAY } from "../src/game/constants";
import { DT, makeSimFromMap } from "./helpers";

function classicSim() {
  const src = MAP_SOURCES[0];
  return makeSimFromMap(parseMap(src.id, src.name, src.template));
}

function killAndWait(sim: ReturnType<typeof classicSim>, slots: number[]) {
  for (const slot of slots) {
    const t = sim.tankBySlot(slot);
    t.alive = false;
    t.respawnT = RESPAWN_DELAY;
  }
  for (let i = 0; i < Math.ceil((RESPAWN_DELAY + 0.2) / DT); i++) sim.step({}, DT);
}

test("every tank respawns on its own spawn point", () => {
  const sim = classicSim();
  const start = sim.tanks.map((t) => ({ x: t.x, y: t.y }));
  // Move everyone off their spawns first, so a respawn is visible as a jump.
  for (const t of sim.tanks) t.y += t.team === "blue" ? -CELL : CELL;
  // One at a time: dying together, the old first-free-spawn rule handed
  // spawns out in slot order and looked right by accident.
  for (const t of sim.tanks) killAndWait(sim, [t.slot]);
  for (const t of sim.tanks) {
    assert.ok(t.alive, `slot ${t.slot} should be back`);
    assert.deepEqual({ x: t.x, y: t.y }, start[t.slot], `slot ${t.slot} came back somewhere else`);
  }
});

test("a respawn whose own spawn is blocked takes another free one, not the same one as everyone", () => {
  const sim = classicSim();
  const blue = sim.tanks.filter((t) => t.team === "blue");
  const [victim, blocker] = blue;
  const home = { x: victim.x, y: victim.y };
  // Park a teammate on the victim's spawn.
  victim.y -= 2 * CELL;
  blocker.x = home.x;
  blocker.y = home.y;
  killAndWait(sim, [victim.slot]);
  assert.ok(victim.alive);
  assert.notDeepEqual({ x: victim.x, y: victim.y }, home, "respawned on top of the blocker");
  const spawns = sim.map.spawns.blue.map((p) => ({ x: p.cx * CELL, y: p.cy * CELL }));
  assert.ok(spawns.some((p) => p.x === victim.x && p.y === victim.y), "should still be on one of the team's spawns");
});

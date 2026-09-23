// A full 5v5 bot match driven headless on every production map, as a guard
// on the movement layer: the corner assist is what lets a tank turn into a
// 1-cell corridor, and tightening when it fires (sim.ts cornerAssist) is
// exactly the kind of change that could quietly leave bots grinding against
// wall corners for a whole match.

import test from "node:test";
import assert from "node:assert/strict";

import { parseMap } from "../src/world/maps/mapFormat";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { Sim, type SeatInput } from "../src/world/sim";
import { createDefaultSlots } from "../src/world/tank";
import { BotController } from "../src/ai/bot";
import { computeTeamRoles, type Role } from "../src/ai/teamPlan";
import { CELL, TICK_DT, TEAMS, type TeamId } from "../src/game/config";
import { dist } from "../src/util/math";

const SECONDS = 20;

for (const { id, name, template } of MAP_SOURCES) {
  test(`bots keep moving for ${SECONDS}s on '${id}'`, () => {
    const map = parseMap(id, name, template);
    const slots = createDefaultSlots("host", map.spawns.blue.length, map.spawns.red.length);
    // The default host slot is human; make the whole lobby bots so every
    // tank is actually being driven.
    for (const s of slots) {
      s.kind = "bot";
      s.owner = null;
    }
    const sim = new Sim(map, { mapId: id, winsTarget: 1, timeLimit: 600, respawnMult: 999, friendlyFire: false }, slots, 12345);
    const bots = new Map(slots.map((s) => [s.id, new BotController(s.id)]));

    // Distance covered per slot, summed across lives (a respawn teleport is
    // not travel, so reset the reference point when a tank dies).
    const travelled = new Map<number, number>(slots.map((s) => [s.id, 0]));
    let last = new Map(sim.tanks.map((t) => [t.slot, { x: t.x, y: t.y, alive: t.alive }]));

    for (let i = 0; i < SECONDS / TICK_DT; i++) {
      const roles: Record<TeamId, Map<number, Role>> = {
        blue: computeTeamRoles(sim, "blue"),
        red: computeTeamRoles(sim, "red"),
      };
      const inputs: Record<number, SeatInput> = {};
      for (const s of slots) {
        inputs[s.id] = bots.get(s.id)!.decide(sim, roles[s.team], s.botDifficulty);
      }
      sim.step(inputs, TICK_DT);

      for (const t of sim.tanks) {
        const p = last.get(t.slot)!;
        if (t.alive && p.alive) travelled.set(t.slot, travelled.get(t.slot)! + dist(p.x, p.y, t.x, t.y));
        last.set(t.slot, { x: t.x, y: t.y, alive: t.alive });
      }
    }

    for (const s of slots) {
      const d = travelled.get(s.id)!;
      // A bot wedged in a corner for the whole match covers almost nothing;
      // a few cells' worth of travel is a low bar that a stuck one fails.
      assert.ok(d > 5 * CELL, `slot ${s.id} only travelled ${d.toFixed(1)}px on '${id}'`);
    }

    // Sanity: the match itself is still running the way a match should.
    assert.ok(TEAMS.every((team) => sim.tanks.some((t) => t.team === team)));
  });
}

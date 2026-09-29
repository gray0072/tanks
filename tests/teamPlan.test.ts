// The team plan (SPEC §10.1 "Team coordination"): what each bot is for this
// round, and which flank it takes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../src/world/sim";
import { createDefaultSlots } from "../src/world/tank";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { parseMap } from "../src/world/maps/mapFormat";
import { computeTeamRoles, roleCounts, teamPosture } from "../src/ai/teamPlan";
import { CELL, DEFAULT_BONUS_RATE, MAX_PLAYERS_PER_TEAM, type BotPosture } from "../src/game/constants";

const POSTURES: BotPosture[] = ["aggressive", "balanced", "defensive"];

function botSim(seed: number): Sim {
  const src = MAP_SOURCES[0];
  const map = parseMap(src.id, src.name, src.template);
  const slots = createDefaultSlots("host", map.spawns.blue.length, map.spawns.red.length);
  for (const s of slots) { s.kind = "bot"; s.owner = null; }
  return new Sim(
    map,
    { mapId: map.id, winsTarget: 1, timeLimit: 600, respawnMult: 5, friendlyFire: false, bonusesPerMinute: DEFAULT_BONUS_RATE },
    slots,
    seed,
  );
}

test("role counts add up for every team size and posture", () => {
  for (const posture of POSTURES) {
    for (let n = 1; n <= MAX_PLAYERS_PER_TEAM; n++) {
      const c = roleCounts(n, posture);
      assert.equal(c.defend + c.midfield + c.attack, n, `${posture} ${n}`);
      assert.ok(c.attack >= 1, `${posture} ${n}: somebody has to attack`);
      if (n >= 3) assert.ok(c.defend >= 1, `${posture} ${n}: somebody has to stay home`);
    }
  }
  assert.deepEqual(roleCounts(1, "defensive"), { defend: 0, midfield: 0, attack: 1 });
  assert.ok(roleCounts(10, "defensive").defend > roleCounts(10, "aggressive").defend);
});

test("the plan holds for the whole round rather than flipping every tick", () => {
  const sim = botSim(1);
  const first = computeTeamRoles(sim, "blue");
  for (let i = 0; i < 60; i++) sim.step({}, 1 / 30);
  assert.deepEqual(computeTeamRoles(sim, "blue"), first);
});

test("a team does not all go down the same flank", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const roles = computeTeamRoles(botSim(seed), "blue");
    const lanes = new Set([...roles.values()].filter((a) => a.role !== "defend").map((a) => a.lane));
    assert.ok(lanes.size >= 2, `seed ${seed}: every mobile bot on lane ${[...lanes]}`);
  }
});

test("rounds differ: posture and lanes are not the same every round", () => {
  const postures = new Set<string>();
  const layouts = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const sim = botSim(seed);
    const roles = computeTeamRoles(sim, "blue");
    postures.add(teamPosture(sim, "blue")!);
    layouts.add(JSON.stringify([...roles].sort((a, b) => a[0] - b[0])));
  }
  assert.ok(postures.size >= 2, `only ever drew ${[...postures]}`);
  assert.ok(layouts.size >= 4, `only ${layouts.size} distinct plans in 12 rounds`);
});

test("enemies at the flag pull the midfield back to defend", () => {
  // Find a round whose blue plan has a midfielder.
  let sim: Sim | null = null;
  for (let seed = 1; seed <= 20 && !sim; seed++) {
    const s = botSim(seed);
    if ([...computeTeamRoles(s, "blue").values()].some((a) => a.role === "midfield")) sim = s;
  }
  assert.ok(sim, "no round drew a midfielder");
  const flag = sim.map.flags.blue;
  for (const t of sim.tanks.filter((t) => t.team === "red").slice(0, 3)) {
    t.x = flag.cx * CELL;
    t.y = (flag.cy - 2) * CELL;
  }
  const roles = computeTeamRoles(sim, "blue");
  assert.ok(![...roles.values()].some((a) => a.role === "midfield"), "midfielders should have dropped back");
});

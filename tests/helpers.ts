// Shared scaffolding for the headless world tests. Everything under
// `src/world/` is free of Vite-specific imports, so a Sim can be built and
// stepped under plain Node — see AGENTS.md "Testing".

import { parseMap } from "../src/world/maps/mapFormat";
import type { MapDef } from "../src/world/maps/mapFormat";
import { Sim, type SeatInput } from "../src/world/sim";
import type { MatchSettings } from "../src/world/rules";
import { createDefaultSlots, type TankState } from "../src/world/tank";
import { BotController } from "../src/ai/bot";
import { computeTeamRoles, type Role } from "../src/ai/teamPlan";
import { Dir } from "../src/util/math";
import { CELL, TICK_DT, type BotDifficulty, type TeamId } from "../src/game/config";

export const DT = TICK_DT;

export function makeMap(template: string, id = "test"): MapDef {
  return parseMap(id, "Test", template);
}

export function makeSim(template: string, seed = 1): Sim {
  return makeSimFromMap(makeMap(template), seed);
}

/** Same as makeSim, but on a MapDef the caller holds — the only way to build
 *  two matches from one map, as a rematch does. */
export function makeSimFromMap(map: MapDef, seed = 1): Sim {
  const blueSize = map.spawns.blue.length;
  const redSize = map.spawns.red.length;
  const settings: MatchSettings = {
    mapId: map.id,
    timeLimit: 600,
    respawnMult: 5,
    friendlyFire: false,
  };
  const sim = new Sim(map, settings, createDefaultSlots("host", blueSize, redSize), seed);
  // Spawn invulnerability is irrelevant to movement and only adds noise to
  // any test that also looks at damage.
  for (const t of sim.tanks) t.invulnT = 0;
  return sim;
}

/** Teleport a tank to an exact pixel position — movement tests care about
 *  sub-cell offsets, which spawning alone can never produce. */
export function place(tank: TankState, x: number, y: number) {
  tank.x = x;
  tank.y = y;
}

/** Take every tank but `slot` off the board for good, so a single-tank
 *  movement test can't collide with a spawn-mate. `respawnT = Infinity`
 *  matters: stepRespawns() revives anything dead whose timer has run out,
 *  so a plain `alive = false` would put them right back next tick. */
export function isolate(sim: Sim, slot: number) {
  for (const t of sim.tanks) {
    if (t.slot === slot) continue;
    t.alive = false;
    t.respawnT = Infinity;
  }
}

export function hold(sim: Sim, slot: number, dir: Dir | null, ticks: number, dt = DT) {
  const input: SeatInput = { dir, fire: false, mine: false };
  for (let i = 0; i < ticks; i++) sim.step({ [slot]: input }, dt);
}

export function step(sim: Sim, slot: number, dir: Dir | null, dt = DT) {
  hold(sim, slot, dir, 1, dt);
}

export const cells = (n: number) => n * CELL;

export const CARDINALS: Dir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];

/** Which axis a cardinal direction leaves untouched — the one the tank's
 *  center must not drift along. */
export function crossAxis(dir: Dir): "x" | "y" {
  return dir === Dir.Left || dir === Dir.Right ? "y" : "x";
}

export function dirName(dir: Dir): string {
  return Dir[dir];
}

// --- bots -----------------------------------------------------------------

/** A single bot driving slot 0, with every other tank taken off the board
 *  unless `keep` names it. Returns the pieces a bot test needs plus a `run`
 *  that ticks the sim and reports what happened. */
export function botFixture(
  template: string,
  difficulty: BotDifficulty,
  opts: { seed?: number; keep?: number[]; roles?: Map<number, Role> } = {},
) {
  const sim = makeSim(template, opts.seed ?? 1);
  const keep = new Set([0, ...(opts.keep ?? [])]);
  for (const t of sim.tanks) {
    t.invulnT = 0;
    if (!keep.has(t.slot)) { t.alive = false; t.respawnT = Infinity; }
  }
  const bots = new Map([...keep].map((slot) => [slot, new BotController(slot)]));
  const roles = opts.roles ?? new Map<number, Role>();

  /** Ticks the sim for `seconds`, driving every kept slot with its bot.
   *  `hold` pins extra inputs (e.g. a stationary target) on top. */
  function run(seconds: number, hold: Record<number, SeatInput> = {}) {
    const seen = {
      fire: 0, mine: 0, shots: 0, flagHits: 0, pickups: 0, bricksOpened: 0, firstShotAt: -1,
      /** Shots by the direction they were fired in — lets a test count only
       *  the shot it set up, not whatever else the bot found to shoot at. */
      shotsByDir: {} as Partial<Record<Dir, number>>,
    };
    const bulletIds = new Set<number>();
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const inputs: Record<number, SeatInput> = {};
      for (const [slot, bot] of bots) {
        const inp = bot.decide(sim, roles, difficulty);
        inputs[slot] = inp;
        if (slot === 0) {
          if (inp.fire) seen.fire++;
          if (inp.mine) seen.mine++;
        }
      }
      // `hold` wins over a bot's own decision — that's the point of pinning a
      // slot as a stationary target. (Spreading it first instead silently let
      // the target drive off, which quietly invalidated every test that
      // depended on it staying put.)
      Object.assign(inputs, hold);
      for (const e of sim.step(inputs, DT)) {
        if (e.type === "flagHit") seen.flagHits++;
        if (e.type === "pickup" && e.slot === 0) seen.pickups++;
        if (e.type === "terrain") seen.bricksOpened++;
      }
      for (const b of sim.bullets) {
        if (b.ownerSlot !== 0 || bulletIds.has(b.id)) continue;
        bulletIds.add(b.id);
        seen.shotsByDir[b.dir] = (seen.shotsByDir[b.dir] ?? 0) + 1;
        if (seen.firstShotAt < 0) seen.firstShotAt = sim.time;
      }
    }
    seen.shots = bulletIds.size;
    return seen;
  }

  return { sim, bots, tank: sim.tankBySlot(0), run };
}

/** A real two-sided 5v5 bot match, returning each team's frags. This is the
 *  only honest way to check that the difficulty dial points the right way:
 *  every individual behaviour can look correct while the profiles still rank
 *  backwards in a fight. */
export function matchFrags(map: MapDef, blue: BotDifficulty, red: BotDifficulty, seed: number, seconds = 75) {
  const slots = createDefaultSlots("host", map.spawns.blue.length, map.spawns.red.length);
  for (const s of slots) {
    s.kind = "bot";
    s.owner = null;
    s.botDifficulty = s.team === "blue" ? blue : red;
  }
  const settings: MatchSettings = { mapId: map.id, timeLimit: 3600, respawnMult: 999, friendlyFire: false };
  const sim = new Sim(map, settings, slots, seed);
  const bots = new Map(slots.map((s) => [s.id, new BotController(s.id)]));
  const frags: Record<TeamId, number> = { blue: 0, red: 0 };

  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const roles: Record<TeamId, Map<number, Role>> = {
      blue: computeTeamRoles(sim, "blue"),
      red: computeTeamRoles(sim, "red"),
    };
    const inputs: Record<number, SeatInput> = {};
    for (const s of slots) inputs[s.id] = bots.get(s.id)!.decide(sim, roles[s.team], s.botDifficulty);
    for (const e of sim.step(inputs, DT)) {
      if (e.type !== "kill" || e.killerSlot === null) continue;
      const killer = sim.tankBySlot(e.killerSlot);
      const victim = sim.tankBySlot(e.victimSlot);
      if (killer.team !== victim.team) frags[killer.team]++;
    }
    // A destroyed flag ends the match; for a frag comparison we want the
    // whole window, so the flag is patched back up and the fight continues.
    if (sim.rules.ended) {
      sim.rules.ended = false;
      sim.rules.winner = null;
      sim.rules.flagAlive.blue = true;
      sim.rules.flagAlive.red = true;
    }
  }
  return frags;
}

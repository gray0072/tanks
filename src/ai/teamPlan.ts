// A thin coordination layer, not a full commander (SPEC §10.1 "Team
// coordination"): just enough to stop a whole team's bots from piling into
// the same lane. Recomputed every tick; cheap enough at a full roster.

import type { Sim } from "../world/sim";
import { CELL } from "../game/config";
import type { TeamId } from "../game/config";
import { tankCenter } from "../world/tank";

export type Role = "attack" | "defend";

const THREAT_RADIUS_CELLS = 14;
const THREAT_COUNT_FOR_FULL_DEFENSE = 2;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Returns the desired role for every living slot on `team`. Roughly 2
 *  defenders / 3 attackers, shifting toward defense the more enemies are
 *  loitering near the team's own flag. */
export function computeTeamRoles(sim: Sim, team: TeamId): Map<number, Role> {
  const flag = sim.map.flags[team];
  // Cell center, not cell corner + 1 — a flag is one cell (SPEC §3.5), so
  // `+ 1` was aiming a whole cell past it.
  const flagPx = { x: (flag.cx + 0.5) * CELL, y: (flag.cy + 0.5) * CELL };

  let threats = 0;
  for (const t of sim.tanks) {
    if (!t.alive || t.team === team) continue;
    const c = tankCenter(t);
    if (dist(c.x, c.y, flagPx.x, flagPx.y) <= THREAT_RADIUS_CELLS * CELL) threats++;
  }
  const defendersWanted = threats >= THREAT_COUNT_FOR_FULL_DEFENSE ? 3 : 2;

  const mySlots = sim.tanks.filter((t) => t.team === team && t.alive);
  const byDistanceToFlag = [...mySlots].sort((a, b) => {
    const ca = tankCenter(a);
    const cb = tankCenter(b);
    return dist(ca.x, ca.y, flagPx.x, flagPx.y) - dist(cb.x, cb.y, flagPx.x, flagPx.y);
  });

  const roles = new Map<number, Role>();
  byDistanceToFlag.forEach((t, i) => roles.set(t.slot, i < defendersWanted ? "defend" : "attack"));
  return roles;
}

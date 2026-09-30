// What a team of bots tells each other (SPEC §10.3 Extreme, "plays as a
// team"). Human teams talk — "one in the left bush", "I'm on the flank, go"
// — and this is the bot version of that call-out channel, nothing more: it
// only ever carries what some teammate actually *saw* (SPEC §10.2 still
// holds per bot), and a report reaches the others after BOT_COMMS_DELAY, the
// time it takes to say it.
//
// Keyed by Sim like the team plan: a new round is a new board.

import type { Sim } from "../world/sim";
import type { TeamId } from "../game/config";

/** One enemy as last reported by anyone on the team. */
export type Sighting = { x: number; y: number; at: number; vx: number; vy: number };

type Board = {
  sightings: Map<number, Sighting>;
  /** Attackers waiting at their staging point, and since when. */
  staged: Map<number, number>;
  /** When the current push was called; attackers who arrive later join it. */
  pushAt: number;
  /** Which enemy each bot is going after, so the team spreads its attention
   *  instead of every bot chasing the same tank. */
  hunting: Map<number, number>;
};

const boards = new WeakMap<Sim, Partial<Record<TeamId, Board>>>();

export function teamBoard(sim: Sim, team: TeamId): Board {
  let byTeam = boards.get(sim);
  if (!byTeam) boards.set(sim, (byTeam = {}));
  return (byTeam[team] ??= { sightings: new Map(), staged: new Map(), pushAt: -Infinity, hunting: new Map() });
}

export function reportSighting(sim: Sim, team: TeamId, enemySlot: number, s: Sighting) {
  const board = teamBoard(sim, team);
  const prev = board.sightings.get(enemySlot);
  if (!prev || prev.at < s.at) board.sightings.set(enemySlot, { ...s });
}

/** How many teammates other than `self` are after `enemySlot`. */
export function huntersOf(sim: Sim, team: TeamId, enemySlot: number, self: number): number {
  let n = 0;
  for (const [slot, target] of teamBoard(sim, team).hunting) if (slot !== self && target === enemySlot) n++;
  return n;
}

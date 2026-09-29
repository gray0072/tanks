// A thin coordination layer, not a full commander (SPEC §10.1 "Team
// coordination"): it decides what each bot on a team is *for* this round —
// defend, hold the middle, or attack — and which flank it takes, so a team
// spreads over the map instead of every bot driving the same shortest route.
//
// The plan is drawn once per round (one Sim is one round) from the sim's own
// seeded RNG, so rounds differ from each other and every guest-visible
// outcome stays deterministic for the host. Only the threat response is
// recomputed every tick.

import type { Sim } from "../world/sim";
import {
  BOT_POSTURE_SHARES,
  BOT_POSTURE_WEIGHTS,
  BOT_LANE_MIN_WIDTH_CELLS,
  BOT_THREAT_COUNT_FOR_FULL_DEFENSE,
  BOT_THREAT_RADIUS_CELLS,
  CELL,
  type BotPosture,
} from "../game/constants";
import type { TeamId } from "../game/config";
import { tankCenter } from "../world/tank";

export type Role = "attack" | "midfield" | "defend";

/** A bot's job for the round. `lane` is its flank across the map, from -1
 *  to 1 (0 = straight down the middle), used by attackers and midfielders
 *  for their route and by defenders for where they stand around the flag. */
export type Assignment = { role: Role; lane: number };

type TeamPlan = { posture: BotPosture; key: string; assignments: Map<number, Assignment> };

// Keyed by Sim: a new round is a new Sim, and with it a fresh plan.
const plans = new WeakMap<Sim, Partial<Record<TeamId, TeamPlan>>>();

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** How many of `n` bots defend, hold the middle and attack under a posture.
 *  Works from a 1-bot team up: a lone bot always attacks (the flag-threat
 *  signal still pulls it home), two bots never both sit at home, and from
 *  three up there is always at least one defender and one attacker. */
export function roleCounts(n: number, posture: BotPosture): Record<Role, number> {
  if (n <= 0) return { defend: 0, midfield: 0, attack: 0 };
  const share = BOT_POSTURE_SHARES[posture];
  const defend = n >= 3 ? Math.max(1, Math.round(n * share.defend)) : n === 2 && posture === "defensive" ? 1 : 0;
  const midfield = Math.max(0, Math.min(n - defend - 1, Math.round(n * share.midfield)));
  return { defend, midfield, attack: n - defend - midfield };
}

/** `k` lane values spread evenly over [-1, 1]; a single one is the middle. */
function spread(k: number): number[] {
  if (k <= 1) return [0];
  return Array.from({ length: k }, (_, i) => -1 + (2 * i) / (k - 1));
}

function pickPosture(sim: Sim): BotPosture {
  const entries = Object.entries(BOT_POSTURE_WEIGHTS) as [BotPosture, number][];
  let r = sim.rng.next() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [posture, w] of entries) {
    r -= w;
    if (r <= 0) return posture;
  }
  return "balanced";
}

function shuffle<T>(sim: Sim, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(sim.rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawPlan(sim: Sim, team: TeamId, botSlots: number[], key: string): TeamPlan {
  const posture = pickPosture(sim);
  const counts = roleCounts(botSlots.length, posture);
  const flag = sim.map.flags[team];
  const fx = (flag.cx + 0.5) * CELL;
  const fy = (flag.cy + 0.5) * CELL;
  // Defenders are the bots that start nearest home, give or take a few
  // cells of noise so the same spawn isn't always the one left behind.
  const order = botSlots
    .map((slot) => {
      const c = tankCenter(sim.tankBySlot(slot));
      return { slot, d: dist(c.x, c.y, fx, fy) + sim.rng.next() * 3 * CELL };
    })
    .sort((a, b) => a.d - b.d)
    .map((e) => e.slot);

  const defenders = order.slice(0, counts.defend);
  const midfielders = order.slice(counts.defend, counts.defend + counts.midfield);
  const attackers = order.slice(counts.defend + counts.midfield);

  // Flanks: as many as the map is wide enough for, up to three. Attackers
  // and midfielders are dealt round them from a random starting lane, so
  // a team of five covers both flanks and the middle rather than stacking
  // on one — and which flank gets the heavier push changes every round.
  const lanes = shuffle(sim, spread(laneCount(sim, team)));
  const assignments = new Map<number, Assignment>();
  const defendLanes = spread(defenders.length);
  defenders.forEach((slot, i) => assignments.set(slot, { role: "defend", lane: defendLanes[i] }));
  [...attackers, ...midfielders].forEach((slot, i) => {
    const role: Role = i < attackers.length ? "attack" : "midfield";
    assignments.set(slot, { role, lane: lanes[i % lanes.length] });
  });
  return { posture, key, assignments };
}

/** Every bot's assignment on `team`, keyed by slot. The round's plan is
 *  kept; on top of it, enough enemies near our flag pull the midfielders
 *  back to defend until the threat passes. */
export function computeTeamRoles(sim: Sim, team: TeamId): Map<number, Assignment> {
  const botSlots = sim.slots.filter((s) => s.team === team && s.kind === "bot").map((s) => s.id);
  const key = botSlots.join(",");
  const byTeam = plans.get(sim) ?? {};
  plans.set(sim, byTeam);
  // Redrawn only if the roster changes mid-round (a kicked human becomes a
  // bot), so an assignment never flips on its own.
  let plan = byTeam[team];
  if (!plan || plan.key !== key) plan = byTeam[team] = drawPlan(sim, team, botSlots, key);

  const flag = sim.map.flags[team];
  const fx = (flag.cx + 0.5) * CELL;
  const fy = (flag.cy + 0.5) * CELL;
  let threats = 0;
  for (const t of sim.tanks) {
    if (!t.alive || t.team === team) continue;
    const c = tankCenter(t);
    if (dist(c.x, c.y, fx, fy) <= BOT_THREAT_RADIUS_CELLS * CELL) threats++;
  }
  if (threats < BOT_THREAT_COUNT_FOR_FULL_DEFENSE) return plan.assignments;

  const roles = new Map<number, Assignment>();
  for (const [slot, a] of plan.assignments) {
    roles.set(slot, a.role === "midfield" ? { role: "defend", lane: a.lane } : a);
  }
  return roles;
}

/** The posture a team drew this round, for tests and a debug overlay. */
export function teamPosture(sim: Sim, team: TeamId): BotPosture | null {
  return plans.get(sim)?.[team]?.posture ?? null;
}

// --- lane geometry -----------------------------------------------------------

/** The map's frame as one team sees it: from its own flag toward the
 *  enemy's (`u`), and across (`p`). Flags on opposite edges is the usual
 *  shape, but nothing here assumes it. */
function frame(sim: Sim, team: TeamId) {
  const own = sim.map.flags[team];
  const enemy = sim.map.flags[team === "blue" ? "red" : "blue"];
  const ax = (own.cx + 0.5) * CELL;
  const ay = (own.cy + 0.5) * CELL;
  const dx = (enemy.cx + 0.5) * CELL - ax;
  const dy = (enemy.cy + 0.5) * CELL - ay;
  const len = Math.hypot(dx, dy) || 1;
  const u = { x: dx / len, y: dy / len };
  const p = { x: -u.y, y: u.x };
  // Half the map's width across the flag-to-flag line.
  const halfWidth = (Math.abs(p.x) * sim.worldW + Math.abs(p.y) * sim.worldH) / 2;
  return { ax, ay, u, p, len, halfWidth };
}

function laneCount(sim: Sim, team: TeamId): number {
  const width = (2 * frame(sim, team).halfWidth) / CELL;
  return Math.max(1, Math.min(3, Math.floor(width / BOT_LANE_MIN_WIDTH_CELLS)));
}

/** A cell on `lane`, `along` of the way (0..1) from our flag to theirs. The
 *  outer lanes sit most of the way to the edge, not on it. Not snapped to
 *  passable ground — the pathfinder does that. */
export function lanePoint(sim: Sim, team: TeamId, lane: number, along: number): { cx: number; cy: number } {
  const f = frame(sim, team);
  // Lanes are measured from the middle of the map, not from our flag: the
  // flags need not be centred, and a flank is a flank of the battlefield.
  const centre = (sim.worldW / 2 - f.ax) * f.p.x + (sim.worldH / 2 - f.ay) * f.p.y;
  const across = centre + lane * f.halfWidth * 0.7;
  const x = f.ax + f.u.x * along * f.len + f.p.x * across;
  const y = f.ay + f.u.y * along * f.len + f.p.y * across;
  return {
    cx: Math.max(0, Math.min(sim.map.width - 1, Math.floor(x / CELL))),
    cy: Math.max(0, Math.min(sim.map.height - 1, Math.floor(y / CELL))),
  };
}

/** How far (0..1) a point is along the line from our flag to theirs. */
export function progressAlong(sim: Sim, team: TeamId, x: number, y: number): number {
  const f = frame(sim, team);
  return ((x - f.ax) * f.u.x + (y - f.ay) * f.u.y) / f.len;
}

/** Where a defender on `lane` waits when nothing is in sight: a few cells in
 *  front of our flag, defenders side by side rather than stacked. */
export function guardPoint(sim: Sim, team: TeamId, lane: number, aheadCells: number, spreadCells: number): { cx: number; cy: number } {
  const f = frame(sim, team);
  const x = f.ax + f.u.x * aheadCells * CELL + f.p.x * lane * spreadCells * CELL;
  const y = f.ay + f.u.y * aheadCells * CELL + f.p.y * lane * spreadCells * CELL;
  return {
    cx: Math.max(0, Math.min(sim.map.width - 1, Math.floor(x / CELL))),
    cy: Math.max(0, Math.min(sim.map.height - 1, Math.floor(y / CELL))),
  };
}

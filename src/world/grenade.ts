// GRENADE — SPEC §4.3. The rules, kept pure so they can be tested without a
// Sim: how big the blast is on a given map, how many tanks one grenade may
// take, and where it is thrown. sim.ts owns the flight and the detonation.

import {
  CELL,
  GRENADE_FLIGHT_MAX,
  GRENADE_FLIGHT_MIN,
  GRENADE_KILL_SHARE,
  GRENADE_RADIUS_MAX_CELLS,
  GRENADE_RADIUS_MIN_CELLS,
  GRENADE_RADIUS_PER_SIZE,
  GRENADE_SPEED_CELLS,
} from "../game/constants";
import type { TeamId } from "../game/config";

export type GrenadeState = {
  id: number;
  team: TeamId; // the thrower's team — it only hurts the other one
  ownerSlot: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Seconds in the air so far, and in total. */
  t: number;
  flight: number;
  radius: number; // px
};

type Point = { x: number; y: number };

/** Blast radius in px for a map of `width`×`height` cells. */
export function grenadeRadius(width: number, height: number): number {
  const cells = GRENADE_RADIUS_PER_SIZE * Math.sqrt(width * height);
  return Math.min(GRENADE_RADIUS_MAX_CELLS, Math.max(GRENADE_RADIUS_MIN_CELLS, cells)) * CELL;
}

/** How many tanks of a team of `teamSize` one grenade may kill: half,
 *  rounded up — one of one, one of two, three of five, ten of twenty. */
export function grenadeKillCap(teamSize: number): number {
  return Math.max(1, Math.ceil(teamSize * GRENADE_KILL_SHARE));
}

export function grenadeFlightTime(from: Point, to: Point): number {
  const cells = Math.hypot(to.x - from.x, to.y - from.y) / CELL;
  return Math.min(GRENADE_FLIGHT_MAX, Math.max(GRENADE_FLIGHT_MIN, cells / GRENADE_SPEED_CELLS));
}

/** Where to throw: the point whose blast would catch the most `targets`
 *  (tank centres). Candidates are each target and the centroid of each
 *  target's neighbours within the radius — a knot of three is hit in its
 *  middle, not on its edge. Ties go to the candidate nearest the thrower, so
 *  with nobody bunched up it simply flies at the closest enemy. Null when
 *  there is nothing to throw at. */
export function pickGrenadeTarget(
  from: Point,
  targets: readonly Point[],
  radius: number,
): { x: number; y: number; count: number } | null {
  if (targets.length === 0) return null;
  const r2 = radius * radius;
  const within = (c: Point) => targets.filter((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= r2);
  const candidates: Point[] = [];
  for (const p of targets) {
    candidates.push(p);
    const near = within(p);
    if (near.length > 1) {
      candidates.push({
        x: near.reduce((s, q) => s + q.x, 0) / near.length,
        y: near.reduce((s, q) => s + q.y, 0) / near.length,
      });
    }
  }
  let best: { x: number; y: number; count: number } | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const count = within(c).length;
    const dist = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
    if (!best || count > best.count || (count === best.count && dist < bestDist)) {
      best = { x: c.x, y: c.y, count };
      bestDist = dist;
    }
  }
  return best;
}

let nextGrenadeId = 1;
export function resetGrenadeIds() {
  nextGrenadeId = 1;
}
export function takeGrenadeId(): number {
  return nextGrenadeId++;
}

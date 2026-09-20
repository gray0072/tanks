// Bonuses — SPEC §4.3. Data + spawn bookkeeping; applying an effect to a
// tank/team happens in sim.ts, which has the full match state.

export type BonusKind =
  | "HELMET"
  | "STAR"
  | "SPEED"
  | "SHOVEL"
  | "CLOCK"
  | "GRENADE"
  | "RESPAWN"
  | "MINE";

export const BONUS_KINDS: readonly BonusKind[] = [
  "HELMET", "STAR", "SPEED", "SHOVEL", "CLOCK", "GRENADE", "RESPAWN", "MINE",
];

/** Personal buffs that replace each other (SPEC §4.3, "at most one timed
 *  personal buff"). STAR/RESPAWN/team-scoped bonuses stack freely. */
export const EXCLUSIVE_PERSONAL_BUFFS: readonly BonusKind[] = ["HELMET", "SPEED"];

export const TEAM_SCOPED_BONUSES: readonly BonusKind[] = ["SHOVEL", "CLOCK", "GRENADE", "RESPAWN"];

export type BonusEntity = {
  id: number;
  kind: BonusKind;
  cx: number;
  cy: number;
  ttl: number; // seconds until despawn if untouched
};

let nextBonusId = 1;
export function resetBonusIds() {
  nextBonusId = 1;
}

export function createBonus(kind: BonusKind, cx: number, cy: number, ttl: number): BonusEntity {
  return { id: nextBonusId++, kind, cx, cy, ttl };
}

/** An active SHOVEL fortification: brick around a team's flag turned to
 *  steel, reverting after its duration. */
export type Fortification = {
  cx: number;
  cy: number;
  restoreTile: import("./grid").Tile;
  ttl: number;
};

/** A dropped mine (SPEC §4.3 MINE bonus): visible only to the owning team. */
export type MineState = {
  id: number;
  team: "blue" | "red";
  ownerSlot: number;
  cx: number;
  cy: number;
};

let nextMineId = 1;
export function resetMineIds() {
  nextMineId = 1;
}

export function createMine(team: "blue" | "red", ownerSlot: number, cx: number, cy: number): MineState {
  return { id: nextMineId++, team, ownerSlot, cx, cy };
}

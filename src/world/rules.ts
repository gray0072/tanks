import type { TeamId } from "../game/config";
import type { Slot } from "./tank";

export type MatchSettings = {
  mapId: string;
  timeLimit: number; // seconds, SPEC §2.2
  respawnMult: number; // starting respawns per team member (§2.2)
  friendlyFire: boolean;
};

export type PlayerStats = {
  frags: number;
  deaths: number;
  flagDamage: number;
  bonusesTaken: number;
  assists: number;
};

export function createStats(): PlayerStats {
  return { frags: 0, deaths: 0, flagDamage: 0, bonusesTaken: 0, assists: 0 };
}

export type MatchRules = {
  timeLeft: number;
  respawns: Record<TeamId, number>;
  flagAlive: Record<TeamId, boolean>;
  stats: Record<number, PlayerStats>;
  /** last slot to damage a given slot, and when — for the 5s assist window (§2.4) */
  lastDamagedBy: Partial<Record<number, { bySlot: number; at: number }>>;
  /** Slots per team, as the loaded map declares them (§3.5) — 5 and 5 for the
   *  built-ins, 1 and 1 for the debug map, and not necessarily equal: a map
   *  may field 4 against 6. */
  teamSizes: Record<TeamId, number>;
  /** Which team each slot id belongs to. The teams are no longer two equal
   *  id ranges, so this is the only correct way to attribute a slot's stats
   *  to a team (see teamFrags). */
  slotTeam: Record<number, TeamId>;
  ended: boolean;
  winner: TeamId | "draw" | null;
};

export function createRules(settings: MatchSettings, slots: Slot[]): MatchRules {
  const stats: Record<number, PlayerStats> = {};
  const slotTeam: Record<number, TeamId> = {};
  const teamSizes: Record<TeamId, number> = { blue: 0, red: 0 };
  for (const s of slots) {
    stats[s.id] = createStats();
    slotTeam[s.id] = s.team;
    teamSizes[s.team]++;
  }
  return {
    timeLeft: settings.timeLimit,
    // Per team, so a 4-vs-6 map still gives both sides the same number of
    // lives each (see RESPAWN_MULTIPLIERS).
    respawns: {
      blue: settings.respawnMult * teamSizes.blue,
      red: settings.respawnMult * teamSizes.red,
    },
    flagAlive: { blue: true, red: true },
    stats,
    lastDamagedBy: {},
    teamSizes,
    slotTeam,
    ended: false,
    winner: null,
  };
}

const ASSIST_WINDOW = 5; // s, SPEC §2.4

export function otherTeam(t: TeamId): TeamId {
  return t === "blue" ? "red" : "blue";
}

/** Records a kill: frag to the killer, death + respawn loss to the victim's
 *  team, and an assist to whoever last damaged the victim (if different and
 *  within the assist window). Pass killerSlot = null for environmental deaths
 *  (water, mine, shovel-crush) which cost a respawn but credit no frag. */
export function recordKill(
  rules: MatchRules,
  victimSlot: number,
  victimTeam: TeamId,
  killerSlot: number | null,
  now: number,
) {
  rules.stats[victimSlot].deaths++;
  rules.respawns[victimTeam] = Math.max(0, rules.respawns[victimTeam] - 1);
  if (killerSlot !== null) rules.stats[killerSlot].frags++;

  const last = rules.lastDamagedBy[victimSlot];
  if (last && last.bySlot !== killerSlot && now - last.at <= ASSIST_WINDOW) {
    rules.stats[last.bySlot].assists++;
  }
  delete rules.lastDamagedBy[victimSlot];
}

export function recordDamage(rules: MatchRules, victimSlot: number, bySlot: number, now: number) {
  rules.lastDamagedBy[victimSlot] = { bySlot, at: now };
}

/** SPEC §2.2 win conditions, checked once per tick by sim.ts. */
export function checkWinByFlag(rules: MatchRules) {
  if (rules.ended) return;
  for (const team of ["blue", "red"] as TeamId[]) {
    if (!rules.flagAlive[team]) {
      rules.ended = true;
      rules.winner = otherTeam(team);
      return;
    }
  }
}

export function checkWinByRespawns(rules: MatchRules, teamHasLivingTank: Record<TeamId, boolean>) {
  if (rules.ended) return;
  for (const team of ["blue", "red"] as TeamId[]) {
    if (rules.respawns[team] <= 0 && !teamHasLivingTank[team]) {
      rules.ended = true;
      rules.winner = otherTeam(team);
      return;
    }
  }
}

export function checkWinByTime(rules: MatchRules) {
  if (rules.ended) return;
  if (rules.timeLeft > 0) return;
  const blueFrags = teamFrags(rules, "blue");
  const redFrags = teamFrags(rules, "red");
  rules.ended = true;
  if (blueFrags === redFrags) {
    // tie-break: flag armor remaining (both intact here) -> draw for MVP
    rules.winner = "draw";
  } else {
    rules.winner = blueFrags > redFrags ? "blue" : "red";
  }
}

export function teamFrags(rules: MatchRules, team: TeamId): number {
  let sum = 0;
  for (const [id, t] of Object.entries(rules.slotTeam)) {
    if (t === team) sum += rules.stats[Number(id)].frags;
  }
  return sum;
}

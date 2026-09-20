import type { TeamId } from "../game/config";
import type { Slot } from "./tank";

export type MatchSettings = {
  mapId: string;
  timeLimit: number; // seconds, SPEC §2.2
  tickets: number; // starting tickets per team
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
  tickets: Record<TeamId, number>;
  flagAlive: Record<TeamId, boolean>;
  stats: Record<number, PlayerStats>;
  /** last slot to damage a given slot, and when — for the 5s assist window (§2.4) */
  lastDamagedBy: Partial<Record<number, { bySlot: number; at: number }>>;
  /** Slots per team — 5 for every production map; a debug map (§3.5) can be
   *  smaller. Assumes symmetric teams (createDefaultSlots' invariant), so
   *  teamFrags below can address a team by a contiguous id range. */
  teamSize: number;
  ended: boolean;
  winner: TeamId | "draw" | null;
};

export function createRules(settings: MatchSettings, slots: Slot[]): MatchRules {
  const stats: Record<number, PlayerStats> = {};
  for (const s of slots) stats[s.id] = createStats();
  return {
    timeLeft: settings.timeLimit,
    tickets: { blue: settings.tickets, red: settings.tickets },
    flagAlive: { blue: true, red: true },
    stats,
    lastDamagedBy: {},
    teamSize: slots.length / 2,
    ended: false,
    winner: null,
  };
}

const ASSIST_WINDOW = 5; // s, SPEC §2.4

export function otherTeam(t: TeamId): TeamId {
  return t === "blue" ? "red" : "blue";
}

/** Records a kill: frag to the killer, death + ticket loss to the victim's
 *  team, and an assist to whoever last damaged the victim (if different and
 *  within the assist window). Pass killerSlot = null for environmental deaths
 *  (water, mine, shovel-crush) which cost a ticket but credit no frag. */
export function recordKill(
  rules: MatchRules,
  victimSlot: number,
  victimTeam: TeamId,
  killerSlot: number | null,
  now: number,
) {
  rules.stats[victimSlot].deaths++;
  rules.tickets[victimTeam] = Math.max(0, rules.tickets[victimTeam] - 1);
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

export function checkWinByTickets(rules: MatchRules, teamHasLivingTank: Record<TeamId, boolean>) {
  if (rules.ended) return;
  for (const team of ["blue", "red"] as TeamId[]) {
    if (rules.tickets[team] <= 0 && !teamHasLivingTank[team]) {
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
  const start = team === "blue" ? 0 : rules.teamSize;
  for (let i = 0; i < rules.teamSize; i++) sum += rules.stats[start + i].frags;
  return sum;
}

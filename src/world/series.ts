// The match series — SPEC §2.2. A *round* is one fight (one `Sim`, one set of
// MatchRules); a *match* is a series of rounds on the same map, and the first
// team to win `target` rounds takes it.
//
// Kept apart from world/rules.ts on purpose: MatchRules is per-round state the
// Sim owns and resets every round, while this is what survives across rounds.
// Pure and DOM-free like the rest of `world/`, so the round/series rules are
// testable without a host or a renderer.

import type { TeamId } from "../game/config";
import { createStats, type PlayerStats } from "./rules";
import type { Slot } from "./tank";

export type Series = {
  /** Rounds won, per team — the score the HUD, the intermission and the
   *  result screen all show. A drawn round adds to neither. */
  wins: Record<TeamId, number>;
  /** 1-based number of the round being played. */
  round: number;
  /** Wins needed to take the match, from the map (SPEC §3.5 `!wins`). */
  target: number;
  /** Per-player stats summed over every round played so far — the scoreboard
   *  is about the match, not the round the player happens to be in. */
  stats: Record<number, PlayerStats>;
};

export function createSeries(target: number, slots: Slot[]): Series {
  const stats: Record<number, PlayerStats> = {};
  for (const s of slots) stats[s.id] = createStats();
  return { wins: { blue: 0, red: 0 }, round: 1, target, stats };
}

/** Folds a finished round's stats into the series total. Slots that appeared
 *  mid-series (a roster the series didn't start with) are taken as they come. */
export function addRoundStats(series: Series, round: Record<number, PlayerStats>) {
  for (const [id, st] of Object.entries(round)) {
    const into = (series.stats[Number(id)] ??= createStats());
    into.frags += st.frags;
    into.deaths += st.deaths;
    into.flagDamage += st.flagDamage;
    into.bonusesTaken += st.bonusesTaken;
    into.assists += st.assists;
  }
}

/** Books a finished round. Every round has a winner (SPEC §2.2): the clock
 *  running out level puts the round into sudden death rather than ending it,
 *  so there is nothing here for a draw to mean. */
export function recordRound(series: Series, winner: TeamId) {
  series.wins[winner]++;
  series.round++;
}

/** The team that has taken the match, or null while it's still on. */
export function seriesWinner(series: Series): TeamId | null {
  if (series.wins.blue >= series.target) return "blue";
  if (series.wins.red >= series.target) return "red";
  return null;
}

/** "5:2", winner's score first — how the result screen states the outcome
 *  ("BLUE WINS 5:2"). Blue first for a series with no winner, which only a
 *  match nobody finished can be. */
export function seriesScoreLabel(wins: Record<TeamId, number>, winner: TeamId | null): string {
  if (!winner) return `${wins.blue}:${wins.red}`;
  const loser: TeamId = winner === "blue" ? "red" : "blue";
  return `${wins[winner]}:${wins[loser]}`;
}

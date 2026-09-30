// Names, ids and display labels shared across the game, plus the DEBUG
// switch. Every gameplay *number* lives in ./constants.ts.

// --- Debug (dev-only, SPEC §3.5 "Debug map") ---
// Flip on locally to skip the menu/room flow entirely and drop straight into
// a running match on the debug map (world/maps/debugMap.ts), bots filling
// every spawn but slot 0. Never ship this on.
export const DEBUG = false;

// --- Teams ---
export type TeamId = "blue" | "red";
export const TEAMS: readonly TeamId[] = ["blue", "red"];
export const TEAM_COLOR: Record<TeamId, number> = {
  blue: 0x3d7dff,
  red: 0xff4d4d,
};

// --- Bot difficulty (SPEC §10) ---
// The tuning behind each one is BOT_PROFILE in ./constants.ts.
export type BotDifficulty = "easy" | "normal" | "hard" | "extreme";
export const BOT_DIFFICULTIES: BotDifficulty[] = ["easy", "normal", "hard", "extreme"];

/** Display name of a difficulty — the single source of truth for the UI
 *  labels and for bot nicknames ("Easy1", "Medium2", "Hard3", "Extreme4"). The middle
 *  tier reads "Medium" to players; the internal id stays `normal`. */
export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: "Easy",
  normal: "Medium",
  hard: "Hard",
  extreme: "Extreme",
};

// --- Lobby labels for match rules (SPEC §2) ---

/** How a respawn multiplier reads in the lobby: `x10 (50)` when both teams
 *  field the same roster, `x10 (50, 100)` — blue, red — when the map is
 *  lopsided. The multiplier alone never says how many lives that actually is. */
export function respawnLabel(mult: number, blueSize: number, redSize: number): string {
  const blue = mult * blueSize;
  const red = mult * redSize;
  return `×${mult} (${blue === red ? blue : `${blue}, ${red}`})`;
}

/** "first to 5" — how long a match runs, in rounds won. The lobby states it
 *  wherever it states the round length. */
export function winsTargetLabel(winsTarget: number): string {
  return `first to ${winsTarget}`;
}

// Tunables from SPEC.md. Keep numbers here, not scattered through the code.

// --- Debug (dev-only, SPEC §3.5 "Debug map") ---
// Flip on locally to skip the menu/room flow entirely and drop straight into
// a running match on the debug map (world/maps/debugMap.ts), bots filling
// every spawn but slot 0. Never ship this on.
export const DEBUG = false;

// --- Arena (SPEC §3.1) ---
// One cell = one tank/flag slot — the map format (SPEC §3.5) is one
// character per cell, so a single `r`/`b`/`R`/`B` glyph has to *be* a full
// tank-sized square, not a quarter of one, or a 1-cell gap in the map art
// (like the debug map's brick gate) isn't actually wide enough to drive a
// tank through.
export const CELL = 32;
// No fixed arena size (and no fixed aspect ratio) — the world is exactly as
// big as whatever map is loaded (map.width/height * CELL, SPEC §3.1), which
// is why every map, including the much smaller debug map, needs its own
// world bounds rather than sharing one baked-in constant.
// Floor and ceiling for any map. The floor is the smallest grid that can
// still hold one flag and one spawn per team (2x2); the ceiling guards the
// grid allocation and terrain-sprite count against a malformed/huge template.
export const MIN_MAP_W = 2;
export const MIN_MAP_H = 2;
export const MAX_MAP_W = 128;
export const MAX_MAP_H = 128;

export const TANK_CELLS = 1; // a tank is exactly one cell now, see above
export const TANK_SIZE = TANK_CELLS * CELL; // 32px logical slot (spawns, flags, pathing grid)
// The actual collision/visual body is smaller than the 32px slot so a tank
// can turn into a same-width (1-cell) corridor without needing pixel-perfect
// alignment — without this, tanks would snag on wall corners constantly.
export const TANK_HITBOX = 24;
export const TANK_MARGIN = (TANK_SIZE - TANK_HITBOX) / 2;
// Gentle assist pulling the tank's cross-axis position toward the nearest
// CELL grid line while it moves, so lining up to turn into a corridor
// doesn't require the player to hit the exact pixel.
export const AUTO_CENTER_SPEED = 60; // px/s

export const SUB_GRID = 8; // movement snap, px

// --- Tank (SPEC §4.1) ---
export const TANK_SPEED = 84; // px/s
export const SAND_SPEED_MULT = 0.55;
export const SPEED_BONUS_MULT = 1.6;
export const ICE_SLIDE_TIME = 0.4; // s of continued sliding after key release
export const FIRE_COOLDOWN = 0.45; // s
export const BULLET_SPEED_BASE = 300; // px/s
export const BULLET_SPEED_STAR1 = 420; // px/s, STAR level >= 1
export const BULLET_RADIUS = 3;

// --- Upgrades (SPEC §4.2) ---
export const MAX_STAR = 3;

// --- Match rules (SPEC §2) ---
// Fallback roster size only, for a room created without a map in hand. The
// real team size is whatever the loaded map declares — one slot per `r`/`b`
// marker in its template (SPEC §3.5) — so a map can be 1v1 or 8v8.
export const TEAM_SIZE = 5;
export const DEFAULT_RESPAWNS = 25;
export const DEFAULT_TIME_LIMIT = 10 * 60; // seconds
export const RESPAWN_DELAY = 3; // s
export const SPAWN_INVULN = 3; // s

// --- Bonuses (SPEC §4.3) ---
export const BONUS_SPAWN_INTERVAL: [number, number] = [20, 30]; // s
export const BONUS_MAX_ON_FIELD = 2;
export const BONUS_DESPAWN_AFTER = 15; // s
export const BONUS_DURATION = {
  HELMET: 12,
  SPEED: 10,
  SHOVEL: 20,
  CLOCK: 6,
} as const;
export const MAX_MINES_HELD = 3;
export const MINE_BLAST_RADIUS_CELLS = 1;

// --- Simulation (SPEC §8) ---
export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

// --- Networking (SPEC §9) ---
export const NET_INPUT_HZ = 30;
export const NET_SNAPSHOT_HZ = 15;
export const NET_FULL_SNAPSHOT_EVERY = 2; // s
export const RECONNECT_GRACE = 60; // s
export const RECONNECT_ROOM_TIMEOUT = 30; // s

// --- Bots (SPEC §10) ---
export type BotDifficulty = "easy" | "normal" | "hard";
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "normal";
export const BOT_DIFFICULTIES: BotDifficulty[] = ["easy", "normal", "hard"];

/** Display name of a difficulty — the single source of truth for the UI
 *  labels and for bot nicknames ("Easy1", "Medium2", "Hard3"). The middle
 *  tier reads "Medium" to players; the internal id stays `normal`. */
export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: "Easy",
  normal: "Medium",
  hard: "Hard",
};

export type BotProfile = {
    reactionDelay: number; // s, before shooting at a newly acquired target
    /** Extra pause between consecutive shots at a target it is already
     *  tracking, on top of the tank's own FIRE_COOLDOWN. This is what makes
     *  Easy read as sluggish on the trigger rather than merely inaccurate —
     *  you get time to break the lane after its first shot. */
    fireHesitation: number; // s
    rescoreInterval: number; // s
    aimErrorDeg: number;
    fireToleranceDeg: number;
    leadFactor: number; // 0 = no lead, 1 = full lead
    memory: number; // s, last-known-position decay
    preemptiveDodge: boolean;
    /** Whether the bot will shoot brick, and how eagerly it routes through
     *  it: "never" paths around brick entirely, "whenFaster" treats it as
     *  expensive-but-passable, "proactive" opens lanes cheaply and also
     *  fires *through* brick at an enemy it knows is behind it. */
    shootsBrickToPath: "never" | "whenFaster" | "proactive";
    /** How the bot picks which known enemy to shoot at: "sticky" keeps the
     *  current one until it is forgotten (tunnel vision), "nearest" always
     *  retargets, "threat" weighs upgrade level, buffs and proximity to our
     *  own flag. */
    targetPriority: "sticky" | "nearest" | "threat";
    roleAdherence: number; // 0..1
    /** Probability of detouring to pick up a bonus it can see. 0 = only ever
     *  collects what it happens to drive over. */
    bonusDetour: number; // 0..1
    usesMines: boolean;
    /** Only drop a mine at a chokepoint, never in the open — SPEC §10.3
     *  Hard, "placed at chokepoints and around the flag pocket, not
     *  scattered". A bot without it also mines its own flag approach. */
    minesAtChokepointsOnly: boolean;
    timesTeamBonuses: boolean;
    retreatsWhenLosing: boolean;
    deniesBonuses: boolean;
};

export const BOT_PROFILE: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionDelay: 0.45,
    fireHesitation: 0.55,
    rescoreInterval: 0.25,
    aimErrorDeg: 14,
    fireToleranceDeg: 18,
    leadFactor: 0,
    memory: 1.0,
    preemptiveDodge: false,
    shootsBrickToPath: "never",
    targetPriority: "sticky",
    roleAdherence: 0.35,
    bonusDetour: 0,
    usesMines: false,
    minesAtChokepointsOnly: false,
    timesTeamBonuses: false,
    retreatsWhenLosing: false,
    deniesBonuses: false,
  },
  normal: {
    reactionDelay: 0.22,
    fireHesitation: 0.15,
    rescoreInterval: 0.15,
    aimErrorDeg: 5,
    fireToleranceDeg: 8,
    leadFactor: 0.5,
    memory: 2.5,
    preemptiveDodge: false,
    shootsBrickToPath: "whenFaster",
    targetPriority: "nearest",
    roleAdherence: 0.85,
    bonusDetour: 0.45,
    usesMines: true,
    minesAtChokepointsOnly: false,
    timesTeamBonuses: false,
    retreatsWhenLosing: true,
    deniesBonuses: false,
  },
  hard: {
    reactionDelay: 0.09,
    fireHesitation: 0,
    rescoreInterval: 0.1,
    aimErrorDeg: 1.5,
    fireToleranceDeg: 3,
    leadFactor: 1,
    memory: 4.0,
    preemptiveDodge: true,
    shootsBrickToPath: "proactive",
    targetPriority: "threat",
    roleAdherence: 1,
    bonusDetour: 0.7,
    usesMines: true,
    minesAtChokepointsOnly: true,
    timesTeamBonuses: true,
    retreatsWhenLosing: true,
    deniesBonuses: true,
  },
};

// --- Teams ---
export type TeamId = "blue" | "red";
export const TEAMS: readonly TeamId[] = ["blue", "red"];
export const TEAM_COLOR: Record<TeamId, number> = {
  blue: 0x3d7dff,
  red: 0xff4d4d,
};

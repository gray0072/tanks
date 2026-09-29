// Every gameplay tunable, grouped by what it governs. Keep numbers here, not
// scattered through the code — SPEC section numbers mark where each group is
// specified. Names and types that aren't tuning (team ids, difficulty ids,
// display labels, the DEBUG switch) live in ./config.ts.

import type { BotDifficulty } from "./config";
import type { BonusKind } from "../world/bonus";

// =============================================================================
// Players and teams (SPEC §2, §3.5)
// =============================================================================

// Most tanks one team may field — one per `r`/`b` spawn marker in the map's
// template, so up to 20v20. There is no default team size: the roster is
// always built from the loaded map's own spawn counts, and nothing in the
// engine assumes a size. This is a deliberate ceiling, enforced by the editor
// and the map validator. The teams need not be equal (4 vs 6 is fine).
export const MAX_PLAYERS_PER_TEAM = 20;

// =============================================================================
// Map and arena (SPEC §3)
// =============================================================================

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
// Hits a brick cell takes before it's gone (SPEC §3.3). The sim stores only
// the count; the crack art in render/atlas.ts has one stage per hit.
export const BRICK_QUARTERS = 4;

// =============================================================================
// Tank body and movement (SPEC §4.1)
// =============================================================================

export const TANK_CELLS = 1; // a tank is exactly one cell, see CELL
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

export const TANK_SPEED = 84; // px/s
export const SAND_SPEED_MULT = 0.55;
export const ICE_SLIDE_TIME = 0.4; // s of continued sliding after key release

// =============================================================================
// Shooting (SPEC §4.1, §4.2)
// =============================================================================

export const FIRE_COOLDOWN = 0.45; // s
export const BULLET_SPEED_BASE = 300; // px/s
export const BULLET_SPEED_STAR1 = 420; // px/s, STAR level >= 1
export const BULLET_RADIUS = 3;

// =============================================================================
// Upgrades, bonuses and mines (SPEC §4.2, §4.3)
// =============================================================================

export const MAX_STAR = 3;
export const SPEED_BONUS_MULT = 1.6;

// Bonus rate is a room setting in bonuses per minute (1..10, default 6);
// each gap is 60 / rate seconds, jittered by this factor either way so drops
// don't tick like a metronome. One bonus is dropped the moment a round starts.
export const BONUS_RATE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DEFAULT_BONUS_RATE = 6; // per minute
export const BONUS_SPAWN_JITTER = 0.2;
// Field cap at the slowest rates; faster rates raise it to whatever the rate
// keeps alive for BONUS_DESPAWN_AFTER, so a high rate isn't silently capped.
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

// =============================================================================
// Respawns and scoring (SPEC §2.3, §2.4)
// =============================================================================

export const RESPAWN_DELAY = 3; // s
export const SPAWN_INVULN = 3; // s
// Respawns are a *multiplier on team size*, not a flat pool: a 1v1 map and a
// 20v20 one want wildly different pools, and the roster is whatever the map
// declares. Each team starts with mult x (its own slot count), so lopsided
// maps (4 vs 6) give each side the same respawns per player.
export const RESPAWN_MULTIPLIERS = [0, 1, 2, 3, 5, 10, 20, 50, 100];
export const DEFAULT_RESPAWN_MULT = 10;
// How recently a tank must have damaged the victim to earn an assist.
export const ASSIST_WINDOW = 5; // s

// =============================================================================
// Rounds and the match series (SPEC §2.2)
// =============================================================================

// Selectable round lengths, 1..10 minutes. A round is one fight, not the
// whole match, so these are deliberately short: the clock only decides a
// round nobody won outright.
export const TIME_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => m * 60);
export const DEFAULT_TIME_LIMIT = 5 * 60; // seconds
// A match is a series of rounds on one map; the first team to win
// `winsTarget` rounds takes it. A host-only room setting, like the rest of
// MatchSettings, riding the wire to every guest.
export const WINS_TARGET_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DEFAULT_WINS_TARGET = 5;
// Breather between rounds: the score goes up, the countdown runs, and the
// next round starts on rebuilt terrain when it hits 0.
export const ROUND_INTERMISSION = 3; // s

// =============================================================================
// Simulation (SPEC §8)
// =============================================================================

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

// =============================================================================
// Touch controls (SPEC §5.3)
// =============================================================================

/** Radius, in px, the thumb must travel from the stick's origin before the
 *  tank moves at all — below it the stick reads as "stop", so you can hold
 *  still without lifting your thumb. */
export const TOUCH_DEAD_ZONE = 14;
/** Knob travel. Past this the origin is dragged along behind the thumb, so a
 *  long swipe never runs out of stick and never needs a re-grab. */
export const TOUCH_STICK_RADIUS = 52;

// =============================================================================
// Bots (SPEC §10)
// =============================================================================

export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = "normal";

export type BotProfile = {
    /** Human-scale reaction time (SPEC §10.4): how long after a target lines
     *  up before the bot fires at it, and how old an incoming bullet has to
     *  be before the bot has noticed it and starts to dodge. A beginner sits
     *  around 0.5-0.7 s once the decision is included; a strong player is
     *  near 0.2 s. Below that reads as an aimbot, not as skill. */
    reactionDelay: number; // s
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
     *  it: "lastResort" goes around brick whenever there is any sensible way
     *  round, and only shoots through when the detour is absurd or there is
     *  none (a walled-in flag) — a beginner still figures out that a wall
     *  can be shot; "whenFaster" treats it as
     *  expensive-but-passable, "proactive" opens lanes cheaply and also
     *  fires *through* brick at an enemy it knows is behind it. */
    shootsBrickToPath: "lastResort" | "whenFaster" | "proactive";
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
  // A beginner: slow to react, slow on the trigger, sloppy aim, no lead, and
  // forgets you the moment you're out of sight.
  easy: {
    reactionDelay: 0.6,
    fireHesitation: 0.8,
    rescoreInterval: 0.5,
    aimErrorDeg: 18,
    fireToleranceDeg: 18,
    leadFactor: 0,
    memory: 1.0,
    preemptiveDodge: false,
    shootsBrickToPath: "lastResort",
    targetPriority: "sticky",
    roleAdherence: 0.35,
    bonusDetour: 0,
    usesMines: false,
    minesAtChokepointsOnly: false,
    timesTeamBonuses: false,
    retreatsWhenLosing: false,
    deniesBonuses: false,
  },
  // A regular player.
  normal: {
    reactionDelay: 0.35,
    fireHesitation: 0.15,
    rescoreInterval: 0.3,
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
  // Close to a strong player — fast, but still human-fast.
  hard: {
    reactionDelay: 0.2,
    fireHesitation: 0,
    rescoreInterval: 0.2,
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

// Shared by every difficulty — the profiles above are what sets them apart.

/** Anti-jitter commitments (SPEC §10.4 "no dithering"). Aim error is
 *  re-sampled this often rather than every tick — a per-tick roll kept
 *  flipping a marginal target in and out of the firing window, and the bot
 *  turned back and forth with it. A target already being tracked is held
 *  onto with this much extra lane tolerance (hysteresis: harder to lose a
 *  lane than to find one), and the barrel stays on it briefly once it has
 *  slipped off. A dodge, once started, keeps its direction for a
 *  beat. And path following finishes an axis before switching to the other
 *  unless it is this close to done, instead of zig-zagging a staircase. */
export const BOT_AIM_RESAMPLE_TIME = 0.4; // s
export const BOT_AIM_HOLD_MULT = 1.5;
export const BOT_AIM_HOLD_TIME = 0.35; // s, barrel stays on a target that just slipped off
export const BOT_EVADE_COMMIT_TIME = 0.3; // s
export const BOT_PATH_AXIS_DONE_PX = 3;
/** What brick costs a "lastResort" bot per cell on its route: dear enough
 *  that any real way round wins, finite so a walled-in goal is still
 *  reachable by shooting through. */
export const BOT_LAST_RESORT_BRICK_COST = 25;

/** How close to a firing lane counts as lined up, in px. One movement step
 *  at TANK_SPEED is ~2.8px, so anything tighter than this just oscillates. */
export const BOT_LANE_TOLERANCE_PX = 3;
/** How close a bot has to be before shooting *through* brick at a static
 *  target, and before it will shuffle sideways to line one up. */
export const BOT_DEMOLITION_RANGE_CELLS = 4;
export const BOT_LANE_STEP_RANGE_CELLS = 6;
/** How close an enemy has to be before its firing lane is worth vacating
 *  pre-emptively (SPEC §10.3 Hard, "leaves enemy firing lanes before a shot
 *  is fired"). */
export const BOT_PREEMPT_RANGE_CELLS = 10;
/** Once a bot decides to vacate a lane it keeps going for this long, then
 *  refuses to do it again for a moment — otherwise it re-decides every tick
 *  and never actually leaves. */
export const BOT_PREEMPT_COMMIT_TIME = 0.25; // s
export const BOT_PREEMPT_REST_TIME = 0.5; // s
/** Beyond this the bot does not bother shooting at a tank at all. */
export const BOT_ENGAGE_RANGE_CELLS = 12;
/** How long a bot sticks with a chosen action before re-rolling it. */
export const BOT_ACTION_COMMIT_TIME = 1.5; // s
export const BOT_COLLECT_COMMIT_TIME = 8; // s
/** Velocity tracking for target leading: samples further apart than this are
 *  a re-acquisition, not motion, and the smoothing factor damps the
 *  per-tick quantisation noise. */
export const BOT_VELOCITY_SAMPLE_MAX_GAP = 0.5; // s
export const BOT_VELOCITY_SMOOTHING = 0.25;
/** Baseline desirability of each bonus, before distance. STAR and HELMET
 *  lead for a personal pickup (SPEC §10.3 Medium, "values STAR and HELMET
 *  above the rest"); the team bonuses are re-weighted by the situation for a
 *  profile that times them. */
export const BOT_BONUS_VALUE: Record<BonusKind, number> = {
  STAR: 3,
  HELMET: 2.5,
  RESPAWN: 1.8,
  SPEED: 1.6,
  CLOCK: 1.6,
  SHOVEL: 1.4,
  GRENADE: 2.2,
  MINE: 1.2,
};
/** Team coordination (ai/teamPlan.ts): enemies within this radius of our
 *  flag count as a threat, and this many of them pull the whole team back
 *  to defend. */
export const BOT_THREAT_RADIUS_CELLS = 14;
export const BOT_THREAT_COUNT_FOR_FULL_DEFENSE = 2;
/** A team's posture for the round (ai/teamPlan.ts), drawn at random with
 *  these weights so rounds play differently: how the team splits between
 *  defending, holding the middle and attacking. Shares are of the bots on
 *  the team; roleCounts() turns them into whole bots for any team size. */
export type BotPosture = "aggressive" | "balanced" | "defensive";
export const BOT_POSTURE_WEIGHTS: Record<BotPosture, number> = {
  aggressive: 0.3,
  balanced: 0.45,
  defensive: 0.25,
};
export const BOT_POSTURE_SHARES: Record<BotPosture, { defend: number; midfield: number }> = {
  aggressive: { defend: 0.15, midfield: 0.2 },
  balanced: { defend: 0.25, midfield: 0.3 },
  defensive: { defend: 0.4, midfield: 0.35 },
};
/** One flank per this many cells of map width across the flag-to-flag
 *  line, up to three (left, middle, right). */
export const BOT_LANE_MIN_WIDTH_CELLS = 8;
/** An attacker drives out along its flank to this point (0 = own flag,
 *  1 = enemy flag) before turning in on the flag; a midfielder patrols its
 *  flank between the two HOLD points. */
export const BOT_ATTACK_STAGE_ALONG = 0.5;
export const BOT_HOLD_ALONG: [number, number] = [0.3, 0.5];
/** Defenders wait this far in front of the flag, this far apart. */
export const BOT_GUARD_AHEAD_CELLS = 3;
export const BOT_GUARD_SPREAD_CELLS = 3;

// =============================================================================
// Networking (SPEC §9)
// =============================================================================

export const NET_INPUT_HZ = 30;
export const NET_SNAPSHOT_HZ = 15;
export const NET_FULL_SNAPSHOT_EVERY = 2; // s
export const RECONNECT_GRACE = 60; // s
export const RECONNECT_ROOM_TIMEOUT = 30; // s
// How often the host looks at each peer's RTCPeerConnection state, and how
// long a peer may sit in "disconnected" before it is treated as gone
// (net/liveness.ts). A closed tab usually reaches "failed"/"closed" and is
// dropped at once; this grace is for the ICE blips a roaming phone produces,
// which must not end someone's match.
export const PEER_POLL_INTERVAL = 1; // s
export const PEER_DISCONNECT_GRACE = 8; // s
// A kicked player is told first and the socket is closed a moment later, so
// the message is actually on the wire before the connection goes (§9.4).
export const KICK_CLOSE_DELAY = 0.25; // s

// =============================================================================
// Level editor (specs/level-editor.md §3)
// =============================================================================

// Editor-only bounds, deliberately *inside* the engine's MIN/MAX map size
// above: the engine floor of 2x2 is enough to parse (and the parser test and
// the 8x5 debug map rely on it) but far too small to be a match, and the 128
// ceiling is more map than any phone can letterbox usefully.
export const EDITOR_MIN_W = 8;
export const EDITOR_MIN_H = 8;
export const EDITOR_MAX_W = 64;
export const EDITOR_MAX_H = 64;
export const EDITOR_DEFAULT_W = 20;
export const EDITOR_DEFAULT_H = 16;
// BONUS_MAX_ON_FIELD is 2, so past a handful of points this is only variety.
export const EDITOR_MAX_BONUS_SPAWNS = 16;
export const EDITOR_MAX_NAME = 24;

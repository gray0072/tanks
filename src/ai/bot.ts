// Utility AI — SPEC §10. One BotController per bot slot. Runs only on the
// host (bots never exist on a client, SPEC §9.1), fed the same Sim seen by
// stepFiring/stepMovement so it can only act on information a player could
// plausibly have (SPEC §10.2 "Fair perception").

import type { Sim, SeatInput } from "../world/sim";
import type { TankState } from "../world/tank";
import { tankCenter } from "../world/tank";
import { Tile } from "../world/grid";
import type { BonusEntity } from "../world/bonus";
import { findPath, nearestPassable, type CellPoint } from "./pathfinder";
import { guardPoint, lanePoint, progressAlong, type Assignment } from "./teamPlan";
import { huntersOf, reportSighting, teamBoard } from "./teamIntel";
import { Dir, DIR_VECTOR } from "../util/math";
import {
  CELL,
  TANK_SIZE,
  TANK_HITBOX,
  TANK_SPEED,
  BULLET_SPEED_BASE,
  BULLET_SPEED_STAR1,
  TICK_DT,
  BOT_PROFILE,
  BOT_LANE_TOLERANCE_PX,
  BOT_DEMOLITION_RANGE_CELLS,
  BOT_LANE_STEP_RANGE_CELLS,
  BOT_PREEMPT_RANGE_CELLS,
  BOT_PREEMPT_COMMIT_TIME,
  BOT_PREEMPT_REST_TIME,
  BOT_ENGAGE_RANGE_CELLS,
  BOT_ACTION_COMMIT_TIME,
  BOT_COLLECT_COMMIT_TIME,
  BOT_VELOCITY_SAMPLE_MAX_GAP,
  BOT_VELOCITY_SMOOTHING,
  BOT_BONUS_VALUE,
  BOT_AIM_RESAMPLE_TIME,
  BOT_AIM_HOLD_MULT,
  BOT_AIM_HOLD_TIME,
  BOT_EVADE_COMMIT_TIME,
  BOT_PATH_AXIS_DONE_PX,
  BOT_LAST_RESORT_BRICK_COST,
  BOT_ATTACK_STAGE_ALONG,
  BOT_HOLD_ALONG,
  BOT_GUARD_AHEAD_CELLS,
  BOT_GUARD_SPREAD_CELLS,
  BOT_THREAT_RADIUS_CELLS,
  BOT_COMMS_DELAY,
  BOT_MAX_HUNTERS,
  BOT_APPROACH_RANGE_CELLS,
  BOT_SPACING_CELLS,
  BOT_PUSH_QUORUM,
  BOT_PUSH_MAX_WAIT,
  BOT_PUSH_JOIN_WINDOW,
  BOT_AMBUSH_RADIUS_CELLS,
  BOT_PROBE_INTERVAL,
  BOT_PROBE_RANGE_CELLS,
  type BotProfile,
} from "../game/constants";
import type { BotDifficulty, TeamId } from "../game/config";

/** `Hold` is the midfielder's job: patrol its flank of the middle. */
type Action = "AttackFlag" | "DefendFlag" | "Hunt" | "Collect" | "Regroup" | "Hold";

/** A last-known enemy sighting. `vx/vy` is the velocity the bot has actually
 *  *watched* that tank move at (px/s, smoothed), which is what target leading
 *  uses — assuming every target is always running at full TANK_SPEED in the
 *  direction it currently faces makes a full-lead profile systematically
 *  over-lead, and shoot in front of tanks that are standing still. */
type MemoryEntry = { x: number; y: number; at: number; vx: number; vy: number };

/** An enemy the bot currently knows about, at its last-known position. */
type KnownEnemy = { slot: number; x: number; y: number };

/** What stands between a tank and where it wants to shoot. `brick` is
 *  destructible, so a bot that shoots brick can still take the shot — that's
 *  SPEC §10.3 Hard, "fires through brick at an enemy it knows is behind it". */
type ShotBlock = "clear" | "brick" | "solid";

// Cardinal only — bots themselves only ever move/aim on the 4 cardinal
// dirs (dirTowards below), but a human player's tank.dir can now be
// diagonal (util/input.ts), so lookups against another tank's dir must
// handle a missing entry rather than assume one of these 4.
const AXIS_FOR_DIR: Partial<Record<Dir, "x" | "y">> = {
  [Dir.Up]: "y", [Dir.Down]: "y", [Dir.Left]: "x", [Dir.Right]: "x",
};

const CARDINALS: Dir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];


/** Center of a 1-cell entity in world px. Flags, bonuses and spawns are all
 *  a single cell (SPEC §3.5: "nothing is a 2 x 2 block"). */
function cellCenter(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
}

/** Can this bot *see* that point? Brick and steel block sight; so does
 *  forest, which is also what conceals a tank standing in it (SPEC §10.2) —
 *  the target's own cell is included in the scan, so an enemy sitting in
 *  forest is genuinely unknown rather than merely hard to shoot at. */
function visionBlocked(sim: Sim, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
  for (let i = 1; i <= steps; i++) {
    const x = ax + (dx * i) / steps;
    const y = ay + (dy * i) / steps;
    const tile = sim.grid.tileAt(Math.floor(x / CELL), Math.floor(y / CELL));
    if (tile === Tile.Brick || tile === Tile.Steel || tile === Tile.Forest) return true;
  }
  return false;
}

/** What a bullet fired from `from` toward `to` would hit on the way. Forest
 *  is absent on purpose: it hides tanks but bullets fly straight through it
 *  (grid.bulletPassableCell). Any flag counts as solid, so a shot that would
 *  cross our own flag is refused.
 *
 *  The *target's own cell* is skipped by cell index rather than by stopping
 *  the scan one sample early: at short range the samples are coarse enough
 *  that the last one still lands inside the target cell, which made every
 *  shot at a flag report "solid" — the flag was reading as its own
 *  obstruction, and no bot ever damaged one. */
function shotObstruction(sim: Sim, ax: number, ay: number, bx: number, by: number): ShotBlock {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL / 2)));
  const tcx = Math.floor(bx / CELL);
  const tcy = Math.floor(by / CELL);
  let brick = false;
  for (let i = 1; i <= steps; i++) {
    const cx = Math.floor((ax + (dx * i) / steps) / CELL);
    const cy = Math.floor((ay + (dy * i) / steps) / CELL);
    if (cx === tcx && cy === tcy) continue;
    const tile = sim.grid.tileAt(cx, cy);
    if (tile === Tile.Steel || sim.grid.isFlag(tile)) return "solid";
    if (tile === Tile.Brick) brick = true;
  }
  return brick ? "brick" : "clear";
}

function dirTowards(dx: number, dy: number): Dir {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.Right : Dir.Left) : dy > 0 ? Dir.Down : Dir.Up;
}

/** What a brick cell costs this profile to route through (SPEC §10.3
 *  "Shoots brick to path"). Always finite: a bot that treated brick as
 *  impassable sat forever in front of a walled-in goal. The beginner's cost
 *  is just high enough that any real way round wins. */
function brickPathCost(profile: BotProfile): number {
  switch (profile.shootsBrickToPath) {
    case "lastResort": return BOT_LAST_RESORT_BRICK_COST;
    case "whenFaster": return 6;
    case "proactive": return 2.5;
  }
}

export class BotController {
  private memory = new Map<number, MemoryEntry>();
  private action: Action = "Hunt";
  private path: CellPoint[] | null = null;
  private pathGoal: CellPoint | null = null;
  private repathT = 0;
  private rescoreT = 0;
  private actionHold = 0;
  private aimingAt: number | null = null; // slot we've been tracking, for reaction delay
  private aimingSince = 0;
  private nextShotAt = 0; // sim.time before which we won't take another shot
  private mineCooldown = 0;
  /** One aim-error sample per tick, re-rolled in decide() — drawing a fresh
   *  one per lane test would let a bot re-roll its way onto a shot it just
   *  missed, within the same tick. */
  private aimJitter = 0.5;
  private aimResampleT = 0;
  /** Path-following direction last tick, kept until its axis is done. */
  private lastMoveDir: Dir | null = null;
  /** A started dodge keeps its direction for BOT_EVADE_COMMIT_TIME. */
  private evadeDir: Dir | null = null;
  private evadeT = 0;
  /** This round's job from the team plan (ai/teamPlan.ts). */
  private assignment: Assignment = { role: "attack", lane: 0 };
  /** An attacker first drives out along its flank, then turns in on the
   *  flag; this flips once it is far enough up the map. Reset on death. */
  private staged = false;
  /** Which of the two Hold points a midfielder is heading for. */
  private holdLeg = 0;
  /** Barrel direction held toward the tracked target for a moment after it
   *  slips off the lane, so a marginal target doesn't swing the turret
   *  back and forth between it and the path. */
  private aimHoldDir: Dir | null = null;
  private aimHoldUntil = 0;
  /** When each enemy bullet was first seen: a bullet younger than the
   *  profile's reaction time hasn't been noticed yet. */
  private bulletSeenAt = new Map<number, number>();

  // Stuck detection: if the tank barely moves for half a second despite
  // trying to, pursue()'s rigid path-following has wedged it against a
  // corner or another tank — break out with a random passable direction
  // instead of pushing into the same wall forever.
  private stuckCheckT = 0;
  private lastCheckPos: { x: number; y: number } | null = null;
  private unstuckT = 0;
  private unstuckDir: Dir | null = null;
  /** Set for the tick when standing still is the *plan* — shooting a brick
   *  wall open, or chipping the enemy flag. Without this the stuck detector
   *  reads a bot doing its job as wedged and walks it away mid-demolition. */
  private holdingPosition = false;
  /** Which way the planned shot needed the barrel to point, so decide() can
   *  tell whether an evasive turn has just spoiled it. */
  private plannedAimDir: Dir | null = null;
  private preemptT = 0;
  private preemptCooldown = 0;
  private preemptDir: Dir | null = null;
  /** Group push (profile.groupPush): set once this attacker has gone in
   *  with the others, and kept until it dies. */
  private pushing = false;
  /** The enemy this bot has claimed to hunt on the team board. */
  private huntSlot: number | null = null;
  /** Goal adjustments that would dither if re-derived every tick — a
   *  firing position, a spot clear of teammates, a bush to wait in — are
   *  kept for a moment, keyed by what they were derived from. */
  private goalCache: { key: string; until: number; cell: CellPoint } | null = null;
  /** A step round a teammate in the way, held briefly. */
  private sidestepDir: Dir | null = null;
  private sidestepT = 0;
  /** Parked on purpose (waiting to push, in ambush): the stuck detector
   *  must not read it as wedged. */
  private waiting = false;
  private lastProbeAt = -Infinity;
  private spaceCache: { key: string; until: number; cell: CellPoint } | null = null;
  /** This tick's profile flag, for the static-shot planner. */
  private friendlyFireAware = false;
  /** The team's roles as of this tick, for the group-push quorum. */
  private roles: Map<number, Assignment> = new Map();

  constructor(private slot: number) {}

  /** The enemy slots this bot currently believes it knows the position of —
   *  i.e. what it has seen recently and not yet forgotten (SPEC §10.2). Read
   *  only; nothing in the game loop uses it, but it is the one honest way to
   *  observe perception from the outside (tests, and a debug overlay). */
  knownEnemySlots(): number[] {
    return [...this.memory.keys()];
  }

  decide(sim: Sim, roles: Map<number, Assignment>, difficulty: BotDifficulty): SeatInput {
    const tank = sim.tankBySlot(this.slot);
    const profile = BOT_PROFILE[difficulty];
    if (!tank.alive) {
      this.staged = false;
      this.pushing = false;
      if (profile.sharesIntel || profile.groupPush !== "off") {
        const board = teamBoard(sim, tank.team);
        board.staged.delete(this.slot);
        board.hunting.delete(this.slot);
      }
      return { dir: null, fire: false, mine: false };
    }
    this.assignment = roles.get(this.slot) ?? { role: "attack", lane: 0 };
    this.roles = roles;
    if (profile.groupPush === "column" && this.assignment.role === "attack") {
      // The whole attack goes up one flank: the lane of the team's first
      // attacker, so every attacker agrees on it without talking.
      const lead = [...roles].filter(([, a]) => a.role === "attack").map(([slot]) => slot).sort((a, b) => a - b)[0];
      this.assignment = { role: "attack", lane: roles.get(lead)?.lane ?? this.assignment.lane };
    }

    this.aimResampleT -= TICK_DT;
    if (this.aimResampleT <= 0) {
      this.aimResampleT = BOT_AIM_RESAMPLE_TIME;
      this.aimJitter = sim.rng.next();
    }
    this.updateMemory(sim, tank, profile.memory);
    if (profile.sharesIntel) this.exchangeIntel(sim, tank, profile);

    this.rescoreT -= TICK_DT;
    if (this.rescoreT <= 0) {
      this.rescoreT = profile.rescoreInterval;
      this.chooseAction(sim, tank, roles, profile);
    }

    // Plan the shot first: evasion only ever overrides where the tank
    // *drives*. Cancelling the shot as well (what this used to do) is what
    // made Hard strictly worse than Easy — a pre-emptive dodger spends most
    // of a busy match in the evade branch, so it never fired at all.
    const result = this.pursue(sim, tank, profile);
    const evadeDir = this.checkEvade(sim, tank, profile, result.fire);
    if (evadeDir !== null) {
      // Firing happens *after* movement in the same tick (sim.step), so a
      // tank that turns to dodge fires along the dodge, not along the shot
      // it lined up. Spend the bullet only if the two agree.
      if (result.fire && evadeDir !== this.plannedAimDir) result.fire = false;
      result.dir = evadeDir;
      this.holdingPosition = false;
    }
    if (result.fire && tank.fireCooldown <= 0) {
      this.nextShotAt = sim.time + profile.fireHesitation;
    }
    this.updateStuckState(sim, tank);
    if (this.unstuckT > 0 && this.unstuckDir !== null) {
      // Same rule as a dodge: the bullet leaves along the escape direction,
      // so the planned shot only goes if the two agree.
      return { dir: this.unstuckDir, fire: result.fire && this.unstuckDir === this.plannedAimDir, mine: result.mine };
    }
    return result;
  }

  private updateStuckState(sim: Sim, tank: TankState) {
    if (this.unstuckT > 0) {
      this.unstuckT -= TICK_DT;
      return;
    }
    if (this.holdingPosition || this.waiting) {
      // Standing still on purpose — restart the window so the moment the
      // wall falls we judge progress from there, not from before the shot.
      this.stuckCheckT = 0.5;
      this.lastCheckPos = { x: tank.x, y: tank.y };
      return;
    }
    this.stuckCheckT -= TICK_DT;
    if (this.stuckCheckT > 0) return;
    this.stuckCheckT = 0.5;

    const pos = { x: tank.x, y: tank.y };
    const last = this.lastCheckPos;
    this.lastCheckPos = pos;
    if (!last) return;

    const moved = Math.hypot(pos.x - last.x, pos.y - last.y);
    if (moved >= 6) return; // making real progress, nothing to fix

    const passable = CARDINALS.filter((d) => this.canStep(sim, tank, d));
    if (passable.length === 0) return;
    this.unstuckDir = passable[Math.floor(sim.rng.next() * passable.length)];
    this.unstuckT = 0.3 + sim.rng.next() * 0.4;
    this.path = null; // force a fresh path once the tank is free again
  }

  private canStep(sim: Sim, tank: TankState, d: Dir): boolean {
    const v = DIR_VECTOR[d];
    const nx = tank.x + v.x * CELL;
    const ny = tank.y + v.y * CELL;
    return sim.grid.footprintPassable(
      Math.floor(nx / CELL),
      Math.floor(ny / CELL),
      (a, c) => sim.grid.tankPassableCell(a, c),
    );
  }

  // --- perception (SPEC §10.2) --------------------------------------------

  private updateMemory(sim: Sim, tank: TankState, memorySeconds: number) {
    const me = tankCenter(tank);
    for (const enemy of sim.tanks) {
      if (!enemy.alive || enemy.team === tank.team) continue;
      const c = tankCenter(enemy);
      if (visionBlocked(sim, me.x, me.y, c.x, c.y)) continue;
      const prev = this.memory.get(enemy.slot);
      let vx = 0;
      let vy = 0;
      const dt = prev ? sim.time - prev.at : 0;
      if (prev && dt > 0 && dt < BOT_VELOCITY_SAMPLE_MAX_GAP) {
        // Exponential smoothing: a single tick's delta is mostly quantisation
        // noise, and an unsmoothed sample makes the lead jitter every frame.
        vx = prev.vx + (((c.x - prev.x) / dt) - prev.vx) * BOT_VELOCITY_SMOOTHING;
        vy = prev.vy + (((c.y - prev.y) / dt) - prev.vy) * BOT_VELOCITY_SMOOTHING;
      } else if (prev) {
        vx = prev.vx;
        vy = prev.vy;
      }
      this.memory.set(enemy.slot, { x: c.x, y: c.y, at: sim.time, vx, vy });
    }
    for (const [slot, m] of [...this.memory]) {
      const enemy = sim.tankBySlot(slot);
      // A confirmed kill clears the memory immediately — a player likewise
      // doesn't keep tracking a tank they just watched explode.
      if (!enemy?.alive || sim.time - m.at > memorySeconds) this.memory.delete(slot);
    }
  }

  /** Team call-outs (profile.sharesIntel): report what this bot can see
   *  right now, and take on board what teammates reported at least
   *  BOT_COMMS_DELAY ago. A heard sighting is a memory like any other — it
   *  decays from when it was *seen*, and it is never "visible", so nobody
   *  leads a shot on hearsay. */
  private exchangeIntel(sim: Sim, tank: TankState, profile: BotProfile) {
    for (const [slot, m] of this.memory) {
      if (m.at === sim.time) reportSighting(sim, tank.team, slot, m);
    }
    const board = teamBoard(sim, tank.team);
    for (const [slot, s] of [...board.sightings]) {
      // A kill clears the call-out: a tank that died and respawned is not
      // where anyone last saw it.
      if (!sim.tankBySlot(slot)?.alive) { board.sightings.delete(slot); continue; }
      if (sim.time - s.at < BOT_COMMS_DELAY || sim.time - s.at > profile.memory) continue;
      const own = this.memory.get(slot);
      if (!own || own.at < s.at) this.memory.set(slot, { ...s });
    }
  }

  /** The known enemy closing in on this bot, if any: within
   *  BOT_APPROACH_RANGE_CELLS and either seen just now or reported fresh. */
  private approachingEnemy(sim: Sim, tank: TankState): KnownEnemy | null {
    const me = tankCenter(tank);
    let best: (KnownEnemy & { d: number }) | null = null;
    for (const [slot, m] of this.memory) {
      if (sim.time - m.at > 1) continue;
      const d = Math.hypot(m.x - me.x, m.y - me.y);
      if (d > BOT_APPROACH_RANGE_CELLS * CELL) continue;
      if (!best || d < best.d) best = { slot, x: m.x, y: m.y, d };
    }
    return best;
  }

  /** Which known enemy to hunt, for a bot that coordinates (sharesIntel):
   *  the nearest one not already chased by BOT_MAX_HUNTERS teammates, with
   *  a lightly-hunted one preferred over a crowded one. Anything beyond
   *  engagement range is left to the role — a call-out from across the map
   *  is information, not an order to abandon your post. */
  private pickHuntTarget(sim: Sim, tank: TankState): KnownEnemy | null {
    const me = tankCenter(tank);
    let best: (KnownEnemy & { score: number }) | null = null;
    for (const [slot, m] of this.memory) {
      const d = Math.hypot(m.x - me.x, m.y - me.y) / CELL;
      if (d > BOT_ENGAGE_RANGE_CELLS) continue;
      const hunters = huntersOf(sim, tank.team, slot, this.slot);
      // Point-blank is everyone's business, claimed or not.
      if (hunters >= BOT_MAX_HUNTERS && d > 5) continue;
      const score = d + hunters * 3;
      if (!best || score < best.score) best = { slot, x: m.x, y: m.y, score };
    }
    return best;
  }

  private isVisible(sim: Sim, slot: number): boolean {
    const m = this.memory.get(slot);
    return m !== undefined && sim.time - m.at < TICK_DT * 1.5;
  }

  private nearestKnownEnemy(tank: TankState): { slot: number; x: number; y: number } | null {
    const me = tankCenter(tank);
    let best: { slot: number; x: number; y: number; d: number } | null = null;
    for (const [slot, m] of this.memory) {
      const d = Math.hypot(m.x - me.x, m.y - me.y);
      if (!best || d < best.d) best = { slot, x: m.x, y: m.y, d };
    }
    return best;
  }

  /** Known enemies in the order this profile would rather shoot them, per
   *  SPEC §10.3's target-selection rules. Easy tunnel-visions on whatever it
   *  locked onto first; Medium works outward from the nearest; Hard weighs
   *  how dangerous each one actually is.
   *
   *  It is a list rather than a single pick because the *preferred* target
   *  is usually not the one currently sitting in the barrel's lane — Hard
   *  used to fixate on the most dangerous enemy across the map and take no
   *  shot at all while a second one drove past its muzzle. */
  private orderedTargets(sim: Sim, tank: TankState, profile: BotProfile): KnownEnemy[] {
    const me = tankCenter(tank);
    const known: KnownEnemy[] = [...this.memory].map(([slot, m]) => ({ slot, x: m.x, y: m.y }));
    if (known.length === 0) return [];

    if (profile.targetPriority === "sticky") {
      const locked = this.aimingAt !== null ? known.find((k) => k.slot === this.aimingAt) : undefined;
      if (locked) return [locked];
    }

    if (profile.targetPriority !== "threat") {
      return known.sort(
        (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
      );
    }

    const ownFlag = cellCenter(sim.map.flags[tank.team].cx, sim.map.flags[tank.team].cy);
    const threat = (k: KnownEnemy): number => {
      const enemy = sim.tankBySlot(k.slot);
      if (!enemy?.alive) return -Infinity;
      const toMe = Math.hypot(k.x - me.x, k.y - me.y) / CELL;
      const toFlag = Math.hypot(k.x - ownFlag.x, k.y - ownFlag.y) / CELL;
      return (
        2 * enemy.star +
        (enemy.helmetT > 0 ? 1.5 : 0) +
        (enemy.speedT > 0 ? 1 : 0) +
        6 * Math.max(0, 1 - toFlag / 20) +
        3 * Math.max(0, 1 - toMe / 20)
      );
    };
    return known.sort((a, b) => threat(b) - threat(a));
  }

  // --- action selection (SPEC §10.1) --------------------------------------

  private chooseAction(sim: Sim, tank: TankState, roles: Map<number, Assignment>, profile: BotProfile) {
    const role = (roles.get(tank.slot) ?? this.assignment).role;
    const followRole = sim.rng.next() < profile.roleAdherence;
    const knownEnemy = profile.sharesIntel ? this.pickHuntTarget(sim, tank) : this.nearestKnownEnemy(tank);
    // A bot already going in on the flag keeps going: turning on every tank
    // that comes near cost the push more than the fights won (bot league).
    const approaching = profile.reactsToApproach && !this.pushing ? this.approachingEnemy(sim, tank) : null;
    const flagUnderThreat = this.flagThreatened(sim, tank.team);
    const losingLocally = this.localEnemyAdvantage(sim, tank) > 0;
    const teamCrippled = sim.rules.respawns[tank.team] <= 5;

    // Stick with the current plan for a beat. Several branches below are
    // probabilistic, and re-rolling them every rescore (6-10 times a second)
    // had bots flip-flopping between two goals on opposite sides of the map
    // and converging on neither — a bot would walk *past* a bonus it had
    // decided to fetch. Genuine emergencies still interrupt.
    this.actionHold -= profile.rescoreInterval;
    // An enemy closing in cuts a committed action short — but only one that
    // isn't already about fighting, or the dice below would re-roll a fight
    // several times a second.
    const meetApproach = approaching !== null && this.action !== "Hunt" && this.action !== "DefendFlag";
    const urgent = flagUnderThreat || meetApproach || (profile.retreatsWhenLosing && teamCrippled && losingLocally);
    if (this.actionHold > 0 && !urgent && this.actionStillViable(sim, tank, profile)) return;

    const previous = this.action;

    if (profile.retreatsWhenLosing && teamCrippled && losingLocally && sim.rng.next() < 0.6) {
      this.action = "Regroup";
    } else if (followRole && role === "defend") {
      this.action = "DefendFlag";
    } else if (approaching) {
      this.action = "Hunt";
      this.huntSlot = approaching.slot;
    } else if (flagUnderThreat && (followRole || sim.rng.next() < 0.5)) {
      this.action = "DefendFlag";
    } else if (knownEnemy && sim.rng.next() < 0.6) {
      this.action = "Hunt";
      this.huntSlot = knownEnemy.slot;
    } else if (profile.deniesBonuses && this.contestedBonus(sim, tank, profile)) {
      this.action = "Collect";
    } else if (this.bestBonus(sim, tank, profile) && sim.rng.next() < profile.bonusDetour) {
      this.action = "Collect";
    } else if (followRole && role === "midfield") {
      this.action = "Hold";
    } else {
      this.action = "AttackFlag";
    }
    if (profile.sharesIntel) {
      const board = teamBoard(sim, tank.team);
      if (this.action === "Hunt" && this.huntSlot !== null) board.hunting.set(this.slot, this.huntSlot);
      else board.hunting.delete(this.slot);
    }
    if (this.action !== previous) {
      // A bonus run is committed to until the bonus is actually gone:
      // abandoning one halfway across the map is strictly worse than either
      // fetching it or never starting.
      this.actionHold = this.action === "Collect" ? BOT_COLLECT_COMMIT_TIME : BOT_ACTION_COMMIT_TIME;
    }
    this.path = null;
    this.pathGoal = null;
  }

  /** Is the current action still worth finishing? An action whose target has
   *  evaporated (the bonus was taken, the enemy was forgotten) is dropped
   *  immediately rather than held. */
  private actionStillViable(sim: Sim, tank: TankState, profile: BotProfile): boolean {
    switch (this.action) {
      case "Collect": return this.bestBonus(sim, tank, profile) !== null;
      case "Hunt": return this.nearestKnownEnemy(tank) !== null;
      default: return true;
    }
  }

  private flagThreatened(sim: Sim, team: TeamId): boolean {
    const flag = sim.map.flags[team];
    const f = cellCenter(flag.cx, flag.cy);
    for (const t of sim.tanks) {
      if (!t.alive || t.team === team) continue;
      const c = tankCenter(t);
      if (Math.hypot(c.x - f.x, c.y - f.y) < 10 * CELL) return true;
    }
    return false;
  }

  private localEnemyAdvantage(sim: Sim, tank: TankState): number {
    const me = tankCenter(tank);
    let enemies = 0;
    let allies = 0;
    for (const t of sim.tanks) {
      if (!t.alive) continue;
      const c = tankCenter(t);
      if (Math.hypot(c.x - me.x, c.y - me.y) > 12 * CELL) continue;
      if (t.team === tank.team) allies++;
      else enemies++;
    }
    return enemies - allies;
  }

  /** How much this bonus is worth to *this* bot right now: a base value per
   *  kind (SPEC §10.3, Medium "values STAR and HELMET above the rest") over
   *  distance, with the team bonuses re-weighted by the situation for a
   *  profile that times them (Hard) — it won't walk across the map for a
   *  SHOVEL with nobody near our flag, but will race one during a push. */
  private bonusScore(sim: Sim, tank: TankState, b: BonusEntity, profile: BotProfile): number {
    const me = tankCenter(tank);
    const c = cellCenter(b.cx, b.cy);
    const distCells = Math.hypot(c.x - me.x, c.y - me.y) / CELL;
    let value = BOT_BONUS_VALUE[b.kind];

    if (b.kind === "SPEED" && tank.speedT > 0) value *= 0.3;
    if (b.kind === "HELMET" && tank.helmetT > 0) value *= 0.3;
    if (b.kind === "MINE" && !profile.usesMines) value *= 0.4;

    if (profile.timesTeamBonuses) {
      switch (b.kind) {
        case "GRENADE": {
          // Worth what its blast would catch now (SPEC §4.3: it lands on the
          // biggest enemy knot and takes half a team at most), and always
          // worth it with enemies on our flag.
          const caught = sim.grenadeTargetFor(tank.team, me)?.count ?? 0;
          value *= caught >= 2 || (caught >= 1 && this.flagThreatened(sim, tank.team)) ? 2 : caught >= 1 ? 0.8 : 0.3;
          break;
        }
        case "SHOVEL":
          value *= this.flagThreatened(sim, tank.team) ? 2.2 : 0.4;
          break;
        case "CLOCK":
          value *= this.localEnemyAdvantage(sim, tank) < 0 ? 2 : 0.6;
          break;
        default:
          break;
      }
    }
    return value / (1 + distCells / 6);
  }

  private bestBonus(sim: Sim, tank: TankState, profile: BotProfile): BonusEntity | null {
    let best: BonusEntity | null = null;
    let bestScore = 0;
    for (const b of sim.bonuses) {
      if (!nearestPassable(sim.grid, { cx: b.cx, cy: b.cy }, brickPathCost(profile), 2)) continue;
      const score = this.bonusScore(sim, tank, b, profile);
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  /** Hard-only: is an enemy also converging on the best bonus, worth
   *  denying even if we don't need it ourselves (SPEC §10.3 "denies")? */
  private contestedBonus(sim: Sim, tank: TankState, profile: BotProfile): boolean {
    const b = this.bestBonus(sim, tank, profile);
    if (!b) return false;
    const me = tankCenter(tank);
    const c = cellCenter(b.cx, b.cy);
    const myDist = Math.hypot(c.x - me.x, c.y - me.y);
    for (const [, m] of this.memory) {
      const theirDist = Math.hypot(m.x - c.x, m.y - c.y);
      // Only worth contesting if we can plausibly get there first-ish.
      if (theirDist < 10 * CELL && myDist < theirDist * 1.5) return true;
    }
    return false;
  }

  // --- evasion (utility spike, overrides the current action) --------------

  private checkEvade(sim: Sim, tank: TankState, profile: BotProfile, firingThisTick: boolean): Dir | null {
    const box = { x: tank.x, y: tank.y, w: TANK_SIZE, h: TANK_SIZE };
    const reactWindow = profile.preemptiveDodge ? 0.6 : profile.memory > 2 ? 0.35 : 0.12;

    const live = new Set<number>();
    for (const b of sim.bullets) {
      live.add(b.id);
      if (!this.bulletSeenAt.has(b.id)) this.bulletSeenAt.set(b.id, sim.time);
    }
    for (const id of this.bulletSeenAt.keys()) if (!live.has(id)) this.bulletSeenAt.delete(id);

    this.evadeT -= TICK_DT;
    if (this.evadeT > 0 && this.evadeDir !== null && this.canStep(sim, tank, this.evadeDir)) return this.evadeDir;
    this.evadeDir = null;

    // With friendly fire on, a teammate's bullet kills just the same.
    const dodgeFriendly = profile.friendlyFireAware && sim.settings.friendlyFire;
    for (const b of sim.bullets) {
      if (b.ownerSlot === tank.slot || (b.team === tank.team && !dodgeFriendly)) continue;
      // Not noticed yet — the reaction time applies to dodging too.
      if (sim.time - (this.bulletSeenAt.get(b.id) ?? sim.time) < profile.reactionDelay) continue;
      const v = DIR_VECTOR[b.dir];
      const t = v.x !== 0
        ? (box.x + box.w / 2 - b.x) / (v.x * b.speed)
        : (box.y + box.h / 2 - b.y) / (v.y * b.speed);
      if (!Number.isFinite(t) || t < 0 || t > reactWindow) continue;

      const futureX = b.x + v.x * b.speed * t;
      const futureY = b.y + v.y * b.speed * t;
      if (futureX < box.x - CELL || futureX > box.x + box.w + CELL) continue;
      if (futureY < box.y - CELL || futureY > box.y + box.h + CELL) continue;

      // Step off the line on the side we already lean toward — the short way
      // out, and the same answer tick after tick, so consecutive dodges
      // don't alternate sides.
      const c = tankCenter(tank);
      const perp: Dir[] = v.x !== 0
        ? (c.y < b.y ? [Dir.Up, Dir.Down] : [Dir.Down, Dir.Up])
        : (c.x < b.x ? [Dir.Left, Dir.Right] : [Dir.Right, Dir.Left]);
      for (const d of perp) {
        if (!this.canStep(sim, tank, d)) continue;
        this.evadeDir = d;
        this.evadeT = BOT_EVADE_COMMIT_TIME;
        return d;
      }
    }

    if (!profile.preemptiveDodge) return null;

    // Leaving a lane an enemy is aiming down, *before* it fires. Everything
    // here is about being selective and then committing: on a crowded map
    // somebody is pointing your way most of the time, and a bot that yields
    // every one of those lanes for a single tick at a time just jitters in
    // place and never gets a shot off. Measured head-to-head, the naive
    // version cost Hard about a fifth of its frags against Medium.
    this.preemptCooldown = Math.max(0, this.preemptCooldown - TICK_DT);
    if (this.preemptT > 0) {
      this.preemptT -= TICK_DT;
      if (this.preemptDir !== null && this.canStep(sim, tank, this.preemptDir)) return this.preemptDir;
      this.preemptT = 0;
    }
    if (firingThisTick || this.preemptCooldown > 0) return null;

    const mc = tankCenter(tank);
    for (const enemy of sim.tanks) {
      if (!enemy.alive || enemy.team === tank.team) continue;
      const axis = AXIS_FOR_DIR[enemy.dir];
      if (!axis) continue; // enemy facing diagonally — not this cardinal-only lane check's problem
      const aligned = axis === "x" ? Math.abs(enemy.y - tank.y) < TANK_SIZE : Math.abs(enemy.x - tank.x) < TANK_SIZE;
      if (!aligned) continue;
      const v = DIR_VECTOR[enemy.dir];
      const ahead = axis === "x" ? (tank.x - enemy.x) * v.x > 0 : (tank.y - enemy.y) * v.y > 0;
      if (!ahead) continue;
      // A tank with a bullet already in flight can't fire again until it
      // lands (sim.stepFiring), so its lane is momentarily harmless. This is
      // information a player has too — the bullet is right there on screen.
      if (enemy.star < 2 && sim.bullets.some((b) => b.ownerSlot === enemy.slot)) continue;
      const ec = tankCenter(enemy);
      if (Math.hypot(ec.x - mc.x, ec.y - mc.y) > BOT_PREEMPT_RANGE_CELLS * CELL) continue;
      if (shotObstruction(sim, ec.x, ec.y, mc.x, mc.y) !== "clear") continue;

      const perp: Dir[] = axis === "x" ? [Dir.Up, Dir.Down] : [Dir.Left, Dir.Right];
      for (const d of perp) {
        if (!this.canStep(sim, tank, d)) continue;
        this.preemptDir = d;
        this.preemptT = BOT_PREEMPT_COMMIT_TIME;
        this.preemptCooldown = BOT_PREEMPT_COMMIT_TIME + BOT_PREEMPT_REST_TIME;
        return d;
      }
    }
    return null;
  }

  // --- execution ------------------------------------------------------------

  private pursue(sim: Sim, tank: TankState, profile: BotProfile): SeatInput {
    this.holdingPosition = false;
    this.friendlyFireAware = profile.friendlyFireAware;
    const shot = this.planShot(sim, tank, profile);

    let goal = this.resolveGoalCell(sim, tank, profile);
    if (goal && profile.keepsSpacing) goal = this.spacedGoal(sim, tank, goal);
    let moveDir: Dir | null = null;
    if (goal) {
      const me = { cx: Math.floor(tankCenter(tank).x / CELL), cy: Math.floor(tankCenter(tank).y / CELL) };
      this.repathT -= TICK_DT;
      const goalChanged = !this.pathGoal || this.pathGoal.cx !== goal.cx || this.pathGoal.cy !== goal.cy;
      const exhausted = !this.path || this.path.length === 0;
      // Without the cooldown an unreachable goal re-ran a full 4000-node A*
      // every tick, for every bot.
      if (goalChanged || (exhausted && this.repathT <= 0)) {
        this.path = findPath(sim.grid, me, goal, { brickCost: brickPathCost(profile) });
        this.pathGoal = goal;
        this.repathT = 0.5;
      }

      if (this.path && this.path.length > 0) {
        const next = this.path[0];
        const targetPx = cellCenter(next.cx, next.cy);
        const center = tankCenter(tank);
        if (Math.hypot(targetPx.x - center.x, targetPx.y - center.y) < CELL / 2) {
          this.path.shift();
        }
        moveDir = this.followDir(targetPx.x - center.x, targetPx.y - center.y);
      }
    }
    this.lastMoveDir = moveDir;
    if (moveDir !== null && profile.keepsSpacing) moveDir = this.sidestep(sim, tank, moveDir);

    // Facing the shot wins over following the path: a bot that has to turn
    // to take a shot would otherwise never line up, and against a wall or a
    // flag "moving into it" is just standing still while shooting.
    this.plannedAimDir = shot.aimDir;
    return {
      dir: shot.aimDir ?? moveDir,
      fire: shot.fire,
      mine: this.considerMine(sim, tank, profile),
    };
  }

  /** Which way to drive toward a waypoint `dx, dy` away. Keeps last tick's
   *  direction while that axis still has distance to cover: re-picking the
   *  larger axis every tick zig-zagged any tank that was off both axes
   *  (Right, Down, Right, Down…) — the visible jitter. */
  private followDir(dx: number, dy: number): Dir {
    const last = this.lastMoveDir;
    if (last !== null && AXIS_FOR_DIR[last]) {
      const v = DIR_VECTOR[last];
      const along = v.x !== 0 ? dx * v.x : dy * v.y;
      if (along > BOT_PATH_AXIS_DONE_PX) return last;
    }
    return dirTowards(dx, dy);
  }

  private resolveGoalCell(sim: Sim, tank: TankState, profile: BotProfile): CellPoint | null {
    this.waiting = false;
    switch (this.action) {
      case "AttackFlag": {
        // Out along our own flank first, then in on the flag — otherwise
        // every attacker takes the same shortest route and the whole team
        // arrives down one side. Already past the staging line (having
        // chased someone up the map, say) counts as staged.
        const c = tankCenter(tank);
        if (!this.staged && progressAlong(sim, tank.team, c.x, c.y) >= BOT_ATTACK_STAGE_ALONG - 0.05) this.staged = true;
        if (!this.staged) {
          const stage = lanePoint(sim, tank.team, this.assignment.lane, BOT_ATTACK_STAGE_ALONG);
          if (Math.hypot((stage.cx + 0.5) * CELL - c.x, (stage.cy + 0.5) * CELL - c.y) < 2.5 * CELL) this.staged = true;
          else return stage;
        }
        if (profile.groupPush !== "off" && !this.pushing) {
          if (!this.pushCalled(sim, tank)) {
            // Staged, waiting for the others — in a bush near the staging
            // point if there is one.
            this.waiting = true;
            const stage = lanePoint(sim, tank.team, this.assignment.lane, BOT_ATTACK_STAGE_ALONG);
            return profile.ambushesFromForest ? this.ambushCell(sim, tank, stage) : stage;
          }
          this.pushing = true;
        }
        const enemyFlag = sim.map.flags[tank.team === "blue" ? "red" : "blue"];
        return { cx: enemyFlag.cx, cy: enemyFlag.cy };
      }
      case "Hold": {
        const c = tankCenter(tank);
        if (profile.ambushesFromForest) {
          // Holding the middle from a bush beats pacing up and down it: the
          // far end of the patrol, sat in cover.
          const post = lanePoint(sim, tank.team, this.assignment.lane, BOT_HOLD_ALONG[1]);
          const bush = this.ambushCell(sim, tank, post);
          if (sim.grid.tileAt(bush.cx, bush.cy) === Tile.Forest) { this.waiting = true; return bush; }
        }
        const at = lanePoint(sim, tank.team, this.assignment.lane, BOT_HOLD_ALONG[this.holdLeg]);
        if (Math.hypot((at.cx + 0.5) * CELL - c.x, (at.cy + 0.5) * CELL - c.y) < 1.5 * CELL) this.holdLeg = 1 - this.holdLeg;
        return at;
      }
      case "DefendFlag": {
        let known = this.nearestKnownEnemy(tank);
        if (known && profile.sharesIntel) {
          // A defender goes for what is near the flag, not for every
          // call-out on the map.
          const f = cellCenter(sim.map.flags[tank.team].cx, sim.map.flags[tank.team].cy);
          if (Math.hypot(known.x - f.x, known.y - f.y) > BOT_THREAT_RADIUS_CELLS * CELL) known = null;
        }
        if (known) {
          return profile.firingPositions
            ? this.firingPosition(sim, tank, known)
            : { cx: Math.floor(known.x / CELL), cy: Math.floor(known.y / CELL) };
        }
        // Defenders side by side in front of the flag, not stacked on one cell.
        const post = guardPoint(sim, tank.team, this.assignment.lane, BOT_GUARD_AHEAD_CELLS, BOT_GUARD_SPREAD_CELLS);
        if (!profile.ambushesFromForest) return post;
        this.waiting = true;
        return this.ambushCell(sim, tank, post);
      }
      case "Hunt": {
        const claimed = this.huntSlot !== null ? this.memory.get(this.huntSlot) : undefined;
        const known = claimed && this.huntSlot !== null
          ? { slot: this.huntSlot, x: claimed.x, y: claimed.y }
          : this.nearestKnownEnemy(tank);
        if (!known) { this.action = "AttackFlag"; return this.resolveGoalCell(sim, tank, profile); }
        if (profile.firingPositions) return this.firingPosition(sim, tank, known);
        return { cx: Math.floor(known.x / CELL), cy: Math.floor(known.y / CELL) };
      }
      case "Collect": {
        const b = this.bestBonus(sim, tank, profile);
        if (!b) { this.action = "AttackFlag"; return this.resolveGoalCell(sim, tank, profile); }
        return { cx: b.cx, cy: b.cy };
      }
      case "Regroup": {
        const ally = sim.tanks.find((t) => t.alive && t.team === tank.team && t.slot !== tank.slot);
        const own = sim.map.flags[tank.team];
        if (ally) return { cx: Math.floor(tankCenter(ally).x / CELL), cy: Math.floor(tankCenter(ally).y / CELL) };
        return { cx: own.cx, cy: own.cy };
      }
    }
  }

  /** Group push: has the attack been called? It is once BOT_PUSH_QUORUM of
   *  the team's living attackers are staged (at least two, unless only one
   *  is left), or the first of them has waited BOT_PUSH_MAX_WAIT — and a
   *  push called a moment ago is joined by whoever stages after it rather
   *  than waiting for a quorum all over again. */
  private pushCalled(sim: Sim, tank: TankState): boolean {
    const board = teamBoard(sim, tank.team);
    if (!board.staged.has(this.slot)) board.staged.set(this.slot, sim.time);
    if (sim.time - board.pushAt < BOT_PUSH_JOIN_WINDOW) return true;
    let staged = 0;
    let firstAt = Infinity;
    for (const [slot, at] of [...board.staged]) {
      if (!sim.tankBySlot(slot)?.alive) { board.staged.delete(slot); continue; }
      staged++;
      firstAt = Math.min(firstAt, at);
    }
    let attackers = 0;
    for (const [slot, a] of this.roles) if (a.role === "attack" && sim.tankBySlot(slot)?.alive) attackers++;
    attackers = Math.max(attackers, staged);
    const quorum = staged >= Math.ceil(attackers * BOT_PUSH_QUORUM) && (staged >= 2 || attackers <= 1);
    if (!quorum && sim.time - firstAt < BOT_PUSH_MAX_WAIT) return false;
    board.pushAt = sim.time;
    board.staged.clear();
    return true;
  }

  /** A forest cell within BOT_AMBUSH_RADIUS_CELLS of `post` to wait in,
   *  nearest the post first; the post itself if there is none. */
  private ambushCell(sim: Sim, tank: TankState, post: CellPoint): CellPoint {
    return this.cached(sim, `ambush:${post.cx},${post.cy}`, 2, () => {
      let best: CellPoint | null = null;
      let bestD = Infinity;
      const r = BOT_AMBUSH_RADIUS_CELLS;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const cx = post.cx + dx;
          const cy = post.cy + dy;
          if (sim.grid.tileAt(cx, cy) !== Tile.Forest) continue;
          if (this.allyNear(sim, tank, cx, cy, BOT_SPACING_CELLS)) continue;
          const d = Math.hypot(dx, dy);
          if (d < bestD) { bestD = d; best = { cx, cy }; }
        }
      }
      return best ?? post;
    });
  }

  /** Where to shoot `target` from: a cell in line with it (same row or
   *  column, a clear bullet lane between) two to seven cells out, as close
   *  to us as possible — preferring one the enemy's barrel isn't pointing
   *  at, one in forest, and one no teammate is already standing on. Beats
   *  driving at the enemy's own cell, which walks into its lane head-on. */
  private firingPosition(sim: Sim, tank: TankState, target: KnownEnemy): CellPoint {
    const tcx = Math.floor(target.x / CELL);
    const tcy = Math.floor(target.y / CELL);
    return this.cached(sim, `fire:${target.slot}:${tcx},${tcy}`, 0.6, () => {
      const me = tankCenter(tank);
      const mcx = Math.floor(me.x / CELL);
      const mcy = Math.floor(me.y / CELL);
      const enemy = sim.tankBySlot(target.slot);
      let best: CellPoint = { cx: tcx, cy: tcy };
      let bestScore = Infinity;
      for (const d of CARDINALS) {
        const v = DIR_VECTOR[d];
        for (let k = 1; k <= 7; k++) {
          const cx = tcx + v.x * k;
          const cy = tcy + v.y * k;
          if (!sim.grid.bulletPassableCell(cx, cy)) break;
          if (k < 2 || !sim.grid.tankPassableCell(cx, cy)) continue;
          let score = Math.abs(cx - mcx) + Math.abs(cy - mcy);
          if (enemy?.dir === d) score += 6;
          if (sim.grid.tileAt(cx, cy) === Tile.Forest) score -= 2;
          if (this.allyNear(sim, tank, cx, cy, 1)) score += 4;
          if (score < bestScore) { bestScore = score; best = { cx, cy }; }
        }
      }
      return best;
    });
  }

  /** `goal`, or — if a teammate nearer to it is already standing on it —
   *  the nearest free cell two or three cells off, so two bots don't queue
   *  for one spot (profile.keepsSpacing). */
  private spacedGoal(sim: Sim, tank: TankState, goal: CellPoint): CellPoint {
    const g = cellCenter(goal.cx, goal.cy);
    const me = tankCenter(tank);
    const myD = Math.hypot(g.x - me.x, g.y - me.y);
    const taken = sim.tanks.some((a) => {
      if (!a.alive || a.team !== tank.team || a.slot === tank.slot) return false;
      const c = tankCenter(a);
      const d = Math.hypot(c.x - g.x, c.y - g.y);
      return d < BOT_SPACING_CELLS * CELL && d < myD;
    });
    if (!taken) return goal;
    const key = `space:${goal.cx},${goal.cy}`;
    if (this.spaceCache && this.spaceCache.key === key && sim.time < this.spaceCache.until) return this.spaceCache.cell;
    let best = goal;
    let bestD = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (ring < 2) continue;
        const cx = goal.cx + dx;
        const cy = goal.cy + dy;
        if (!sim.grid.tankPassableCell(cx, cy)) continue;
        if (this.allyNear(sim, tank, cx, cy, BOT_SPACING_CELLS)) continue;
        const c = cellCenter(cx, cy);
        const d = Math.hypot(c.x - me.x, c.y - me.y) + ring * CELL;
        if (d < bestD) { bestD = d; best = { cx, cy }; }
      }
    }
    this.spaceCache = { key, until: sim.time + 1, cell: best };
    return best;
  }

  private allyNear(sim: Sim, tank: TankState, cx: number, cy: number, cellsRadius: number): boolean {
    const p = cellCenter(cx, cy);
    return sim.tanks.some((a) => {
      if (!a.alive || a.team !== tank.team || a.slot === tank.slot) return false;
      const c = tankCenter(a);
      return Math.hypot(c.x - p.x, c.y - p.y) < cellsRadius * CELL;
    });
  }

  private cached(sim: Sim, key: string, seconds: number, compute: () => CellPoint): CellPoint {
    if (this.goalCache && this.goalCache.key === key && sim.time < this.goalCache.until) return this.goalCache.cell;
    const cell = compute();
    this.goalCache = { key, until: sim.time + seconds, cell };
    return cell;
  }

  /** A teammate standing in the way of the next step: step round it for a
   *  beat instead of shoving into its back (profile.keepsSpacing). */
  private sidestep(sim: Sim, tank: TankState, moveDir: Dir): Dir {
    this.sidestepT -= TICK_DT;
    if (this.sidestepT > 0 && this.sidestepDir !== null && this.canStep(sim, tank, this.sidestepDir)) return this.sidestepDir;
    this.sidestepDir = null;
    const me = tankCenter(tank);
    const v = DIR_VECTOR[moveDir];
    const blocked = sim.tanks.some((a) => {
      if (!a.alive || a.team !== tank.team || a.slot === tank.slot) return false;
      const c = tankCenter(a);
      const along = (c.x - me.x) * v.x + (c.y - me.y) * v.y;
      const across = v.x !== 0 ? Math.abs(c.y - me.y) : Math.abs(c.x - me.x);
      return along > 0 && along < 1.3 * CELL && across < 0.9 * CELL;
    });
    if (!blocked) return moveDir;
    const perp: Dir[] = v.x !== 0 ? [Dir.Up, Dir.Down] : [Dir.Left, Dir.Right];
    if (this.slot % 2 === 1) perp.reverse();
    for (const d of perp) {
      if (!this.canStep(sim, tank, d)) continue;
      this.sidestepDir = d;
      this.sidestepT = 0.4;
      return d;
    }
    return moveDir;
  }

  /** How far a bullet fired from (x, y) along `dir` flies before something
   *  stops it — brick, steel, a flag or the edge of the map. */
  private bulletReach(sim: Sim, x: number, y: number, dir: Dir): number {
    const v = DIR_VECTOR[dir];
    for (let d = CELL / 2; ; d += CELL / 2) {
      const cx = Math.floor((x + v.x * d) / CELL);
      const cy = Math.floor((y + v.y * d) / CELL);
      if (!sim.grid.bulletPassableCell(cx, cy)) return d;
    }
  }

  /** Would a shot along `dir` risk a teammate, with friendly fire on
   *  (profile.friendlyFireAware)? Checked over the bullet's whole flight,
   *  not just up to the target — a target that dodges leaves the bullet
   *  flying on. A teammate counts if it is in the lane now, or will be by
   *  the time the bullet gets there should it keep driving the way it
   *  faces: most teamkills measured in the league were a teammate crossing
   *  a lane that was clear when the trigger was pulled. With friendly fire
   *  off bullets pass through teammates, so nothing is ever in the way. */
  private laneHasAlly(sim: Sim, tank: TankState, dir: Dir): boolean {
    if (!sim.settings.friendlyFire) return false;
    const me = tankCenter(tank);
    const v = DIR_VECTOR[dir];
    const reach = this.bulletReach(sim, me.x, me.y, dir);
    const bulletSpeed = tank.star >= 1 ? BULLET_SPEED_STAR1 : BULLET_SPEED_BASE;
    const inLane = (x: number, y: number) => {
      const along = (x - me.x) * v.x + (y - me.y) * v.y;
      const across = v.x !== 0 ? Math.abs(y - me.y) : Math.abs(x - me.x);
      return along > -TANK_HITBOX / 2 && along - TANK_HITBOX / 2 < reach && across < TANK_HITBOX / 2 + 4;
    };
    return sim.tanks.some((a) => {
      if (!a.alive || a.team !== tank.team || a.slot === tank.slot) return false;
      const c = tankCenter(a);
      if (inLane(c.x, c.y)) return true;
      const along = Math.max(0, (c.x - me.x) * v.x + (c.y - me.y) * v.y);
      const t = along / bulletSpeed;
      const av = DIR_VECTOR[a.dir];
      // Sampled along the way: a fast crossing can be in and out of the
      // lane between "now" and "when the bullet arrives".
      for (const f of [0.5, 1]) {
        if (inLane(c.x + av.x * TANK_SPEED * t * f, c.y + av.y * TANK_SPEED * t * f)) return true;
      }
      return false;
    });
  }

  /** Recon by fire (profile.probesForest): a bullet into a bush an enemy
   *  may be hiding in, when there is nothing better to shoot. Only a bush
   *  already in one of our lanes — a bot doesn't drive around to line one
   *  up — and never one a teammate is sitting in. */
  private planProbeShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } | null {
    if (profile.probesForest === "off" || sim.time - this.lastProbeAt < BOT_PROBE_INTERVAL) return null;
    if (tank.fireCooldown > 0 || sim.bullets.some((b) => b.ownerSlot === tank.slot)) return null;
    const me = tankCenter(tank);
    // Where an enemy we know of went out of sight — the bushes round there.
    const suspects = [...this.memory].filter(([slot]) => !this.isVisible(sim, slot)).map(([, m]) => m);
    for (const dir of CARDINALS) {
      // Sweeping fires only straight ahead; turning for a hunch would steer
      // the tank off its route.
      if (suspects.length === 0 && (profile.probesForest !== "sweep" || dir !== tank.dir)) continue;
      const v = DIR_VECTOR[dir];
      const reach = Math.min(this.bulletReach(sim, me.x, me.y, dir), BOT_PROBE_RANGE_CELLS * CELL);
      for (let d = CELL; d < reach; d += CELL) {
        const cx = Math.floor((me.x + v.x * d) / CELL);
        const cy = Math.floor((me.y + v.y * d) / CELL);
        if (sim.grid.tileAt(cx, cy) !== Tile.Forest) continue;
        const suspected = suspects.some((m) => Math.hypot(m.x - (cx + 0.5) * CELL, m.y - (cy + 0.5) * CELL) < 2 * CELL);
        if (!suspected && (profile.probesForest !== "sweep" || dir !== tank.dir)) continue;
        if (this.allyNear(sim, tank, cx, cy, 1) || this.laneHasAlly(sim, tank, dir)) break;
        if (tank.dir !== dir) return { fire: false, aimDir: dir };
        this.lastProbeAt = sim.time;
        return { fire: true, aimDir: dir };
      }
    }
    return null;
  }

  /** Decides what to shoot at this tick and which way the barrel has to
   *  point for it, in priority order: an enemy tank, then the enemy flag,
   *  then a brick wall in the way of our own route. */
  private planShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } {
    const enemyShot = this.planEnemyShot(sim, tank, profile);
    if (enemyShot) return enemyShot;

    const flagShot = this.planFlagShot(sim, tank, profile);
    if (flagShot) return flagShot;

    const brickShot = this.planBrickShot(sim, tank, profile);
    if (brickShot.aimDir !== null) return brickShot;
    return this.planProbeShot(sim, tank, profile) ?? brickShot;
  }

  private planEnemyShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } | null {
    const candidates = this.orderedTargets(sim, tank, profile);
    if (candidates.length === 0) { this.aimingAt = null; return null; }

    const center = tankCenter(tank);
    // Keep whoever we are already tracking at the front of the queue while
    // it is still a legal shot: swapping targets every tick would keep
    // restarting the reaction timer, and the bot would never actually fire.
    const ordered = this.aimingAt === null
      ? candidates
      : [
          ...candidates.filter((c) => c.slot === this.aimingAt),
          ...candidates.filter((c) => c.slot !== this.aimingAt),
        ];

    for (const target of ordered) {
      const range = Math.hypot(target.x - center.x, target.y - center.y) / CELL;
      // A shot from the far side of the map spends most of a second in
      // flight and almost never lands; it just burns the single bullet a
      // non-upgraded tank is allowed to have out at a time.
      if (range > BOT_ENGAGE_RANGE_CELLS) continue;

      let targetX = target.x;
      let targetY = target.y;
      // Lead on the velocity we have watched this tank travel at, and only
      // while it is actually in sight — against a remembered position we
      // shoot at where it was, like a player would.
      const seen = this.memory.get(target.slot);
      if (profile.leadFactor > 0 && seen && this.isVisible(sim, target.slot)) {
        const bulletSpeed = tank.star >= 1 ? BULLET_SPEED_STAR1 : BULLET_SPEED_BASE;
        const travelTime = (range * CELL) / bulletSpeed;
        targetX += seen.vx * travelTime * profile.leadFactor;
        targetY += seen.vy * travelTime * profile.leadFactor;
      }

      const hold = target.slot === this.aimingAt ? BOT_AIM_HOLD_MULT : 1;
      const wantDir = this.laneDir(center.x, center.y, targetX, targetY, profile, hold);
      if (wantDir === null) continue;

      const block = shotObstruction(sim, center.x, center.y, target.x, target.y);
      if (block === "solid") continue;
      // Only Hard spends ammunition punching through a wall at someone it
      // merely knows is behind it (SPEC §10.3 Hard, "fires through brick").
      if (block === "brick" && profile.shootsBrickToPath !== "proactive") continue;
      if (profile.friendlyFireAware && this.laneHasAlly(sim, tank, wantDir)) continue;

      if (this.aimingAt !== target.slot) {
        this.aimingAt = target.slot;
        this.aimingSince = sim.time;
      }
      this.aimHoldDir = wantDir;
      this.aimHoldUntil = sim.time + BOT_AIM_HOLD_TIME;
      if (tank.dir !== wantDir) return { fire: false, aimDir: wantDir };
      if (sim.time - this.aimingSince < profile.reactionDelay) return { fire: false, aimDir: wantDir };
      if (sim.time < this.nextShotAt) return { fire: false, aimDir: wantDir };
      return { fire: true, aimDir: wantDir };
    }
    if (this.aimHoldDir !== null && sim.time < this.aimHoldUntil && this.aimingAt !== null && this.memory.has(this.aimingAt)) {
      return { fire: false, aimDir: this.aimHoldDir };
    }
    this.aimHoldDir = null;
    return null;
  }

  private planFlagShot(sim: Sim, tank: TankState, _profile: BotProfile): { fire: boolean; aimDir: Dir | null } | null {
    const enemy: TeamId = tank.team === "blue" ? "red" : "blue";
    if (!sim.rules.flagAlive[enemy]) return null;
    const flag = sim.map.flags[enemy];
    const f = cellCenter(flag.cx, flag.cy);
    // Anything but steel is worth punching through to reach a flag, from
    // close up (planStaticShot) — every profile, a beginner included.
    return this.planStaticShot(sim, tank, f.x, f.y, true);
  }

  /** Shooting something that doesn't move — a flag, or a brick wall in the
   *  way. Unlike an enemy, these need the tank to actually *line up*: path
   *  following only ever gets within half a cell of a lane (it advances to
   *  the next waypoint before reaching the current one), which is far wider
   *  than any profile's firing tolerance. So the bot steps sideways onto the
   *  lane first, then faces the target and fires. Returns null when the
   *  target isn't within a cell of a lane at all — that's the pathfinder's
   *  job, not this one's. */
  private planStaticShot(
    sim: Sim,
    tank: TankState,
    tx: number,
    ty: number,
    allowBrick: boolean,
  ): { fire: boolean; aimDir: Dir | null } | null {
    const center = tankCenter(tank);
    const dx = tx - center.x;
    const dy = ty - center.y;
    const shootDir = dirTowards(dx, dy);
    const axis = AXIS_FOR_DIR[shootDir]!;
    const cross = axis === "x" ? dy : dx; // px off the firing lane
    if (Math.abs(cross) > CELL) return null;
    const distCells = Math.hypot(dx, dy) / CELL;

    const block = shotObstruction(sim, center.x, center.y, tx, ty);
    if (block === "solid") return null;
    // Punching a wall down is only a plan from close up; from across the map
    // it is just a long shot at a random brick.
    if (block === "brick" && (!allowBrick || distCells > BOT_DEMOLITION_RANGE_CELLS)) return null;
    // Sidestepping onto a lane is a short-range manoeuvre too. Without this
    // a bot 20 cells away would shuffle sideways toward a lane whose
    // obstruction flips every step, and stall between the two behaviours.
    if (Math.abs(cross) > BOT_LANE_TOLERANCE_PX && distCells > BOT_LANE_STEP_RANGE_CELLS) return null;

    this.holdingPosition = true;
    if (Math.abs(cross) > BOT_LANE_TOLERANCE_PX) {
      const side = axis === "x"
        ? (cross > 0 ? Dir.Down : Dir.Up)
        : (cross > 0 ? Dir.Right : Dir.Left);
      return { fire: false, aimDir: side };
    }
    // A static target needs no reaction delay — but the between-shots
    // hesitation still applies, which is what keeps Easy slow at demolition.
    if (tank.dir !== shootDir) return { fire: false, aimDir: shootDir };
    if (sim.time < this.nextShotAt) return { fire: false, aimDir: shootDir };
    if (this.friendlyFireAware && this.laneHasAlly(sim, tank, shootDir)) return { fire: false, aimDir: shootDir };
    return { fire: true, aimDir: shootDir };
  }

  /** The route A* handed us runs through a brick cell — shoot it open
   *  instead of grinding against it (SPEC §10.3 "Shoots brick to path"). An
   *  Easy bot's route only does that when there is no sensible way round
   *  (brickPathCost). */
  private planBrickShot(sim: Sim, tank: TankState, _profile: BotProfile): { fire: boolean; aimDir: Dir | null } {
    const none = { fire: false, aimDir: null };
    if (!this.path || this.path.length === 0) return none;

    const center = tankCenter(tank);
    const mc = { cx: Math.floor(center.x / CELL), cy: Math.floor(center.y / CELL) };
    // Only the next couple of steps, and only ones still on our own row or
    // column — shooting a wall three corners away opens nothing for us.
    for (const next of this.path.slice(0, 2)) {
      if (sim.grid.tileAt(next.cx, next.cy) !== Tile.Brick) continue;
      if (next.cx !== mc.cx && next.cy !== mc.cy) continue;
      const t = cellCenter(next.cx, next.cy);
      const shot = this.planStaticShot(sim, tank, t.x, t.y, true);
      if (shot) return shot;
    }
    return none;
  }

  /** The cardinal direction to shoot in to hit (tx,ty) from (cx,cy), or null
   *  if the target is too far off that lane for this profile's tolerance.
   *  The aim error is applied here, so a sloppy profile both misses lanes it
   *  could have taken and takes ones it shouldn't. */
  private laneDir(cx: number, cy: number, tx: number, ty: number, profile: BotProfile, hold = 1): Dir | null {
    const dx = tx - cx;
    const dy = ty - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const jitter = (this.aimJitter - 0.5) * 2 * profile.aimErrorDeg * (Math.PI / 180) * dist;
    // A bullet always travels exactly along tank.dir, so what decides a hit
    // is the lateral offset in px, not an angle — half a hitbox wide, at any
    // range. The angular tolerance widens that window for a sloppy profile;
    // it must never narrow it below a shot that would actually connect, or
    // the *tightest* profile ends up passing up its free kills (which is
    // precisely why Hard used to lose to Easy).
    const toleranceDist = hold * Math.max(
      TANK_HITBOX / 2,
      dist * Math.tan((profile.fireToleranceDeg * Math.PI) / 180),
    );

    const wantDir = dirTowards(dx, dy);
    const axis = AXIS_FOR_DIR[wantDir];
    const lateral = axis === "x" ? dy : dx;
    if (Math.abs(lateral + jitter) >= toleranceDist) return null;
    return wantDir;
  }

  private considerMine(sim: Sim, tank: TankState, profile: BotProfile): boolean {
    if (!profile.usesMines || tank.mines <= 0) return false;
    this.mineCooldown -= TICK_DT;
    if (this.mineCooldown > 0) return false;
    if (this.action !== "DefendFlag") return false;

    const center = tankCenter(tank);
    const flag = sim.map.flags[tank.team];
    const f = cellCenter(flag.cx, flag.cy);
    const nearOwnFlag = Math.hypot(center.x - f.x, center.y - f.y) < 8 * CELL;
    // A cell with at most two ways out is a corridor or a corner — somewhere
    // an enemy has to drive through rather than around.
    const atChokepoint = CARDINALS.filter((d) => this.canStep(sim, tank, d)).length <= 2;
    if (profile.minesAtChokepointsOnly ? !atChokepoint : !nearOwnFlag && !atChokepoint) return false;

    this.mineCooldown = 2;
    return true;
  }
}

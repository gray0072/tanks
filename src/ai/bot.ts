// Utility AI — SPEC §10. One BotController per bot slot. Runs only on the
// host (bots never exist on a client, SPEC §9.1), fed the same Sim seen by
// stepFiring/stepMovement so it can only act on information a player could
// plausibly have (SPEC §10.2 "Fair perception").

import type { Sim, SeatInput } from "../world/sim";
import type { TankState } from "../world/tank";
import { tankCenter } from "../world/tank";
import { Tile } from "../world/grid";
import type { BonusEntity, BonusKind } from "../world/bonus";
import { findPath, nearestPassable, type CellPoint } from "./pathfinder";
import type { Role } from "./teamPlan";
import { Dir, DIR_VECTOR } from "../util/math";
import {
  CELL,
  TANK_SIZE,
  TANK_HITBOX,
  BULLET_SPEED_BASE,
  BULLET_SPEED_STAR1,
  TICK_DT,
  BOT_PROFILE,
  type BotDifficulty,
  type BotProfile,
  type TeamId,
} from "../game/config";

type Action = "AttackFlag" | "DefendFlag" | "Hunt" | "Collect" | "Regroup";

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

/** How close to a firing lane counts as lined up, in px. One movement step
 *  at TANK_SPEED is ~2.8px, so anything tighter than this just oscillates. */
const LANE_TOLERANCE_PX = 3;

/** How close a bot has to be before shooting *through* brick at a static
 *  target, and before it will shuffle sideways to line one up. */
const DEMOLITION_RANGE_CELLS = 4;
const LANE_STEP_RANGE_CELLS = 6;

/** How close an enemy has to be before its firing lane is worth vacating
 *  pre-emptively (SPEC §10.3 Hard, "leaves enemy firing lanes before a shot
 *  is fired"). */
const PREEMPT_RANGE_CELLS = 10;
/** Once a bot decides to vacate a lane it keeps going for this long, then
 *  refuses to do it again for a moment — otherwise it re-decides every tick
 *  and never actually leaves. */
const PREEMPT_COMMIT_TIME = 0.25; // s
const PREEMPT_REST_TIME = 0.5; // s

/** Beyond this the bot does not bother shooting at a tank at all. */
const ENGAGE_RANGE_CELLS = 12;

/** How long a bot sticks with a chosen action before re-rolling it. */
const ACTION_COMMIT_TIME = 1.5; // s
const COLLECT_COMMIT_TIME = 8; // s

/** Velocity tracking for target leading: samples further apart than this are
 *  a re-acquisition, not motion, and the smoothing factor damps the
 *  per-tick quantisation noise. */
const VELOCITY_SAMPLE_MAX_GAP = 0.5; // s
const VELOCITY_SMOOTHING = 0.25;

/** Baseline desirability of each bonus, before distance. STAR and HELMET
 *  lead for a personal pickup (SPEC §10.3 Medium, "values STAR and HELMET
 *  above the rest"); the team bonuses are re-weighted by the situation for a
 *  profile that times them. */
const BONUS_VALUE: Record<BonusKind, number> = {
  STAR: 3,
  HELMET: 2.5,
  TICKET: 1.8,
  SPEED: 1.6,
  CLOCK: 1.6,
  SHOVEL: 1.4,
  GRENADE: 2.2,
  MINE: 1.2,
};

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
 *  "Shoots brick to path"). Infinity for a bot that never shoots brick, so
 *  it paths *around* instead of walking into a wall it will never open —
 *  otherwise A*'s cheap brick route wedges it against the wall for good. */
function brickPathCost(profile: BotProfile): number {
  switch (profile.shootsBrickToPath) {
    case "never": return Infinity;
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

  constructor(private slot: number) {}

  /** The enemy slots this bot currently believes it knows the position of —
   *  i.e. what it has seen recently and not yet forgotten (SPEC §10.2). Read
   *  only; nothing in the game loop uses it, but it is the one honest way to
   *  observe perception from the outside (tests, and a debug overlay). */
  knownEnemySlots(): number[] {
    return [...this.memory.keys()];
  }

  decide(sim: Sim, roles: Map<number, Role>, difficulty: BotDifficulty): SeatInput {
    const tank = sim.tankBySlot(this.slot);
    const profile = BOT_PROFILE[difficulty];
    if (!tank.alive) return { dir: null, fire: false, mine: false };

    this.aimJitter = sim.rng.next();
    this.updateMemory(sim, tank, profile.memory);

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
      return { dir: this.unstuckDir, fire: result.fire, mine: result.mine };
    }
    return result;
  }

  private updateStuckState(sim: Sim, tank: TankState) {
    if (this.unstuckT > 0) {
      this.unstuckT -= TICK_DT;
      return;
    }
    if (this.holdingPosition) {
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
      if (prev && dt > 0 && dt < VELOCITY_SAMPLE_MAX_GAP) {
        // Exponential smoothing: a single tick's delta is mostly quantisation
        // noise, and an unsmoothed sample makes the lead jitter every frame.
        vx = prev.vx + (((c.x - prev.x) / dt) - prev.vx) * VELOCITY_SMOOTHING;
        vy = prev.vy + (((c.y - prev.y) / dt) - prev.vy) * VELOCITY_SMOOTHING;
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

  private chooseAction(sim: Sim, tank: TankState, roles: Map<number, Role>, profile: BotProfile) {
    const role = roles.get(tank.slot) ?? "attack";
    const followRole = sim.rng.next() < profile.roleAdherence;
    const knownEnemy = this.nearestKnownEnemy(tank);
    const flagUnderThreat = this.flagThreatened(sim, tank.team);
    const losingLocally = this.localEnemyAdvantage(sim, tank) > 0;
    const teamCrippled = sim.rules.tickets[tank.team] <= 5;

    // Stick with the current plan for a beat. Several branches below are
    // probabilistic, and re-rolling them every rescore (6-10 times a second)
    // had bots flip-flopping between two goals on opposite sides of the map
    // and converging on neither — a bot would walk *past* a bonus it had
    // decided to fetch. Genuine emergencies still interrupt.
    this.actionHold -= profile.rescoreInterval;
    const urgent = flagUnderThreat || (profile.retreatsWhenLosing && teamCrippled && losingLocally);
    if (this.actionHold > 0 && !urgent && this.actionStillViable(sim, tank, profile)) return;

    const previous = this.action;

    if (profile.retreatsWhenLosing && teamCrippled && losingLocally && sim.rng.next() < 0.6) {
      this.action = "Regroup";
    } else if (followRole && role === "defend") {
      this.action = "DefendFlag";
    } else if (flagUnderThreat && (followRole || sim.rng.next() < 0.5)) {
      this.action = "DefendFlag";
    } else if (knownEnemy && sim.rng.next() < 0.6) {
      this.action = "Hunt";
    } else if (profile.deniesBonuses && this.contestedBonus(sim, tank, profile)) {
      this.action = "Collect";
    } else if (this.bestBonus(sim, tank, profile) && sim.rng.next() < profile.bonusDetour) {
      this.action = "Collect";
    } else {
      this.action = "AttackFlag";
    }
    if (this.action !== previous) {
      // A bonus run is committed to until the bonus is actually gone:
      // abandoning one halfway across the map is strictly worse than either
      // fetching it or never starting.
      this.actionHold = this.action === "Collect" ? COLLECT_COMMIT_TIME : ACTION_COMMIT_TIME;
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
    let value = BONUS_VALUE[b.kind];

    if (b.kind === "SPEED" && tank.speedT > 0) value *= 0.3;
    if (b.kind === "HELMET" && tank.helmetT > 0) value *= 0.3;
    if (b.kind === "MINE" && !profile.usesMines) value *= 0.4;

    if (profile.timesTeamBonuses) {
      const livingEnemies = sim.tanks.filter((t) => t.alive && t.team !== tank.team).length;
      switch (b.kind) {
        case "GRENADE":
          value *= livingEnemies >= 3 || !sim.rules.flagAlive[tank.team] ? 2 : 0.5;
          break;
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

    for (const b of sim.bullets) {
      if (b.team === tank.team) continue;
      const v = DIR_VECTOR[b.dir];
      const t = v.x !== 0
        ? (box.x + box.w / 2 - b.x) / (v.x * b.speed)
        : (box.y + box.h / 2 - b.y) / (v.y * b.speed);
      if (!Number.isFinite(t) || t < 0 || t > reactWindow) continue;
      // Easy often reacts too late even within its short window.
      if (reactWindow <= 0.12 && sim.rng.next() < 0.5) continue;

      const futureX = b.x + v.x * b.speed * t;
      const futureY = b.y + v.y * b.speed * t;
      if (futureX < box.x - CELL || futureX > box.x + box.w + CELL) continue;
      if (futureY < box.y - CELL || futureY > box.y + box.h + CELL) continue;

      const perp: Dir[] = v.x !== 0 ? [Dir.Up, Dir.Down] : [Dir.Left, Dir.Right];
      for (const d of perp) {
        if (this.canStep(sim, tank, d)) return d;
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
      if (Math.hypot(ec.x - mc.x, ec.y - mc.y) > PREEMPT_RANGE_CELLS * CELL) continue;
      if (shotObstruction(sim, ec.x, ec.y, mc.x, mc.y) !== "clear") continue;

      const perp: Dir[] = axis === "x" ? [Dir.Up, Dir.Down] : [Dir.Left, Dir.Right];
      for (const d of perp) {
        if (!this.canStep(sim, tank, d)) continue;
        this.preemptDir = d;
        this.preemptT = PREEMPT_COMMIT_TIME;
        this.preemptCooldown = PREEMPT_COMMIT_TIME + PREEMPT_REST_TIME;
        return d;
      }
    }
    return null;
  }

  // --- execution ------------------------------------------------------------

  private pursue(sim: Sim, tank: TankState, profile: BotProfile): SeatInput {
    this.holdingPosition = false;
    const shot = this.planShot(sim, tank, profile);

    const goal = this.resolveGoalCell(sim, tank, profile);
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
        moveDir = dirTowards(targetPx.x - center.x, targetPx.y - center.y);
      }
    }

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

  private resolveGoalCell(sim: Sim, tank: TankState, profile: BotProfile): CellPoint | null {
    switch (this.action) {
      case "AttackFlag": {
        const enemyFlag = sim.map.flags[tank.team === "blue" ? "red" : "blue"];
        return { cx: enemyFlag.cx, cy: enemyFlag.cy };
      }
      case "DefendFlag": {
        const ownFlag = sim.map.flags[tank.team];
        const known = this.nearestKnownEnemy(tank);
        if (known) return { cx: Math.floor(known.x / CELL), cy: Math.floor(known.y / CELL) };
        return { cx: ownFlag.cx, cy: Math.max(0, ownFlag.cy + (tank.team === "blue" ? -3 : 3)) };
      }
      case "Hunt": {
        const known = this.nearestKnownEnemy(tank);
        if (!known) { this.action = "AttackFlag"; return this.resolveGoalCell(sim, tank, profile); }
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

  /** Decides what to shoot at this tick and which way the barrel has to
   *  point for it, in priority order: an enemy tank, then the enemy flag,
   *  then a brick wall in the way of our own route. */
  private planShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } {
    const enemyShot = this.planEnemyShot(sim, tank, profile);
    if (enemyShot) return enemyShot;

    const flagShot = this.planFlagShot(sim, tank, profile);
    if (flagShot) return flagShot;

    return this.planBrickShot(sim, tank, profile);
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
      if (range > ENGAGE_RANGE_CELLS) continue;

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

      const wantDir = this.laneDir(center.x, center.y, targetX, targetY, profile);
      if (wantDir === null) continue;

      const block = shotObstruction(sim, center.x, center.y, target.x, target.y);
      if (block === "solid") continue;
      // Only Hard spends ammunition punching through a wall at someone it
      // merely knows is behind it (SPEC §10.3 Hard, "fires through brick").
      if (block === "brick" && profile.shootsBrickToPath !== "proactive") continue;

      if (this.aimingAt !== target.slot) {
        this.aimingAt = target.slot;
        this.aimingSince = sim.time;
      }
      if (tank.dir !== wantDir) return { fire: false, aimDir: wantDir };
      if (sim.time - this.aimingSince < profile.reactionDelay) return { fire: false, aimDir: wantDir };
      if (sim.time < this.nextShotAt) return { fire: false, aimDir: wantDir };
      return { fire: true, aimDir: wantDir };
    }
    return null;
  }

  private planFlagShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } | null {
    const enemy: TeamId = tank.team === "blue" ? "red" : "blue";
    if (!sim.rules.flagAlive[enemy]) return null;
    const flag = sim.map.flags[enemy];
    const f = cellCenter(flag.cx, flag.cy);
    // Anything but steel is worth punching through to reach a flag; an Easy
    // bot that never shoots brick has to find an already-open angle.
    return this.planStaticShot(sim, tank, f.x, f.y, profile.shootsBrickToPath !== "never");
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
    if (block === "brick" && (!allowBrick || distCells > DEMOLITION_RANGE_CELLS)) return null;
    // Sidestepping onto a lane is a short-range manoeuvre too. Without this
    // a bot 20 cells away would shuffle sideways toward a lane whose
    // obstruction flips every step, and stall between the two behaviours.
    if (Math.abs(cross) > LANE_TOLERANCE_PX && distCells > LANE_STEP_RANGE_CELLS) return null;

    this.holdingPosition = true;
    if (Math.abs(cross) > LANE_TOLERANCE_PX) {
      const side = axis === "x"
        ? (cross > 0 ? Dir.Down : Dir.Up)
        : (cross > 0 ? Dir.Right : Dir.Left);
      return { fire: false, aimDir: side };
    }
    // A static target needs no reaction delay — but the between-shots
    // hesitation still applies, which is what keeps Easy slow at demolition.
    if (tank.dir !== shootDir) return { fire: false, aimDir: shootDir };
    if (sim.time < this.nextShotAt) return { fire: false, aimDir: shootDir };
    return { fire: true, aimDir: shootDir };
  }

  /** The route A* handed us runs through a brick cell — shoot it open
   *  instead of grinding against it (SPEC §10.3 "Shoots brick to path"). An
   *  Easy bot paths around brick entirely (brickPathCost), so it never gets
   *  here. */
  private planBrickShot(sim: Sim, tank: TankState, profile: BotProfile): { fire: boolean; aimDir: Dir | null } {
    const none = { fire: false, aimDir: null };
    if (profile.shootsBrickToPath === "never") return none;
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
  private laneDir(cx: number, cy: number, tx: number, ty: number, profile: BotProfile): Dir | null {
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
    const toleranceDist = Math.max(
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

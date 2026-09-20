// The authoritative match simulation — SPEC §8. Runs at a fixed 30Hz tick on
// whichever peer hosts the room (including a solo/local/hot-seat "room of
// one"). Deterministic given the same seed + inputs: all randomness goes
// through `rng`, never Math.random.

import { Grid, Tile } from "./grid";
import type { MapDef } from "./maps/loader";
import {
  CELL,
  TANK_SIZE,
  TANK_HITBOX,
  TANK_MARGIN,
  BULLET_RADIUS,
  AUTO_CENTER_SPEED,
  TANK_SPEED,
  SAND_SPEED_MULT,
  SPEED_BONUS_MULT,
  ICE_SLIDE_TIME,
  FIRE_COOLDOWN,
  MAX_STAR,
  MAX_MINES_HELD,
  MINE_BLAST_RADIUS_CELLS,
  BONUS_SPAWN_INTERVAL,
  BONUS_MAX_ON_FIELD,
  BONUS_DESPAWN_AFTER,
  BONUS_DURATION,
  RESPAWN_DELAY,
  SPAWN_INVULN,
  type TeamId,
} from "../game/config";
import { Dir, DIR_VECTOR, RNG } from "../util/math";
import {
  type Slot,
  type TankState,
  createTank,
  tankCenter,
  aabbOverlap,
} from "./tank";
import { type BulletState, createBullet, stepBullet, resetBulletIds } from "./bullet";
import {
  type BonusKind,
  type BonusEntity,
  type Fortification,
  type MineState,
  BONUS_KINDS,
  EXCLUSIVE_PERSONAL_BUFFS,
  createBonus,
  createMine,
  resetBonusIds,
  resetMineIds,
} from "./bonus";
import { flagPocketWalls } from "./flag";
import {
  type MatchSettings,
  type MatchRules,
  createRules,
  recordKill,
  recordDamage,
  checkWinByFlag,
  checkWinByTickets,
  checkWinByTime,
  otherTeam,
} from "./rules";

export type SeatInput = { dir: Dir | null; fire: boolean; mine: boolean };

export type MatchEvent =
  | { type: "kill"; victimSlot: number; killerSlot: number | null }
  | { type: "pickup"; slot: number; kind: BonusKind }
  | { type: "teamBonus"; team: TeamId; kind: BonusKind }
  | { type: "flagHit"; team: TeamId }
  | { type: "matchEnd" }
  /** A cell's discrete tile changed (brick fully destroyed, steel destroyed,
   *  SHOVEL fortify/revert). Lets the client patch its terrain incrementally
   *  instead of re-sending the whole grid every snapshot. */
  | { type: "terrain"; cx: number; cy: number; tile: Tile }
  /** A brick cell took a hit but survived — quarters remaining dropped
   *  without flipping the tile to Empty. Drives the crumbling-wall visual
   *  (SPEC §3.3); the cell is still fully solid until a "terrain" event
   *  reports it as Empty. */
  | { type: "brickDamage"; cx: number; cy: number; quarters: number }
  /** A bullet hit a wall (brick or steel), whether or not it was destroyed —
   *  drives the hit-spark fx even for a brick that took a quarter of damage
   *  and is still standing. */
  | { type: "impact"; x: number; y: number };

function maxBulletsInFlight(star: number): number {
  return star >= 2 ? 2 : 1;
}

export class Sim {
  readonly map: MapDef;
  readonly grid: Grid;
  readonly settings: MatchSettings;
  readonly slots: Slot[];
  readonly tanks: TankState[];
  // World bounds in px — the map's own size, not a fixed constant (SPEC
  // §3.1: no fixed arena size/aspect ratio, a map can be any size).
  readonly worldW: number;
  readonly worldH: number;
  bullets: BulletState[] = [];
  bonuses: BonusEntity[] = [];
  fortifications: Fortification[] = [];
  mines: MineState[] = [];
  rules: MatchRules;
  rng: RNG;
  tick = 0;
  time = 0; // seconds elapsed, for assist windows etc.
  clockFrozen: Record<TeamId, number> = { blue: 0, red: 0 };
  private nextBonusIn: number;

  constructor(map: MapDef, settings: MatchSettings, slots: Slot[], seed: number) {
    this.map = map;
    this.grid = map.grid;
    this.worldW = map.width * CELL;
    this.worldH = map.height * CELL;
    this.settings = settings;
    this.slots = slots;
    this.rng = new RNG(seed);
    this.rules = createRules(settings, slots);
    resetBulletIds();
    resetBonusIds();
    resetMineIds();

    this.tanks = slots.map((s) => {
      const spawns = map.spawns[s.team];
      // Modulo by this team's actual spawn count, not a hardcoded 5 — a
      // debug map (SPEC §3.5) can define a smaller team than production.
      const p = spawns[s.id % spawns.length] ?? spawns[0];
      return createTank(s.id, s.team, p.cx, p.cy);
    });
    for (const t of this.tanks) t.invulnT = SPAWN_INVULN;
    this.nextBonusIn = this.rng.range(...BONUS_SPAWN_INTERVAL);
  }

  tankBySlot(slot: number): TankState {
    return this.tanks[slot];
  }

  step(inputs: Record<number, SeatInput>, dt: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    if (this.rules.ended) return events;

    this.stepMovement(inputs, dt);
    this.stepFiring(inputs, dt);
    this.stepBullets(dt, events);
    this.stepMines(events);
    this.stepBonusPickup(events);
    this.stepBonusSpawning(dt);
    this.stepFortifications(dt, events);
    this.stepBuffTimers(dt);
    this.stepRespawns(dt, events);
    this.stepWinConditions(dt);

    this.tick++;
    this.time += dt;
    if (this.rules.ended) events.push({ type: "matchEnd" });
    return events;
  }

  // --- movement -----------------------------------------------------------

  private stepMovement(inputs: Record<number, SeatInput>, dt: number) {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (this.clockFrozen[tank.team] > 0) continue; // CLOCK: frozen in place
      const input = inputs[tank.slot] ?? { dir: null, fire: false, mine: false };

      const center = tankCenter(tank);
      const onIce = this.grid.tileAt(Math.floor(center.x / CELL), Math.floor(center.y / CELL)) === Tile.Ice;

      let moving = false;
      if (input.dir !== null) {
        if (onIce && tank.slideT > 0 && input.dir !== tank.dir) {
          // SPEC §3.3 ICE: "cannot turn instantly" — direction change is
          // deferred until the current slide decays.
        } else {
          tank.dir = input.dir;
        }
        if (onIce) tank.slideT = ICE_SLIDE_TIME;
        moving = true;
      } else if (onIce && tank.slideT > 0) {
        moving = true; // still sliding after key release
      }
      if (tank.slideT > 0) tank.slideT = Math.max(0, tank.slideT - dt);

      if (!moving) continue;

      const onSand = this.grid.tileAt(Math.floor(center.x / CELL), Math.floor(center.y / CELL)) === Tile.Sand;
      let speed = TANK_SPEED;
      if (onSand) speed *= SAND_SPEED_MULT;
      if (tank.speedT > 0) speed *= SPEED_BONUS_MULT;

      const v = DIR_VECTOR[tank.dir];
      const stepX = v.x * speed * dt;
      const stepY = v.y * speed * dt;
      const blocked = this.tryMove(tank, stepX, stepY);
      // Corner assist — see cornerAssist(). Only for cardinal movement:
      // diagonal input already drives both axes on purpose, so there's no
      // "cross axis" to assist, and centering one anyway would visibly drag
      // the tank off its diagonal line.
      if (blocked && v.x !== 0 && v.y === 0) this.cornerAssist(tank, "y", stepX, 0, dt);
      else if (blocked && v.y !== 0 && v.x === 0) this.cornerAssist(tank, "x", 0, stepY, dt);
    }
  }

  /** Returns true if a requested axis step was refused (wall, other tank or
   *  world bound) — the caller turns that into a corner assist. */
  private tryMove(tank: TankState, dx: number, dy: number): boolean {
    let blocked = false;
    if (dx !== 0) {
      const nx = this.resolveAxis(tank, dx, 0);
      if (nx === tank.x) blocked = true;
      tank.x = nx;
    }
    if (dy !== 0) {
      const ny = this.resolveAxis(tank, 0, dy);
      if (ny === tank.y) blocked = true;
      tank.y = ny;
    }
    return blocked;
  }

  private resolveAxis(tank: TankState, dx: number, dy: number): number {
    const nx = clampNum(tank.x + dx, 0, this.worldW - TANK_SIZE);
    const ny = clampNum(tank.y + dy, 0, this.worldH - TANK_SIZE);
    if (!this.footprintFree(nx, ny, tank.slot)) return dx !== 0 ? tank.x : tank.y;
    if (dx !== 0) return nx;
    return ny;
  }

  /** Corner assist: a tank that is *blocked* moving along one axis gets its
   *  cross-axis position pulled toward the nearest CELL grid line, so
   *  turning into a same-width corridor doesn't need pixel-perfect
   *  alignment — without this tanks snag on every corner.
   *
   *  Two deliberate restrictions, both of which the movement tests pin down:
   *  it runs only while the tank is blocked (an unobstructed turn must never
   *  move the tank's center sideways — that read as the model "jumping" a
   *  few px when you turned down out of a leftward run), and only when being
   *  aligned would actually clear the way, so driving head-on into a solid
   *  wall doesn't make the tank creep sideways along it. */
  private cornerAssist(tank: TankState, axis: "x" | "y", stepX: number, stepY: number, dt: number) {
    const target = Math.round(tank[axis] / CELL) * CELL;
    const diff = target - tank[axis];
    if (diff === 0) return;

    // Would the blocked move go through if the tank were already aligned?
    const ax = axis === "x" ? target : tank.x;
    const ay = axis === "y" ? target : tank.y;
    const aheadX = clampNum(ax + stepX, 0, this.worldW - TANK_SIZE);
    const aheadY = clampNum(ay + stepY, 0, this.worldH - TANK_SIZE);
    if (!this.footprintFree(aheadX, aheadY, tank.slot)) return;

    const step = clampNum(diff, -AUTO_CENTER_SPEED * dt, AUTO_CENTER_SPEED * dt);
    const nx = axis === "x" ? tank.x + step : tank.x;
    const ny = axis === "y" ? tank.y + step : tank.y;
    if (this.footprintFree(nx, ny, tank.slot)) tank[axis] = axis === "x" ? nx : ny;
  }

  private footprintFree(x: number, y: number, ignoreSlot: number): boolean {
    const hx = x + TANK_MARGIN;
    const hy = y + TANK_MARGIN;
    // The hitbox covers the half-open range [hx, hx + TANK_HITBOX) — tank
    // positions are floats, not integer pixels, so the last cell it touches
    // is ceil(right / CELL) - 1. The old integer-grid idiom (`+ HITBOX - 1`)
    // let a tank sink up to a pixel into a wall before the cell it had
    // already entered counted as occupied.
    const cx0 = Math.floor(hx / CELL);
    const cy0 = Math.floor(hy / CELL);
    const cx1 = Math.ceil((hx + TANK_HITBOX) / CELL) - 1;
    const cy1 = Math.ceil((hy + TANK_HITBOX) / CELL) - 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.grid.tankPassableCell(cx, cy)) return false;
      }
    }
    for (const other of this.tanks) {
      if (!other.alive || other.slot === ignoreSlot) continue;
      if (aabbOverlap(hx, hy, TANK_HITBOX, TANK_HITBOX, other.x + TANK_MARGIN, other.y + TANK_MARGIN, TANK_HITBOX, TANK_HITBOX)) return false;
    }
    return true;
  }

  // --- firing ---------------------------------------------------------------

  private stepFiring(inputs: Record<number, SeatInput>, dt: number) {
    const inFlight = new Map<number, number>();
    for (const b of this.bullets) inFlight.set(b.ownerSlot, (inFlight.get(b.ownerSlot) ?? 0) + 1);

    for (const tank of this.tanks) {
      if (tank.fireCooldown > 0) tank.fireCooldown = Math.max(0, tank.fireCooldown - dt);
      if (!tank.alive) continue;
      if (this.clockFrozen[tank.team] > 0) continue;
      const input = inputs[tank.slot];
      if (!input) continue;

      if (input.mine && tank.mines > 0) {
        const c = tankCenter(tank);
        const cx = Math.floor(c.x / CELL);
        const cy = Math.floor(c.y / CELL);
        this.mines.push(createMine(tank.team, tank.slot, cx, cy));
        tank.mines--;
      }

      if (!input.fire) continue;
      if (tank.fireCooldown > 0) continue;
      if ((inFlight.get(tank.slot) ?? 0) >= maxBulletsInFlight(tank.star)) continue;

      tank.invulnT = 0; // firing breaks spawn invulnerability early
      tank.fireCooldown = FIRE_COOLDOWN;
      const v = DIR_VECTOR[tank.dir];
      const half = TANK_SIZE / 2;
      const muzzleX = tank.x + half + v.x * half;
      const muzzleY = tank.y + half + v.y * half;
      const bullet = createBullet(tank.slot, tank.team, muzzleX, muzzleY, tank.dir, tank.star);
      this.bullets.push(bullet);
      inFlight.set(tank.slot, (inFlight.get(tank.slot) ?? 0) + 1);
    }
  }

  // --- bullets ----------------------------------------------------------

  private stepBullets(dt: number, events: MatchEvent[]) {
    const alive: BulletState[] = [];
    for (const b of this.bullets) {
      const prevX = b.x, prevY = b.y;
      stepBullet(b, dt);
      if (b.x < 0 || b.y < 0 || b.x >= this.worldW || b.y >= this.worldH) continue;
      if (this.sweepBulletIntoWall(b, prevX, prevY, events)) continue; // consumed

      const hit = this.hitTestTank(b);
      if (hit === "consumed") continue;
      alive.push(b);
    }
    this.bullets = alive;

    // resolve tank hits found during the pass above
    for (const [slot, dmg] of this.pendingTankHits) {
      this.applyTankHit(slot, dmg.bySlot, events);
    }
    this.pendingTankHits.clear();
  }

  /** Sweeps the bullet's *leading edge* (its visual radius, not its bare
   *  center) through every cell boundary it crosses this tick — not just the
   *  cell it lands in. Two bugs otherwise follow from a plain point check at
   *  the post-move position: a fast bullet can jump clean over a wall no
   *  thicker than one cell (tunneling), and — since walls render above
   *  bullets (arena.ts) — the bullet's own circle can already be poking a
   *  few pixels into the wall's texture, hidden behind it, before its bare
   *  center crosses the tile boundary and collision finally fires. Sweeping
   *  the edge instead of the center makes the hit register exactly when the
   *  visible tip touches the wall's face. Returns true if consumed. */
  private sweepBulletIntoWall(b: BulletState, prevX: number, prevY: number, events: MatchEvent[]): boolean {
    const v = DIR_VECTOR[b.dir];
    const prevEdgeX = prevX + v.x * BULLET_RADIUS;
    const prevEdgeY = prevY + v.y * BULLET_RADIUS;
    const edgeX = b.x + v.x * BULLET_RADIUS;
    const edgeY = b.y + v.y * BULLET_RADIUS;

    for (const { cx, cy } of cellsAlongLine(prevEdgeX, prevEdgeY, edgeX, edgeY, CELL)) {
      if (this.resolveBulletTileHit(b, cx, cy, events)) return true;
    }
    return false;
  }

  /** Checks one cell for a wall/flag the bullet's edge just swept into,
   *  applying damage/flag-hit effects. Returns true if the bullet is
   *  consumed (blocked or hit a flag). */
  private resolveBulletTileHit(b: BulletState, cx: number, cy: number, events: MatchEvent[]): boolean {
    const tile = this.grid.tileAt(cx, cy);
    if (tile === Tile.Steel) {
      events.push({ type: "impact", x: b.x, y: b.y });
      if (b.destroysSteel) {
        this.grid.setTile(cx, cy, Tile.Empty);
        events.push({ type: "terrain", cx, cy, tile: Tile.Empty });
      }
      return true; // consumed either way
    }
    if (tile === Tile.Brick) {
      events.push({ type: "impact", x: b.x, y: b.y });
      if (this.grid.damageBrick(cx, cy, b.fullBrickHit ? 4 : 1)) {
        events.push({ type: "terrain", cx, cy, tile: Tile.Empty });
      } else {
        events.push({ type: "brickDamage", cx, cy, quarters: this.grid.brickQuartersAt(cx, cy) });
      }
      return true;
    }
    if (this.grid.isFlag(tile)) {
      const team: TeamId = tile === Tile.FlagBlue ? "blue" : "red";
      this.rules.stats[b.ownerSlot].flagDamage++;
      this.rules.flagAlive[team] = false;
      events.push({ type: "flagHit", team });
      return true;
    }
    return false;
  }

  private pendingTankHits = new Map<number, { bySlot: number }>();

  private hitTestTank(b: BulletState): "consumed" | "miss" {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (tank.slot === b.ownerSlot) continue;
      const sameTeam = tank.team === b.team;
      if (sameTeam && !this.settings.friendlyFire) continue;
      if (
        b.x >= tank.x + TANK_MARGIN &&
        b.x < tank.x + TANK_MARGIN + TANK_HITBOX &&
        b.y >= tank.y + TANK_MARGIN &&
        b.y < tank.y + TANK_MARGIN + TANK_HITBOX
      ) {
        this.pendingTankHits.set(tank.slot, { bySlot: b.ownerSlot });
        return "consumed";
      }
    }
    return "miss";
  }

  private applyTankHit(slot: number, bySlot: number, events: MatchEvent[]) {
    const tank = this.tanks[slot];
    if (!tank.alive) return;
    if (tank.invulnT > 0) return;
    if (tank.helmetT > 0) {
      tank.helmetT = 0;
      recordDamage(this.rules, slot, bySlot, this.time);
      return;
    }
    this.killTank(tank, bySlot, events);
  }

  private killTank(tank: TankState, killerSlot: number | null, events: MatchEvent[]) {
    tank.alive = false;
    tank.respawnT = RESPAWN_DELAY;
    tank.helmetT = 0;
    tank.speedT = 0;
    tank.mines = 0;
    recordKill(this.rules, tank.slot, tank.team, killerSlot, this.time);
    events.push({ type: "kill", victimSlot: tank.slot, killerSlot });
  }

  // --- mines --------------------------------------------------------------

  private stepMines(events: MatchEvent[]) {
    const remaining: MineState[] = [];
    for (const mine of this.mines) {
      let triggered = false;
      for (const tank of this.tanks) {
        if (!tank.alive || tank.team === mine.team) continue;
        const tcx0 = Math.floor(tank.x / CELL);
        const tcy0 = Math.floor(tank.y / CELL);
        const tcx1 = Math.floor((tank.x + TANK_SIZE - 1) / CELL);
        const tcy1 = Math.floor((tank.y + TANK_SIZE - 1) / CELL);
        if (mine.cx >= tcx0 && mine.cx <= tcx1 && mine.cy >= tcy0 && mine.cy <= tcy1) {
          triggered = true;
          break;
        }
      }
      if (!triggered) {
        remaining.push(mine);
        continue;
      }
      this.detonateMine(mine, events);
    }
    this.mines = remaining;
  }

  private detonateMine(mine: MineState, events: MatchEvent[]) {
    const r = MINE_BLAST_RADIUS_CELLS;
    for (let cy = mine.cy - r; cy <= mine.cy + r; cy++) {
      for (let cx = mine.cx - r; cx <= mine.cx + r; cx++) {
        if (this.grid.tileAt(cx, cy) === Tile.Brick && this.grid.damageBrick(cx, cy, 4)) {
          events.push({ type: "terrain", cx, cy, tile: Tile.Empty });
        }
      }
    }
    for (const tank of this.tanks) {
      if (!tank.alive || tank.team === mine.team) continue;
      const tcx = Math.floor(tankCenter(tank).x / CELL);
      const tcy = Math.floor(tankCenter(tank).y / CELL);
      if (Math.abs(tcx - mine.cx) <= r && Math.abs(tcy - mine.cy) <= r) {
        this.applyTankHit(tank.slot, mine.ownerSlot, events);
      }
    }
  }

  // --- bonuses --------------------------------------------------------------

  private stepBonusPickup(events: MatchEvent[]) {
    const remaining: BonusEntity[] = [];
    for (const bonus of this.bonuses) {
      let taken = false;
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        if (
          aabbOverlap(
            tank.x, tank.y, TANK_SIZE, TANK_SIZE,
            bonus.cx * CELL, bonus.cy * CELL, CELL, CELL,
          )
        ) {
          this.applyBonus(tank, bonus.kind, events);
          taken = true;
          break;
        }
      }
      if (!taken) remaining.push(bonus);
    }
    this.bonuses = remaining;
  }

  private applyBonus(tank: TankState, kind: BonusKind, events: MatchEvent[]) {
    this.rules.stats[tank.slot].bonusesTaken++;
    events.push({ type: "pickup", slot: tank.slot, kind });

    if (EXCLUSIVE_PERSONAL_BUFFS.includes(kind)) {
      tank.helmetT = 0;
      tank.speedT = 0;
    }

    switch (kind) {
      case "HELMET":
        tank.helmetT = BONUS_DURATION.HELMET;
        break;
      case "SPEED":
        tank.speedT = BONUS_DURATION.SPEED;
        break;
      case "STAR":
        tank.star = Math.min(MAX_STAR, tank.star + 1);
        break;
      case "MINE":
        tank.mines = Math.min(MAX_MINES_HELD, tank.mines + 1);
        break;
      case "SHOVEL": {
        const walls = flagPocketWalls(this.grid, this.map.flags[tank.team]);
        for (const w of walls) {
          const existing = this.fortifications.find((f) => f.cx === w.cx && f.cy === w.cy);
          if (existing) {
            existing.ttl = BONUS_DURATION.SHOVEL;
          } else {
            const prev = this.grid.fortify(w.cx, w.cy);
            if (prev !== null) {
              this.fortifications.push({ cx: w.cx, cy: w.cy, restoreTile: prev, ttl: BONUS_DURATION.SHOVEL });
              events.push({ type: "terrain", cx: w.cx, cy: w.cy, tile: Tile.Steel });
            }
          }
        }
        events.push({ type: "teamBonus", team: tank.team, kind });
        break;
      }
      case "CLOCK":
        this.clockFrozen[otherTeam(tank.team)] = BONUS_DURATION.CLOCK;
        events.push({ type: "teamBonus", team: tank.team, kind });
        break;
      case "GRENADE":
        for (const enemy of this.tanks) {
          if (enemy.alive && enemy.team !== tank.team) this.killTank(enemy, tank.slot, events);
        }
        events.push({ type: "teamBonus", team: tank.team, kind });
        break;
      case "TICKET":
        this.rules.tickets[tank.team] += 3;
        events.push({ type: "teamBonus", team: tank.team, kind });
        break;
    }
  }

  private stepBonusSpawning(dt: number) {
    this.bonuses = this.bonuses.filter((b) => (b.ttl -= dt) > 0);
    this.nextBonusIn -= dt;
    if (this.nextBonusIn > 0) return;
    this.nextBonusIn = this.rng.range(...BONUS_SPAWN_INTERVAL);
    if (this.bonuses.length >= BONUS_MAX_ON_FIELD) return;

    const occupied = new Set(this.bonuses.map((b) => b.cy * this.grid.width + b.cx));
    const free = this.map.bonusSpawns.filter((p) => !occupied.has(p.cy * this.grid.width + p.cx));
    if (free.length === 0) return;
    const point = this.rng.pick(free);
    const kind = this.rng.pick(BONUS_KINDS);
    this.bonuses.push(createBonus(kind, point.cx, point.cy, BONUS_DESPAWN_AFTER));
  }

  private stepFortifications(dt: number, events: MatchEvent[]) {
    this.fortifications = this.fortifications.filter((f) => {
      f.ttl -= dt;
      if (f.ttl > 0) return true;
      this.grid.restore(f.cx, f.cy, f.restoreTile);
      events.push({ type: "terrain", cx: f.cx, cy: f.cy, tile: f.restoreTile });
      return false;
    });
  }

  private stepBuffTimers(dt: number) {
    for (const tank of this.tanks) {
      if (tank.helmetT > 0) tank.helmetT = Math.max(0, tank.helmetT - dt);
      if (tank.speedT > 0) tank.speedT = Math.max(0, tank.speedT - dt);
      if (tank.invulnT > 0) tank.invulnT = Math.max(0, tank.invulnT - dt);
    }
    for (const team of ["blue", "red"] as TeamId[]) {
      if (this.clockFrozen[team] > 0) this.clockFrozen[team] = Math.max(0, this.clockFrozen[team] - dt);
    }
  }

  // --- respawn / win ------------------------------------------------------

  private stepRespawns(dt: number, _events: MatchEvent[]) {
    for (const tank of this.tanks) {
      if (tank.alive) continue;
      if (this.rules.tickets[tank.team] <= 0) continue; // eliminated, spectating
      tank.respawnT = Math.max(0, tank.respawnT - dt);
      if (tank.respawnT > 0) continue;
      this.respawnTank(tank);
    }
  }

  private respawnTank(tank: TankState) {
    const spawns = this.map.spawns[tank.team];
    let point = spawns.find((p) => this.footprintFree(p.cx * CELL, p.cy * CELL, tank.slot));
    if (!point) point = this.rng.pick(spawns);
    tank.x = point.cx * CELL;
    tank.y = point.cy * CELL;
    tank.alive = true;
    tank.invulnT = SPAWN_INVULN;
    tank.slideT = 0;
  }

  private stepWinConditions(dt: number) {
    checkWinByFlag(this.rules);
    const teamHasLivingTank: Record<TeamId, boolean> = { blue: false, red: false };
    for (const tank of this.tanks) if (tank.alive) teamHasLivingTank[tank.team] = true;
    checkWinByTickets(this.rules, teamHasLivingTank);
    if (!this.rules.ended) this.rules.timeLeft = Math.max(0, this.rules.timeLeft - dt);
    checkWinByTime(this.rules);
  }

  // --- networking (SPEC §9.3) ---------------------------------------------
  // Full snapshots, not binary deltas — a deliberate simplification (see
  // README/PR notes): correctness over an optimization that can't be
  // measured without real multi-device testing.

  snapshot(): Snapshot {
    return {
      tick: this.tick,
      tanks: this.tanks.map((t) => ({
        slot: t.slot,
        alive: t.alive,
        x: t.x,
        y: t.y,
        dir: t.dir,
        star: t.star,
        helmetT: t.helmetT,
        speedT: t.speedT,
        invulnT: t.invulnT,
        mines: t.mines,
        respawnT: t.respawnT,
      })),
      bullets: this.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, dir: b.dir, team: b.team })),
      bonuses: this.bonuses.map((b) => ({ id: b.id, kind: b.kind, cx: b.cx, cy: b.cy })),
      mines: this.mines.map((m) => ({ id: m.id, team: m.team, cx: m.cx, cy: m.cy })),
      tickets: { ...this.rules.tickets },
      flagAlive: { ...this.rules.flagAlive },
      timeLeft: this.rules.timeLeft,
      ended: this.rules.ended,
      winner: this.rules.winner,
    };
  }
}

export type TankSnap = {
  slot: number;
  alive: boolean;
  x: number;
  y: number;
  dir: Dir;
  star: number;
  helmetT: number;
  speedT: number;
  invulnT: number;
  mines: number;
  respawnT: number;
};
export type BulletSnap = { id: number; x: number; y: number; dir: Dir; team: TeamId };
export type BonusSnap = { id: number; kind: BonusKind; cx: number; cy: number };
export type MineSnap = { id: number; team: TeamId; cx: number; cy: number };
export type Snapshot = {
  tick: number;
  tanks: TankSnap[];
  bullets: BulletSnap[];
  bonuses: BonusSnap[];
  mines: MineSnap[];
  tickets: Record<TeamId, number>;
  flagAlive: Record<TeamId, boolean>;
  timeLeft: number;
  ended: boolean;
  winner: TeamId | "draw" | null;
};

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Every cell index a point sweeps through moving from `prev` to `curr`
 *  along one axis, inclusive of both ends and in travel order — so a step
 *  wider than one cell can't skip the cell(s) in between. */
/** Every cell a straight segment from (x0,y0) to (x1,y1) passes through, in
 *  travel order — a 2D grid walk (a supercover/DDA line), not two separate
 *  per-axis sweeps, so it's correct for a diagonal path too (where both axes
 *  cross cell boundaries in the same tick, in whichever order the segment
 *  actually crosses them) and not just an axis-aligned one. */
function cellsAlongLine(x0: number, y0: number, x1: number, y1: number, cellSize: number): { cx: number; cy: number }[] {
  let cx = Math.floor(x0 / cellSize);
  let cy = Math.floor(y0 / cellSize);
  const cxEnd = Math.floor(x1 / cellSize);
  const cyEnd = Math.floor(y1 / cellSize);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const cells = [{ cx, cy }];
  let guard = 0;
  while ((cx !== cxEnd || cy !== cyEnd) && guard++ < 64) {
    const nextVBoundary = (cx + (stepX > 0 ? 1 : 0)) * cellSize;
    const nextHBoundary = (cy + (stepY > 0 ? 1 : 0)) * cellSize;
    const tX = stepX !== 0 ? (nextVBoundary - x0) / dx : Infinity;
    const tY = stepY !== 0 ? (nextHBoundary - y0) / dy : Infinity;
    if (tX < tY) cx += stepX;
    else if (tY < tX) cy += stepY;
    else { cx += stepX; cy += stepY; } // exact corner crossing
    cells.push({ cx, cy });
  }
  return cells;
}

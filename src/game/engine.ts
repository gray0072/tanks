import {
  W, H, TANK_SIZE, BULLET_SPEED, BULLET_LIFE, SHOOT_CD,
  FLAG_SIZE, FLAG_HP, TANK_HP, TANK_SPEED, AI_SPEED, WALL_COUNT,
  RESPAWN_TIME, PICKUP_SPAWN_INTERVAL, SPEED_BUFF_DUR, FIRE_BUFF_DUR,
  SPEED_MULT, FIRE_CD_MULT, HEAL_AMOUNT, MAX_PICKUPS,
} from './constants';
import type { Tank, Wall, Flag, Bullet, Particle, Pickup, MutableGameState, UISnapshot, PlayerInput } from './types';

// ── collision ──────────────────────────────────────────────────────────────

function rectCollide(ax: number, ay: number, aw: number, ah: number,
                     bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function pointInWall(walls: Wall[], px: number, py: number, pad = 0): Wall | null {
  for (const w of walls) {
    if (w.hp <= 0) continue;
    if (px - pad < w.x + w.w && px + pad > w.x && py - pad < w.y + w.h && py + pad > w.y) return w;
  }
  return null;
}

function tankCollidesWall(walls: Wall[], tx: number, ty: number): boolean {
  const s = TANK_SIZE * 0.8;
  for (const w of walls) {
    if (w.hp <= 0) continue;
    if (rectCollide(tx - s, ty - s, s * 2, s * 2, w.x, w.y, w.w, w.h)) return true;
  }
  return tx - s < 0 || tx + s > W || ty - s < 0 || ty + s > H;
}

function tankCollidesTank(tanks: Tank[], self: Tank, tx: number, ty: number): boolean {
  const s = TANK_SIZE * 1.4;
  for (const t of tanks) {
    if (t === self || t.dead) continue;
    if (Math.abs(tx - t.x) < s && Math.abs(ty - t.y) < s) return true;
  }
  return false;
}

// ── particles ──────────────────────────────────────────────────────────────

function addParticle(particles: Particle[], x: number, y: number, color: string, count = 5): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 3;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     life: 15 + Math.random() * 15, color, size: 2 + Math.random() * 3 });
  }
}

function addExplosion(particles: Particle[], x: number, y: number, color: string, count = 20): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 5;
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                     life: 20 + Math.random() * 25, color, size: 3 + Math.random() * 5 });
  }
}

// ── pickups ────────────────────────────────────────────────────────────────

function spawnPickup(state: MutableGameState): void {
  if (state.pickups.length >= MAX_PICKUPS) return;
  const types: Pickup['type'][] = ['heal', 'heal', 'speed', 'fire'];
  const type = types[Math.floor(Math.random() * types.length)];
  let x = 0, y = 0, tries = 0;
  do {
    x = 80 + Math.random() * (W - 160);
    y = 40 + Math.random() * (H - 80);
    tries++;
  } while (tries < 30 && pointInWall(state.walls, x, y, 12));
  if (tries < 30) state.pickups.push({ x, y, type, pulse: Math.random() * Math.PI * 2 });
}

function applyPickup(state: MutableGameState, tank: Tank, p: Pickup): void {
  if (p.type === 'heal') {
    tank.hp = Math.min(tank.maxHp, tank.hp + HEAL_AMOUNT);
    addParticle(state.particles, tank.x, tank.y, '#0f0', 8);
  } else if (p.type === 'speed') {
    tank.speedBuff = SPEED_BUFF_DUR;
    addParticle(state.particles, tank.x, tank.y, '#0cf', 8);
  } else {
    tank.fireBuff = FIRE_BUFF_DUR;
    addParticle(state.particles, tank.x, tank.y, '#f80', 8);
  }
}

// ── movement ───────────────────────────────────────────────────────────────

function getSpeed(t: Tank): number {
  const base = t.isPlayer ? TANK_SPEED : AI_SPEED;
  return t.speedBuff > 0 ? base * SPEED_MULT : base;
}

function getShootCd(t: Tank): number {
  return t.fireBuff > 0 ? Math.floor(SHOOT_CD * FIRE_CD_MULT) : SHOOT_CD;
}

function tryMove(state: MutableGameState, tank: Tank, angle: number, speed: number): void {
  const dx = Math.cos(angle) * speed;
  const dy = Math.sin(angle) * speed;
  const nx = tank.x + dx;
  const ny = tank.y + dy;
  if (!tankCollidesWall(state.walls, nx, ny) && !tankCollidesTank(state.tanks, tank, nx, ny)) {
    tank.x = nx; tank.y = ny; return;
  }
  if (!tankCollidesWall(state.walls, nx, tank.y) && !tankCollidesTank(state.tanks, tank, nx, tank.y)) {
    tank.x = nx; return;
  }
  if (!tankCollidesWall(state.walls, tank.x, ny) && !tankCollidesTank(state.tanks, tank, tank.x, ny)) {
    tank.y = ny;
  }
}

// ── shoot / respawn ────────────────────────────────────────────────────────

function shoot(state: MutableGameState, tank: Tank): void {
  if (tank.shootCd > 0) return;
  tank.shootCd = getShootCd(tank);
  const a = tank.turretAngle;
  state.bullets.push({
    x: tank.x + Math.cos(a) * TANK_SIZE,
    y: tank.y + Math.sin(a) * TANK_SIZE,
    vx: Math.cos(a) * BULLET_SPEED,
    vy: Math.sin(a) * BULLET_SPEED,
    team: tank.team,
    life: BULLET_LIFE,
    dmg: 12 + Math.random() * 6,
  });
  addParticle(state.particles,
    tank.x + Math.cos(a) * TANK_SIZE * 1.2,
    tank.y + Math.sin(a) * TANK_SIZE * 1.2,
    tank.team === 0 ? '#6f6' : '#f66', 3);
}

function respawnTank(state: MutableGameState, t: Tank): void {
  t.dead = false;
  t.hp = t.maxHp;
  t.shootCd = 0;
  t.speedBuff = 0;
  t.fireBuff = 0;
  t.respawnTimer = 0;
  const baseX = t.team === 0 ? 40 + Math.random() * 50 : W - 40 - Math.random() * 50;
  let ry = 0, tries = 0;
  do {
    ry = 40 + Math.random() * (H - 80);
    tries++;
  } while (tries < 30 && (tankCollidesWall(state.walls, baseX, ry) || tankCollidesTank(state.tanks, t, baseX, ry)));
  t.x = baseX;
  t.y = ry;
  t.angle = t.team === 0 ? 0 : Math.PI;
  t.turretAngle = t.angle;
  addParticle(state.particles, t.x, t.y, '#fff', 12);
}

// ── AI ─────────────────────────────────────────────────────────────────────

function aiUpdate(state: MutableGameState, tank: Tank): void {
  if (tank.dead) return;
  tank.aiTimer--;
  tank.shootCd = Math.max(0, tank.shootCd - 1);
  if (tank.speedBuff > 0) tank.speedBuff--;
  if (tank.fireBuff > 0) tank.fireBuff--;

  const eFlag = state.flags[tank.team === 0 ? 1 : 0];
  const mFlag = state.flags[tank.team];

  let cEnemy: Tank | null = null, cDist = Infinity;
  for (const t of state.tanks) {
    if (t.team === tank.team || t.dead) continue;
    const d = Math.hypot(t.x - tank.x, t.y - tank.y);
    if (d < cDist) { cDist = d; cEnemy = t; }
  }

  let cPickup: Pickup | null = null, pDist = Infinity;
  for (const p of state.pickups) {
    const d = Math.hypot(p.x - tank.x, p.y - tank.y);
    if (d < pDist) { pDist = d; cPickup = p; }
  }

  if (tank.aiTimer <= 0) {
    tank.aiTimer = 60 + Math.random() * 60;
    const r = Math.random();
    if (cPickup && pDist < 200 && (tank.hp < tank.maxHp * 0.6 || r < 0.2)) {
      tank.aiState = 'pickup'; tank.targetX = cPickup.x; tank.targetY = cPickup.y;
    } else if (r < 0.5 && eFlag.hp > 0) {
      tank.aiState = 'attack';
      tank.targetX = eFlag.x + (Math.random() - 0.5) * 60;
      tank.targetY = eFlag.y + (Math.random() - 0.5) * 60;
    } else if (r < 0.75 && cEnemy) {
      tank.aiState = 'chase';
      tank.targetX = cEnemy.x + (Math.random() - 0.5) * 40;
      tank.targetY = cEnemy.y + (Math.random() - 0.5) * 40;
    } else {
      tank.aiState = 'defend';
      tank.targetX = mFlag.x + (Math.random() - 0.5) * 100 + (tank.team === 0 ? 60 : -60);
      tank.targetY = mFlag.y + (Math.random() - 0.5) * 120;
    }
  }

  if (Math.abs(tank.x - tank.prevX) < 0.2 && Math.abs(tank.y - tank.prevY) < 0.2) {
    tank.stuckTimer++;
    if (tank.stuckTimer > 30) {
      tank.targetX = Math.max(30, Math.min(W - 30, tank.x + (Math.random() - 0.5) * 200));
      tank.targetY = Math.max(30, Math.min(H - 30, tank.y + (Math.random() - 0.5) * 200));
      tank.stuckTimer = 0;
      tank.aiTimer = 40;
    }
  } else {
    tank.stuckTimer = 0;
  }
  tank.prevX = tank.x;
  tank.prevY = tank.y;

  const dx = tank.targetX - tank.x, dy = tank.targetY - tank.y;
  const ma = Math.atan2(dy, dx);
  tank.angle = ma;
  if (Math.hypot(dx, dy) > 20) tryMove(state, tank, ma, getSpeed(tank));

  const aim: { x: number; y: number } | null =
    (cEnemy && cDist < 250) ? cEnemy : eFlag.hp > 0 ? eFlag : cEnemy;
  if (aim) {
    const ta = Math.atan2(aim.y - tank.y, aim.x - tank.x);
    let diff = ta - tank.turretAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    tank.turretAngle += diff * 0.1;
    if (Math.abs(diff) < 0.25) shoot(state, tank);
  }
}

// ── player (local single-player) ───────────────────────────────────────────

function playerUpdate(state: MutableGameState, tank: Tank): void {
  if (tank.dead) {
    tank.respawnTimer--;
    if (tank.respawnTimer <= 0) respawnTank(state, tank);
    return;
  }
  tank.shootCd = Math.max(0, tank.shootCd - 1);
  if (tank.speedBuff > 0) tank.speedBuff--;
  if (tank.fireBuff > 0) tank.fireBuff--;

  let mx = 0, my = 0;
  const k = state.keys;
  if (k['w'] || k['ц']) my -= 1;
  if (k['s'] || k['ы']) my += 1;
  if (k['a'] || k['ф']) mx -= 1;
  if (k['d'] || k['в']) mx += 1;
  if (mx || my) {
    const a = Math.atan2(my, mx);
    tank.angle = a;
    tryMove(state, tank, a, getSpeed(tank));
  }

  tank.turretAngle = Math.atan2(state.mouseY - tank.y, state.mouseX - tank.x);
  if (state.mouseDown) shoot(state, tank);
}

// ── player (network input — used by server) ────────────────────────────────

function playerUpdateFromInput(state: MutableGameState, tank: Tank, input: PlayerInput): void {
  if (tank.dead) {
    tank.respawnTimer--;
    if (tank.respawnTimer <= 0) respawnTank(state, tank);
    return;
  }
  tank.shootCd = Math.max(0, tank.shootCd - 1);
  if (tank.speedBuff > 0) tank.speedBuff--;
  if (tank.fireBuff > 0) tank.fireBuff--;

  let mx = 0, my = 0;
  if (input.up)    my -= 1;
  if (input.down)  my += 1;
  if (input.left)  mx -= 1;
  if (input.right) mx += 1;
  if (mx || my) {
    const a = Math.atan2(my, mx);
    tank.angle = a;
    tryMove(state, tank, a, getSpeed(tank));
  }

  tank.turretAngle = Math.atan2(input.mouseY - tank.y, input.mouseX - tank.x);
  if (input.fire) shoot(state, tank);
}

// ── init ───────────────────────────────────────────────────────────────────

function mkTank(id: number, x: number, y: number, angle: number, team: 0 | 1, isPlayer: boolean): Tank {
  return {
    id, x, y, angle, turretAngle: angle, team, isPlayer,
    controlledBy: 'bot',
    hp: TANK_HP, maxHp: TANK_HP, shootCd: 0,
    aiState: 'attack', aiTimer: 0, targetX: W / 2, targetY: H / 2,
    stuckTimer: 0, prevX: 0, prevY: 0,
    dead: false, respawnTimer: 0, speedBuff: 0, fireBuff: 0,
  };
}

function generateWalls(): Wall[] {
  const walls: Wall[] = [];
  for (let i = 0; i < WALL_COUNT; i++) {
    let w = 0, h = 0, x = 0, y = 0, tries = 0;
    do {
      w = Math.random() < 0.5 ? 40 + Math.random() * 60 : 20 + Math.random() * 30;
      h = Math.random() < 0.5 ? 20 + Math.random() * 30 : 40 + Math.random() * 60;
      x = 80 + Math.random() * (W - 160 - w);
      y = 40 + Math.random() * (H - 80 - h);
      tries++;
    } while (tries < 20 && (
      (x < 140 && y > H / 2 - 80 && y < H / 2 + 80) ||
      (x + w > W - 140 && y > H / 2 - 80 && y < H / 2 + 80)
    ));
    if (tries < 20) walls.push({ x, y, w, h, hp: 3 });
  }
  return walls;
}

export function createInitialState(): MutableGameState {
  const walls = generateWalls();
  const tanks: Tank[] = [];
  for (let i = 0; i < 5; i++)
    tanks.push(mkTank(i, 40 + Math.random() * 50, 60 + i * (H - 120) / 4 + Math.random() * 20, 0, 0, i === 0));
  for (let i = 0; i < 5; i++)
    tanks.push(mkTank(5 + i, W - 40 - Math.random() * 50, 60 + i * (H - 120) / 4 + Math.random() * 20, Math.PI, 1, false));
  const flags: [Flag, Flag] = [
    { x: 35, y: H / 2, team: 0, hp: FLAG_HP, maxHp: FLAG_HP },
    { x: W - 35, y: H / 2, team: 1, hp: FLAG_HP, maxHp: FLAG_HP },
  ];
  return {
    tanks, walls, flags,
    bullets: [], particles: [], pickups: [],
    pickupTimer: 60,
    keys: {}, mouseX: W / 2, mouseY: H / 2, mouseDown: false,
    gameOver: false, winner: null,
    events: [],
  };
}

// ── main update ────────────────────────────────────────────────────────────

export function update(state: MutableGameState, inputMap?: Map<number, PlayerInput>): UISnapshot {
  if (state.gameOver) return snapshot(state);

  state.pickupTimer--;
  if (state.pickupTimer <= 0) { spawnPickup(state); state.pickupTimer = PICKUP_SPAWN_INTERVAL; }
  for (const p of state.pickups) p.pulse += 0.06;

  for (const t of state.tanks) {
    const netInput = inputMap?.get(t.id);
    if (netInput !== undefined) {
      playerUpdateFromInput(state, t, netInput);
    } else if (t.isPlayer) {
      playerUpdate(state, t);
    } else {
      if (t.dead) { t.respawnTimer--; if (t.respawnTimer <= 0) respawnTank(state, t); }
      else aiUpdate(state, t);
    }
  }

  // pickup collection
  for (const t of state.tanks) {
    if (t.dead) continue;
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      if (Math.hypot(t.x - state.pickups[i].x, t.y - state.pickups[i].y) < TANK_SIZE + 10) {
        applyPickup(state, t, state.pickups[i]);
        state.pickups.splice(i, 1);
      }
    }
  }

  // bullets
  for (const b of state.bullets) {
    b.x += b.vx; b.y += b.vy; b.life--;
    const hw = pointInWall(state.walls, b.x, b.y, 2);
    if (hw) {
      hw.hp--;
      if (hw.hp <= 0) addExplosion(state.particles, b.x, b.y, '#a86', 10);
      else addParticle(state.particles, b.x, b.y, '#aa8', 3);
      b.life = 0; continue;
    }
    for (const t of state.tanks) {
      if (t.team === b.team || t.dead) continue;
      if (Math.hypot(t.x - b.x, t.y - b.y) < TANK_SIZE) {
        t.hp -= b.dmg;
        const hitColor = t.team === 0 ? '#4f4' : '#f44';
        addParticle(state.particles, b.x, b.y, hitColor, 5);
        state.events.push({ kind: 'hit', x: b.x, y: b.y, color: hitColor });
        if (t.hp <= 0) {
          t.dead = true;
          t.respawnTimer = RESPAWN_TIME;
          addExplosion(state.particles, t.x, t.y, hitColor, 25);
          state.events.push({ kind: 'explosion', x: t.x, y: t.y, color: hitColor, count: 25 });
        }
        b.life = 0; break;
      }
    }
    for (const f of state.flags) {
      if (f.team === b.team || f.hp <= 0) continue;
      if (Math.hypot(f.x - b.x, f.y - b.y) < FLAG_SIZE + 4) {
        f.hp -= b.dmg;
        addParticle(state.particles, b.x, b.y, '#ff0', 4);
        if (f.hp <= 0) {
          addExplosion(state.particles, f.x, f.y, '#ff0', 35);
          state.events.push({ kind: 'explosion', x: f.x, y: f.y, color: '#ff0', count: 35 });
          state.gameOver = true;
          state.winner = f.team === 0 ? 1 : 0;
        }
        b.life = 0; break;
      }
    }
    if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) b.life = 0;
  }
  state.bullets = state.bullets.filter(b => b.life > 0);

  for (const p of state.particles) {
    p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life--; p.size *= 0.97;
  }
  state.particles = state.particles.filter(p => p.life > 0);

  return snapshot(state);
}

function snapshot(state: MutableGameState): UISnapshot {
  const player = state.tanks.find(t => t.isPlayer) ?? state.tanks[0];
  return {
    greenFlagHp: state.flags[0].hp,
    redFlagHp: state.flags[1].hp,
    playerSpeedBuff: player?.speedBuff ?? 0,
    playerFireBuff: player?.fireBuff ?? 0,
    playerDead: player?.dead ?? false,
    playerRespawnTimer: player?.respawnTimer ?? 0,
    gameOver: state.gameOver,
    winner: state.winner,
  };
}

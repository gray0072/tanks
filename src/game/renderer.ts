import { W, H, TANK_SIZE, FLAG_SIZE, RESPAWN_TIME } from './constants';
import type { RenderState, Pickup } from './types';

export function draw(ctx: CanvasRenderingContext2D, state: RenderState): void {
  ctx.clearRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = '#222'; ctx.lineWidth = 0.5;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // team zones
  ctx.fillStyle = 'rgba(0,255,0,0.03)'; ctx.fillRect(0, 0, 70, H);
  ctx.fillStyle = 'rgba(255,0,0,0.03)'; ctx.fillRect(W - 70, 0, 70, H);

  // walls
  for (const w of state.walls) {
    if (w.hp <= 0) { ctx.fillStyle = '#1d1d1d'; ctx.fillRect(w.x, w.y, w.w, w.h); continue; }
    ctx.fillStyle = w.hp === 3 ? '#555' : w.hp === 2 ? '#443' : '#432';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = '#0002';
    for (let by = w.y; by < w.y + w.h; by += 8) {
      ctx.beginPath(); ctx.moveTo(w.x, by); ctx.lineTo(w.x + w.w, by); ctx.stroke();
    }
  }

  // pickups
  for (const p of state.pickups) drawPickup(ctx, p);

  // flags
  for (const f of state.flags) drawFlag(ctx, f.x, f.y, f.team, f.hp, f.maxHp);

  // ghost tanks (dead)
  for (const t of state.tanks) {
    if (!t.dead) continue;
    ctx.save(); ctx.globalAlpha = 0.15; ctx.translate(t.x, t.y);
    ctx.fillStyle = t.team === 0 ? '#4f4' : '#f44';
    ctx.beginPath(); ctx.arc(0, 0, TANK_SIZE * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.6;
    const bw = TANK_SIZE * 2;
    ctx.fillStyle = '#333'; ctx.fillRect(-bw / 2, -4, bw, 8);
    ctx.fillStyle = '#fff'; ctx.fillRect(-bw / 2, -4, bw * (1 - t.respawnTimer / RESPAWN_TIME), 8);
    ctx.restore();
  }

  // live tanks
  for (const t of state.tanks) {
    if (t.dead) continue;
    ctx.save(); ctx.translate(t.x, t.y);
    if (t.speedBuff > 0 || t.fireBuff > 0) {
      ctx.shadowColor = t.speedBuff > 0 ? '#0cf' : '#f80';
      ctx.shadowBlur = 14;
    }
    // body
    ctx.save(); ctx.rotate(t.angle);
    ctx.fillStyle = t.team === 0 ? '#282' : '#922';
    ctx.fillRect(-TANK_SIZE, -TANK_SIZE * 0.7, TANK_SIZE * 2, TANK_SIZE * 1.4);
    ctx.fillStyle = t.team === 0 ? '#3a3' : '#c33';
    ctx.fillRect(-TANK_SIZE * 0.85, -TANK_SIZE * 0.55, TANK_SIZE * 1.7, TANK_SIZE * 1.1);
    ctx.fillStyle = '#444';
    ctx.fillRect(-TANK_SIZE, -TANK_SIZE * 0.75, TANK_SIZE * 2, 3);
    ctx.fillRect(-TANK_SIZE, TANK_SIZE * 0.75 - 3, TANK_SIZE * 2, 3);
    ctx.restore();
    ctx.shadowBlur = 0;
    // turret
    ctx.save(); ctx.rotate(t.turretAngle);
    ctx.fillStyle = t.team === 0 ? '#5d5' : '#e55';
    ctx.beginPath(); ctx.arc(0, 0, TANK_SIZE * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.team === 0 ? '#4c4' : '#d44';
    ctx.fillRect(0, -2.5, TANK_SIZE * 1.1, 5);
    ctx.restore();
    // player ring
    if (t.id === state.mySlot) {
      ctx.strokeStyle = '#ff0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, TANK_SIZE + 4, 0, Math.PI * 2); ctx.stroke();
    }
    // hp bar
    if (t.hp < t.maxHp) {
      const bw = TANK_SIZE * 2;
      ctx.fillStyle = '#333'; ctx.fillRect(-bw / 2, -TANK_SIZE - 8, bw, 4);
      ctx.fillStyle = t.team === 0 ? '#4f4' : '#f44';
      ctx.fillRect(-bw / 2, -TANK_SIZE - 8, bw * (t.hp / t.maxHp), 4);
    }
    ctx.restore();
  }

  // bullets
  for (const b of state.bullets) {
    ctx.fillStyle = b.team === 0 ? '#ff0' : '#fa0';
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.team === 0 ? 'rgba(255,255,0,0.3)' : 'rgba(255,160,0,0.3)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();
  }

  // particles
  for (const p of state.particles) {
    ctx.globalAlpha = p.life / 30;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawFlag(ctx: CanvasRenderingContext2D, fx: number, fy: number,
                  team: 0 | 1, hp: number, maxHp: number): void {
  ctx.save(); ctx.translate(fx, fy);
  ctx.fillStyle = '#888'; ctx.fillRect(-2, -FLAG_SIZE, 4, FLAG_SIZE * 2);
  if (hp > 0) {
    ctx.fillStyle = team === 0 ? '#4f4' : '#f44';
    ctx.beginPath();
    ctx.moveTo(2, -FLAG_SIZE); ctx.lineTo(16, -FLAG_SIZE + 6); ctx.lineTo(2, -FLAG_SIZE + 12);
    ctx.fill();
    const bw = 30;
    ctx.fillStyle = '#333'; ctx.fillRect(-bw / 2, FLAG_SIZE + 4, bw, 4);
    ctx.fillStyle = team === 0 ? '#4f4' : '#f44';
    ctx.fillRect(-bw / 2, FLAG_SIZE + 4, bw * (hp / maxHp), 4);
  } else {
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.moveTo(2, -FLAG_SIZE); ctx.lineTo(10, -FLAG_SIZE + 4); ctx.lineTo(2, -FLAG_SIZE + 8);
    ctx.fill();
  }
  ctx.restore();
}

function drawPickup(ctx: CanvasRenderingContext2D, p: Pickup): void {
  ctx.save(); ctx.translate(p.x, p.y);
  const s = 8 + Math.sin(p.pulse) * 2;
  const glow = 0.5 + Math.sin(p.pulse) * 0.3;
  if (p.type === 'heal') {
    ctx.shadowColor = '#0f0'; ctx.shadowBlur = 10 * glow;
    ctx.fillStyle = '#0a0';
    ctx.fillRect(-s, -s / 3, s * 2, s * 0.66);
    ctx.fillRect(-s / 3, -s, s * 0.66, s * 2);
    ctx.fillStyle = '#4f4';
    ctx.fillRect(-s + 1.5, -s / 3 + 1.5, s * 2 - 3, s * 0.66 - 3);
    ctx.fillRect(-s / 3 + 1.5, -s + 1.5, s * 0.66 - 3, s * 2 - 3);
  } else if (p.type === 'speed') {
    ctx.shadowColor = '#0cf'; ctx.shadowBlur = 12 * glow; ctx.fillStyle = '#0cf';
    ctx.beginPath();
    ctx.moveTo(-s, s * 0.6); ctx.lineTo(0, -s); ctx.lineTo(2, 0);
    ctx.lineTo(s, -s * 0.2); ctx.lineTo(0, s); ctx.lineTo(-2, 0);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.shadowColor = '#f80'; ctx.shadowBlur = 12 * glow; ctx.fillStyle = '#f80';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 1.2, -s * 0.3, s * 0.6, s * 0.4);
    ctx.quadraticCurveTo(s * 0.3, s * 0.8, 0, s);
    ctx.quadraticCurveTo(-s * 0.3, s * 0.8, -s * 0.6, s * 0.4);
    ctx.quadraticCurveTo(-s * 1.2, -s * 0.3, 0, -s);
    ctx.fill();
    ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.3);
    ctx.quadraticCurveTo(s * 0.5, 0, s * 0.2, s * 0.3);
    ctx.quadraticCurveTo(0, s * 0.6, -s * 0.2, s * 0.3);
    ctx.quadraticCurveTo(-s * 0.5, 0, 0, -s * 0.3);
    ctx.fill();
  }
  ctx.shadowBlur = 0; ctx.restore();
}

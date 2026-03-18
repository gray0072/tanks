import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useGameStore } from '../store/useGameStore';
import { draw } from '../game/renderer';
import { onSocketMessage, sendMsg } from '../net/socket';
import { W, H, FLAG_HP } from '../game/constants';
import type { RenderState, Tank, Particle, GameEvent } from '../game/types';

const PARTICLE_LIFE = 30;
const TICK_MS = 50;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function spawnParticles(particles: Particle[], event: GameEvent) {
  const count = event.count ?? (event.kind === 'hit' ? 6 : 20);
  for (let i = 0; i < count; i++) {
    const speed = event.kind === 'hit' ? 1.5 : 3;
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: event.x, y: event.y,
      vx: Math.cos(angle) * speed * Math.random(),
      vy: Math.sin(angle) * speed * Math.random(),
      life: PARTICLE_LIFE,
      color: event.color,
      size: event.kind === 'hit' ? 2 + Math.random() * 2 : 3 + Math.random() * 3,
    });
  }
}

function mkRenderState(mySlot: number): RenderState {
  return {
    tanks: [], bullets: [], walls: [], flags: [
      { x: 40, y: H / 2, team: 0, hp: FLAG_HP, maxHp: FLAG_HP },
      { x: W - 40, y: H / 2, team: 1, hp: FLAG_HP, maxHp: FLAG_HP },
    ],
    pickups: [], particles: [], mySlot,
  };
}

type TickSnapshot = {
  tanks: Tank[];
  bullets: { x: number; y: number; team: 0 | 1 }[];
};

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderStateRef = useRef<RenderState>(mkRenderState(0));
  const rafRef = useRef<number>(0);

  // Interpolation state
  const prevSnapRef = useRef<TickSnapshot | null>(null);
  const currSnapRef = useRef<TickSnapshot | null>(null);
  const lastTickTimeRef = useRef<number>(0);

  const keysRef = useRef<Record<string, boolean>>({});
  const mouseXRef = useRef(0);
  const mouseYRef = useRef(0);
  const mouseDownRef = useRef(false);

  const phase = useGameStore(s => s.phase);
  const mySlot = useGameStore(s => s.mySlot);
  const walls = useGameStore(s => s.walls);

  useEffect(() => {
    renderStateRef.current.walls = walls;
    renderStateRef.current.mySlot = mySlot;
  }, [walls, mySlot]);

  useEffect(() => {
    const unsub = onSocketMessage((msg) => {
      if (msg.type === 'TICK') {
        // Shift snapshots for interpolation
        prevSnapRef.current = currSnapRef.current;
        currSnapRef.current = { tanks: msg.tanks, bullets: msg.bullets };
        lastTickTimeRef.current = performance.now();

        const rs = renderStateRef.current;
        rs.flags = msg.flags;
        rs.pickups = msg.pickups;

        for (const evt of msg.events) spawnParticles(rs.particles, evt);

        const myTank = msg.tanks[rs.mySlot];
        useGameStore.getState().updateHUD({
          greenFlagHp: msg.flags[0].hp,
          redFlagHp: msg.flags[1].hp,
          playerSpeedBuff: myTank?.speedBuff ?? 0,
          playerFireBuff: myTank?.fireBuff ?? 0,
          playerDead: myTank?.dead ?? false,
          playerRespawnTimer: myTank?.respawnTimer ?? 0,
          gameOver: msg.gameOver,
          winner: msg.winner,
        });

        if (msg.gameOver) useGameStore.getState().setPhase('lobby');
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    const onKeyDown = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = true; };
    const onKeyUp   = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    const onMove    = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseXRef.current = (e.clientX - rect.left) * (W / rect.width);
      mouseYRef.current = (e.clientY - rect.top)  * (H / rect.height);
    };
    const onDown  = (e: MouseEvent) => { if (e.button === 0) mouseDownRef.current = true; };
    const onUp    = (e: MouseEvent) => { if (e.button === 0) mouseDownRef.current = false; };
    const onCtx   = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('contextmenu', onCtx);

    let lastInputSend = 0;
    const INPUT_INTERVAL = 50;

    const loop = (now: number) => {
      const rs = renderStateRef.current;

      // Interpolate tank and bullet positions between ticks
      const curr = currSnapRef.current;
      const prev = prevSnapRef.current;
      if (curr) {
        const alpha = Math.min(1, (now - lastTickTimeRef.current) / TICK_MS);
        if (prev) {
          rs.tanks = curr.tanks.map((c, i) => {
            const p = prev.tanks[i];
            if (!p || c.dead || p.dead) return c;
            return {
              ...c,
              x: lerp(p.x, c.x, alpha),
              y: lerp(p.y, c.y, alpha),
              angle: lerpAngle(p.angle, c.angle, alpha),
              turretAngle: lerpAngle(p.turretAngle, c.turretAngle, alpha),
            };
          });
          // Extrapolate bullets (they move fast, just continue at velocity)
          rs.bullets = curr.bullets.map((c, i) => {
            const p = prev.bullets[i];
            if (!p || p.team !== c.team) return c;
            return {
              x: lerp(p.x, c.x, alpha),
              y: lerp(p.y, c.y, alpha),
              team: c.team,
            };
          });
        } else {
          rs.tanks = curr.tanks;
          rs.bullets = curr.bullets;
        }
      }

      // Update client-side particles
      for (const p of rs.particles) {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.92; p.vy *= 0.92;
        p.life--;
      }
      rs.particles = rs.particles.filter(p => p.life > 0);

      // Send input at 20 Hz
      if (now - lastInputSend >= INPUT_INTERVAL) {
        lastInputSend = now;
        const k = keysRef.current;
        sendMsg({
          type: 'INPUT',
          up: !!(k['w'] || k['arrowup']),
          down: !!(k['s'] || k['arrowdown']),
          left: !!(k['a'] || k['arrowleft']),
          right: !!(k['d'] || k['arrowright']),
          fire: mouseDownRef.current,
          mouseX: mouseXRef.current,
          mouseY: mouseYRef.current,
        });
      }

      draw(ctx, rs);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('contextmenu', onCtx);
    };
  }, []);

  return (
    <Box sx={{
      border: '2px solid #333', lineHeight: 0, cursor: 'crosshair',
      display: phase === 'playing' ? 'block' : 'none',
    }}>
      <canvas ref={canvasRef} width={W} height={H} />
    </Box>
  );
}

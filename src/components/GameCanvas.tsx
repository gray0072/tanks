import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useGameStore } from '../store/useGameStore';
import { draw } from '../game/renderer';
import { onSocketMessage, sendMsg } from '../net/socket';
import { W, H, FLAG_HP } from '../game/constants';
import type { RenderState, Particle, GameEvent } from '../game/types';

const PARTICLE_LIFE = 30;

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

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderStateRef = useRef<RenderState>(mkRenderState(0));
  const rafRef = useRef<number>(0);

  const keysRef = useRef<Record<string, boolean>>({});
  const mouseXRef = useRef(0);
  const mouseYRef = useRef(0);
  const mouseDownRef = useRef(false);

  const phase = useGameStore(s => s.phase);
  const mySlot = useGameStore(s => s.mySlot);
  const walls = useGameStore(s => s.walls);

  // Sync walls and mySlot into renderState when they change
  useEffect(() => {
    renderStateRef.current.walls = walls;
    renderStateRef.current.mySlot = mySlot;
  }, [walls, mySlot]);

  // Subscribe to socket messages
  useEffect(() => {
    const unsub = onSocketMessage((msg) => {
      if (msg.type === 'TICK') {
        const rs = renderStateRef.current;
        rs.tanks = msg.tanks;
        rs.bullets = msg.bullets;
        rs.flags = msg.flags;
        rs.pickups = msg.pickups;

        // Spawn particles from server events
        for (const evt of msg.events) spawnParticles(rs.particles, evt);

        // Update HUD
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

        if (msg.gameOver) {
          useGameStore.getState().setPhase('lobby');
        }
      }
    });
    return unsub;
  }, []);

  // Game loop — runs once for component lifetime
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
    const INPUT_INTERVAL = 50; // send input at ~20Hz

    const loop = (now: number) => {
      // Update particles
      const rs = renderStateRef.current;
      for (const p of rs.particles) {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.92; p.vy *= 0.92;
        p.life--;
      }
      rs.particles = rs.particles.filter(p => p.life > 0);

      // Send input to server
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

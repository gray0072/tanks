export interface Tank {
  id: number;
  controlledBy: string | 'bot';
  x: number;
  y: number;
  angle: number;
  turretAngle: number;
  team: 0 | 1;
  isPlayer: boolean;
  hp: number;
  maxHp: number;
  shootCd: number;
  aiState: 'attack' | 'chase' | 'defend' | 'pickup';
  aiTimer: number;
  targetX: number;
  targetY: number;
  stuckTimer: number;
  prevX: number;
  prevY: number;
  dead: boolean;
  respawnTimer: number;
  speedBuff: number;
  fireBuff: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  team: 0 | 1;
  life: number;
  dmg: number;
}

export interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
}

export interface Flag {
  x: number;
  y: number;
  team: 0 | 1;
  hp: number;
  maxHp: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export interface Pickup {
  x: number;
  y: number;
  type: 'heal' | 'speed' | 'fire';
  pulse: number;
}

// Server-side event accumulated each tick, broadcast to clients for particle effects
export interface GameEvent {
  kind: 'explosion' | 'hit';
  x: number;
  y: number;
  color: string;
  count?: number;
}

// Input sent from client to server each frame
export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  mouseX: number;
  mouseY: number;
}

export interface MutableGameState {
  tanks: Tank[];
  bullets: Bullet[];
  walls: Wall[];
  flags: [Flag, Flag];
  particles: Particle[];
  pickups: Pickup[];
  pickupTimer: number;
  keys: Record<string, boolean>;
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  gameOver: boolean;
  winner: 0 | 1 | null;
  events: GameEvent[];
}

export interface UISnapshot {
  greenFlagHp: number;
  redFlagHp: number;
  playerSpeedBuff: number;
  playerFireBuff: number;
  playerDead: boolean;
  playerRespawnTimer: number;
  gameOver: boolean;
  winner: 0 | 1 | null;
}

// What the client renderer draws each frame (built from server TICK messages)
export interface RenderState {
  tanks: Tank[];
  bullets: { x: number; y: number; team: 0 | 1 }[];
  walls: Wall[];
  flags: [Flag, Flag];
  pickups: Pickup[];
  particles: Particle[];
  mySlot: number;
}

// ── Server → Client messages ──────────────────────────────────────────────

export type S2C =
  | { type: 'WELCOME'; connId: string; slotId: number }
  | { type: 'LOBBY'; slots: (string | null)[]; playerCount: number }
  | { type: 'GAME_START'; walls: Wall[]; mySlot: number }
  | { type: 'TICK'; seq: number; tanks: Tank[]; bullets: { x: number; y: number; team: 0|1 }[]; flags: [Flag, Flag]; pickups: Pickup[]; events: GameEvent[]; gameOver: boolean; winner: 0|1|null }
  | { type: 'GAME_OVER'; winner: 0 | 1 };

// ── Client → Server messages ──────────────────────────────────────────────

export type C2S =
  | { type: 'SET_NAME'; name: string }
  | { type: 'INPUT' } & PlayerInput
  | { type: 'START' };

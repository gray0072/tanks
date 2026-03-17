import type * as Party from 'partykit/server';
import { createInitialState, update } from '../src/game/engine';
import type { MutableGameState, PlayerInput, S2C, C2S } from '../src/game/types';

const TICK_MS = 50;
const MAX_SLOTS = 10;

export default class TanksServer implements Party.Server {
  private gameState: MutableGameState | null = null;
  private slots: (string | null)[] = Array(MAX_SLOTS).fill(null);
  private inputMap: Map<number, PlayerInput> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private phase: 'lobby' | 'playing' = 'lobby';

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    const slot = this.slots.findIndex(s => s === null);
    if (slot === -1) {
      conn.close(1008, 'Room full');
      return;
    }
    this.slots[slot] = conn.id;

    const welcome: S2C = { type: 'WELCOME', connId: conn.id, slotId: slot };
    conn.send(JSON.stringify(welcome));
    this.broadcastLobby();
  }

  onClose(conn: Party.Connection) {
    const slot = this.slots.indexOf(conn.id);
    if (slot !== -1) {
      this.slots[slot] = null;
      this.inputMap.delete(slot);
      if (this.gameState) {
        const tank = this.gameState.tanks[slot];
        if (tank) {
          tank.controlledBy = 'bot';
          tank.isPlayer = false;
        }
      }
    }
    this.broadcastLobby();
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg: C2S = JSON.parse(message);
    if (msg.type === 'INPUT') {
      const slot = this.slots.indexOf(sender.id);
      if (slot !== -1) {
        const { type: _type, ...input } = msg;
        this.inputMap.set(slot, input as PlayerInput);
      }
    } else if (msg.type === 'START') {
      if (this.phase === 'lobby') this.startGame();
    }
  }

  private startGame() {
    this.phase = 'playing';
    this.gameState = createInitialState();

    for (let i = 0; i < MAX_SLOTS; i++) {
      if (this.slots[i] !== null) {
        this.gameState.tanks[i].controlledBy = this.slots[i]!;
        this.gameState.tanks[i].isPlayer = true;
      }
    }

    for (let i = 0; i < MAX_SLOTS; i++) {
      const connId = this.slots[i];
      if (!connId) continue;
      const conn = this.room.getConnection(connId);
      if (!conn) continue;
      const msg: S2C = { type: 'GAME_START', walls: this.gameState.walls, mySlot: i };
      conn.send(JSON.stringify(msg));
    }

    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    if (!this.gameState) return;

    update(this.gameState, this.inputMap);

    const events = [...this.gameState.events];
    this.gameState.events = [];

    const tickMsg: S2C = {
      type: 'TICK',
      seq: Date.now(),
      tanks: this.gameState.tanks,
      bullets: this.gameState.bullets.map(b => ({ x: b.x, y: b.y, team: b.team })),
      flags: this.gameState.flags,
      pickups: this.gameState.pickups,
      events,
      gameOver: this.gameState.gameOver,
      winner: this.gameState.winner,
    };

    this.room.broadcast(JSON.stringify(tickMsg));

    if (this.gameState.gameOver) {
      if (this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
      setTimeout(() => this.resetToLobby(), 5000);
    }
  }

  private resetToLobby() {
    this.phase = 'lobby';
    this.gameState = null;
    this.inputMap.clear();
    this.broadcastLobby();
  }

  private broadcastLobby() {
    const playerCount = this.slots.filter(s => s !== null).length;
    const msg: S2C = { type: 'LOBBY', slots: this.slots, playerCount };
    this.room.broadcast(JSON.stringify(msg));
  }
}

import { create } from 'zustand';
import { FLAG_HP, SPEED_BUFF_DUR, FIRE_BUFF_DUR, RESPAWN_TIME } from '../game/constants';
import type { UISnapshot, Wall } from '../game/types';

export { FLAG_HP, SPEED_BUFF_DUR, FIRE_BUFF_DUR, RESPAWN_TIME };

export type Phase = 'idle' | 'lobby' | 'playing';

interface GameStore extends UISnapshot {
  phase: Phase;
  lobbyPlayerCount: number;
  mySlot: number;
  myConnId: string;
  walls: Wall[];
  setPhase: (phase: Phase) => void;
  setLobby: (playerCount: number) => void;
  setMySlot: (slot: number, connId: string) => void;
  setWalls: (walls: Wall[]) => void;
  updateHUD: (snap: UISnapshot) => void;
  resetStore: () => void;
}

const initialUI: UISnapshot = {
  greenFlagHp: FLAG_HP,
  redFlagHp: FLAG_HP,
  playerSpeedBuff: 0,
  playerFireBuff: 0,
  playerDead: false,
  playerRespawnTimer: 0,
  gameOver: false,
  winner: null,
};

export const useGameStore = create<GameStore>((set) => ({
  ...initialUI,
  phase: 'idle',
  lobbyPlayerCount: 0,
  mySlot: 0,
  myConnId: '',
  walls: [],

  setPhase: (phase) => set({ phase }),
  setLobby: (playerCount) => set({ lobbyPlayerCount: playerCount }),
  setMySlot: (slot, connId) => set({ mySlot: slot, myConnId: connId }),
  setWalls: (walls) => set({ walls }),
  updateHUD: (snap) => set(snap),
  resetStore: () => set({ ...initialUI, phase: 'lobby', lobbyPlayerCount: 0 }),
}));

// Persisted per-viewer settings (SPEC §6 Settings screen) — distinct from
// MatchSettings (world/rules.ts), which is per-room and lives on the host.

import { loadSetting, saveSetting } from "../util/storage";
import {
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_RESPAWN_MULT,
  DEFAULT_TIME_LIMIT,
  DEFAULT_WINS_TARGET,
  type BotDifficulty,
} from "./config";

export type Quality = "auto" | "low" | "high";
export type TouchSide = "left" | "right";

export type UserSettings = {
  nickname: string;
  /** The room code this player likes to host on (SPEC §9.2), or "" for a
   *  fresh random one each time. Remembered so a reload — or next week —
   *  reproduces the same invite link without retyping it. */
  roomCode: string;
  volume: number; // 0..1
  quality: Quality;
  touchSide: TouchSide; // which thumb gets the movement stick (SPEC §5.3)
  autoFullscreen: boolean; // go fullscreen + landscape when a match starts, touch devices only
  showPing: boolean;
  menuBackdrop: boolean; // run the live bot match behind the menus (SPEC §6.3)
};

const DEFAULTS: UserSettings = {
  nickname: "",
  roomCode: "",
  volume: 0.6,
  quality: "auto",
  touchSide: "left",
  autoFullscreen: true,
  showPing: true,
  // On for everyone, reduced-motion preference included: Windows' "Animation
  // effects" switch alone puts a desktop browser in reduced-motion, so keying
  // the backdrop off it meant most Windows players never saw the feature at
  // all. The Settings screen still turns it off in one click.
  menuBackdrop: true,
};

export function loadUserSettings(): UserSettings {
  return { ...DEFAULTS, ...loadSetting<Partial<UserSettings>>("settings", {}) };
}

export function saveUserSettings(s: UserSettings) {
  saveSetting("settings", s);
}

export function randomGuestNickname(): string {
  return "Guest" + Math.floor(1000 + Math.random() * 9000);
}

// --- Room setup (per map) ---------------------------------------------------
// The Create Room screen remembers the map you last used and, for each map,
// the settings you last played it with — a big map usually wants a different
// time limit and respawn pool than a cramped one, so one global set of
// defaults would be wrong for half the maps.

export type RoomSetup = {
  winsTarget: number; // rounds a team must win to take the match (§2.2)
  timeLimit: number; // seconds, one round
  respawnMult: number; // respawns per team member
  botDifficulty: BotDifficulty;
  friendlyFire: boolean;
};

export const DEFAULT_ROOM_SETUP: RoomSetup = {
  winsTarget: DEFAULT_WINS_TARGET,
  timeLimit: DEFAULT_TIME_LIMIT,
  respawnMult: DEFAULT_RESPAWN_MULT,
  botDifficulty: DEFAULT_BOT_DIFFICULTY,
  friendlyFire: false,
};

export function loadLastMapId(): string | null {
  return loadSetting<string | null>("lastMap", null);
}

export function saveLastMapId(mapId: string) {
  saveSetting("lastMap", mapId);
}

export function loadRoomSetup(mapId: string): RoomSetup {
  const all = loadSetting<Record<string, Partial<RoomSetup>>>("roomSetups", {});
  return { ...DEFAULT_ROOM_SETUP, ...(all[mapId] ?? {}) };
}

export function saveRoomSetup(mapId: string, setup: RoomSetup) {
  const all = loadSetting<Record<string, Partial<RoomSetup>>>("roomSetups", {});
  all[mapId] = setup;
  saveSetting("roomSetups", all);
}

/** Drop a deleted custom map's remembered settings (specs/level-editor.md
 *  §5.3) — otherwise the entry outlives the map it belongs to forever. */
export function forgetRoomSetup(mapId: string) {
  const all = loadSetting<Record<string, Partial<RoomSetup>>>("roomSetups", {});
  if (!(mapId in all)) return;
  delete all[mapId];
  saveSetting("roomSetups", all);
}

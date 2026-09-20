// Persisted per-viewer settings (SPEC §6 Settings screen) — distinct from
// MatchSettings (world/rules.ts), which is per-room and lives on the host.

import { loadSetting, saveSetting } from "../util/storage";

export type Quality = "auto" | "low" | "high";
export type TouchSide = "left" | "right";

export type UserSettings = {
  nickname: string;
  volume: number; // 0..1
  quality: Quality;
  touchSide: TouchSide; // which thumb gets the d-pad
  showPing: boolean;
};

const DEFAULTS: UserSettings = {
  nickname: "",
  volume: 0.6,
  quality: "auto",
  touchSide: "left",
  showPing: true,
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

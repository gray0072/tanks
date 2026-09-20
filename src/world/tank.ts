import { Dir } from "../util/math";
import {
  TANK_SIZE,
  TANK_HITBOX,
  TANK_MARGIN,
  CELL,
  DEFAULT_BOT_DIFFICULTY,
  BOT_DIFFICULTY_LABEL,
  TEAM_SIZE,
  type BotDifficulty,
  type TeamId,
} from "../game/config";

export type SlotKind = "human" | "bot";

/** A room slot — 2*teamSize of these, half blue half red (10, 5+5, for every
 *  production map; a debug map, SPEC §3.5, can be smaller). Persists across
 *  the match; a tank is (re)spawned from it. SPEC §2.1. */
export type Slot = {
  id: number; // 0..teamSize-1 blue, teamSize..2*teamSize-1 red (also spawn priority within the team)
  team: TeamId;
  kind: SlotKind;
  nickname: string; // "Easy1".."Hard10" for bots (botNickname()), or a human nickname
  botDifficulty: BotDifficulty;
  /** Which connection owns this slot: "host" or a PeerJS connection id. null
   *  when kind === "bot". */
  owner: string | null;
  /** Which of that owner's local seats controls this slot — 1 for a second
   *  local co-op player (SPEC §5.2), 0 otherwise. */
  ownerSeat: 0 | 1;
  ready: boolean;
};

export type TankState = {
  slot: number;
  team: TeamId;
  alive: boolean;
  x: number; // px, top-left of the 32x32 footprint
  y: number;
  dir: Dir;
  slideT: number; // remaining ice-slide time, seconds
  star: number; // 0..3, SPEC §4.2 — persists through death, resets at match end
  helmetT: number; // remaining HELMET shield seconds
  speedT: number; // remaining SPEED buff seconds
  invulnT: number; // remaining spawn invulnerability seconds
  fireCooldown: number;
  mines: number;
  /** Was the mine button held on the previous tick? Host-side transient, not
   *  in the snapshot — it exists only to make mine-laying edge-triggered, so
   *  holding the key/button lays one mine instead of one per tick. */
  mineHeld: boolean;
  respawnT: number; // > 0 while dead and waiting to respawn
};

export function createTank(slot: number, team: TeamId, spawnCx: number, spawnCy: number): TankState {
  return {
    slot,
    team,
    alive: true,
    x: spawnCx * CELL,
    y: spawnCy * CELL,
    dir: team === "blue" ? Dir.Up : Dir.Down,
    slideT: 0,
    star: 0,
    helmetT: 0,
    speedT: 0,
    invulnT: 0,
    fireCooldown: 0,
    mines: 0,
    mineHeld: false,
    respawnT: 0,
  };
}

export function tankCellSpan(t: TankState): { cx0: number; cy0: number; cx1: number; cy1: number } {
  return {
    cx0: Math.floor(t.x / CELL),
    cy0: Math.floor(t.y / CELL),
    cx1: Math.floor((t.x + TANK_SIZE - 1) / CELL),
    cy1: Math.floor((t.y + TANK_SIZE - 1) / CELL),
  };
}

export function tankCenter(t: TankState): { x: number; y: number } {
  return { x: t.x + TANK_SIZE / 2, y: t.y + TANK_SIZE / 2 };
}

/** The tank's actual collision/visual box — smaller than the 32px logical
 *  slot and centered within it (see TANK_HITBOX in config.ts). */
export function tankHitbox(t: TankState): { x: number; y: number; w: number; h: number } {
  return { x: t.x + TANK_MARGIN, y: t.y + TANK_MARGIN, w: TANK_HITBOX, h: TANK_HITBOX };
}

export function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** A bot's display name — its difficulty plus its position in the roster,
 *  e.g. "Medium3". Numbered from 1, the way a player reads the slot list, so
 *  slot id 0 is "Easy1", not "Easy0". Recomputed whenever the slot's
 *  difficulty changes, so the lobby name always says what the bot plays
 *  like. */
export function botNickname(id: number, difficulty: BotDifficulty): string {
  return `${BOT_DIFFICULTY_LABEL[difficulty]}${id + 1}`;
}

/** The room always starts with the creator in slot 0 and bots filling the
 *  rest — SPEC §2.1: at most `2*teamSize - 1` bots can ever exist because the
 *  room creator always occupies one human slot. `teamSize` comes from the
 *  loaded map's spawn count; the `TEAM_SIZE` default is only for a room built
 *  without a map in hand. Ids `0..teamSize-1` are blue,
 *  `teamSize..2*teamSize-1` are red. */
export function createDefaultSlots(hostNickname: string, teamSize: number = TEAM_SIZE): Slot[] {
  const slots: Slot[] = [];
  const total = teamSize * 2;
  for (let id = 0; id < total; id++) {
    const team: TeamId = id < teamSize ? "blue" : "red";
    if (id === 0) {
      slots.push({
        id,
        team,
        kind: "human",
        nickname: hostNickname,
        botDifficulty: DEFAULT_BOT_DIFFICULTY,
        owner: "host",
        ownerSeat: 0,
        ready: true,
      });
    } else {
      slots.push({
        id,
        team,
        kind: "bot",
        nickname: botNickname(id, DEFAULT_BOT_DIFFICULTY),
        botDifficulty: DEFAULT_BOT_DIFFICULTY,
        owner: null,
        ownerSeat: 0,
        ready: true,
      });
    }
  }
  return slots;
}

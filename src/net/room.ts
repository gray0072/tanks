// Shared surface implemented by both RoomHost (net/host.ts) and RoomClient
// (net/client.ts), so the room/match screens don't need to branch on
// "am I the host" anywhere except the one `isHost` check that gates the
// host-only controls (map/settings/difficulty/kick/start).

import type { Slot } from "../world/tank";
import type { MatchSettings, PlayerStats } from "../world/rules";
import type { SeatInput, MatchEvent, Snapshot } from "../world/sim";
import type { BotDifficultyTarget } from "./protocol";
import type { BotDifficulty, TeamId } from "../game/config";

export type RoomCallbacks = {
  onRoomState?: (slots: Slot[], mapId: string, settings: MatchSettings) => void;
  onMatchStart?: (mapId: string, seed: number, settings: MatchSettings, slots: Slot[]) => void;
  onSnapshot?: (snap: Snapshot) => void;
  onMatchEvents?: (events: MatchEvent[]) => void;
  /** One round of the series ended; the score moved and the next round is
   *  `nextRoundIn` seconds away (SPEC §2.2). */
  onRoundEnd?: (e: {
    winner: TeamId;
    wins: Record<TeamId, number>;
    round: number;
    nextRoundIn: number;
  }) => void;
  /** The next round of the series is running — the match screen rebuilds its
   *  scene for the restored terrain. */
  onRoundStart?: (e: { round: number; wins: Record<TeamId, number> }) => void;
  onMatchEnd?: (
    winner: TeamId | null,
    stats: Record<number, PlayerStats>,
    wins: Record<TeamId, number>,
  ) => void;
  onError?: (message: string) => void;
  /** This client is no longer in the room and is not getting back in: the
   *  host kicked it, or the host is gone (SPEC §9.4). Whoever is on screen
   *  tears the room down and returns to the menu with `reason` — without
   *  this, a kicked player sat in a room that had stopped existing. */
  onLeft?: (e: { reason: string; kicked: boolean }) => void;
};

export interface RoomController {
  readonly isHost: boolean;
  readonly roomCode: string | null;
  readonly mapId: string;
  readonly settings: MatchSettings;
  readonly slots: Slot[];
  /** Screens re-hook these on mount, replacing whatever the previous screen
   *  registered — only one screen is ever "listening" at a time. */
  setCallbacks(cb: RoomCallbacks): void;
  claimSlot(slot: number, localSeat?: 0 | 1): void;
  releaseSlot(slot: number): void;
  setReady(ready: boolean): void;
  setBotDifficulty(target: BotDifficultyTarget, difficulty: BotDifficulty): void;
  setMap(mapId: string): void;
  setSettings(settings: Partial<MatchSettings>): void;
  addLocalSeat(): void;
  removeLocalSeat(): void;
  hasLocalSeat2(): boolean;
  /** Host only; a no-op for a client. */
  startMatch(): void;
  /** Whether Esc can actually freeze the simulation: true only when nobody
   *  else is playing (a local room, or an online room with no peers
   *  connected). Pausing a match other people are in is never allowed, so
   *  their Esc menu is just a menu. */
  canPauseMatch(): boolean;
  /** Host only, and only while `canPauseMatch()` — freezes/unfreezes the Sim. */
  setMatchPaused(paused: boolean): void;
  /** Host only: revert someone else's slot to a bot. */
  kickSlot?(slot: number): void;
  /** Feed this machine's own local input (seat 0, and seat 1 if co-op is
   *  active) once per render frame; the room forwards it to whichever slots
   *  the local player currently owns. */
  setLocalInput(localSeat: 0 | 1, input: SeatInput): void;
  mySlots(): Slot[];
  destroy(): void;
}

export const NO_INPUT: SeatInput = { dir: null, fire: false, mine: false };

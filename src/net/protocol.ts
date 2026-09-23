// Wire messages — SPEC §9.3. Sent as JSON over the PeerJS DataChannel rather
// than the packed binary the spec calls for: correctness first, since binary
// framing can't be verified without two real devices on the internet. The
// message shapes below mirror the spec 1:1, so swapping the transport later
// is a codec change, not an architecture change.

import type { Slot } from "../world/tank";
import type { MatchSettings, PlayerStats } from "../world/rules";
import type { SeatInput, MatchEvent, Snapshot } from "../world/sim";
import type { BotDifficulty, TeamId } from "../game/config";

export type BotDifficultyTarget = number | "all" | TeamId;

/** A player-made map travelling to guests as text — sent only when the room's
 *  map id is a custom one, so built-in traffic is unchanged
 *  (specs/level-editor.md §9). A template is ~4KB at the editor's 64x64
 *  ceiling, which rides the existing JSON messages without chunking. */
export type MapPayload = { id: string; name: string; template: string };

export type ClientMessage =
  | { t: "hello"; nickname: string }
  | { t: "claimSlot"; slot: number; localSeat: 0 | 1 }
  | { t: "releaseSlot"; slot: number }
  | { t: "setReady"; ready: boolean }
  | { t: "setBotDifficulty"; target: BotDifficultyTarget; difficulty: BotDifficulty }
  | { t: "setMap"; mapId: string }
  | { t: "setSettings"; settings: Partial<MatchSettings> }
  | { t: "addLocalSeat" }
  | { t: "removeLocalSeat" }
  | { t: "input"; tick: number; seats: { slot: number; input: SeatInput }[] }
  | { t: "ping"; at: number };

export type HostMessage =
  | { t: "welcome"; connId: string }
  | { t: "roomState"; slots: Slot[]; mapId: string; settings: MatchSettings; mapTemplate?: MapPayload }
  | { t: "matchStart"; mapId: string; seed: number; settings: MatchSettings; slots: Slot[]; mapTemplate?: MapPayload }
  | { t: "snapshot"; snap: Snapshot }
  | { t: "events"; events: MatchEvent[] }
  /** A round of the series finished and nobody has taken the match yet
   *  (SPEC §2.2). The next round starts on its own after `nextRoundIn`
   *  seconds — the countdown runs client-side, so it costs one message, not
   *  one per second. */
  | {
      t: "roundEnd";
      /** Always a team: a round can't end level (SPEC §2.2). */
      winner: TeamId;
      wins: Record<TeamId, number>;
      round: number;
      nextRoundIn: number;
    }
  /** The next round is live: same map, rebuilt terrain, clock back to full. */
  | { t: "roundStart"; round: number; wins: Record<TeamId, number> }
  | {
      t: "matchEnd";
      /** The team that took the series; null only for a match abandoned
       *  before anyone could. */
      winner: TeamId | null;
      stats: Record<number, PlayerStats>;
      /** Rounds won per team — the series score the result screen states. */
      wins: Record<TeamId, number>;
    }
  | { t: "pong"; at: number }
  | { t: "kicked" };

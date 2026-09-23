// The connecting side of a room — SPEC §9.1. Thin: it mirrors host-broadcast
// room/match state and periodically ships this machine's own seat inputs.
// All simulation, including bots, runs on the host; the client never runs a
// Sim of its own (interpolation/prediction is the render layer's job).

import type { Slot } from "../world/tank";
import type { MatchSettings } from "../world/rules";
import type { SeatInput } from "../world/sim";
import { ClientNetwork, type NetErrorInfo } from "./peer";
import { clearTransientMaps, registerTransientMap } from "../world/maps/loader";
import type { HostMessage, BotDifficultyTarget, MapPayload } from "./protocol";
import type { RoomCallbacks, RoomController } from "./room";
import { NO_INPUT } from "./room";
import { NET_INPUT_HZ, type BotDifficulty } from "../game/config";

export class RoomClient implements RoomController {
  readonly isHost = false;
  roomCode: string;
  slots: Slot[] = [];
  mapId = "";
  settings: MatchSettings = { mapId: "", winsTarget: 0, timeLimit: 0, respawnMult: 0, friendlyFire: false };

  private net: ClientNetwork;
  private localInputs: [SeatInput, SeatInput] = [NO_INPUT, NO_INPUT];
  private hasSeat2 = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private lastMatchStart: { mapId: string; seed: number; settings: MatchSettings; slots: Slot[] } | null = null;

  constructor(roomCode: string, private nickname: string, private cb: RoomCallbacks) {
    this.roomCode = roomCode;
    this.net = new ClientNetwork(roomCode, {
      onConnected: () => this.net.send({ t: "hello", nickname: this.nickname }),
      onDisconnected: () => {
        this.stopInputLoop();
        this.cb.onError?.("Disconnected from the host.");
      },
      onMessage: (msg) => this.handleHostMessage(msg),
      onError: (e) => this.cb.onError?.(describeError(e)),
    });
    this.startInputLoop();
  }

  /** A player-made map arrives with the room state as text (specs/level-editor.md
   *  §9). It is held in memory for the length of this room only — a guest never
   *  silently gains maps in their own library. A template we can't parse is
   *  reported rather than joined: a desynced map is worse than no match. */
  private acceptMap(payload: MapPayload | undefined): boolean {
    if (!payload) return true;
    try {
      registerTransientMap(payload.id, payload.name, payload.template);
      return true;
    } catch {
      this.cb.onError?.("The host's map couldn't be loaded.");
      return false;
    }
  }

  private handleHostMessage(msg: HostMessage) {
    switch (msg.t) {
      case "roomState":
        if (!this.acceptMap(msg.mapTemplate)) return;
        this.slots = msg.slots;
        this.mapId = msg.mapId;
        this.settings = msg.settings;
        this.cb.onRoomState?.(this.slots, this.mapId, this.settings);
        break;
      case "matchStart":
        if (!this.acceptMap(msg.mapTemplate)) return;
        this.slots = msg.slots;
        this.mapId = msg.mapId;
        this.settings = msg.settings;
        this.lastMatchStart = { mapId: msg.mapId, seed: msg.seed, settings: msg.settings, slots: msg.slots };
        this.cb.onMatchStart?.(msg.mapId, msg.seed, msg.settings, msg.slots);
        break;
      case "snapshot":
        this.cb.onSnapshot?.(msg.snap);
        break;
      case "events":
        this.cb.onMatchEvents?.(msg.events);
        break;
      case "roundEnd":
        this.cb.onRoundEnd?.({
          winner: msg.winner,
          wins: msg.wins,
          round: msg.round,
          nextRoundIn: msg.nextRoundIn,
        });
        break;
      case "roundStart":
        this.cb.onRoundStart?.({ round: msg.round, wins: msg.wins });
        break;
      case "matchEnd":
        // Must be cleared before setCallbacks() can replay it, or every screen
        // that mounts afterwards is thrown straight back into the match that
        // just ended.
        this.lastMatchStart = null;
        this.cb.onMatchEnd?.(msg.winner, msg.stats, msg.wins);
        break;
      case "kicked":
        this.cb.onKicked?.();
        break;
      case "welcome":
      case "pong":
        break;
    }
  }

  // --- RoomController ------------------------------------------------------

  claimSlot(slot: number, localSeat: 0 | 1 = 0) {
    this.net.send({ t: "claimSlot", slot, localSeat });
  }
  releaseSlot(slot: number) {
    // Giving up seat 1's slot drops P2 out entirely (same rule as the host
    // applies in doRelease), so clear the local flag the lobby button reads.
    if (this.mySlots().find((s) => s.id === slot)?.ownerSeat === 1) this.hasSeat2 = false;
    this.net.send({ t: "releaseSlot", slot });
  }
  setReady(ready: boolean) {
    this.net.send({ t: "setReady", ready });
  }
  setBotDifficulty(target: BotDifficultyTarget, difficulty: BotDifficulty) {
    this.net.send({ t: "setBotDifficulty", target, difficulty });
  }
  setMap(mapId: string) {
    this.net.send({ t: "setMap", mapId });
  }
  setSettings(settings: Partial<MatchSettings>) {
    this.net.send({ t: "setSettings", settings });
  }
  addLocalSeat() {
    this.hasSeat2 = true;
    this.net.send({ t: "addLocalSeat" });
  }
  removeLocalSeat() {
    this.hasSeat2 = false;
    this.net.send({ t: "removeLocalSeat" });
  }
  hasLocalSeat2() {
    return this.hasSeat2;
  }
  startMatch() {
    // Only the host can start a match.
  }
  canPauseMatch() {
    // Never: the match runs on the host, alongside other players.
    return false;
  }
  setMatchPaused() {
    // Ditto — a guest's Esc menu is just a menu.
  }
  setLocalInput(localSeat: 0 | 1, input: SeatInput) {
    this.localInputs[localSeat] = input;
  }
  mySlots(): Slot[] {
    const me = this.net.myId;
    return this.slots.filter((s) => s.owner === me);
  }
  setCallbacks(cb: RoomCallbacks) {
    this.cb = cb;
    if (this.slots.length > 0) this.cb.onRoomState?.(this.slots, this.mapId, this.settings);
    if (this.lastMatchStart) {
      const m = this.lastMatchStart;
      this.cb.onMatchStart?.(m.mapId, m.seed, m.settings, m.slots);
    }
  }

  private startInputLoop() {
    this.last = performance.now();
    const step = () => {
      const now = performance.now();
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;
      this.acc += dt;
      const interval = 1 / NET_INPUT_HZ;
      while (this.acc >= interval) {
        this.sendInput();
        this.acc -= interval;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private stopInputLoop() {
    cancelAnimationFrame(this.raf);
  }

  private sendInput() {
    if (!this.net.connected) return;
    const seats = this.mySlots().map((s) => ({ slot: s.id, input: this.localInputs[s.ownerSeat] }));
    if (seats.length === 0) return;
    this.net.send({ t: "input", tick: 0, seats });
  }

  destroy() {
    this.stopInputLoop();
    this.net.destroy();
    clearTransientMaps();
  }
}

function describeError(e: NetErrorInfo): string {
  if (e.type === "peer-unavailable") return "Room not found or the host is offline.";
  return e.message || "Network error.";
}

// The connecting side of a room — SPEC §9.1. Thin: it mirrors host-broadcast
// room/match state and periodically ships this machine's own seat inputs.
// All simulation, including bots, runs on the host; the client never runs a
// Sim of its own (interpolation/prediction is the render layer's job).

import type { Slot } from "../world/tank";
import type { MatchSettings } from "../world/rules";
import type { SeatInput } from "../world/sim";
import { ClientNetwork, type ClientTransport, type NetErrorInfo } from "./peer";
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

  private net: ClientTransport;
  /** Set once this client is out of the room for good, so a late `close`
   *  can't report "disconnected" on top of "you were kicked". */
  private left = false;
  private localInputs: [SeatInput, SeatInput] = [NO_INPUT, NO_INPUT];
  private hasSeat2 = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private lastMatchStart: { mapId: string; seed: number; settings: MatchSettings; slots: Slot[] } | null = null;

  /** `makeNet` is the test seam (see peer.ts `ClientTransport`). */
  constructor(
    roomCode: string,
    private nickname: string,
    private cb: RoomCallbacks,
    makeNet?: (cb: ConstructorParameters<typeof ClientNetwork>[1]) => ClientTransport,
  ) {
    this.roomCode = roomCode;
    const callbacks = {
      onConnected: () => this.net.send({ t: "hello", nickname: this.nickname }),
      onDisconnected: () => {
        // The host went away (or hung up on us). Either way this room is over
        // for us, so say so rather than leaving the lobby on screen.
        this.leave("The host left — the room is gone.", false);
      },
      onMessage: (msg: HostMessage) => this.handleHostMessage(msg),
      onError: (e: NetErrorInfo) => this.cb.onError?.(describeError(e)),
    };
    this.net = makeNet ? makeNet(callbacks) : new ClientNetwork(roomCode, callbacks);
    this.startInputLoop();
  }

  /** One exit for both ways out of a room (SPEC §9.4): stop talking, forget
   *  the match so no screen can be thrown back into it, and tell whoever is
   *  on screen why. Idempotent — a kick is normally followed by the socket
   *  closing, and that must not report a second reason. */
  private leave(reason: string, kicked: boolean) {
    if (this.left) return;
    this.left = true;
    this.stopInputLoop();
    this.lastMatchStart = null;
    this.cb.onLeft?.({ reason, kicked });
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
        this.leave("The host removed you from the room.", true);
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

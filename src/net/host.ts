// The authoritative side of a room — SPEC §9.1/§9.4. Runs the Sim, all bots,
// and (if online) the star-topology broadcast. Also how purely local /
// hot-seat play works: a "room of one" with `online: false` never opens a
// PeerJS connection at all, so local play is just hosting with no peers.

import {
  type Slot,
  botNickname,
  createDefaultSlots,
} from "../world/tank";
import { Sim, type SeatInput } from "../world/sim";
import { type MatchSettings } from "../world/rules";
import {
  addRoundStats,
  createSeries,
  recordRound,
  seriesWinner,
  type Series,
} from "../world/series";
import { listMaps, getMap, type MapDef } from "../world/maps/loader";
import { getCustomMap, isCustomMapId } from "../world/maps/customMaps";
import { BotController } from "../ai/bot";
import { computeTeamRoles, type Role } from "../ai/teamPlan";
import { HostNetwork, type NetErrorInfo } from "./peer";
import { generateRoomCode } from "./roomCode";
import type { ClientMessage, BotDifficultyTarget, MapPayload } from "./protocol";
import type { RoomCallbacks, RoomController } from "./room";
import { NO_INPUT } from "./room";
import {
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_RESPAWN_MULT,
  DEFAULT_TIME_LIMIT,
  DEFAULT_WINS_TARGET,
  ROUND_INTERMISSION,
  TICK_DT,
  NET_SNAPSHOT_HZ,
  type BotDifficulty,
  type TeamId,
} from "../game/config";

export class RoomHost implements RoomController {
  readonly isHost = true;
  roomCode: string | null = null;

  slots: Slot[];
  mapId: string;
  settings: MatchSettings;

  private net: HostNetwork | null = null;
  private sim: Sim | null = null;
  private bots = new Map<number, BotController>();
  private localInputs: [SeatInput, SeatInput] = [NO_INPUT, NO_INPUT];
  private remoteInputs = new Map<string, Partial<Record<number, SeatInput>>>();
  private connNicknames = new Map<string, string>();
  /** What "All bots" was last set to — the difficulty any slot falls back to
   *  when it stops being a human's. */
  private defaultBotDifficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY;
  private hasSeat2 = false;
  private simPaused = false;
  /** The round series this match is playing out (SPEC §2.2) — null between
   *  matches. Outlives each round's Sim, which is rebuilt from scratch every
   *  time so the terrain, the clock and the respawn pools all come back. */
  private series: Series | null = null;
  /** Seconds left of the breather between two rounds; 0 while a round runs. */
  private intermission = 0;

  /** Seed of the round currently running — replayed to a guest that arrives
   *  mid-match, and regenerated per round so two rounds never draw the same
   *  bonus sequence. */
  private seed = 0;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private snapshotAcc = 0;

  constructor(private hostNickname: string, online: boolean, private cb: RoomCallbacks, initialMapId?: string) {
    // cb is reassigned via setCallbacks() below as screens change
    this.mapId = initialMapId ?? listMaps()[0]?.id ?? "classic";
    // Team size comes from the chosen map's own spawn count, not a hardcoded
    // number — the built-in maps are 5 a side, the debug map is 1v1, and any
    // map in between or beyond sizes the roster to match its `r`/`b` markers.
    const initial = getMap(this.mapId);
    this.slots = createDefaultSlots(hostNickname, initial.spawns.blue.length, initial.spawns.red.length);
    this.settings = {
      mapId: this.mapId,
      winsTarget: DEFAULT_WINS_TARGET,
      timeLimit: DEFAULT_TIME_LIMIT,
      respawnMult: DEFAULT_RESPAWN_MULT,
      friendlyFire: false,
    };

    if (online) {
      this.roomCode = generateRoomCode();
      this.net = new HostNetwork(this.roomCode, {
        onHostReady: () => this.publishRoomState(),
        onPeerLeave: (connId) => this.handlePeerLeave(connId),
        onMessage: (connId, msg) => this.handleClientMessage(connId, msg),
        onError: (e) => this.cb.onError?.(describeError(e)),
      });
    }
    this.publishRoomState();
  }

  private publishRoomState() {
    this.settings.mapId = this.mapId;
    this.cb.onRoomState?.(this.slots, this.mapId, this.settings);
    this.net?.broadcast({
      t: "roomState",
      slots: this.slots,
      mapId: this.mapId,
      settings: this.settings,
      mapTemplate: this.mapPayload(),
    });
  }

  /** A guest doesn't have our localStorage, so a player-made map has to
   *  travel with the room state as text (specs/level-editor.md §9). Built-in
   *  maps send nothing extra — the guest already has them. */
  private mapPayload(): MapPayload | undefined {
    if (!isCustomMapId(this.mapId)) return undefined;
    const record = getCustomMap(this.mapId);
    return record ? { id: record.id, name: record.name, template: record.template } : undefined;
  }

  private handlePeerLeave(connId: string) {
    let changed = false;
    for (const s of this.slots) {
      if (s.owner === connId) {
        this.resetSlotToBot(s);
        changed = true;
      }
    }
    this.connNicknames.delete(connId);
    this.remoteInputs.delete(connId);
    if (changed) this.publishRoomState();
  }

  private resetSlotToBot(s: Slot) {
    // A slot a human is vacating still carries whatever difficulty it had
    // before they claimed it, which may be nothing like what the lobby is set
    // to now — hand it back at the room's current default instead.
    if (s.kind === "human") s.botDifficulty = this.defaultBotDifficulty;
    s.kind = "bot";
    s.nickname = botNickname(s.id, s.botDifficulty);
    s.owner = null;
    s.ownerSeat = 0;
    s.ready = true;
  }

  private handleClientMessage(connId: string, msg: ClientMessage) {
    switch (msg.t) {
      case "hello":
        this.connNicknames.set(connId, msg.nickname.slice(0, 12) || "Player");
        // Joining with a code is already a statement of intent to play, so
        // seat the guest right away instead of making them hunt for a bot row.
        this.autoSeat(connId);
        // Room state is otherwise only broadcast on change, so without this
        // reply a fresh guest sits on a connected-but-silent socket forever.
        this.net?.send(connId, {
          t: "roomState",
          slots: this.slots,
          mapId: this.mapId,
          settings: this.settings,
          mapTemplate: this.mapPayload(),
        });
        if (this.sim) {
          this.net?.send(connId, {
            t: "matchStart",
            mapId: this.sim.map.id,
            seed: this.seed,
            settings: this.sim.settings,
            slots: this.slots,
            mapTemplate: this.mapPayload(),
          });
          // matchStart alone would leave a guest who joined at 3:1 looking at
          // a 0:0 scoreboard, so hand them the series score too.
          if (this.series) {
            this.net?.send(connId, { t: "roundStart", round: this.series.round, wins: this.series.wins });
          }
        }
        break;
      case "claimSlot":
        this.doClaim(connId, msg.slot, msg.localSeat);
        break;
      case "releaseSlot":
        this.doRelease(connId, msg.slot);
        break;
      case "setReady":
        this.doSetReady(connId, msg.ready);
        break;
      case "setBotDifficulty":
        this.applyBotDifficulty(msg.target, msg.difficulty);
        break;
      case "setMap":
        this.doSetMap(msg.mapId);
        break;
      case "setSettings":
        Object.assign(this.settings, msg.settings);
        this.publishRoomState();
        break;
      case "addLocalSeat":
        // A remote client's own local co-op is their concern; the host just
        // needs to know their nickname convention for seat 2, handled at claim time.
        break;
      case "removeLocalSeat":
        for (const s of this.slots) {
          if (s.owner === connId && s.ownerSeat === 1) this.resetSlotToBot(s);
        }
        this.publishRoomState();
        break;
      case "input":
        this.remoteInputs.set(connId, Object.fromEntries(msg.seats.map((s) => [s.slot, s.input])));
        break;
      case "ping":
        this.net?.send(connId, { t: "pong", at: msg.at });
        break;
    }
  }

  /** Put a freshly arrived guest in the first free bot slot, preferring the
   *  team with fewer humans so a room fills up balanced. A no-op once the
   *  match is running — mid-match slots belong to the Sim. */
  private autoSeat(connId: string) {
    if (this.sim) return;
    if (this.slots.some((s) => s.owner === connId)) return;
    const humans = (team: TeamId) =>
      this.slots.filter((s) => s.kind === "human" && s.team === team).length;
    const preferred: TeamId = humans("red") < humans("blue") ? "red" : "blue";
    const free =
      this.slots.find((s) => s.kind === "bot" && s.team === preferred) ??
      this.slots.find((s) => s.kind === "bot");
    if (free) this.doClaim(connId, free.id, 0);
  }

  private doClaim(owner: string, slot: number, localSeat: 0 | 1) {
    const s = this.slots[slot];
    if (!s || s.kind !== "bot") return;
    // Claiming a new slot swaps you out of whichever slot this owner+seat
    // currently holds, rather than leaving a duplicate behind.
    const prev = this.slots.find((p) => p.owner === owner && p.ownerSeat === localSeat);
    if (prev) this.resetSlotToBot(prev);
    s.kind = "human";
    s.owner = owner;
    s.ownerSeat = localSeat;
    s.nickname = owner === "host" ? this.hostNickname : this.connNicknames.get(owner) ?? "Player";
    // The host starts the match themselves, so their own seat(s) never need
    // a Ready toggle — only other humans do.
    s.ready = owner === "host";
    this.publishRoomState();
  }

  private doRelease(owner: string, slot: number) {
    const s = this.slots[slot];
    if (!s || s.owner !== owner) return;
    // A player's primary seat always keeps a slot: releasing the last one
    // would drop them out of the roster entirely with no way back in other
    // than spotting a bot row to click, which just reads as "I vanished".
    // (Seat 1, the local co-op player, may release freely — that's how you
    // drop P2 out of the match.)
    const isOnlyPrimarySlot =
      s.ownerSeat === 0 && !this.slots.some((p) => p !== s && p.owner === owner && p.ownerSeat === 0);
    if (isOnlyPrimarySlot) return;
    // Releasing seat 1's slot *is* dropping P2, so the local-co-op flag goes
    // with it — otherwise the lobby keeps offering "Remove local player 2"
    // for a player who is no longer in the roster.
    if (owner === "host" && s.ownerSeat === 1) this.hasSeat2 = false;
    this.resetSlotToBot(s);
    this.publishRoomState();
  }

  private doSetReady(owner: string, ready: boolean) {
    let changed = false;
    for (const s of this.slots) {
      if (s.owner === owner) { s.ready = ready; changed = true; }
    }
    if (changed) this.publishRoomState();
  }

  private applyBotDifficulty(target: BotDifficultyTarget, difficulty: BotDifficulty) {
    if (target === "all") this.defaultBotDifficulty = difficulty;
    for (const s of this.slots) {
      if (s.kind !== "bot") continue;
      const matches = target === "all" || target === s.team || target === s.id;
      if (!matches) continue;
      s.botDifficulty = difficulty;
      s.nickname = botNickname(s.id, difficulty);
    }
    this.publishRoomState();
  }

  private doSetMap(mapId: string) {
    // getMap, not listMaps() — a room may also be on one of the player's own
    // maps (specs/level-editor.md §2.3). An id that resolves to nothing, or a
    // custom map that has since been deleted or broken, is ignored.
    let map;
    try {
      map = getMap(mapId);
    } catch {
      this.cb.onError?.("That map isn't available any more.");
      return;
    }
    this.mapId = mapId;
    this.resizeRoster(map.spawns.blue.length, map.spawns.red.length);
    this.publishRoomState();
  }

  /** A map carries its own per-team sizes (SPEC §3.5, and the two need not
   *  match), so switching to one that disagrees with the current roster has
   *  to rebuild it: Sim hands out spawns per team in slot order, so a stale
   *  roster silently aliases two tanks onto the same spawn. Humans keep their
   *  team and relative order; anyone who no longer fits loses the slot and
   *  can re-claim from the lobby. */
  private resizeRoster(blueSize: number, redSize: number) {
    const total = blueSize + redSize;
    if (
      this.slots.length === total &&
      this.slots.filter((s) => s.team === "blue").length === blueSize
    ) {
      return;
    }
    const next = createDefaultSlots(this.hostNickname, blueSize, redSize);
    for (const s of next) {
      s.botDifficulty = this.defaultBotDifficulty;
      this.resetSlotToBot(s);
    }
    for (const team of ["blue", "red"] as TeamId[]) {
      const seats = next.filter((s) => s.team === team);
      // Host first, so a shrinking roster never leaves them seatless —
      // doRelease()'s "you always keep a slot" rule depends on it.
      const humans = this.slots
        .filter((s) => s.kind === "human" && s.team === team)
        .sort((a, b) => Number(b.owner === "host") - Number(a.owner === "host") || a.ownerSeat - b.ownerSeat);
      for (let i = 0; i < humans.length && i < seats.length; i++) {
        const dst = seats[i];
        const src = humans[i];
        dst.kind = "human";
        dst.owner = src.owner;
        dst.ownerSeat = src.ownerSeat;
        dst.nickname = src.nickname;
        dst.ready = src.ready;
      }
    }
    this.slots = next;
  }

  // --- RoomController --------------------------------------------------

  claimSlot(slot: number, localSeat: 0 | 1 = 0) {
    this.doClaim("host", slot, localSeat);
  }
  releaseSlot(slot: number) {
    this.doRelease("host", slot);
  }
  setReady(ready: boolean) {
    this.doSetReady("host", ready);
  }
  setBotDifficulty(target: BotDifficultyTarget, difficulty: BotDifficulty) {
    this.applyBotDifficulty(target, difficulty);
  }
  setMap(mapId: string) {
    this.doSetMap(mapId);
  }
  setSettings(settings: Partial<MatchSettings>) {
    Object.assign(this.settings, settings);
    this.publishRoomState();
  }
  addLocalSeat() {
    this.hasSeat2 = true;
  }
  removeLocalSeat() {
    this.hasSeat2 = false;
    for (const s of this.slots) {
      if (s.owner === "host" && s.ownerSeat === 1) this.resetSlotToBot(s);
    }
    this.publishRoomState();
  }
  hasLocalSeat2() {
    return this.hasSeat2;
  }
  kickSlot(slot: number) {
    const s = this.slots[slot];
    if (!s || s.kind !== "human" || s.owner === "host") return;
    if (s.owner) this.net?.kick(s.owner);
    this.resetSlotToBot(s);
    this.publishRoomState();
  }
  mySlots(): Slot[] {
    return this.slots.filter((s) => s.owner === "host");
  }
  setLocalInput(localSeat: 0 | 1, input: SeatInput) {
    this.localInputs[localSeat] = input;
  }
  setCallbacks(cb: RoomCallbacks) {
    this.cb = cb;
    // A screen that mounts after the match already started (or after the
    // room already has state) needs an immediate resync, not just future events.
    this.cb.onRoomState?.(this.slots, this.mapId, this.settings);
    if (this.sim) this.cb.onMatchStart?.(this.sim.map.id, 0, this.sim.settings, this.slots);
  }

  canPauseMatch() {
    // No peers connected means nobody else's match to freeze — an offline
    // room (no `net` at all) or an online room still waiting for guests.
    return (this.net?.connectionIds.length ?? 0) === 0;
  }
  setMatchPaused(paused: boolean) {
    if (paused && !this.canPauseMatch()) return;
    this.simPaused = paused;
    // Resuming restarts the clock from now, so the paused wall-time doesn't
    // come back as a burst of catch-up ticks.
    this.last = performance.now();
    this.acc = 0;
  }

  startMatch() {
    if (this.sim) return;
    this.simPaused = false;
    const humansReady = this.slots
      .filter((s) => s.kind === "human" && s.owner !== "host")
      .every((s) => s.ready);
    if (!humansReady) return;

    // getMap, not listMaps().find — it also resolves the debug map
    // (config.DEBUG), which is deliberately kept out of listMaps().
    const map = getMap(this.mapId);
    this.series = createSeries(this.settings.winsTarget, this.slots);
    this.intermission = 0;
    this.buildRound(map);

    this.cb.onMatchStart?.(map.id, this.seed, this.sim!.settings, this.slots);
    this.net?.broadcast({
      t: "matchStart",
      mapId: map.id,
      seed: this.seed,
      settings: this.sim!.settings,
      slots: this.slots,
      mapTemplate: this.mapPayload(),
    });

    this.last = performance.now();
    this.acc = 0;
    this.snapshotAcc = 0;
    this.loop();
  }

  /** One round: a fresh Sim (so the terrain, clock and respawn pools are back
   *  to the map's own state — Sim copies the cached MapDef's grid) and a fresh
   *  bot per bot slot. The room, the roster and the series score carry over. */
  private buildRound(map: MapDef) {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.sim = new Sim(map, { ...this.settings, mapId: map.id }, this.slots, this.seed);
    this.bots.clear();
    for (const s of this.slots) if (s.kind === "bot") this.bots.set(s.id, new BotController(s.id));
  }

  /** Starts the next round of a series already under way. */
  private startNextRound() {
    const series = this.series;
    if (!series) return;
    this.intermission = 0;
    this.buildRound(getMap(this.mapId));
    const e = { round: series.round, wins: series.wins };
    this.cb.onRoundStart?.(e);
    this.net?.broadcast({ t: "roundStart", ...e });
  }

  private loop = () => {
    const now = performance.now();
    // A peer connecting while we're paused un-pauses us: their match can't
    // be held hostage by the host's menu.
    if (this.simPaused && !this.canPauseMatch()) this.simPaused = false;
    if (this.simPaused) {
      this.last = now;
      this.acc = 0;
      this.raf = requestAnimationFrame(this.loop);
      return;
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    // Between rounds the world is left standing exactly as the round ended —
    // nothing is stepped, so the last snapshot the clients hold stays valid
    // for the whole breather (SPEC §2.2).
    if (this.intermission > 0) {
      this.intermission -= dt;
      this.acc = 0;
      if (this.intermission <= 0) this.startNextRound();
      if (this.sim) this.raf = requestAnimationFrame(this.loop);
      return;
    }
    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.tick();
      this.acc -= TICK_DT;
      if (!this.sim || this.intermission > 0) break;
    }
    if (this.sim) this.raf = requestAnimationFrame(this.loop);
  };

  private tick() {
    const sim = this.sim;
    if (!sim) return;
    const roles: Record<TeamId, Map<number, Role>> = {
      blue: computeTeamRoles(sim, "blue"),
      red: computeTeamRoles(sim, "red"),
    };
    const inputs: Record<number, SeatInput> = {};
    for (const s of sim.slots) {
      if (s.kind === "bot") {
        // A slot can turn bot mid-match (handlePeerLeave/kickSlot mutate the
        // same array the Sim holds), so the id may be one startMatch() never
        // built a controller for — hand the abandoned tank to a fresh bot.
        let bot = this.bots.get(s.id);
        if (!bot) {
          bot = new BotController(s.id);
          this.bots.set(s.id, bot);
        }
        inputs[s.id] = bot.decide(sim, roles[s.team], s.botDifficulty);
      } else if (s.owner === "host") {
        inputs[s.id] = this.localInputs[s.ownerSeat];
      } else if (s.owner) {
        inputs[s.id] = this.remoteInputs.get(s.owner)?.[s.id] ?? NO_INPUT;
      } else {
        inputs[s.id] = NO_INPUT;
      }
    }

    const events = sim.step(inputs, TICK_DT);
    this.cb.onSnapshot?.(sim.snapshot());
    if (events.length) this.cb.onMatchEvents?.(events);

    this.snapshotAcc += TICK_DT;
    if (this.net && this.snapshotAcc >= 1 / NET_SNAPSHOT_HZ) {
      this.snapshotAcc = 0;
      this.net.broadcast({ t: "snapshot", snap: sim.snapshot() });
    }
    if (this.net && events.length) this.net.broadcast({ t: "events", events });

    if (sim.rules.ended) this.endRound(sim);
  }

  /** A round is over (a flag fell, a team ran out of respawns, or the clock
   *  expired). The score moves, and either the match is decided or the next
   *  round is queued up behind the intermission countdown — SPEC §2.2. */
  private endRound(sim: Sim) {
    const series = this.series;
    const { winner, stats } = sim.rules;
    if (!series) {
      // Defensive: a match with no series can only be a bug, but ending it is
      // still better than looping the round forever.
      cancelAnimationFrame(this.raf);
      this.sim = null;
      this.cb.onMatchEnd?.(winner, stats, { blue: 0, red: 0 });
      this.net?.broadcast({ t: "matchEnd", winner, stats, wins: { blue: 0, red: 0 } });
      return;
    }

    addRoundStats(series, stats);
    const round = series.round;
    if (!winner) {
      // Unreachable: sim.ts only ends a round with a winner (SPEC §2.2, no
      // drawn rounds). Replaying beats hanging the match if it ever happens.
      this.intermission = ROUND_INTERMISSION;
      return;
    }
    recordRound(series, winner);
    const champion = seriesWinner(series);

    if (!champion) {
      this.intermission = ROUND_INTERMISSION;
      const e = { winner, wins: series.wins, round, nextRoundIn: ROUND_INTERMISSION };
      this.cb.onRoundEnd?.(e);
      this.net?.broadcast({ t: "roundEnd", ...e });
      return;
    }

    cancelAnimationFrame(this.raf);
    const wins = series.wins;
    const total = series.stats;
    this.series = null;
    this.intermission = 0;
    // Drop the Sim before announcing the end: whoever handles this mounts a
    // screen synchronously, and setCallbacks() replays matchStart for as
    // long as `sim` is still set — which bounced the host back into the
    // match it had just finished.
    this.sim = null;
    this.cb.onMatchEnd?.(champion, total, wins);
    this.net?.broadcast({ t: "matchEnd", winner: champion, stats: total, wins });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.net?.destroy();
  }
}

function describeError(e: NetErrorInfo): string {
  if (e.type === "peer-unavailable") return "Room not found or the host is offline.";
  if (e.type === "unavailable-id") return "That room code is already taken — try again.";
  return e.message || "Network error.";
}

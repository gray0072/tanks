import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import type { RoomController } from "../../net/room";
import type { Slot } from "../../world/tank";
import { getMap, getTransientSource } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import { createCustomMap, getCustomMap, isCustomMapId, MapStorageError, uniqueMapName } from "../../world/maps/customMaps";
import { drawMapPreview, drawTankPreview } from "../../render/preview";
import { MatchScreen } from "./MatchScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { bindEnter } from "../../util/dialog";
import {
  BOT_DIFFICULTIES as DIFFS,
  BOT_DIFFICULTY_LABEL as DIFF_LABEL,
  type BotDifficulty,
  type TeamId,
} from "../../game/config";

export class RoomScreen implements Screen {
  private el!: HTMLElement;
  private slots: Slot[] = [];
  private mapId = "";
  private hoverSlot: number | null = null;
  private pendingLocalSeat: 0 | 1 = 0;
  private navigatedToMatch = false;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager, private room: RoomController) {}

  mount(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "screen";
    root.appendChild(this.el);

    this.room.setCallbacks({
      onRoomState: (slots, mapId) => {
        this.slots = slots;
        this.mapId = mapId;
        this.render();
      },
      onMatchStart: () => {
        if (this.navigatedToMatch) return;
        this.navigatedToMatch = true;
        this.screens.go(new MatchScreen(this.screens, this.room));
      },
      onError: (msg) => this.showBanner(msg),
    });

    // Enter is the room's primary action: start the match as host, toggle
    // Ready as a guest. Bound once for the screen — render() rewires the
    // buttons on every room update, but this reads the live state on press.
    this.unbindEnter = bindEnter(() => this.primaryAction());

    this.render();
  }

  private primaryAction() {
    if (this.room.isHost) {
      const humansReady = this.slots
        .filter((s) => s.kind === "human" && s.owner !== "host")
        .every((s) => s.ready);
      if (humansReady) this.room.startMatch();
    } else {
      this.room.setReady(!(this.room.mySlots()[0]?.ready ?? false));
    }
  }

  private render() {
    const isHost = this.room.isHost;
    const code = this.room.roomCode;
    const mySlotIds = new Set(this.room.mySlots().map((s) => s.id));
    const myReady = this.room.mySlots()[0]?.ready ?? false;
    // The host starts the match themselves, so their own seat(s) don't need
    // to be Ready — only other humans block Start match.
    const humansReady = this.slots
      .filter((s) => s.kind === "human" && s.owner !== "host")
      .every((s) => s.ready);

    this.el.innerHTML = `
      <div class="row between room-header">
        <div class="title" style="font-size:1.4rem">Room ${code ? `<span style="letter-spacing:.2em">${code}</span>` : "(offline)"}</div>
        <div class="row">
          ${code ? `<button data-a="copy">Copy code</button><button data-a="invite">Invite link</button>` : ""}
          <button data-a="leave">Leave</button>
        </div>
      </div>
      <div class="hint" data-f="banner"></div>
      <div class="room-layout">
        <div class="room-rosters">
          ${this.renderTeamBlock("blue", mySlotIds, isHost)}
          ${this.renderTeamBlock("red", mySlotIds, isHost)}
          <div class="row wrap">
            <span class="hint">All bots:</span>
            ${DIFFS.map((d) => `<button class="chip" data-all-diff="${d}">${DIFF_LABEL[d]}</button>`).join("")}
          </div>
        </div>
        <div class="preview-panel">
          <canvas data-f="preview" width="256" height="160"></canvas>
          <canvas data-f="tank" width="300" height="190"></canvas>
          <div class="hint" data-f="mapinfo"></div>
          <div class="row wrap" data-f="mapactions"></div>
          <div class="row wrap">
            ${this.room.hasLocalSeat2()
              ? `<button data-a="removeSeat2">Remove local player 2</button>`
              : `<button data-a="addSeat2">Add local player 2</button>`}
          </div>
          ${this.pendingLocalSeat === 1 ? `<div class="hint">Player 2: pick a bot slot below.</div>` : ""}
          <div class="row between">
            ${isHost ? "" : `<button class="${myReady ? "primary" : ""}" data-a="ready">${myReady ? "Ready ✔" : "Ready"}</button>`}
            ${isHost ? `<button class="primary" data-a="start" ${humansReady ? "" : "disabled"}>Start match</button>` : ""}
          </div>
        </div>
      </div>
    `;

    this.wire();
  }

  private renderTeamBlock(team: TeamId, mySlotIds: Set<number>, isHost: boolean): string {
    const rows = this.slots
      .filter((s) => s.team === team)
      .map((s) => this.renderSlotRow(s, mySlotIds.has(s.id), isHost))
      .join("");
    return `<div class="team-block ${team}"><h3>${team.toUpperCase()}</h3>${rows}</div>`;
  }

  private renderSlotRow(s: Slot, mine: boolean, isHost: boolean): string {
    const chip = s.kind === "bot"
      ? `<button class="chip ${isHost ? "" : "disabled"}" data-diff-slot="${s.id}">${DIFF_LABEL[s.botDifficulty]}</button>`
      : `<span></span>`;
    const kick = s.kind === "human" && !mine && isHost ? `<button class="small" data-kick="${s.id}">kick</button>` : `<span></span>`;
    return `
      <div class="slot-row ${mine ? "mine" : ""}" data-slot="${s.id}">
        ${chip}
        <span>${escapeHtml(s.nickname)}${s.kind === "human" && s.ownerSeat === 1 ? " (P2)" : ""}</span>
        <span class="hint">${s.kind === "bot" ? "bot" : mine ? "you" : ""}</span>
        ${kick}
        <span class="ready">${s.ready ? "✔" : ""}</span>
      </div>
    `;
  }

  private wire() {
    this.el.querySelector<HTMLButtonElement>("[data-a=leave]")!.onclick = () => {
      this.room.destroy();
      this.screens.go(new MainMenuScreen(this.screens));
    };
    this.el.querySelector<HTMLButtonElement>("[data-a=copy]")?.addEventListener("click", () => {
      if (this.room.roomCode) navigator.clipboard?.writeText(this.room.roomCode).catch(() => {});
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=invite]")?.addEventListener("click", () => {
      if (!this.room.roomCode) return;
      const url = `${location.origin}${location.pathname}?room=${this.room.roomCode}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      this.showBanner("Invite link copied.");
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=addSeat2]")?.addEventListener("click", () => {
      this.room.addLocalSeat();
      this.pendingLocalSeat = 1;
      this.render();
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=removeSeat2]")?.addEventListener("click", () => {
      this.room.removeLocalSeat();
      this.pendingLocalSeat = 0;
      this.render();
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=ready]")?.addEventListener("click", () => {
      const myReady = this.room.mySlots()[0]?.ready ?? false;
      this.room.setReady(!myReady);
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=start]")?.addEventListener("click", () => this.room.startMatch());

    this.el.querySelectorAll<HTMLButtonElement>("[data-all-diff]").forEach((b) => {
      b.onclick = () => this.room.setBotDifficulty("all", b.dataset.allDiff as BotDifficulty);
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-diff-slot]").forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const slotId = Number(b.dataset.diffSlot);
        const slot = this.slots.find((s) => s.id === slotId);
        if (!slot) return;
        const next = DIFFS[(DIFFS.indexOf(slot.botDifficulty) + 1) % DIFFS.length];
        this.room.setBotDifficulty(slotId, next);
      };
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-kick]").forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        this.room.kickSlot?.(Number(b.dataset.kick));
      };
    });

    this.el.querySelectorAll<HTMLDivElement>("[data-slot]").forEach((row) => {
      const slotId = Number(row.dataset.slot);
      row.addEventListener("mouseenter", () => { this.hoverSlot = slotId; this.updatePreview(); });
      row.addEventListener("click", () => this.onSlotClick(slotId));
    });

    this.updatePreview();
  }

  private onSlotClick(slotId: number) {
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) return;
    const mySlotIds = new Set(this.room.mySlots().map((s) => s.id));
    if (mySlotIds.has(slotId)) {
      // Your primary seat always keeps a slot (see RoomHost.doRelease) — say
      // so instead of letting the click look like it did nothing.
      const primaries = this.room.mySlots().filter((s) => s.ownerSeat === 0);
      if (slot.ownerSeat === 0 && primaries.length <= 1) {
        this.showBanner("You need a slot — click another slot to move there.");
        return;
      }
      this.room.releaseSlot(slotId);
    } else if (slot.kind === "bot") {
      // Reset before claiming: RoomHost's callback fires synchronously, so
      // resetting after would re-render with the stale pending seat.
      const seat = this.pendingLocalSeat;
      this.pendingLocalSeat = 0;
      this.room.claimSlot(slotId, seat);
    }
  }

  private updatePreview() {
    if (!this.mapId) return;
    const map = getMap(this.mapId);
    const previewCanvas = this.el.querySelector<HTMLCanvasElement>("[data-f=preview]");
    const tankCanvas = this.el.querySelector<HTMLCanvasElement>("[data-f=tank]");
    const info = this.el.querySelector<HTMLDivElement>("[data-f=mapinfo]");
    if (info) {
      // Size and roster sit where the decision is made, same as on a map card
      // (specs/level-editor.md §5.2).
      info.textContent = `Map: ${map.name} · ${mapSizeLabel(map)} · ${(this.room.settings?.timeLimit ?? 0) / 60 | 0} min · ${this.room.settings?.respawns ?? "?"} respawns`;
    }
    this.renderMapActions(map.id, map.name);

    const hovered = this.hoverSlot !== null ? this.slots.find((s) => s.id === this.hoverSlot) : undefined;
    if (previewCanvas) {
      let hoverCell: { cx: number; cy: number } | undefined;
      if (hovered) {
        // Same indexing as Sim's tank placement, so the ring marks the spawn
        // this slot will actually get.
        const spawns = map.spawns[hovered.team];
        hoverCell = spawns[hovered.id % spawns.length] ?? spawns[0];
      }
      drawMapPreview(previewCanvas, map, { hoverCell, hoverTeam: hovered?.team });
    }
    if (tankCanvas) {
      // Hidden, not just cleared, while nothing is hovered: a touch device
      // never hovers, so a permanently blank 300x190 canvas would only push
      // the Start match button off the bottom of a phone screen.
      tankCanvas.hidden = !hovered;
      if (hovered) drawTankPreview(tankCanvas, hovered.team, hovered.nickname);
      else tankCanvas.getContext("2d")?.clearRect(0, 0, tankCanvas.width, tankCanvas.height);
    }
  }

  /** A guest is playing on the host's own map; offer to keep it. This is the
   *  only way someone else's map enters the local library (specs/level-editor.md §9). */
  private renderMapActions(mapId: string, mapName: string) {
    const host = this.el.querySelector<HTMLDivElement>("[data-f=mapactions]");
    if (!host) return;
    const source = isCustomMapId(mapId) ? getTransientSource(mapId) : null;
    const savable = source !== null && !getCustomMap(mapId);
    if (!savable || !source) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `<span class="map-tag">custom</span><button class="small" data-a="saveMap">Save to my maps</button>`;
    host.querySelector<HTMLButtonElement>("[data-a=saveMap]")!.onclick = () => {
      try {
        createCustomMap({
          name: uniqueMapName(mapName),
          template: source.template,
          origin: { kind: "import" },
        });
        this.showBanner(`"${mapName}" saved to your maps.`);
        this.updatePreview();
      } catch (e) {
        this.showBanner(e instanceof MapStorageError ? e.message : "Couldn't save that map.");
      }
    };
  }

  private showBanner(msg: string) {
    const el = this.el.querySelector<HTMLDivElement>("[data-f=banner]");
    if (el) el.textContent = msg;
  }

  unmount() {
    this.unbindEnter?.();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

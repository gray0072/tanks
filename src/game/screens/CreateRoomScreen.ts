import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { listMaps } from "../../world/maps/loader";
import { drawMapPreview } from "../../render/preview";
import { RoomHost } from "../../net/host";
import { RoomScreen } from "./RoomScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { bindEnter } from "../../util/dialog";
import {
  loadUserSettings,
  saveUserSettings,
  randomGuestNickname,
  loadLastMapId,
  saveLastMapId,
  loadRoomSetup,
  saveRoomSetup,
  type RoomSetup,
} from "../settings";
import {
  BOT_DIFFICULTY_LABEL,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_RESPAWNS,
  DEFAULT_TIME_LIMIT,
  type BotDifficulty,
} from "../../game/config";

const MAP_BLURB: Record<string, string> = {
  classic: "Battle City homage: brick mazes, steel spine, water gate at midfield.",
  crossroads: "Four open lanes meeting in the middle, minimal cover, fast and lethal.",
  swamp: "Water channels and sand flats — movement is the puzzle.",
  thicket: "Wide and horizontal, bases left and right, dense forest cover.",
};

export class CreateRoomScreen implements Screen {
  private el!: HTMLElement;
  private selectedMap: string;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager) {
    // Reopen on the map you played last, unless it's gone from the build.
    const maps = listMaps();
    const last = loadLastMapId();
    this.selectedMap = (last && maps.some((m) => m.id === last) ? last : maps[0]?.id) ?? "classic";
  }

  mount(root: HTMLElement) {
    const settings = loadUserSettings();
    this.el = document.createElement("div");
    this.el.className = "screen";
    this.el.innerHTML = `
      <div class="title">Create Room</div>
      <div class="panel panel-wide">
        <label>Nickname
          <input type="text" data-f="nickname" maxlength="12" value="${escapeAttr(settings.nickname || randomGuestNickname())}" />
        </label>

        <label>Map</label>
        <div class="row wrap" data-f="maps"></div>

        <div class="row wrap">
          <label>Time limit
            <select data-f="timeLimit">
              <option value="300">5 min</option>
              <option value="600" selected>10 min</option>
              <option value="900">15 min</option>
            </select>
          </label>
          <label>Respawns
            <select data-f="respawns">
              <option value="15">15</option>
              <option value="25" selected>25</option>
              <option value="40">40</option>
            </select>
          </label>
          <label>Default bot difficulty
            <select data-f="difficulty">
              <option value="easy">${BOT_DIFFICULTY_LABEL.easy}</option>
              <option value="normal" selected>${BOT_DIFFICULTY_LABEL.normal}</option>
              <option value="hard">${BOT_DIFFICULTY_LABEL.hard}</option>
            </select>
          </label>
          <label style="flex-direction:row;align-items:center;gap:6px;">
            <input type="checkbox" data-f="friendlyFire" style="width:auto" /> Friendly fire
          </label>
        </div>

        <div class="error" data-f="error"></div>
        <div class="row between">
          <button data-a="back">Back</button>
          <button class="primary" data-a="create">Create</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    const mapsEl = this.el.querySelector<HTMLDivElement>("[data-f=maps]")!;
    for (const map of listMaps()) {
      const card = document.createElement("button");
      card.type = "button";
      // Class, not inline styles: the phone media queries in style.css have to
      // be able to shrink this card, and an inline width would outrank them.
      card.className = "map-card";
      card.innerHTML = `<canvas width="160" height="100"></canvas><b>${map.name}</b><span class="hint">${MAP_BLURB[map.id] ?? ""}</span>`;
      const canvas = card.querySelector("canvas")!;
      drawMapPreview(canvas, map);
      card.onclick = () => {
        // Each map keeps its own settings, so stash the current form under
        // the outgoing map before loading the incoming one's.
        saveRoomSetup(this.selectedMap, this.readSetup());
        this.selectedMap = map.id;
        this.applySetup(loadRoomSetup(map.id));
        this.refreshMapSelection();
      };
      card.dataset.map = map.id;
      mapsEl.appendChild(card);
    }
    this.refreshMapSelection();
    this.applySetup(loadRoomSetup(this.selectedMap));

    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new MainMenuScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=create]")!.onclick = () => this.create();
    this.unbindEnter = bindEnter(() => this.create());
  }

  private refreshMapSelection() {
    this.el.querySelectorAll<HTMLButtonElement>("[data-f=maps] button").forEach((b) => {
      b.classList.toggle("selected", b.dataset.map === this.selectedMap);
    });
  }

  /** The form's current values, as they'd be persisted for this map. */
  private readSetup(): RoomSetup {
    return {
      timeLimit: Number(this.field<HTMLSelectElement>("timeLimit").value) || DEFAULT_TIME_LIMIT,
      respawns: Number(this.field<HTMLSelectElement>("respawns").value) || DEFAULT_RESPAWNS,
      botDifficulty: (this.field<HTMLSelectElement>("difficulty").value as BotDifficulty) || DEFAULT_BOT_DIFFICULTY,
      friendlyFire: (this.field("friendlyFire") as HTMLInputElement).checked,
    };
  }

  private applySetup(setup: RoomSetup) {
    this.field<HTMLSelectElement>("timeLimit").value = String(setup.timeLimit);
    this.field<HTMLSelectElement>("respawns").value = String(setup.respawns);
    this.field<HTMLSelectElement>("difficulty").value = setup.botDifficulty;
    (this.field("friendlyFire") as HTMLInputElement).checked = setup.friendlyFire;
  }

  private create() {
    const nickname = this.field("nickname").value.trim().slice(0, 12) || randomGuestNickname();
    saveUserSettings({ ...loadUserSettings(), nickname });

    const setup = this.readSetup();
    saveRoomSetup(this.selectedMap, setup);
    saveLastMapId(this.selectedMap);

    const room = new RoomHost(nickname, true, {
      onError: (msg) => this.showError(msg),
    });
    room.setMap(this.selectedMap);
    room.setSettings({ timeLimit: setup.timeLimit, respawns: setup.respawns, friendlyFire: setup.friendlyFire });
    room.setBotDifficulty("all", setup.botDifficulty);
    this.screens.go(new RoomScreen(this.screens, room));
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.el.querySelector<T>(`[data-f=${name}]`)!;
  }

  private showError(msg: string) {
    this.field("error").textContent = msg;
  }

  unmount() {
    this.unbindEnter?.();
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

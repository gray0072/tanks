import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { listMaps } from "../../world/maps/loader";
import { drawMapPreview } from "../../render/preview";
import { RoomHost } from "../../net/host";
import { RoomScreen } from "./RoomScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { bindEnter } from "../../util/dialog";
import { loadUserSettings, saveUserSettings, randomGuestNickname } from "../settings";
import {
  BOT_DIFFICULTY_LABEL,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_TICKETS,
  DEFAULT_TIME_LIMIT,
  type BotDifficulty,
} from "../../game/config";

const MAP_BLURB: Record<string, string> = {
  classic: "Battle City homage: brick mazes, steel spine, water gate at midfield.",
  crossroads: "Four open lanes meeting in the middle, minimal cover, fast and lethal.",
  swamp: "Water channels and sand flats — movement is the puzzle.",
};

export class CreateRoomScreen implements Screen {
  private el!: HTMLElement;
  private selectedMap: string;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager) {
    this.selectedMap = listMaps()[0]?.id ?? "classic";
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
          <label>Respawn tickets
            <select data-f="tickets">
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
      card.style.cssText = "display:flex;flex-direction:column;gap:6px;width:180px;padding:8px;align-items:stretch;";
      card.innerHTML = `<canvas width="160" height="100"></canvas><b>${map.name}</b><span class="hint">${MAP_BLURB[map.id] ?? ""}</span>`;
      const canvas = card.querySelector("canvas")!;
      drawMapPreview(canvas, map);
      card.onclick = () => { this.selectedMap = map.id; this.refreshMapSelection(); };
      card.dataset.map = map.id;
      mapsEl.appendChild(card);
    }
    this.refreshMapSelection();

    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new MainMenuScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=create]")!.onclick = () => this.create();
    this.unbindEnter = bindEnter(() => this.create());
  }

  private refreshMapSelection() {
    this.el.querySelectorAll<HTMLButtonElement>("[data-f=maps] button").forEach((b) => {
      b.style.outline = b.dataset.map === this.selectedMap ? "2px solid var(--blue)" : "none";
    });
  }

  private create() {
    const nickname = this.field("nickname").value.trim().slice(0, 12) || randomGuestNickname();
    saveUserSettings({ ...loadUserSettings(), nickname });

    const timeLimit = Number(this.field<HTMLSelectElement>("timeLimit").value) || DEFAULT_TIME_LIMIT;
    const tickets = Number(this.field<HTMLSelectElement>("tickets").value) || DEFAULT_TICKETS;
    const difficulty = this.field<HTMLSelectElement>("difficulty").value as BotDifficulty;
    const friendlyFire = (this.field("friendlyFire") as HTMLInputElement).checked;

    const room = new RoomHost(nickname, true, {
      onError: (msg) => this.showError(msg),
    });
    room.setMap(this.selectedMap);
    room.setSettings({ timeLimit, tickets, friendlyFire });
    room.setBotDifficulty("all", difficulty || DEFAULT_BOT_DIFFICULTY);
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

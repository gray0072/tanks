import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { listMaps, listPlayableMaps } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import { drawMapPreview } from "../../render/preview";
import { MapLibraryScreen } from "./MapLibraryScreen";
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

export class CreateRoomScreen implements Screen {
  private el!: HTMLElement;
  private selectedMap: string;
  private unbindEnter: (() => void) | null = null;

  /** `initialMapId` is what the map library (specs/level-editor.md §5) hands
   *  back on Continue; without one, reopen on the map played last, unless it
   *  has since been deleted or dropped from the build. */
  constructor(private screens: ScreenManager, initialMapId?: string) {
    const maps = listPlayableMaps();
    const wanted = initialMapId ?? loadLastMapId();
    this.selectedMap = (wanted && maps.some((m) => m.id === wanted) ? wanted : maps[0]?.id) ?? "classic";
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
        <div class="row between wrap map-row">
          <div class="row">
            <canvas class="map-row-thumb" width="120" height="76"></canvas>
            <div>
              <b data-f="mapName"></b>
              <div class="map-meta" data-f="mapMeta"></div>
            </div>
          </div>
          <button data-a="changeMap">Change…</button>
        </div>

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

    this.refreshMapRow();
    this.applySetup(loadRoomSetup(this.selectedMap));
    this.el.querySelector<HTMLButtonElement>("[data-a=changeMap]")!.onclick = () => this.openLibrary();

    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new MainMenuScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=create]")!.onclick = () => this.create();
    this.unbindEnter = bindEnter(() => this.create());
  }

  /** The map line replaces the old inline card grid: the library screen owns
   *  picking now, so this is just "what am I about to play" plus a way in. */
  private refreshMapRow() {
    const map = listPlayableMaps().find((m) => m.id === this.selectedMap) ?? listMaps()[0];
    if (!map) return;
    this.selectedMap = map.id;
    this.el.querySelector<HTMLElement>("[data-f=mapName]")!.textContent = map.name;
    this.el.querySelector<HTMLElement>("[data-f=mapMeta]")!.textContent = mapSizeLabel(map);
    drawMapPreview(this.el.querySelector<HTMLCanvasElement>(".map-row-thumb")!, map);
  }

  private openLibrary() {
    // Each map keeps its own settings, so stash the current form under the
    // outgoing map before leaving for the picker.
    saveRoomSetup(this.selectedMap, this.readSetup());
    const nickname = this.field("nickname").value.trim().slice(0, 12);
    if (nickname) saveUserSettings({ ...loadUserSettings(), nickname });
    const reopen = (mapId: string) => this.screens.go(new CreateRoomScreen(this.screens, mapId));
    this.screens.go(
      new MapLibraryScreen(this.screens, {
        mode: "pick",
        selectedMapId: this.selectedMap,
        onPick: reopen,
        onBack: () => reopen(this.selectedMap),
      }),
    );
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

import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { MainMenuScreen } from "./MainMenuScreen";
import { loadUserSettings, saveUserSettings, type Quality, type TouchSide } from "../settings";
import { audio } from "../../audio/audio";
import { bindEnter } from "../../util/dialog";
import { menuBackdrop as backdrop } from "../menuBackdrop";

export class SettingsScreen implements Screen {
  private el!: HTMLElement;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager) {}

  mount(root: HTMLElement) {
    const s = loadUserSettings();
    this.el = document.createElement("div");
    this.el.className = "screen";
    this.el.innerHTML = `
      <div class="title">Settings</div>
      <div class="panel">
        <label>Nickname
          <input type="text" data-f="nickname" maxlength="12" value="${escapeAttr(s.nickname)}" />
        </label>
        <label>Volume
          <input type="range" data-f="volume" min="0" max="100" value="${Math.round(s.volume * 100)}" />
        </label>
        <label>Render quality
          <select data-f="quality">
            <option value="auto" ${s.quality === "auto" ? "selected" : ""}>Auto</option>
            <option value="high" ${s.quality === "high" ? "selected" : ""}>High</option>
            <option value="low" ${s.quality === "low" ? "selected" : ""}>Low</option>
          </select>
        </label>
        <label>Movement stick side (touch)
          <select data-f="touchSide">
            <option value="left" ${s.touchSide === "left" ? "selected" : ""}>Left — fire on the right</option>
            <option value="right" ${s.touchSide === "right" ? "selected" : ""}>Right — fire on the left</option>
          </select>
        </label>
        <label style="flex-direction:row;align-items:center;gap:6px;">
          <input type="checkbox" data-f="autoFullscreen" style="width:auto" ${s.autoFullscreen ? "checked" : ""}/> Fullscreen on match start (touch)
        </label>
        <label style="flex-direction:row;align-items:center;gap:6px;">
          <input type="checkbox" data-f="menuBackdrop" style="width:auto" ${s.menuBackdrop ? "checked" : ""}/> Live battle behind the menus
        </label>
        <label style="flex-direction:row;align-items:center;gap:6px;">
          <input type="checkbox" data-f="showPing" style="width:auto" ${s.showPing ? "checked" : ""}/> Show ping
        </label>
        <div class="row between">
          <button data-a="back">Back</button>
          <button class="primary" data-a="save">Save</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new MainMenuScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=save]")!.onclick = () => this.save();
    this.unbindEnter = bindEnter(() => this.save());
  }

  private save() {
    const nickname = this.field("nickname").value.trim().slice(0, 12);
    const volume = Number(this.field("volume").value) / 100;
    const quality = this.field<HTMLSelectElement>("quality").value as Quality;
    const touchSide = this.field<HTMLSelectElement>("touchSide").value as TouchSide;
    const autoFullscreen = (this.field("autoFullscreen") as HTMLInputElement).checked;
    const showPing = (this.field("showPing") as HTMLInputElement).checked;
    const menuBackdrop = (this.field("menuBackdrop") as HTMLInputElement).checked;
    saveUserSettings({ nickname, volume, quality, touchSide, autoFullscreen, showPing, menuBackdrop });
    audio.setVolume(volume);
    // The backdrop reads the setting when it starts, so a toggle only takes
    // effect on the next start — force one either way as we leave.
    backdrop.setVisible(false);
    backdrop.setVisible(true);
    this.screens.go(new MainMenuScreen(this.screens));
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.el.querySelector<T>(`[data-f=${name}]`)!;
  }

  unmount() {
    this.unbindEnter?.();
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

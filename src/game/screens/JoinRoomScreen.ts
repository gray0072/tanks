import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { RoomClient } from "../../net/client";
import { RoomScreen } from "./RoomScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { normalizeRoomCode, isValidRoomCode } from "../../net/roomCode";
import { loadUserSettings, saveUserSettings, randomGuestNickname } from "../settings";
import { bindEnter } from "../../util/dialog";

export class JoinRoomScreen implements Screen {
  private el!: HTMLElement;
  private room: RoomClient | null = null;
  private navigated = false;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager, private prefillCode = "") {}

  mount(root: HTMLElement) {
    const settings = loadUserSettings();
    this.el = document.createElement("div");
    this.el.className = "screen";
    this.el.innerHTML = `
      <div class="title">Join Room</div>
      <div class="panel">
        <label>Nickname
          <input type="text" data-f="nickname" maxlength="12" value="${escapeAttr(settings.nickname || randomGuestNickname())}" />
        </label>
        <label>Room code
          <input type="text" class="code-input" data-f="code" maxlength="6" value="${escapeAttr(this.prefillCode)}" placeholder="ABC123" />
        </label>
        <div class="error" data-f="error"></div>
        <div class="row between">
          <button data-a="back">Back</button>
          <button class="primary" data-a="join">Join</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    const codeInput = this.field("code");
    codeInput.addEventListener("input", () => {
      codeInput.value = normalizeRoomCode(codeInput.value);
    });

    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new MainMenuScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=join]")!.onclick = () => this.join();
    this.unbindEnter = bindEnter(() => this.join());

    if (this.prefillCode) this.join();
  }

  private join() {
    const nickname = this.field("nickname").value.trim().slice(0, 12) || randomGuestNickname();
    const code = normalizeRoomCode(this.field("code").value);
    if (!isValidRoomCode(code)) {
      this.showError("Enter a 6-character room code.");
      return;
    }
    saveUserSettings({ ...loadUserSettings(), nickname });
    this.showError("Connecting…");

    this.room?.destroy();
    this.room = new RoomClient(code, nickname, {
      onRoomState: () => {
        if (this.navigated || !this.room) return;
        this.navigated = true;
        this.screens.go(new RoomScreen(this.screens, this.room));
      },
      onError: (msg) => this.showError(msg),
    });
  }

  private field<T extends HTMLElement = HTMLInputElement>(name: string): T {
    return this.el.querySelector<T>(`[data-f=${name}]`)!;
  }

  private showError(msg: string) {
    this.field("error").textContent = msg;
  }

  unmount() {
    this.unbindEnter?.();
    // Ownership passes to RoomScreen once navigated; only tear down if the
    // user backs out before a connection ever succeeded.
    if (!this.navigated) this.room?.destroy();
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

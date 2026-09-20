import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { CreateRoomScreen } from "./CreateRoomScreen";
import { JoinRoomScreen } from "./JoinRoomScreen";
import { SettingsScreen } from "./SettingsScreen";
import { bindEnter } from "../../util/dialog";

const HOW_TO_PLAY = `
  <h3>Objective</h3>
  <p>Two teams, blue and red. Destroy the enemy flag, or grind the enemy team out of respawn tickets
     before the clock runs out. Any slot you don't take is filled by a bot.</p>
  <h3>Controls</h3>
  <p><b>Player 1:</b> WASD move, Space fire.<br/>
     <b>Player 2 (same keyboard):</b> Arrow keys move, Enter fire.<br/>
     Hold two direction keys to drive diagonally. Hold Tab for the scoreboard, Esc pauses.</p>
  <h3>Terrain</h3>
  <p>Brick breaks under fire, steel doesn't (until you're upgraded), forest hides you, water blocks tanks but not bullets,
     ice makes you slide, sand slows you down.</p>
  <h3>Bonuses</h3>
  <p>HELMET shields one hit, STAR upgrades your tank, SPEED boosts you, MINE gives you proximity mines
     (drop with Q, or Right Shift for player 2), and four bonuses affect your whole team:
     SHOVEL fortifies your flag, CLOCK freezes the enemy, GRENADE wipes every enemy tank, TICKET grants extra respawns.</p>
`;

export class MainMenuScreen implements Screen {
  private el!: HTMLElement;
  private unbindEnter: (() => void) | null = null;

  constructor(private screens: ScreenManager) {}

  mount(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "screen";
    this.el.innerHTML = `
      <div class="title">TANKS</div>
      <div class="subtitle">Team tank battle — Battle City style</div>
      <div class="panel">
        <button class="primary" data-a="create">Create Room</button>
        <button data-a="join">Join Room</button>
        <button data-a="settings">Settings</button>
        <button data-a="howto">How to Play</button>
      </div>
    `;
    root.appendChild(this.el);
    this.el.querySelector<HTMLButtonElement>("[data-a=create]")!.onclick = () =>
      this.screens.go(new CreateRoomScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=join]")!.onclick = () =>
      this.screens.go(new JoinRoomScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=settings]")!.onclick = () =>
      this.screens.go(new SettingsScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=howto]")!.onclick = () => this.showHowTo();

    this.bindPrimary();
  }

  private bindPrimary() {
    this.unbindEnter = bindEnter(() => this.screens.go(new CreateRoomScreen(this.screens)));
  }

  private showHowTo() {
    if (this.el.querySelector(".modal-center")) return;
    // The overlay takes Enter over for itself while it's up, so Enter closes
    // it instead of creating a room behind it.
    this.unbindEnter?.();
    const overlay = document.createElement("div");
    overlay.className = "hud-scoreboard modal-center";
    overlay.style.pointerEvents = "auto";
    overlay.innerHTML = `<div class="modal-body">${HOW_TO_PLAY}<button class="primary" data-a="close">Close</button></div>`;
    this.el.appendChild(overlay);
    const close = () => {
      overlay.remove();
      this.unbindEnter?.();
      this.bindPrimary();
    };
    this.unbindEnter = bindEnter(close);
    const closeBtn = overlay.querySelector<HTMLButtonElement>("[data-a=close]")!;
    closeBtn.onclick = close;
    // Takes focus off the "How to Play" button that opened this, which would
    // otherwise swallow Enter and re-open the overlay.
    closeBtn.focus();
  }

  unmount() {
    this.unbindEnter?.();
  }
}

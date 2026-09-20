import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { CreateRoomScreen } from "./CreateRoomScreen";
import { JoinRoomScreen } from "./JoinRoomScreen";
import { SettingsScreen } from "./SettingsScreen";
import { bindEnter } from "../../util/dialog";
import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from "../../util/fullscreen";

const HOW_TO_PLAY = `
  <h3>Objective</h3>
  <p>Two teams, blue and red. Destroy the enemy flag, or grind the enemy team out of respawns
     before the clock runs out. Any slot you don't take is filled by a bot.</p>
  <h3>Controls — keyboard</h3>
  <p><b>Player 1:</b> WASD move, Space fire.<br/>
     <b>Player 2 (same keyboard):</b> Arrow keys move, Enter fire.<br/>
     Hold two direction keys to drive diagonally. Hold Tab for the scoreboard, Esc pauses.</p>
  <h3>Controls — touch</h3>
  <p>Put a thumb down anywhere on the <b>left half</b> of the battlefield and drag: a stick appears
     under your thumb and the tank drives that way, in any of 8 directions. Lift to stop.<br/>
     <b>Tap anywhere on the right half</b> to fire; hold it down to keep firing. The MINE button in
     the bottom corner drops a mine.<br/>
     Left-handed? Settings → Movement stick side swaps the two halves. The buttons in the top bar
     are the scoreboard, fullscreen and the pause menu.</p>
  <h3>Terrain</h3>
  <p>Brick breaks under fire, steel doesn't (until you're upgraded), forest hides you, water blocks tanks but not bullets,
     ice makes you slide, sand slows you down.</p>
  <h3>Bonuses</h3>
  <p>HELMET shields one hit, STAR upgrades your tank, SPEED boosts you, MINE gives you proximity mines
     (drop with Q, or Right Shift for player 2), and four bonuses affect your whole team:
     SHOVEL fortifies your flag, CLOCK freezes the enemy, GRENADE wipes every enemy tank, RESPAWN refills your team’s respawn pool.</p>
`;

export class MainMenuScreen implements Screen {
  private el!: HTMLElement;
  private unbindEnter: (() => void) | null = null;
  private fsBtn!: HTMLButtonElement;
  private unbindFullscreen: (() => void) | null = null;

  private syncFullscreenLabel = () => {
    this.fsBtn.textContent = isFullscreen() ? "Exit Fullscreen" : "Fullscreen";
  };

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
        <button data-a="fs" hidden>Fullscreen</button>
      </div>
      <a class="repo-link" href="https://github.com/gray0072/tanks" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
        Source on GitHub
      </a>
    `;
    root.appendChild(this.el);
    this.el.querySelector<HTMLButtonElement>("[data-a=create]")!.onclick = () =>
      this.screens.go(new CreateRoomScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=join]")!.onclick = () =>
      this.screens.go(new JoinRoomScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=settings]")!.onclick = () =>
      this.screens.go(new SettingsScreen(this.screens));
    this.el.querySelector<HTMLButtonElement>("[data-a=howto]")!.onclick = () => this.showHowTo();

    // Offered on the menu as well as in-match so there's a way back out: a
    // match auto-enters fullscreen on a phone (SPEC §5.4) and a phone has no
    // Esc key to leave it with.
    this.fsBtn = this.el.querySelector<HTMLButtonElement>("[data-a=fs]")!;
    this.fsBtn.hidden = !fullscreenSupported();
    this.fsBtn.onclick = () => void toggleFullscreen();
    this.unbindFullscreen = onFullscreenChange(this.syncFullscreenLabel);
    this.syncFullscreenLabel();

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
    this.unbindFullscreen?.();
  }
}

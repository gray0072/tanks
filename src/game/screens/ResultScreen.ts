import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import type { RoomController } from "../../net/room";
import type { PlayerStats } from "../../world/rules";
import type { TeamId } from "../../game/config";
import { RoomScreen } from "./RoomScreen";
import { MatchScreen } from "./MatchScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { bindEnter } from "../../util/dialog";

export class ResultScreen implements Screen {
  private el!: HTMLElement;
  private unbindEnter: (() => void) | null = null;

  constructor(
    private screens: ScreenManager,
    private room: RoomController,
    private winner: TeamId | "draw" | null,
    private stats: Record<number, PlayerStats>,
  ) {}

  mount(root: HTMLElement) {
    const bannerText = this.winner === "draw" || this.winner === null ? "DRAW" : `${this.winner.toUpperCase()} TEAM WINS`;
    const bannerClass = this.winner === "blue" || this.winner === "red" ? this.winner : "";

    const rows = this.room.slots
      .map((s) => ({ slot: s, st: this.stats[s.id] }))
      .filter((r) => r.st)
      .sort((a, b) => b.st.frags - a.st.frags);
    const mvp = rows[0];

    this.el = document.createElement("div");
    this.el.className = "screen";
    this.el.innerHTML = `
      <div class="result-banner ${bannerClass}">${bannerText}</div>
      <div class="hint" data-f="banner"></div>
      ${mvp ? `<div class="hint">MVP: ${escapeHtml(mvp.slot.nickname)} — ${mvp.st.frags} frags</div>` : ""}
      <div class="panel panel-wide">
        <div class="sb-row" style="font-weight:700"><span>Player</span><span>Frags</span><span>Deaths</span><span>Assists</span></div>
        ${rows
          .map(
            (r) =>
              `<div class="sb-row sb-${r.slot.team}"><span>${escapeHtml(r.slot.nickname)}</span><span>${r.st.frags}</span><span>${r.st.deaths}</span><span>${r.st.assists}</span></div>`,
          )
          .join("")}
        <div class="row between" style="margin-top:10px">
          <button data-a="menu">Main Menu</button>
          <button class="primary" data-a="back">Back to room</button>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    // Without this the room still delivers to the unmounted MatchScreen's
    // callbacks, so a host who starts the next match while a guest is reading
    // the scoreboard leaves that guest behind.
    this.room.setCallbacks({
      onMatchStart: () => this.screens.go(new MatchScreen(this.screens, this.room)),
      onError: (msg) => this.showBanner(msg),
    });

    this.el.querySelector<HTMLButtonElement>("[data-a=menu]")!.onclick = () => {
      this.room.destroy();
      this.screens.go(new MainMenuScreen(this.screens));
    };
    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.screens.go(new RoomScreen(this.screens, this.room));
    this.unbindEnter = bindEnter(() => this.screens.go(new RoomScreen(this.screens, this.room)));
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

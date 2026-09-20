// Match HUD — SPEC §6.2. Plain DOM, not Pixi Text: text-heavy chrome that
// changes at a low frequency is simpler and more accessible as HTML. Two
// separate mount points, not one root: the stats/timer bar is a real layout
// row above the arena (MatchScreen's `.match-topbar`), while everything else
// (banner, feed, bottom stats, scoreboard) overlays the arena itself
// (`.match-arena`) — see MatchScreen.mount() for how those are built.

import type { Snapshot, MatchEvent } from "../world/sim";
import type { TeamId } from "../game/config";

export class Hud {
  private topRoot: HTMLDivElement;
  private overlayRoot: HTMLDivElement;
  private ticketsEl: Record<TeamId, HTMLSpanElement>;
  private fragsEl: Record<TeamId, HTMLSpanElement>;
  private flagEl: Record<TeamId, HTMLSpanElement>;
  private timerEl: HTMLSpanElement;
  private starEl: HTMLSpanElement;
  private buffEl: HTMLSpanElement;
  private mineEl: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private feedEl: HTMLDivElement;
  private scoreboardEl: HTMLDivElement;

  constructor(topMount: HTMLElement, overlayMount: HTMLElement) {
    this.topRoot = document.createElement("div");
    this.topRoot.className = "hud-top";
    this.topRoot.innerHTML = `
      <div class="hud-team hud-blue"><span class="hud-tickets"></span> tickets · <span class="hud-frags"></span> frags <span class="hud-flag"></span></div>
      <div class="hud-timer"></div>
      <div class="hud-team hud-red"><span class="hud-flag"></span> <span class="hud-frags"></span> frags · <span class="hud-tickets"></span> tickets</div>
    `;
    topMount.appendChild(this.topRoot);

    this.overlayRoot = document.createElement("div");
    this.overlayRoot.className = "hud-overlay";
    this.overlayRoot.innerHTML = `
      <div class="hud-banner"></div>
      <div class="hud-feed"></div>
      <div class="hud-bottom">
        <span class="hud-stars"></span>
        <span class="hud-buff"></span>
        <span class="hud-mines"></span>
      </div>
      <div class="hud-scoreboard" hidden></div>
    `;
    overlayMount.appendChild(this.overlayRoot);

    const blue = this.topRoot.querySelector(".hud-blue")!;
    const red = this.topRoot.querySelector(".hud-red")!;
    this.ticketsEl = { blue: blue.querySelector(".hud-tickets")!, red: red.querySelector(".hud-tickets")! };
    this.fragsEl = { blue: blue.querySelector(".hud-frags")!, red: red.querySelector(".hud-frags")! };
    this.flagEl = { blue: blue.querySelector(".hud-flag")!, red: red.querySelector(".hud-flag")! };
    this.timerEl = this.topRoot.querySelector(".hud-timer")!;
    this.starEl = this.overlayRoot.querySelector(".hud-stars")!;
    this.buffEl = this.overlayRoot.querySelector(".hud-buff")!;
    this.mineEl = this.overlayRoot.querySelector(".hud-mines")!;
    this.bannerEl = this.overlayRoot.querySelector(".hud-banner")!;
    this.feedEl = this.overlayRoot.querySelector(".hud-feed")!;
    this.scoreboardEl = this.overlayRoot.querySelector(".hud-scoreboard")!;
  }

  update(snap: Snapshot, mySlot: number | null) {
    for (const team of ["blue", "red"] as TeamId[]) {
      this.ticketsEl[team].textContent = String(snap.tickets[team]);
      // Plain text glyphs, not emoji (🚩/💥 render as fixed-color glyphs
      // that ignore .hud-blue/.hud-red's `color`, so both teams' flags
      // looked the same) — these inherit the team color correctly.
      this.flagEl[team].textContent = snap.flagAlive[team] ? "⚑" : "✕";
    }
    const m = Math.floor(snap.timeLeft / 60);
    const s = Math.floor(snap.timeLeft % 60);
    this.timerEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;

    const me = mySlot !== null ? snap.tanks.find((t) => t.slot === mySlot) : null;
    if (me) {
      this.starEl.textContent = "★".repeat(me.star) || "";
      this.buffEl.textContent = me.helmetT > 0 ? `Shield ${me.helmetT.toFixed(0)}s` : me.speedT > 0 ? `Speed ${me.speedT.toFixed(0)}s` : "";
      this.mineEl.textContent = me.mines > 0 ? `Mines: ${me.mines}` : "";
    }
  }

  setFrags(blue: number, red: number) {
    this.fragsEl.blue.textContent = String(blue);
    this.fragsEl.red.textContent = String(red);
  }

  banner(text: string, ms = 3000) {
    const el = document.createElement("div");
    el.className = "hud-banner-item";
    el.textContent = text;
    this.bannerEl.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  feed(text: string) {
    const el = document.createElement("div");
    el.className = "hud-feed-item";
    el.textContent = text;
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 4) this.feedEl.lastChild?.remove();
    setTimeout(() => el.remove(), 6000);
  }

  applyEvents(events: MatchEvent[], nicknameOf: (slot: number) => string) {
    for (const e of events) {
      if (e.type === "kill") {
        const killer = e.killerSlot !== null ? nicknameOf(e.killerSlot) : "Something";
        this.feed(`${killer} destroyed ${nicknameOf(e.victimSlot)}`);
      }
      if (e.type === "pickup") {
        this.feed(`${nicknameOf(e.slot)} picked up ${e.kind}`);
      }
      if (e.type === "flagHit") {
        this.banner(`${e.team.toUpperCase()} FLAG DESTROYED`, 4000);
      }
      if (e.type === "teamBonus") {
        this.banner(`${e.team.toUpperCase()} team: ${e.kind}!`);
      }
    }
  }

  setScoreboardVisible(visible: boolean) {
    this.scoreboardEl.hidden = !visible;
  }

  renderScoreboard(rows: { nickname: string; team: TeamId; frags: number; deaths: number; assists: number }[]) {
    this.scoreboardEl.innerHTML = rows
      .map((r) => `<div class="sb-row sb-${r.team}"><span>${escapeHtml(r.nickname)}</span><span>${r.frags}</span><span>${r.deaths}</span><span>${r.assists}</span></div>`)
      .join("");
  }

  destroy() {
    this.topRoot.remove();
    this.overlayRoot.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

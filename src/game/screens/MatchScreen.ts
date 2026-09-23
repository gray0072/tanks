import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { NO_INPUT, type RoomController } from "../../net/room";
import type { Snapshot, MatchEvent } from "../../world/sim";
import type { PlayerStats } from "../../world/rules";
import { getMap } from "../../world/maps/loader";
import { createPixiApp, type PixiHost } from "../../render/app";
import { createAtlas } from "../../render/atlas";
import { Arena } from "../../render/arena";
import { Hud } from "../../render/hud";
import { Input } from "../../util/input";
import { audio } from "../../audio/audio";
import { loadUserSettings } from "../settings";
import { TouchControls } from "../touchControls";
import {
  enterFullscreen,
  fullscreenSupported,
  isFullscreen,
  lockLandscape,
  onFullscreenChange,
  toggleFullscreen,
} from "../../util/fullscreen";
import { ResultScreen } from "./ResultScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { CELL, type TeamId } from "../../game/config";
import { bindEnter } from "../../util/dialog";

type LiveStat = { frags: number; deaths: number };

export class MatchScreen implements Screen {
  /** This screen draws its own arena; the menu backdrop shuts down while
   *  it's up (ScreenManager). */
  readonly backdrop = false;

  private el!: HTMLElement;
  private topbarHost!: HTMLElement;
  private arenaHost!: HTMLElement;
  private pixi: PixiHost | null = null;
  private arena: Arena | null = null;
  private hud: Hud | null = null;
  private input = new Input();
  private raf = 0;
  private myTeams = new Set<TeamId>();
  private nicknames = new Map<number, string>();
  private slotTeams = new Map<number, TeamId>();
  private liveStats = new Map<number, LiveStat>();
  private paused = false;
  private ended = false;
  private unbindEnter: (() => void) | null = null;
  private touchControls: TouchControls | null = null;
  private unbindFullscreen: (() => void) | null = null;
  private scoreboardPinned = false;
  private isTouch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  /** `exit` replaces "back to the main menu" for a match that was started
   *  from somewhere else — the level editor's Test play hands it a way back
   *  to the grid it came from (specs/level-editor.md §6.7). */
  constructor(
    private screens: ScreenManager,
    private room: RoomController,
    private exit?: () => void,
  ) {}

  mount(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "screen match-screen";
    // Top row is a real layout row (stats + timer), not an overlay — the
    // arena below it gets the rest of the screen, not the whole viewport.
    this.topbarHost = document.createElement("div");
    this.topbarHost.className = "match-topbar";
    this.arenaHost = document.createElement("div");
    this.arenaHost.className = "match-arena";
    this.el.append(this.topbarHost, this.arenaHost);
    root.appendChild(this.el);

    for (const s of this.room.slots) {
      this.nicknames.set(s.id, s.nickname);
      this.slotTeams.set(s.id, s.team);
      this.liveStats.set(s.id, { frags: 0, deaths: 0 });
    }
    for (const s of this.room.mySlots()) this.myTeams.add(s.team);

    audio.unlock();
    audio.setVolume(loadUserSettings().volume);

    void this.initAsync();

    this.room.setCallbacks({
      onSnapshot: (snap) => this.onSnapshot(snap),
      onMatchEvents: (events) => this.onEvents(events),
      onMatchEnd: (winner, stats) => this.onMatchEnd(winner, stats),
      onError: (msg) => this.hud?.banner(msg),
    });

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.checkOrientation);
    this.unbindFullscreen = onFullscreenChange(this.onFullscreenChange);
    this.checkOrientation();
    this.autoFullscreen();
    this.loop();
  }

  private async initAsync() {
    const map = getMap(this.room.mapId);
    const mount = document.createElement("div");
    mount.className = "pixi-mount";
    this.arenaHost.appendChild(mount);
    this.pixi = await createPixiApp(mount, map.width * CELL, map.height * CELL);
    const atlas = createAtlas(this.pixi.app);
    this.arena = new Arena(atlas, map, this.room.slots);
    this.arena.app = this.pixi.app;
    this.pixi.world.addChild(this.arena.world);

    this.hud = new Hud(this.topbarHost, this.arenaHost);
    this.hud.onAction("menu", () => this.togglePause());
    this.hud.onAction("scoreboard", () => this.toggleScoreboard());
    this.hud.onAction("fullscreen", () => void toggleFullscreen());
    this.hud.setActionAvailable("fullscreen", fullscreenSupported());
    this.hud.setActionActive("fullscreen", isFullscreen());
    this.setupTouchControls();
  }

  private toggleScoreboard() {
    this.scoreboardPinned = !this.scoreboardPinned;
    this.input.setTouchScoreboard(this.scoreboardPinned);
    this.hud?.setActionActive("scoreboard", this.scoreboardPinned);
  }

  private onSnapshot(snap: Snapshot) {
    this.arena?.applySnapshot(snap);
    this.hud?.update(snap, this.room.mySlots()[0]?.id ?? null);
  }

  private onEvents(events: MatchEvent[]) {
    this.arena?.applyEvents(events);
    this.hud?.applyEvents(events, (slot) => this.nicknames.get(slot) ?? "?");
    for (const e of events) {
      if (e.type === "kill") {
        if (e.killerSlot !== null) this.bump(e.killerSlot, "frags");
        this.bump(e.victimSlot, "deaths");
        audio.explosion();
      }
      if (e.type === "terrain") audio.brickCrumble();
      if (e.type === "flagHit") audio.flagAlarm();
      if (e.type === "teamBonus") audio.teamBonusFanfare();
      if (e.type === "pickup") audio.bonusPickup();
    }
    this.hud?.setFrags(this.teamFrags("blue"), this.teamFrags("red"));
  }

  private bump(slot: number, key: keyof LiveStat) {
    const st = this.liveStats.get(slot);
    if (st) st[key]++;
  }

  private teamFrags(team: TeamId): number {
    let sum = 0;
    for (const [slot, st] of this.liveStats) if (this.slotTeams.get(slot) === team) sum += st.frags;
    return sum;
  }

  private onMatchEnd(winner: TeamId | "draw" | null, stats: Record<number, PlayerStats>) {
    if (this.ended) return;
    this.ended = true;
    audio.matchEnd();
    this.screens.go(new ResultScreen(this.screens, this.room, winner, stats, this.exit));
  }

  private onKeyDown = () => {
    if (this.input.consumeEscape()) this.togglePause();
  };

  private togglePause() {
    this.paused = !this.paused;
    // With nobody else in the match, Esc really stops the world; with other
    // players connected the match keeps running and this is just a menu.
    const freezes = this.room.canPauseMatch();
    let overlay = this.el.querySelector<HTMLDivElement>(".pause-overlay");
    if (this.paused) {
      if (freezes) this.room.setMatchPaused(true);
      // Nothing feeds input while the menu is up, so clear it — otherwise a
      // running match would keep replaying whatever was held when it opened.
      this.room.setLocalInput(0, NO_INPUT);
      if (this.room.hasLocalSeat2()) this.room.setLocalInput(1, NO_INPUT);
      // The overlay covers the touch zones, so their pointerup never arrives —
      // without this the tank would resume still driving and firing.
      this.touchControls?.release();
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "hud-scoreboard pause-overlay";
        overlay.style.pointerEvents = "auto";
        overlay.innerHTML = `
          <div class="pause-menu">
            <div class="title" style="font-size:1.4rem">${freezes ? "Paused" : "Menu"}</div>
            <button class="primary" data-a="resume">${freezes ? "Resume" : "Back to match"}</button>
            <button class="danger" data-a="leave">Leave match</button>
          </div>
        `;
        this.el.appendChild(overlay);
        overlay.querySelector<HTMLButtonElement>("[data-a=resume]")!.onclick = () => this.togglePause();
        // Deliberately not focusing Resume: the bindEnter below already
        // resumes on Enter, and a focused button would toggle the pause a
        // second time off the same press.
        (document.activeElement as HTMLElement | null)?.blur();
        overlay.querySelector<HTMLButtonElement>("[data-a=leave]")!.onclick = () => {
          this.room.setMatchPaused(false);
          if (this.exit) {
            this.exit();
            return;
          }
          this.room.destroy();
          this.screens.go(new MainMenuScreen(this.screens));
        };
      }
      // Enter resumes while paused; only bound for as long as the menu is up.
      this.unbindEnter = bindEnter(() => this.togglePause());
    } else {
      this.room.setMatchPaused(false);
      this.unbindEnter?.();
      this.unbindEnter = null;
      overlay?.remove();
    }
  }

  private checkOrientation = () => {
    let notice = this.el.querySelector<HTMLDivElement>(".rotate-notice");
    const shouldShow = this.isTouch && window.innerHeight > window.innerWidth;
    if (shouldShow && !notice) {
      notice = document.createElement("div");
      notice.className = "rotate-notice";
      notice.style.display = "flex";
      // The button is the only way out on a device with rotation locked in
      // its own settings: an orientation lock can only be taken while
      // fullscreen, so offering fullscreen here is offering the rotation.
      notice.innerHTML = `
        <div class="rotate-body">
          <div>Rotate your device — Tanks plays in landscape.</div>
          <button class="primary" data-a="fs" type="button" ${fullscreenSupported() ? "" : "hidden"}>Fullscreen &amp; rotate</button>
        </div>
      `;
      notice.querySelector<HTMLButtonElement>("[data-a=fs]")!.onclick = () => {
        void enterFullscreen().then((ok) => ok && void lockLandscape());
      };
      this.el.appendChild(notice);
      this.touchControls?.release();
    } else if (!shouldShow && notice) {
      notice.remove();
    }
  };

  private setupTouchControls() {
    if (!this.isTouch) return;
    // Mounted on the arena, not the whole screen: the zones then line up with
    // the battlefield and leave the top bar (and the system gesture strip
    // above it) alone. See touchControls.ts for the scheme.
    this.arenaHost.classList.add("has-touch");
    this.touchControls = new TouchControls(this.arenaHost, this.input, loadUserSettings().touchSide);
  }

  // --- fullscreen (SPEC §5.4) ----------------------------------------------

  /** Phones only, and only if the player left the setting on. The request is
   *  refused outside a user gesture, which is exactly what happens to a guest
   *  whose match was started by the host — so when the immediate attempt
   *  fails we arm the player's next touch to do it instead. */
  private autoFullscreen() {
    if (!this.isTouch || !fullscreenSupported()) return;
    if (!loadUserSettings().autoFullscreen) return;
    void enterFullscreen().then((ok) => {
      if (ok) void lockLandscape();
      else this.armFullscreenOnGesture();
    });
  }

  private armFullscreenOnGesture() {
    const once = () => {
      this.el.removeEventListener("pointerdown", once);
      void enterFullscreen().then((ok) => ok && void lockLandscape());
    };
    this.el.addEventListener("pointerdown", once);
  }

  private onFullscreenChange = () => {
    this.hud?.setActionActive("fullscreen", isFullscreen());
    this.checkOrientation();
  };

  private loop = () => {
    if (!this.paused) {
      this.room.setLocalInput(0, this.input.getSeatInput(0));
      if (this.room.hasLocalSeat2()) this.room.setLocalInput(1, this.input.getSeatInput(1));
    }
    this.arena?.tick(this.myTeams);
    this.hud?.setScoreboardVisible(this.input.scoreboardHeld());
    if (this.input.scoreboardHeld()) {
      const rows = this.room.slots
        .map((s) => ({ nickname: s.nickname, team: s.team, ...this.liveStats.get(s.id)! , assists: 0}))
        .sort((a, b) => b.frags - a.frags);
      this.hud?.renderScoreboard(rows);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  unmount() {
    this.room.setMatchPaused(false);
    this.unbindEnter?.();
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.checkOrientation);
    this.unbindFullscreen?.();
    this.touchControls?.destroy();
    this.arena?.destroy();
    this.pixi?.destroy();
    this.hud?.destroy();
  }
}

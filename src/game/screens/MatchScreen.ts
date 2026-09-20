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
import { dirFromAngle } from "../../util/math";
import { audio } from "../../audio/audio";
import { loadUserSettings } from "../settings";
import { ResultScreen } from "./ResultScreen";
import { MainMenuScreen } from "./MainMenuScreen";
import { CELL, type TeamId } from "../../game/config";
import { bindEnter } from "../../util/dialog";

type LiveStat = { frags: number; deaths: number };

export class MatchScreen implements Screen {
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
  private isTouch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  constructor(private screens: ScreenManager, private room: RoomController) {}

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
    this.checkOrientation();
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
    this.setupTouchControls();
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
    this.screens.go(new ResultScreen(this.screens, this.room, winner, stats));
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
        // Deliberately not focusing Resume: Input (util/input.ts) swallows
        // Enter's default action during a match, so a focused button would
        // never be activated by it — the bindEnter below is what resumes.
        (document.activeElement as HTMLElement | null)?.blur();
        overlay.querySelector<HTMLButtonElement>("[data-a=leave]")!.onclick = () => {
          this.room.setMatchPaused(false);
          this.room.destroy();
          this.screens.go(new MainMenuScreen(this.screens));
        };
      }
      // Enter resumes while paused; it's player 2's fire key the rest of the
      // time, which is why it's only bound for as long as the menu is up.
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
      notice.textContent = "Rotate your device — Tanks plays in landscape.";
      this.el.appendChild(notice);
    } else if (!shouldShow && notice) {
      notice.remove();
    }
  };

  private setupTouchControls() {
    if (!this.isTouch) return;
    const side = loadUserSettings().touchSide;
    const wrap = document.createElement("div");
    wrap.className = "touch-controls active";
    wrap.innerHTML = `
      <div class="touch-dpad" style="${side === "left" ? "left:20px" : "right:20px"}"></div>
      <div class="touch-fire" style="${side === "left" ? "right:30px" : "left:30px"}"></div>
      <div class="touch-mine" style="${side === "left" ? "right:120px" : "left:120px"}">MINE</div>
    `;
    this.el.appendChild(wrap);

    const dpad = wrap.querySelector<HTMLDivElement>(".touch-dpad")!;
    const setFromTouch = (t: Touch) => {
      const rect = dpad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = t.clientX - cx;
      const dy = t.clientY - cy;
      if (Math.hypot(dx, dy) < 12) { this.input.setTouchDir(null); return; }
      this.input.setTouchDir(dirFromAngle(Math.atan2(dy, dx)));
    };
    dpad.addEventListener("touchstart", (e) => { e.preventDefault(); setFromTouch(e.touches[0]); }, { passive: false });
    dpad.addEventListener("touchmove", (e) => { e.preventDefault(); setFromTouch(e.touches[0]); }, { passive: false });
    dpad.addEventListener("touchend", () => this.input.setTouchDir(null));

    const fire = wrap.querySelector<HTMLDivElement>(".touch-fire")!;
    fire.addEventListener("touchstart", (e) => { e.preventDefault(); this.input.setTouchFire(true); }, { passive: false });
    fire.addEventListener("touchend", () => this.input.setTouchFire(false));

    const mine = wrap.querySelector<HTMLDivElement>(".touch-mine")!;
    mine.addEventListener("touchstart", (e) => { e.preventDefault(); this.input.setTouchMine(true); }, { passive: false });
    mine.addEventListener("touchend", () => this.input.setTouchMine(false));
  }

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
    this.arena?.destroy();
    this.pixi?.destroy();
    this.hud?.destroy();
  }
}

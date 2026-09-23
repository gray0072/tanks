// The menu's live backdrop — SPEC §6.3. Behind every menu screen runs a real
// bot-vs-bot match: the same Sim, the same bots and the same Arena renderer a
// match uses, just with nobody playing and nothing to click. It exists to make
// the menu look alive, so everything about it defers to the menu in front:
// it's silent, unreadable on purpose (blurred and dimmed in CSS, no
// nicknames), it never steals input, and it is destroyed outright — GPU
// context and all — the moment a screen that owns the canvas (a match, the
// editor) takes over.

import { Sim } from "../world/sim";
import type { SeatInput } from "../world/sim";
import type { MatchSettings } from "../world/rules";
import { createDefaultSlots, botNickname, type Slot } from "../world/tank";
import { listMaps } from "../world/maps/loader";
import type { MapDef } from "../world/maps/loader";
import { BotController } from "../ai/bot";
import { computeTeamRoles, type Role } from "../ai/teamPlan";
import { createPixiApp, type PixiHost } from "../render/app";
import { createAtlas, type Atlas } from "../render/atlas";
import { Arena } from "../render/arena";
import { CELL, TANK_SIZE, TICK_DT, type TeamId } from "./config";
import { loadUserSettings } from "./settings";

/** Backdrop rounds are short on purpose: a menu session that outlasts one
 *  should show a different map, not the same stalemate for ten minutes. */
const ROUND_SECONDS = 150;
/** Respawns per tank — generous, so the battle never thins out into an empty
 *  map while someone reads How to Play. */
const ROUND_RESPAWN_MULT = 20;
/** Beat between a round ending and the next one fading in. */
const RESTART_DELAY_MS = 1200;
/** Zoom over the `cover` fit, by viewport width. The backdrop shows a slice
 *  of the battlefield rather than the whole map: on a desktop, at whole-map
 *  scale the tanks are specks and the picture reads as wallpaper of bricks
 *  instead of a fight. A portrait phone is the opposite problem — `cover`
 *  already crops a landscape map down to a few cells, so it needs no help. */
function cameraZoom(): number {
  const w = window.innerWidth;
  if (w >= 900) return 1.5;
  if (w >= 600) return 1.15;
  // Never below 1: the fit is `cover`, so anything under it stops covering
  // and bares the layer behind the arena at the edges.
  return 1;
}
/** Per-second fraction of the remaining distance the camera closes on its
 *  target. Low on purpose — the camera must drift, never cut or chase, or it
 *  turns into movement in the corner of the eye while someone reads a menu. */
const CAMERA_FOLLOW = 0.9;
/** Hard ceiling on that drift, in world units per second (a cell is 32) —
 *  roughly a tank's own pace. Without it, a fight breaking out across the map
 *  sends the whole backdrop sliding past at a speed impossible to ignore. */
const CAMERA_MAX_SPEED = 110;
/** The camera ignores its target inside this radius, so it settles instead of
 *  jittering along with whichever two tanks are currently closest. */
const CAMERA_DEAD_ZONE = 40;
/** How often the camera is allowed to re-aim. Between re-aims it keeps
 *  drifting toward the point it last picked, so the closest blue/red pair
 *  changing (a kill, two tanks crossing on the far side of the map) can move
 *  the camera at most once a second instead of tugging at it every frame. */
const CAMERA_RETARGET_MS = 1000;

export class MenuBackdrop {
  private layer: HTMLElement | null = null;
  private mount: HTMLElement | null = null;
  private pixi: PixiHost | null = null;
  private arena: Arena | null = null;
  /** Built once per renderer and reused by every round — each `createAtlas`
   *  bakes a fresh set of GPU textures, and `Arena.destroy` doesn't free
   *  them, so a new atlas per round would leak one atlas per round. */
  private atlas: Atlas | null = null;
  private sim: Sim | null = null;
  private bots = new Map<number, BotController>();
  private slots: Slot[] = [];
  private raf = 0;
  private last = 0;
  private acc = 0;
  private restartAt = 0;
  /** Where the spectator camera is now, in world units; null until the first
   *  round places it. */
  private camera: { x: number; y: number } | null = null;
  /** The point the camera is drifting toward, re-picked at most once every
   *  CAMERA_RETARGET_MS. */
  private cameraTarget: { x: number; y: number } | null = null;
  private retargetedAt = 0;
  private wanted = false;
  /** Set while `start()` is awaiting the Pixi renderer, so a hide that lands
   *  mid-init doesn't get overwritten by the resolved app. */
  private starting = false;
  private lastMapId: string | null = null;

  /** Called once at boot with the element the backdrop should live in (behind
   *  `#ui`). Nothing runs until a screen asks for it. */
  attach(layer: HTMLElement) {
    this.layer = layer;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** ScreenManager calls this on every screen change: menu screens want the
   *  backdrop, the match and the editor don't. */
  setVisible(on: boolean) {
    if (on && !this.enabled()) return;
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) void this.start();
    else this.stop();
  }

  /** One switch decides: the player's own setting, which starts off under
   *  the system's reduced-motion preference (settings.ts) but is theirs to
   *  overrule from the Settings screen. */
  private enabled(): boolean {
    return !!this.layer && loadUserSettings().menuBackdrop;
  }

  private async start() {
    if (this.starting || this.pixi || !this.layer) return;
    this.starting = true;
    const map = this.pickMap();
    const mount = document.createElement("div");
    mount.className = "menu-backdrop-mount";
    this.layer.appendChild(mount);
    // `cover` + no letterbox: the backdrop fills the viewport and the map's
    // overflow is simply cropped. Half resolution — it's blurred anyway, and
    // this is a screen the player isn't even looking at directly.
    const pixi = await createPixiApp(mount, map.width * CELL, map.height * CELL, {
      fit: "cover",
      zoom: cameraZoom,
      maxResolution: 1,
    });
    if (!this.wanted) {
      // Hidden while we were awaiting the renderer (a fast click through the
      // menu into a match) — throw the whole thing away rather than leaking a
      // second WebGL context behind the arena.
      pixi.destroy();
      mount.remove();
      this.starting = false;
      return;
    }
    this.mount = mount;
    this.pixi = pixi;
    this.atlas = createAtlas(pixi.app);
    this.startRound(map);
    this.starting = false;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.loop);
    // One frame of world before the fade, so the menu never crossfades into
    // an empty arena.
    requestAnimationFrame(() => mount.classList.add("is-on"));
  }

  /** Builds the roster, Sim, bots and Arena for one round. The Pixi app and
   *  its mount outlive rounds — only the scene graph is rebuilt. */
  private startRound(map: MapDef) {
    const pixi = this.pixi;
    if (!pixi) return;
    this.slots = createDefaultSlots("", map.spawns.blue.length, map.spawns.red.length);
    for (const s of this.slots) {
      // Every slot is a bot, including slot 0 — createDefaultSlots reserves
      // that one for the room's creator, and here there is no creator; left
      // human it would sit at its spawn all round taking hits.
      s.kind = "bot";
      s.owner = null;
      s.ownerSeat = 0;
      s.ready = true;
      // Hard on both sides: the backdrop wants a fight that keeps moving, and
      // easier bots idle and stall (see specs/bots.md §10.4).
      s.botDifficulty = "hard";
      s.nickname = botNickname(s.id, s.botDifficulty);
    }
    const settings: MatchSettings = {
      mapId: map.id,
      timeLimit: ROUND_SECONDS,
      respawnMult: ROUND_RESPAWN_MULT,
      friendlyFire: false,
    };
    this.sim = new Sim(map, settings, this.slots, Math.floor(Math.random() * 0x7fffffff));
    // Start centred; the camera drifts to the first firefight from there
    // rather than snapping to it as the round fades in.
    this.camera = { x: (map.width * CELL) / 2, y: (map.height * CELL) / 2 };
    this.cameraTarget = null;
    this.retargetedAt = 0;
    pixi.setFocus(this.camera, this.anchor());
    this.bots.clear();
    for (const s of this.slots) this.bots.set(s.id, new BotController(s.id));
    this.arena = new Arena(this.atlas!, map, this.slots, { labels: false });
    this.arena.app = pixi.app;
    pixi.world.addChild(this.arena.world);
    this.restartAt = 0;
  }

  private endRound() {
    if (this.arena) {
      this.pixi?.world.removeChild(this.arena.world);
      this.arena.destroy();
      this.arena = null;
    }
    this.sim = null;
    this.bots.clear();
  }

  /** Where in the viewport the followed fight is held. The menu panel owns
   *  the middle of the screen, so on anything wide enough the action is
   *  parked to the left of it, in the space the menu doesn't use; on a narrow
   *  screen the panel spans the width and there is no such space, so it goes
   *  back to centre. */
  private anchor(): { x: number; y: number } {
    return window.innerWidth >= 900 ? { x: 0.24, y: 0.5 } : { x: 0.5, y: 0.5 };
  }

  /** A different map every round, so the menu doesn't settle into one
   *  picture. Custom maps are deliberately left out — the backdrop shouldn't
   *  be at the mercy of a half-finished map someone is editing. */
  private pickMap(): MapDef {
    const maps = listMaps();
    const choices = maps.length > 1 ? maps.filter((m) => m.id !== this.lastMapId) : maps;
    const map = choices[Math.floor(Math.random() * choices.length)] ?? maps[0];
    this.lastMapId = map.id;
    return map;
  }

  private loop = () => {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    // A backgrounded tab (or a slow frame) must not come back as a burst of
    // catch-up ticks — the backdrop has nothing to stay in sync with.
    if (dt > 0.25) dt = 0.25;

    if (this.sim) {
      this.acc += dt;
      while (this.acc >= TICK_DT && this.sim) {
        this.tick();
        this.acc -= TICK_DT;
      }
    } else if (this.restartAt && now >= this.restartAt) {
      this.mount?.classList.remove("is-on");
      this.startRound(this.pickMap());
      requestAnimationFrame(() => this.mount?.classList.add("is-on"));
    }

    this.moveCamera(dt, now);
    // Both teams count as "mine": forest concealment exists to hide enemies
    // from a player, and there is no player here — a backdrop whose tanks
    // vanish into the bushes is a backdrop of empty scenery.
    this.arena?.tick(ALL_TEAMS);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Drifts toward wherever the fight is, re-aiming no more than once a
   *  second (see CAMERA_RETARGET_MS) so the picture never twitches. */
  private moveCamera(dt: number, now: number) {
    const cam = this.camera;
    if (!this.sim || !cam) return;
    if (!this.cameraTarget || now - this.retargetedAt >= CAMERA_RETARGET_MS) {
      const next = this.pickCameraTarget();
      if (next) {
        this.cameraTarget = next;
        this.retargetedAt = now;
      }
    }
    const target = this.cameraTarget;
    if (!target) return;
    const dx = target.x - cam.x;
    const dy = target.y - cam.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CAMERA_DEAD_ZONE) {
      // Exponential smoothing, framerate-independent (the same drift whether
      // the tab renders at 144 Hz or limps at 30), then speed-capped.
      const ease = dist * (1 - Math.exp(-CAMERA_FOLLOW * dt));
      const step = Math.min(ease, CAMERA_MAX_SPEED * dt);
      cam.x += (dx / dist) * step;
      cam.y += (dy / dist) * step;
    }
    this.pixi?.setFocus(cam, this.anchor());
  }

  /** Where the fight is: the midpoint of the closest blue/red pair, which is
   *  a decent stand-in for "where something is about to happen" and costs a
   *  single pass over the roster. Falls back to the centre of mass when one
   *  team has nobody alive. */
  private pickCameraTarget(): { x: number; y: number } | null {
    const sim = this.sim;
    if (!sim) return null;
    const alive = sim.tanks.filter((t) => t.alive);
    if (!alive.length) return null;
    let best = Infinity;
    let target: { x: number; y: number } | null = null;
    for (const a of alive) {
      if (a.team !== "blue") continue;
      for (const b of alive) {
        if (b.team !== "red") continue;
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d < best) {
          best = d;
          target = { x: (a.x + b.x) / 2 + TANK_SIZE / 2, y: (a.y + b.y) / 2 + TANK_SIZE / 2 };
        }
      }
    }
    if (target) return target;
    let sx = 0;
    let sy = 0;
    for (const t of alive) {
      sx += t.x;
      sy += t.y;
    }
    return { x: sx / alive.length + TANK_SIZE / 2, y: sy / alive.length + TANK_SIZE / 2 };
  }

  private tick() {
    const sim = this.sim;
    if (!sim) return;
    const roles: Record<TeamId, Map<number, Role>> = {
      blue: computeTeamRoles(sim, "blue"),
      red: computeTeamRoles(sim, "red"),
    };
    const inputs: Record<number, SeatInput> = {};
    for (const s of sim.slots) {
      inputs[s.id] = this.bots.get(s.id)!.decide(sim, roles[s.team], s.botDifficulty);
    }
    const events = sim.step(inputs, TICK_DT);
    this.arena?.applySnapshot(sim.snapshot());
    // Explosions and debris only — no audio: a menu that makes gunfire noises
    // at a player who hasn't started anything is a bug, not atmosphere.
    if (events.length) this.arena?.applyEvents(events);
    if (sim.rules.ended) {
      this.endRound();
      this.restartAt = performance.now() + RESTART_DELAY_MS;
    }
  }

  /** Frames cost battery even behind a menu nobody is looking at. */
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.wanted && this.pixi && !this.raf) {
      this.last = performance.now();
      this.acc = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.endRound();
    // Destroying the Application takes its textures (the atlas included) with
    // it, so the next start builds a fresh one.
    this.pixi?.destroy();
    this.pixi = null;
    this.atlas = null;
    this.mount?.remove();
    this.mount = null;
  }
}

const ALL_TEAMS: Set<TeamId> = new Set<TeamId>(["blue", "red"]);

export const menuBackdrop = new MenuBackdrop();

// PixiJS bootstrap — SPEC §7. One Application, one logical world container —
// sized to whatever map is loaded, not a fixed constant (SPEC §3.1: no fixed
// arena size or aspect ratio) — scaled uniformly to fit the viewport and
// centered in it, so the map keeps its proportions and whatever is left over
// on one axis is letterboxed — works identically whether the arena renders
// in a phone browser or a desktop window.

import { Application, Container } from "pixi.js";

export type PixiHost = {
  app: Application;
  world: Container;
  /** World-space point to hold at `anchor` (a 0..1 fraction of the mount,
   *  default dead centre), clamped so the view never runs off the map.
   *  `null` (the default) centres the map itself, which is what a match wants
   *  — the arena doesn't pan. Used by the menu backdrop's spectator camera
   *  (SPEC §6.3), which anchors off-centre so the fight isn't behind the
   *  menu panel. */
  setFocus: (p: { x: number; y: number } | null, anchor?: { x: number; y: number }) => void;
  destroy: () => void;
};

export type PixiHostOptions = {
  /** `contain` (the default) letterboxes the whole map into the mount — what a
   *  match wants, since a cropped arena is a cropped playfield. `cover` scales
   *  by the *longer* ratio instead, filling the mount and cropping the
   *  overflow: for the menu backdrop (SPEC §6.3) there is nothing to play, and
   *  black letterbox bars behind the menu would look like a bug. */
  fit?: "contain" | "cover";
  /** Extra zoom on top of the fit, so a backdrop can frame a slice of the
   *  battlefield instead of the whole map at postage-stamp size. A function
   *  is re-read every frame — the right zoom depends on the viewport, which
   *  changes under a rotating phone. */
  zoom?: number | (() => number);
  /** Device-pixel cap. The default follows the display; a blurred backdrop
   *  doesn't need the extra pixels and shouldn't pay for them. */
  maxResolution?: number;
};

export async function createPixiApp(
  mount: HTMLElement,
  worldW: number,
  worldH: number,
  opts: PixiHostOptions = {},
): Promise<PixiHost> {
  const fit = opts.fit ?? "contain";
  const zoom = typeof opts.zoom === "function" ? opts.zoom : () => (opts.zoom as number | undefined) ?? 1;
  const app = new Application();
  await app.init({
    backgroundColor: 0x0b0f14,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, opts.maxResolution ?? 2),
  });
  mount.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  // Resize the renderer ourselves off the mount's own box every tick,
  // instead of Pixi's built-in `resizeTo` — that option only re-measures on
  // a *window* resize event, so its very first measurement (before any
  // resize has fired) landed on the full window height instead of this
  // mount's actual box, clipping the bottom of the arena under a
  // shorter-than-viewport mount (e.g. below the HUD's top bar, SPEC §6.2).
  let lastW = -1;
  let lastH = -1;
  let focus: { x: number; y: number } | null = null;
  let anchor = { x: 0.5, y: 0.5 };
  const layout = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w !== lastW || h !== lastH) {
      app.renderer.resize(w, h);
      lastW = w;
      lastH = h;
    }
    // One scale for both axes — cells stay square and the map keeps its
    // proportions; the shorter axis takes the leftover as an even letterbox
    // margin (or, under `cover`, spills evenly off both edges), rather than
    // the arena being stretched to fill it (SPEC §3.1).
    const sx = app.screen.width / worldW;
    const sy = app.screen.height / worldH;
    const scale = (fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy)) * zoom();
    world.scale.set(scale);
    // The focus point is in world units; the placement maths works in
    // rendered pixels, so it scales with everything else.
    world.position.set(
      axis(app.screen.width, worldW * scale, focus && focus.x * scale, anchor.x),
      axis(app.screen.height, worldH * scale, focus && focus.y * scale, anchor.y),
    );
  };
  app.ticker.add(layout);

  return {
    app,
    world,
    setFocus: (p, a) => {
      focus = p;
      if (a) anchor = a;
    },
    destroy: () => {
      app.ticker.remove(layout);
      app.destroy(true, { children: true });
      mount.innerHTML = "";
    },
  };
}

/** One axis of the world's placement: centre the focus point if there is one,
 *  then clamp so the map's own edge never pulls inside the view — panning to
 *  a corner must not reveal a strip of empty background next to the arena.
 *  With nothing to clamp against (the map is smaller than the mount on this
 *  axis) it falls back to centring the map. */
function axis(screen: number, world: number, focus: number | null | undefined, anchor: number): number {
  if (focus == null || world <= screen) return Math.round((screen - world) / 2);
  return Math.round(Math.min(0, Math.max(screen - world, screen * anchor - focus)));
}

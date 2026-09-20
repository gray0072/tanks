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
  destroy: () => void;
};

export async function createPixiApp(mount: HTMLElement, worldW: number, worldH: number): Promise<PixiHost> {
  const app = new Application();
  await app.init({
    backgroundColor: 0x0b0f14,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
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
    // margin, rather than the arena being stretched to fill it (SPEC §3.1).
    const scale = Math.min(app.screen.width / worldW, app.screen.height / worldH);
    world.scale.set(scale);
    world.position.set(
      Math.round((app.screen.width - worldW * scale) / 2),
      Math.round((app.screen.height - worldH * scale) / 2),
    );
  };
  app.ticker.add(layout);

  return {
    app,
    world,
    destroy: () => {
      app.ticker.remove(layout);
      app.destroy(true, { children: true });
      mount.innerHTML = "";
    },
  };
}

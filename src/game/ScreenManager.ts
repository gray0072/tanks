// Screens are plain DOM subtrees (SPEC §6) — only the Match screen mounts a
// PixiJS canvas for the arena itself. Exactly one screen is active at a
// time, matching the "single stack" model in the spec.

import { menuBackdrop } from "./menuBackdrop";

export interface Screen {
  mount(root: HTMLElement): void;
  unmount(): void;
  /** Whether the live menu backdrop (SPEC §6.3) keeps running behind this
   *  screen. Defaults to true — only the screens that own the canvas
   *  themselves (a match, the editor) opt out. */
  readonly backdrop?: boolean;
}

export class ScreenManager {
  private current: Screen | null = null;

  constructor(private root: HTMLElement) {}

  go(screen: Screen) {
    this.current?.unmount();
    this.root.innerHTML = "";
    this.current = screen;
    // Before mount, so a screen that opts out never shares a frame (or a
    // WebGL context) with the backdrop's renderer.
    menuBackdrop.setVisible(screen.backdrop !== false);
    screen.mount(this.root);
  }
}

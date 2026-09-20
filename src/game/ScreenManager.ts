// Screens are plain DOM subtrees (SPEC §6) — only the Match screen mounts a
// PixiJS canvas for the arena itself. Exactly one screen is active at a
// time, matching the "single stack" model in the spec.

export interface Screen {
  mount(root: HTMLElement): void;
  unmount(): void;
}

export class ScreenManager {
  private current: Screen | null = null;

  constructor(private root: HTMLElement) {}

  go(screen: Screen) {
    this.current?.unmount();
    this.root.innerHTML = "";
    this.current = screen;
    screen.mount(this.root);
  }
}

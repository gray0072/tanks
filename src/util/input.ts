import { Dir } from "./math";

export type SeatInput = { dir: Dir | null; fire: boolean; mine: boolean };

// Only the 4 cardinal keys are bound — a diagonal Dir comes from holding an
// adjacent pair of them at once (resolveDir below), not a dedicated key.
type CardinalDir = Dir.Up | Dir.Right | Dir.Down | Dir.Left;
const CARDINALS: CardinalDir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];

type SeatBindings = {
  dirs: Record<CardinalDir, string[]>;
  fire: string[];
  mine: string[];
};

// SPEC §5.1 — Player 1: WASD / Space / Q. Player 2 (local co-op): Arrows / Enter / RShift.
const BINDINGS: [SeatBindings, SeatBindings] = [
  {
    dirs: {
      [Dir.Up]: ["keyw"],
      [Dir.Right]: ["keyd"],
      [Dir.Down]: ["keys"],
      [Dir.Left]: ["keya"],
    },
    fire: ["space"],
    mine: ["keyq"],
  },
  {
    dirs: {
      [Dir.Up]: ["arrowup"],
      [Dir.Right]: ["arrowright"],
      [Dir.Down]: ["arrowdown"],
      [Dir.Left]: ["arrowleft"],
    },
    fire: ["enter", "controlright"],
    mine: ["shiftright"],
  },
];

// Up+Right held together faces/drives UpRight, etc. — the diagonal the two
// cardinal keys sit next to. Up+Down or Left+Right (opposite pairs) has no
// entry here; resolveDir() falls back to whichever of the pair was pressed
// more recently instead, same as it always has for a single conflicting axis.
const DIAGONAL: Partial<Record<CardinalDir, Partial<Record<CardinalDir, Dir>>>> = {
  [Dir.Up]: { [Dir.Left]: Dir.UpLeft, [Dir.Right]: Dir.UpRight },
  [Dir.Down]: { [Dir.Left]: Dir.DownLeft, [Dir.Right]: Dir.DownRight },
};

const PREVENT_DEFAULT = new Set([
  "keyw", "keya", "keys", "keyd", "keyq", "space",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "enter", "controlright", "shiftright", "tab", "escape",
]);

export class Input {
  private held = new Set<string>();
  // Most-recently-pressed-first stack of currently-held cardinal direction
  // keys, per seat — resolveDir() below combines an adjacent pair into a
  // diagonal, or falls back to the front of the stack for a single axis.
  private dirStack: [CardinalDir[], CardinalDir[]] = [[], []];
  private touch: [Partial<SeatInput>, Partial<SeatInput>] = [{}, {}];
  private tabDown = false;
  private escPressed = false;

  constructor() {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => {
      this.held.clear();
      this.dirStack = [[], []];
      this.tabDown = false;
    });
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const code = e.code.toLowerCase();
    if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    if (down === this.held.has(code)) {
      if (down) return; // already held, ignore repeat
    }
    if (down) this.held.add(code);
    else this.held.delete(code);

    for (let seat = 0; seat < 2; seat++) {
      const dirs = BINDINGS[seat].dirs;
      for (const d of CARDINALS) {
        if (!dirs[d].includes(code)) continue;
        const stack = this.dirStack[seat];
        const idx = stack.indexOf(d);
        if (down) {
          if (idx !== -1) stack.splice(idx, 1);
          stack.unshift(d);
        } else if (idx !== -1) {
          stack.splice(idx, 1);
        }
      }
    }

    if (code === "tab") this.tabDown = down;
    if (code === "escape" && down) this.escPressed = true;
  }

  /** Reads and clears the one-shot "Esc was pressed since last check" flag. */
  consumeEscape(): boolean {
    const v = this.escPressed;
    this.escPressed = false;
    return v;
  }

  scoreboardHeld(): boolean {
    return this.tabDown;
  }

  /** Mobile touch d-pad / fire / mine, seat 0 only (local co-op is desktop-only). */
  setTouchDir(dir: Dir | null) {
    this.touch[0].dir = dir ?? undefined;
  }
  setTouchFire(down: boolean) {
    this.touch[0].fire = down;
  }
  setTouchMine(down: boolean) {
    this.touch[0].mine = down;
  }

  /** Combines the seat's currently-held cardinal keys into one Dir: a
   *  vertical + a horizontal key held together (e.g. Up+Right) resolves to
   *  the diagonal between them; a single axis held resolves to that
   *  cardinal; an opposing pair on one axis (e.g. Up+Down) resolves to
   *  whichever of the two was pressed more recently, same tie-break as a
   *  single axis always used. */
  private resolveDir(seat: 0 | 1): Dir | null {
    const stack = this.dirStack[seat];
    const held = new Set(stack);
    const pick = (a: CardinalDir, b: CardinalDir): CardinalDir | null => {
      const ha = held.has(a), hb = held.has(b);
      if (ha && hb) return stack.indexOf(a) < stack.indexOf(b) ? a : b;
      return ha ? a : hb ? b : null;
    };
    const vertical = pick(Dir.Up, Dir.Down);
    const horizontal = pick(Dir.Left, Dir.Right);
    if (vertical !== null && horizontal !== null) return DIAGONAL[vertical]?.[horizontal] ?? vertical;
    return vertical ?? horizontal;
  }

  getSeatInput(seat: 0 | 1): SeatInput {
    const b = BINDINGS[seat];
    const keyDir = this.resolveDir(seat);
    const keyFire = b.fire.some((k) => this.held.has(k));
    const keyMine = b.mine.some((k) => this.held.has(k));
    const t = this.touch[seat];
    return {
      dir: keyDir ?? t.dir ?? null,
      fire: keyFire || !!t.fire,
      mine: keyMine || !!t.mine,
    };
  }
}

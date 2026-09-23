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

// SPEC §5.1 — Player 1: WASD / 1 / 2. Player 2 (local co-op): Arrows / N / M.
//
// Everything below is a `KeyboardEvent.code` — a *physical* key, not the
// character it produces — so the bindings are identical on a Russian (or any
// other) layout: `keyn` is the key labelled Т, `keyw` the one labelled Ц, and
// `digit1`/`digit2` are the number row regardless of what they type.
// Ctrl is deliberately not bound: `Ctrl`+`W` closes the tab and no page can
// stop it outside fullscreen.
const BINDINGS: [SeatBindings, SeatBindings] = [
  {
    dirs: {
      [Dir.Up]: ["keyw"],
      [Dir.Right]: ["keyd"],
      [Dir.Down]: ["keys"],
      [Dir.Left]: ["keya"],
    },
    fire: ["digit1"],
    mine: ["digit2"],
  },
  {
    dirs: {
      [Dir.Up]: ["arrowup"],
      [Dir.Right]: ["arrowright"],
      [Dir.Down]: ["arrowdown"],
      [Dir.Left]: ["arrowleft"],
    },
    fire: ["keyn"],
    mine: ["keym"],
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
  "keyw", "keya", "keys", "keyd", "digit1", "digit2",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "keyn", "keym", "tab", "escape",
]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export class Input {
  private held = new Set<string>();
  // Most-recently-pressed-first stack of currently-held cardinal direction
  // keys, per seat — resolveDir() below combines an adjacent pair into a
  // diagonal, or falls back to the front of the stack for a single axis.
  private dirStack: [CardinalDir[], CardinalDir[]] = [[], []];
  private touch: [Partial<SeatInput>, Partial<SeatInput>] = [{}, {}];
  private tabDown = false;
  private touchScoreboard = false;
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
    // The listeners stay on `window` for the rest of the session once a match
    // has run, so a bound key must not be swallowed while the player is typing
    // in a field elsewhere (a room code or map name is full of digits).
    if (isTyping(e.target)) return;
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
    return this.tabDown || this.touchScoreboard;
  }

  /** Touch equivalent of holding Tab — a HUD toggle rather than a hold,
   *  since there is no spare thumb to keep a button down with. */
  setTouchScoreboard(on: boolean) {
    this.touchScoreboard = on;
  }

  /** Mobile stick / fire / mine, seat 0 only (local co-op is desktop-only). */
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

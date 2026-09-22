// The level editor's document model — specs/level-editor.md §6. Pure: a
// character grid plus the paint/place/resize rules and an undo stack, with no
// DOM and no Vite-specific imports, so it runs headless under node:test
// exactly like the rest of `world/` does.
//
// The grid is stored as one character per cell, the same vocabulary the map
// format uses (SPEC §3.5, mapChars.ts) — the editor never builds a `Grid`,
// because the template *is* the document and a round-trip through parseMap
// would lose the things the parser folds away (bonus spawns, spawn order).

import {
  EDITOR_DEFAULT_H,
  EDITOR_DEFAULT_W,
  EDITOR_MAX_BONUS_SPAWNS,
  EDITOR_MAX_H,
  EDITOR_MAX_SPAWNS_PER_TEAM,
  EDITOR_MAX_W,
  EDITOR_MIN_H,
  EDITOR_MIN_W,
} from "../../game/config";
import { CHAR_TILE } from "./mapChars";

export const EMPTY = ".";
export const BONUS = "*";

/** Everything that paints as a surface — a rectangle fill is allowed only
 *  for these (specs/level-editor.md §6.4). `*` counts as terrain here: a
 *  bonus spawn renders as EMPTY and carries no roster meaning. */
export const TERRAIN_GLYPHS = Object.keys(CHAR_TILE);
/** Flags and player spawns — placed one at a time, never dragged out. */
export const ENTITY_GLYPHS = ["R", "B", "r", "b"] as const;

export type EntityGlyph = (typeof ENTITY_GLYPHS)[number];
export type Anchor = "start" | "center" | "end";

export function isTerrainGlyph(g: string): boolean {
  return TERRAIN_GLYPHS.includes(g);
}
export function isEntityGlyph(g: string): g is EntityGlyph {
  return (ENTITY_GLYPHS as readonly string[]).includes(g);
}
export function isKnownGlyph(g: string): boolean {
  return isTerrainGlyph(g) || isEntityGlyph(g);
}

/** Why a brush stroke did nothing — the editor turns these into a toast
 *  rather than leaving the click looking broken. */
export type PaintResult = "changed" | "unchanged" | "spawn-limit" | "bonus-limit" | "entity-rect";

export class EditorModel {
  width: number;
  height: number;
  /** Row-major, one glyph per cell. */
  private cells: string[];

  private constructor(width: number, height: number, cells: string[]) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  static fromTemplate(template: string): EditorModel {
    const rows = template.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
    const height = Math.max(1, rows.length);
    const width = Math.max(1, ...rows.map((r) => r.length));
    const cells: string[] = new Array(width * height).fill(EMPTY);
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? "";
      for (let x = 0; x < width; x++) {
        const c = row[x];
        // Ragged rows are padded rather than rejected: the editor has to be
        // able to *open* a broken map, that's how you fix one (§7.3).
        cells[y * width + x] = c !== undefined && isKnownGlyph(c) ? c : EMPTY;
      }
    }
    return new EditorModel(width, height, cells);
  }

  /** A fresh map that is **valid the moment it is created** (§6.2): steel
   *  border, one flag and one spawn per team mirrored red-top/blue-bottom,
   *  two bonus spawns at midfield. */
  static blank(width = EDITOR_DEFAULT_W, height = EDITOR_DEFAULT_H): EditorModel {
    const w = clamp(width, EDITOR_MIN_W, EDITOR_MAX_W);
    const h = clamp(height, EDITOR_MIN_H, EDITOR_MAX_H);
    const m = new EditorModel(w, h, new Array(w * h).fill(EMPTY));
    m.drawBorder();
    const mid = Math.floor(w / 2);
    m.set(mid, 1, "R");
    m.set(mid, h - 2, "B");
    m.set(mid - 2, 1, "r");
    m.set(mid + 2, h - 2, "b");
    m.set(mid - 3, Math.floor(h / 2), BONUS);
    m.set(mid + 3, Math.floor(h / 2), BONUS);
    return m;
  }

  clone(): EditorModel {
    return new EditorModel(this.width, this.height, this.cells.slice());
  }

  toTemplate(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      rows.push(this.cells.slice(y * this.width, (y + 1) * this.width).join(""));
    }
    return rows.join("\n");
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  at(x: number, y: number): string {
    return this.inBounds(x, y) ? this.cells[y * this.width + x] : EMPTY;
  }

  private set(x: number, y: number, g: string) {
    if (this.inBounds(x, y)) this.cells[y * this.width + x] = g;
  }

  count(glyph: string): number {
    let n = 0;
    for (const c of this.cells) if (c === glyph) n++;
    return n;
  }

  find(glyph: string): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === glyph) out.push({ x: i % this.width, y: Math.floor(i / this.width) });
    }
    return out;
  }

  // --- Brushes -------------------------------------------------------------

  /** One cell of a brush stroke. Terrain overwrites whatever was there,
   *  entities carry the rules from §6.4: a flag *moves*, a spawn *toggles*
   *  and is capped per team. */
  paint(x: number, y: number, glyph: string): PaintResult {
    if (!this.inBounds(x, y)) return "unchanged";
    const before = this.at(x, y);

    if (isTerrainGlyph(glyph)) {
      if (glyph === BONUS && before !== BONUS && this.count(BONUS) >= EDITOR_MAX_BONUS_SPAWNS) {
        return "bonus-limit";
      }
      if (before === glyph) return "unchanged";
      this.set(x, y, glyph);
      return "changed";
    }

    if (glyph === "R" || glyph === "B") {
      // Exactly one per team by construction, so the flag brush is "pick it
      // up and drop it here" — never a second flag, never a delete.
      if (before === glyph) return "unchanged";
      for (const p of this.find(glyph)) this.set(p.x, p.y, EMPTY);
      this.set(x, y, glyph);
      return "changed";
    }

    if (glyph === "r" || glyph === "b") {
      // Same-team spawn under the brush: toggle it off. That's how you delete
      // a spawn without switching brushes.
      if (before === glyph) {
        this.set(x, y, EMPTY);
        return "changed";
      }
      if (this.count(glyph) >= EDITOR_MAX_SPAWNS_PER_TEAM) return "spawn-limit";
      this.set(x, y, glyph);
      return "changed";
    }

    return "unchanged";
  }

  /** Rectangle fill — **terrain only** (§6.4): bushes, walls, water and the
   *  rest can be dragged out as a block, flags and spawns can't, because each
   *  is a discrete objective/roster entity rather than a surface. */
  fillRect(x0: number, y0: number, x1: number, y1: number, glyph: string): PaintResult {
    if (!isTerrainGlyph(glyph)) return "entity-rect";
    const r = this.normalizeRect(x0, y0, x1, y1);
    let changed = false;
    let hitBonusLimit = false;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const res = this.paint(x, y, glyph);
        if (res === "changed") changed = true;
        if (res === "bonus-limit") hitBonusLimit = true;
      }
    }
    if (hitBonusLimit && !changed) return "bonus-limit";
    return changed ? "changed" : "unchanged";
  }

  /** Clamped to the grid — a drag that leaves the canvas paints what's
   *  inside it, never out of bounds. */
  normalizeRect(x0: number, y0: number, x1: number, y1: number) {
    return {
      x0: clamp(Math.min(x0, x1), 0, this.width - 1),
      y0: clamp(Math.min(y0, y1), 0, this.height - 1),
      x1: clamp(Math.max(x0, x1), 0, this.width - 1),
      y1: clamp(Math.max(y0, y1), 0, this.height - 1),
    };
  }

  // --- Resize --------------------------------------------------------------

  /** What shrinking to this size would throw away (§6.5) — the editor asks
   *  before doing it, naming the counts. */
  resizeLoss(width: number, height: number, ax: Anchor, ay: Anchor) {
    const { dx, dy } = resizeOffset(this.width, this.height, width, height, ax, ay);
    let entities = 0;
    let painted = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) continue;
        const g = this.at(x, y);
        if (isEntityGlyph(g)) entities++;
        else if (g !== EMPTY) painted++;
      }
    }
    return { entities, painted };
  }

  /** Grow/shrink around an anchor. Growing adds EMPTY away from the anchor
   *  and, when the map already had a complete steel border, redraws it on the
   *  new outer ring so the frame doesn't end up stranded mid-map. */
  resize(width: number, height: number, ax: Anchor, ay: Anchor, opts: { redrawBorder?: boolean } = {}) {
    const w = clamp(width, EDITOR_MIN_W, EDITOR_MAX_W);
    const h = clamp(height, EDITOR_MIN_H, EDITOR_MAX_H);
    const hadBorder = this.hasSteelBorder();
    const { dx, dy } = resizeOffset(this.width, this.height, w, h, ax, ay);
    const next: string[] = new Array(w * h).fill(EMPTY);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        next[ny * w + nx] = this.cells[y * this.width + x];
      }
    }
    this.cells = next;
    this.width = w;
    this.height = h;
    if (hadBorder && opts.redrawBorder !== false) this.drawBorder();
  }

  hasSteelBorder(): boolean {
    for (let x = 0; x < this.width; x++) {
      if (this.at(x, 0) !== "@" || this.at(x, this.height - 1) !== "@") return false;
    }
    for (let y = 0; y < this.height; y++) {
      if (this.at(0, y) !== "@" || this.at(this.width - 1, y) !== "@") return false;
    }
    return true;
  }

  drawBorder(glyph = "@") {
    for (let x = 0; x < this.width; x++) {
      this.set(x, 0, glyph);
      this.set(x, this.height - 1, glyph);
    }
    for (let y = 0; y < this.height; y++) {
      this.set(0, y, glyph);
      this.set(this.width - 1, y, glyph);
    }
  }
}

/** Where the old grid's (0,0) lands in the new one. */
function resizeOffset(
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  ax: Anchor,
  ay: Anchor,
): { dx: number; dy: number } {
  const off = (oldN: number, newN: number, a: Anchor) =>
    a === "start" ? 0 : a === "end" ? newN - oldN : Math.floor((newN - oldN) / 2);
  return { dx: off(oldW, newW, ax), dy: off(oldH, newH, ay) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Model + undo stack. Every committed gesture — one click, one freehand drag,
 * one rectangle, one resize — is a single step (§6.4/§6.6), which is why
 * mutation goes through `commit()`: it snapshots the template before, and
 * throws the snapshot away again if the gesture turned out to change nothing.
 *
 * Whole-grid snapshots rather than a command log: a 64x64 grid is 4KB, so the
 * 50-deep history is ~200KB, far cheaper than a command log is to get right.
 */
export class EditorDoc {
  model: EditorModel;
  private past: string[] = [];
  private future: string[] = [];
  private strokeBefore: string | null = null;

  constructor(model: EditorModel, private limit = 50) {
    this.model = model;
  }

  static fromTemplate(template: string): EditorDoc {
    return new EditorDoc(EditorModel.fromTemplate(template));
  }

  get template(): string {
    return this.model.toTemplate();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit<T>(fn: (m: EditorModel) => T): T {
    this.beginStroke();
    const result = fn(this.model);
    this.endStroke();
    return result;
  }

  /** A drag paints many cells but is *one* undo step (§6.4), so the snapshot
   *  is taken when the pointer goes down and banked when it lifts. */
  beginStroke() {
    if (this.strokeBefore === null) this.strokeBefore = this.model.toTemplate();
  }

  /** True if the stroke actually changed anything. */
  endStroke(): boolean {
    const before = this.strokeBefore;
    this.strokeBefore = null;
    if (before === null || this.model.toTemplate() === before) return false;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    return true;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.model.toTemplate());
    this.model = EditorModel.fromTemplate(prev);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.model.toTemplate());
    this.model = EditorModel.fromTemplate(next);
    return true;
  }
}

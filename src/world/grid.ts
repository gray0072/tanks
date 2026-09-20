// Terrain grid — SPEC §3.3 (surfaces) and §3.5 (map file format).

export enum Tile {
  Empty = 0,
  Brick = 1,
  Steel = 2,
  Forest = 3,
  Water = 4,
  Ice = 5,
  Sand = 6,
  FlagBlue = 7,
  FlagRed = 8,
}

export const BRICK_QUARTERS = 4;

export type CellPos = { cx: number; cy: number };

export class Grid {
  readonly width: number;
  readonly height: number;
  private tiles: Uint8Array;
  // Remaining quarters for BRICK cells (0..4); meaningless for other tiles.
  private brickQuarters: Uint8Array;

  constructor(width: number, height: number, tiles?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.tiles = tiles ?? new Uint8Array(width * height);
    this.brickQuarters = new Uint8Array(width * height).fill(BRICK_QUARTERS);
  }

  private idx(cx: number, cy: number): number {
    return cy * this.width + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  tileAt(cx: number, cy: number): Tile {
    if (!this.inBounds(cx, cy)) return Tile.Steel; // out of bounds = solid
    return this.tiles[this.idx(cx, cy)];
  }

  setTile(cx: number, cy: number, t: Tile) {
    if (!this.inBounds(cx, cy)) return;
    this.tiles[this.idx(cx, cy)] = t;
    if (t === Tile.Brick) this.brickQuarters[this.idx(cx, cy)] = BRICK_QUARTERS;
  }

  brickQuartersAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return 0;
    return this.brickQuarters[this.idx(cx, cy)];
  }

  /** Returns true if the cell became empty (fully destroyed). */
  damageBrick(cx: number, cy: number, quarters: number): boolean {
    if (!this.inBounds(cx, cy) || this.tileAt(cx, cy) !== Tile.Brick) return false;
    const i = this.idx(cx, cy);
    this.brickQuarters[i] = Math.max(0, this.brickQuarters[i] - quarters);
    if (this.brickQuarters[i] === 0) {
      this.tiles[i] = Tile.Empty;
      return true;
    }
    return false;
  }

  /** SHOVEL bonus: turn a cell to steel and remember what to restore it to. */
  fortify(cx: number, cy: number): Tile | null {
    if (!this.inBounds(cx, cy)) return null;
    const prev = this.tileAt(cx, cy);
    if (prev !== Tile.Brick) return null;
    this.setTile(cx, cy, Tile.Steel);
    return prev;
  }

  restore(cx: number, cy: number, tile: Tile) {
    this.setTile(cx, cy, tile);
  }

  isFlag(t: Tile): boolean {
    return t === Tile.FlagBlue || t === Tile.FlagRed;
  }

  /** Can a tank's footprint occupy this single cell (ignores other tanks)? */
  tankPassableCell(cx: number, cy: number): boolean {
    const t = this.tileAt(cx, cy);
    return t !== Tile.Brick && t !== Tile.Steel && t !== Tile.Water && !this.isFlag(t);
  }

  /** Can a bullet continue flying through this single cell? */
  bulletPassableCell(cx: number, cy: number): boolean {
    const t = this.tileAt(cx, cy);
    return t !== Tile.Brick && t !== Tile.Steel && !this.isFlag(t);
  }

  /** Movement cost multiplier for a bot's path cost map (SPEC §10.1). */
  moveCost(cx: number, cy: number): number {
    const t = this.tileAt(cx, cy);
    switch (t) {
      case Tile.Brick:
        return 3;
      case Tile.Sand:
        return 2;
      case Tile.Ice:
        return 1.5;
      case Tile.Steel:
      case Tile.Water:
        return Infinity;
      default:
        return this.isFlag(t) ? Infinity : 1;
    }
  }

  /** True if every cell of the 2x2 footprint at (cx,cy) is tank-passable. */
  footprintPassable(cx: number, cy: number, predicate: (cx: number, cy: number) => boolean): boolean {
    return (
      predicate(cx, cy) &&
      predicate(cx + 1, cy) &&
      predicate(cx, cy + 1) &&
      predicate(cx + 1, cy + 1)
    );
  }

  /** Single-cell BFS used only by the map validator's coarse connectivity
   *  check ("is this region sealed off by permanent walls/water"). Flags and
   *  spawn markers are passable here — unlike real tank movement, we want to
   *  reach a flag/spawn's own cell, not just stand next to it, and brick
   *  counts as passable since it can always be shot open. */
  floodFillReachable(fromCx: number, fromCy: number): Set<number> {
    const seen = new Set<number>();
    const stack: [number, number][] = [[fromCx, fromCy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const key = this.idx(x, y);
      if (seen.has(key) || !this.inBounds(x, y)) continue;
      const t = this.tileAt(x, y);
      if (t === Tile.Steel || t === Tile.Water) continue;
      seen.add(key);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
  }
}

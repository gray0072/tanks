import { Grid, Tile } from "./grid";

/** A flag occupies exactly one cell, like everything else on the map (SPEC
 *  §3.5: "nothing is a 2 x 2 block"). Kept as a function so the callers read
 *  the same whether or not that ever changes again. */
export function flagCells(at: { cx: number; cy: number }): { cx: number; cy: number }[] {
  return [{ cx: at.cx, cy: at.cy }];
}

/** The brick walls immediately surrounding a flag's 2x2 pocket (SPEC §3.2,
 *  "walled in by brick on three sides"). Found generically by adjacency so it
 *  works for any map, not just the authored three. */
export function flagPocketWalls(grid: Grid, at: { cx: number; cy: number }): { cx: number; cy: number }[] {
  const flagSet = new Set(flagCells(at).map((c) => c.cy * grid.width + c.cx));
  const walls = new Map<number, { cx: number; cy: number }>();
  for (const c of flagCells(at)) {
    const neighbors = [
      { cx: c.cx - 1, cy: c.cy },
      { cx: c.cx + 1, cy: c.cy },
      { cx: c.cx, cy: c.cy - 1 },
      { cx: c.cx, cy: c.cy + 1 },
    ];
    for (const n of neighbors) {
      const key = n.cy * grid.width + n.cx;
      if (flagSet.has(key)) continue;
      if (grid.tileAt(n.cx, n.cy) === Tile.Brick) walls.set(key, n);
    }
  }
  return [...walls.values()];
}

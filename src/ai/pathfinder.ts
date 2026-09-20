// A* over the terrain cost grid (SPEC §10.1 "Pathing"). Bots are treated as a
// single point on the cell grid rather than a full 2x2 footprint — a
// deliberate simplification; the sim's own movement collision still uses the
// full footprint, so a bot occasionally nudges along a wall it "shouldn't"
// fit past by half a cell. Not worth the extra cost for an MVP bot.

import { Grid, Tile } from "../world/grid";

export type CellPoint = { cx: number; cy: number };

export type PathOptions = {
  maxNodes?: number;
  /** What a brick cell costs to route through. The caller supplies it from
   *  the bot's profile (SPEC §10.3 "Shoots brick to path"): `Infinity` for a
   *  bot that never shoots brick, so it paths around instead of walking into
   *  a wall it will never open. */
  brickCost?: number;
};

type Node = { cx: number; cy: number; g: number; f: number; parent: Node | null };

const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function manhattan(a: CellPoint, b: CellPoint): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

function costAt(grid: Grid, cx: number, cy: number, brickCost: number): number {
  return grid.tileAt(cx, cy) === Tile.Brick ? brickCost : grid.moveCost(cx, cy);
}

/** The nearest cell to `to` that A* can actually stand on, `to` itself if it
 *  is already passable, or null if nothing within `maxRing` is.
 *
 *  This is what makes an *objective* pathable. A flag tile costs Infinity
 *  (grid.moveCost) and so does the steel around it, so asking A* for the flag
 *  cell itself always fails — which used to leave every bot in `AttackFlag`
 *  with a null path and no movement input at all. Snapping puts the goal on
 *  the closest cell the bot can reach, which for a flag is a firing position
 *  right outside its pocket. */
export function nearestPassable(grid: Grid, to: CellPoint, brickCost = 3, maxRing = 6): CellPoint | null {
  if (Number.isFinite(costAt(grid, to.cx, to.cy, brickCost))) return to;
  for (let r = 1; r <= maxRing; r++) {
    let best: CellPoint | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const cx = to.cx + dx;
        const cy = to.cy + dy;
        if (!grid.inBounds(cx, cy)) continue;
        if (!Number.isFinite(costAt(grid, cx, cy, brickCost))) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { cx, cy }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Returns a path of cell centers from `from` to `to` (exclusive of `from`),
 *  or null if unreachable. `to` is snapped to the nearest passable cell if it
 *  sits inside a solid block (e.g. pathing "into" a flag pocket to shoot it). */
export function findPath(grid: Grid, from: CellPoint, to: CellPoint, opts: PathOptions = {}): CellPoint[] | null {
  const maxNodes = opts.maxNodes ?? 4000;
  const brickCost = opts.brickCost ?? 3;
  const goal = nearestPassable(grid, to, brickCost);
  if (!goal) return null;

  const key = (c: CellPoint) => c.cy * grid.width + c.cx;
  const open = new Map<number, Node>();
  const closed = new Set<number>();
  const start: Node = { ...from, g: 0, f: manhattan(from, goal), parent: null };
  open.set(key(from), start);

  let visited = 0;
  while (open.size > 0 && visited < maxNodes) {
    let current: Node | null = null;
    for (const n of open.values()) {
      if (!current || n.f < current.f) current = n;
    }
    if (!current) break;
    open.delete(key(current));
    closed.add(key(current));
    visited++;

    if (current.cx === goal.cx && current.cy === goal.cy) {
      const path: CellPoint[] = [];
      let n: Node | null = current;
      while (n && n.parent) {
        path.unshift({ cx: n.cx, cy: n.cy });
        n = n.parent;
      }
      return path;
    }

    for (const { dx, dy } of NEIGHBORS) {
      const ncx = current.cx + dx;
      const ncy = current.cy + dy;
      if (!grid.inBounds(ncx, ncy)) continue;
      const nk = ncy * grid.width + ncx;
      if (closed.has(nk)) continue;
      const cost = costAt(grid, ncx, ncy, brickCost);
      if (!Number.isFinite(cost)) continue;
      const g = current.g + cost;
      const existing = open.get(nk);
      if (existing && existing.g <= g) continue;
      open.set(nk, { cx: ncx, cy: ncy, g, f: g + manhattan({ cx: ncx, cy: ncy }, goal), parent: current });
    }
  }
  return null;
}

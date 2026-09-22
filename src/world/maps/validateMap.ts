// Map validation for the level editor — specs/level-editor.md §7. Pure (no
// DOM, no Vite imports), so it runs headless under node:test.
//
// This is deliberately *not* a thin wrapper over parseMap. The parser throws
// one combined message for the built-ins' CI gate; the editor needs a list of
// individually-addressable problems, each able to point at the cells it is
// about, and it needs to say *which* spawn is walled in rather than "(3,1) is
// not reachable". parseMap still runs at the end as a safety net: nothing may
// be saved as playable that the engine's own parser would reject.

import {
  EDITOR_MAX_BONUS_SPAWNS,
  EDITOR_MAX_H,
  EDITOR_MAX_NAME,
  EDITOR_MAX_SPAWNS_PER_TEAM,
  EDITOR_MAX_W,
  EDITOR_MIN_H,
  EDITOR_MIN_W,
} from "../../game/config";
import { CHAR_TILE } from "./mapChars";
import { MapValidationError, parseMap } from "./mapFormat";

export type Cell = { cx: number; cy: number };

export type MapProblem = {
  severity: "error" | "warning";
  message: string;
  cells?: Cell[];
};

export type ValidateOpts = {
  /** Checked only when given — the template itself carries no name. */
  name?: string;
  /** Names of the *other* custom maps, for the uniqueness rule. */
  otherNames?: string[];
};

/** Permanently impassable for a tank. BRICK is passable here: it can always
 *  be shot open, so a base behind brick is reachable, just slower. */
const BLOCKING = new Set(["@", "~"]);

export function hasErrors(problems: MapProblem[]): boolean {
  return problems.some((p) => p.severity === "error");
}

export function validateMapTemplate(template: string, opts: ValidateOpts = {}): MapProblem[] {
  const problems: MapProblem[] = [];
  const err = (message: string, cells?: Cell[]) => problems.push({ severity: "error", message, cells });
  const warn = (message: string, cells?: Cell[]) => problems.push({ severity: "warning", message, cells });

  const rows = template.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  const height = rows.length;
  const width = rows[0]?.length ?? 0;

  // --- 1. Shape and vocabulary ---------------------------------------------
  if (width === 0 || height === 0) {
    err("The map is empty.");
    return problems;
  }
  const ragged = rows.map((r, y) => ({ r, y })).filter(({ r }) => r.length !== width);
  if (ragged.length) {
    err(`Rows ${ragged.map(({ y }) => y).join(", ")} don't match row 0's width of ${width}.`);
  }
  if (width < EDITOR_MIN_W || height < EDITOR_MIN_H) {
    err(`${width}×${height} is smaller than the ${EDITOR_MIN_W}×${EDITOR_MIN_H} minimum.`);
  }
  if (width > EDITOR_MAX_W || height > EDITOR_MAX_H) {
    err(`${width}×${height} is larger than the ${EDITOR_MAX_W}×${EDITOR_MAX_H} maximum.`);
  }

  const unknown: Cell[] = [];
  const redSpawns: Cell[] = [];
  const blueSpawns: Cell[] = [];
  const redFlags: Cell[] = [];
  const blueFlags: Cell[] = [];
  const bonuses: Cell[] = [];
  for (let cy = 0; cy < height; cy++) {
    const row = rows[cy];
    for (let cx = 0; cx < row.length; cx++) {
      const c = row[cx];
      if (c === "r") redSpawns.push({ cx, cy });
      else if (c === "b") blueSpawns.push({ cx, cy });
      else if (c === "R") redFlags.push({ cx, cy });
      else if (c === "B") blueFlags.push({ cx, cy });
      else if (c === "*") bonuses.push({ cx, cy });
      else if (CHAR_TILE[c] === undefined) unknown.push({ cx, cy });
    }
  }
  if (unknown.length) {
    err(`${unknown.length} cell(s) use a character the map format doesn't know.`, unknown);
  }

  // --- 2..3. Flags and rosters ---------------------------------------------
  for (const [team, flags] of [["Red", redFlags], ["Blue", blueFlags]] as const) {
    if (flags.length === 0) err(`No ${team.toLowerCase()} flag — place one.`);
    else if (flags.length > 1) err(`${flags.length} ${team.toLowerCase()} flags — there can only be one.`, flags);
  }
  if (redSpawns.length === 0) err("Red has no player spawns.");
  if (blueSpawns.length === 0) err("Blue has no player spawns.");

  for (const [team, spawns] of [["Red", redSpawns], ["Blue", blueSpawns]] as const) {
    if (spawns.length > EDITOR_MAX_SPAWNS_PER_TEAM) {
      err(`${team} has ${spawns.length} spawns — at most ${EDITOR_MAX_SPAWNS_PER_TEAM} per team.`, spawns);
    }
  }
  if (bonuses.length > EDITOR_MAX_BONUS_SPAWNS) {
    err(`${bonuses.length} bonus spawn points — at most ${EDITOR_MAX_BONUS_SPAWNS}.`, bonuses);
  }

  // --- 4..5. Reachability ---------------------------------------------------
  // "Nobody is walled in": flood over everything a tank can eventually occupy
  // (steel and water block, brick is shootable) and require every spawn to
  // reach both flags. Reachability is symmetric, so one flood from the red
  // flag answers it for every pair.
  const passable = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < width && cy < height && !BLOCKING.has(rows[cy]?.[cx] ?? "@");
  const origin = redFlags[0] ?? redSpawns[0] ?? blueFlags[0];
  const reached = origin ? flood(origin, passable, width) : new Set<number>();
  const key = (c: Cell) => c.cy * width + c.cx;
  const isReached = (c: Cell) => reached.has(key(c));

  if (origin) {
    const describe = (c: Cell, what: string) => {
      const sealedBy = sealingTerrain(c, rows, width, height);
      err(
        `${what} at (${c.cx},${c.cy}) can't reach the rest of the map — it's sealed in by ${sealedBy}.`,
        [c],
      );
    };
    const originIsRedFlag = redFlags[0] !== undefined;
    for (const [what, list] of [
      ["Red spawn", redSpawns],
      ["Blue spawn", blueSpawns],
    ] as const) {
      for (const c of list) if (!isReached(c)) describe(c, what);
    }
    if (blueFlags[0] && !isReached(blueFlags[0])) describe(blueFlags[0], "The blue flag");
    if (!originIsRedFlag && redFlags[0] && !isReached(redFlags[0])) describe(redFlags[0], "The red flag");
  }

  // --- 6..7. Spawn separation ------------------------------------------------
  for (const r of redSpawns) {
    for (const b of blueSpawns) {
      if (chebyshev(r, b) < 2) {
        err(`Red spawn (${r.cx},${r.cy}) and blue spawn (${b.cx},${b.cy}) are next to each other.`, [r, b]);
      }
    }
  }
  for (const [flag, enemySpawns, what] of [
    [redFlags[0], blueSpawns, "The red flag"],
    [blueFlags[0], redSpawns, "The blue flag"],
  ] as const) {
    if (!flag) continue;
    for (const s of enemySpawns) {
      if (chebyshev(flag, s) < 2) {
        err(`${what} is right next to an enemy spawn at (${s.cx},${s.cy}).`, [flag, s]);
      }
    }
  }

  // --- 9. Name ---------------------------------------------------------------
  if (opts.name !== undefined) {
    for (const p of validateMapName(opts.name, opts.otherNames ?? [])) problems.push(p);
  }

  // --- Safety net ------------------------------------------------------------
  // Whatever the rules above missed, the engine's own parser must still
  // accept — a map that parseMap rejects can never be allowed into a match.
  try {
    parseMap("preview", "Preview", template);
  } catch (e) {
    if (e instanceof MapValidationError && !hasErrors(problems)) {
      for (const line of e.message.split("\n").slice(1)) {
        const t = line.trim();
        if (t) err(t);
      }
    }
  }

  if (hasErrors(problems)) return problems;

  // --- Warnings (§7.2) -------------------------------------------------------
  // Only worth computing on an otherwise-valid map: every one of them assumes
  // two flags and two rosters exist.
  const redFlag = redFlags[0];
  const blueFlag = blueFlags[0];

  for (const [flag, enemySpawns, what] of [
    [redFlag, blueSpawns, "The red flag"],
    [blueFlag, redSpawns, "The blue flag"],
  ] as const) {
    for (const s of enemySpawns) {
      if ((s.cx !== flag.cx && s.cy !== flag.cy) || !openLane(flag, s, rows)) continue;
      warn(
        `${what} is on an open line of fire from the enemy spawn at (${s.cx},${s.cy}) — put a steel block on that lane.`,
        [flag, s],
      );
    }
  }

  const pockets: Cell[] = [];
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (passable(cx, cy) && !reached.has(cy * width + cx)) pockets.push({ cx, cy });
    }
  }
  if (pockets.length) {
    warn(`${pockets.length} open cell(s) are sealed off from the rest of the map.`, pockets);
  }

  const redDist = distances(redFlag, passable, width);
  const blueDist = distances(blueFlag, passable, width);
  let redArea = 0;
  let blueArea = 0;
  for (const k of reached) {
    const dr = redDist.get(k) ?? Infinity;
    const db = blueDist.get(k) ?? Infinity;
    if (dr < db) redArea++;
    else if (db < dr) blueArea++;
  }
  const worst = Math.max(redArea, blueArea);
  if (worst > 0 && Math.abs(redArea - blueArea) / worst > 0.2) {
    warn(`The halves are lopsided — ${redArea} cells are closer to red, ${blueArea} to blue.`);
  }

  if (redSpawns.length !== blueSpawns.length) {
    // Allowed — the engine builds each team from its own spawn count — but
    // an uneven fight is far more often a slip than a design.
    warn(
      `Uneven teams: red has ${redSpawns.length} spawn(s), blue has ${blueSpawns.length}.`,
      [...redSpawns, ...blueSpawns],
    );
  }

  if (bonuses.length === 0) {
    warn("No bonus spawn points (*) — bonuses will never appear on this map.");
  }

  for (const [flag, what] of [
    [redFlag, "The red flag"],
    [blueFlag, "The blue flag"],
  ] as const) {
    const cover = neighbors8(flag).some(({ cx, cy }) => {
      const c = rows[cy]?.[cx];
      return c === "#" || c === "@";
    });
    if (!cover) warn(`${what} has no cover around it.`, [flag]);
  }

  const tanks = redSpawns.length + blueSpawns.length;
  if (tanks > 0 && reached.size / tanks < 12) {
    warn(`Cramped: ${reached.size} open cells for ${tanks} tanks (about ${Math.floor(reached.size / tanks)} each).`);
  }

  return problems;
}

/** Name rules (§5.4) — also used on their own by the library's rename/copy
 *  paths, where there's no template to validate. */
export function validateMapName(name: string, otherNames: string[]): MapProblem[] {
  const trimmed = name.trim();
  if (!trimmed) return [{ severity: "error", message: "The map needs a name." }];
  if (trimmed.length > EDITOR_MAX_NAME) {
    return [{ severity: "error", message: `The name is longer than ${EDITOR_MAX_NAME} characters.` }];
  }
  if (otherNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())) {
    return [{ severity: "error", message: `You already have a map called "${trimmed}".` }];
  }
  return [];
}

// --- helpers ---------------------------------------------------------------

/** Cells reachable from `from`, keyed `cy * width + cx` like the rest of the
 *  codebase (world/grid.ts's own flood fill uses the same key). */
function flood(from: Cell, passable: (cx: number, cy: number) => boolean, width: number): Set<number> {
  const seen = new Set<number>();
  const stack: Cell[] = [from];
  while (stack.length) {
    const c = stack.pop()!;
    if (!passable(c.cx, c.cy)) continue;
    const k = c.cy * width + c.cx;
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(
      { cx: c.cx + 1, cy: c.cy },
      { cx: c.cx - 1, cy: c.cy },
      { cx: c.cx, cy: c.cy + 1 },
      { cx: c.cx, cy: c.cy - 1 },
    );
  }
  return seen;
}

/** BFS hop counts from a cell, keyed the same way as `flood`. */
function distances(from: Cell, passable: (cx: number, cy: number) => boolean, width: number): Map<number, number> {
  const dist = new Map<number, number>();
  if (!passable(from.cx, from.cy)) return dist;
  const queue: Cell[] = [from];
  dist.set(from.cy * width + from.cx, 0);
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const d = dist.get(c.cy * width + c.cx)!;
    for (const n of [
      { cx: c.cx + 1, cy: c.cy },
      { cx: c.cx - 1, cy: c.cy },
      { cx: c.cx, cy: c.cy + 1 },
      { cx: c.cx, cy: c.cy - 1 },
    ]) {
      if (!passable(n.cx, n.cy)) continue;
      const k = n.cy * width + n.cx;
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** True if nothing permanent interrupts the straight line between two cells
 *  that share a row or a column. Brick doesn't count — it gets shot away. */
function openLane(a: Cell, b: Cell, rows: string[]): boolean {
  const dx = Math.sign(b.cx - a.cx);
  const dy = Math.sign(b.cy - a.cy);
  let cx = a.cx + dx;
  let cy = a.cy + dy;
  while (cx !== b.cx || cy !== b.cy) {
    if (rows[cy]?.[cx] === "@") return false;
    cx += dx;
    cy += dy;
  }
  return true;
}

/** What the walls around a sealed-in cell are made of, for the message. */
function sealingTerrain(c: Cell, rows: string[], width: number, height: number): string {
  let steel = false;
  let water = false;
  for (const n of neighbors8(c)) {
    if (n.cx < 0 || n.cy < 0 || n.cx >= width || n.cy >= height) continue;
    const g = rows[n.cy]?.[n.cx];
    if (g === "@") steel = true;
    if (g === "~") water = true;
  }
  if (steel && water) return "steel and water";
  if (water) return "water";
  return "steel";
}

function neighbors8(c: Cell): Cell[] {
  const out: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) out.push({ cx: c.cx + dx, cy: c.cy + dy });
    }
  }
  return out;
}

function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
}

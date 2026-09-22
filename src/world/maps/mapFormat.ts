// Parses and validates the map character-grid format (SPEC §3.5) into a
// runtime MapDef. Pure — no Vite-specific imports — so it can run under
// plain Node too (see scripts/checkMaps.ts, `npm run maps:check`).
//
// A map is a single JS template literal, one character per cell, no header:
//
//   r.......
//   .##..##.
//   .R#..#B.
//   .##..##.
//   .......b
//
// A leading/trailing newline (from writing the template on its own lines
// between backticks) is stripped; what's left fixes both the map's
// dimensions and its team size — however many `r`/`b` markers it has (5 for
// every built-in map, but nothing here requires that: any size from 2x2 up
// to MAX_MAP_W/H parses, with any number of spawns per team — the two teams
// need not be the same size). Flags are
// `R` (red) and `B` (blue), players `r`/`b`, one cell each — spawn priority
// is assigned by scan order, top-to-bottom then left-to-right. Terrain uses
// the glyphs in mapChars.ts.

import { Grid, Tile } from "../grid";
import type { TeamId } from "../../game/config";
import { MIN_MAP_W, MIN_MAP_H, MAX_MAP_W, MAX_MAP_H } from "../../game/config";
import { CHAR_TILE } from "./mapChars";

export type MapDef = {
  id: string;
  name: string;
  width: number;
  height: number;
  grid: Grid;
  flags: Record<TeamId, { cx: number; cy: number }>;
  spawns: Record<TeamId, { cx: number; cy: number }[]>;
  bonusSpawns: { cx: number; cy: number }[];
};

export class MapValidationError extends Error {}

export function parseMap(id: string, name: string, template: string): MapDef {
  const errors: string[] = [];
  const rows = template.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");

  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (width === 0 || height === 0) errors.push("empty template");
  rows.forEach((r, y) => {
    if (r.length !== width) errors.push(`row ${y} has length ${r.length}, expected ${width} (row 0's length)`);
  });
  if (width > MAX_MAP_W || height > MAX_MAP_H) {
    errors.push(`${width}x${height} exceeds the ${MAX_MAP_W}x${MAX_MAP_H} max map size`);
  }
  if (width > 0 && height > 0 && (width < MIN_MAP_W || height < MIN_MAP_H)) {
    errors.push(`${width}x${height} is below the ${MIN_MAP_W}x${MIN_MAP_H} min map size`);
  }

  const grid = new Grid(width, height);
  const bonusSpawns: { cx: number; cy: number }[] = [];
  const redSpawns: { cx: number; cy: number }[] = [];
  const blueSpawns: { cx: number; cy: number }[] = [];
  let redFlag: { cx: number; cy: number } | null = null;
  let blueFlag: { cx: number; cy: number } | null = null;

  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x++) {
      const c = row[x];
      if (c === "*") {
        bonusSpawns.push({ cx: x, cy: y });
        continue;
      }
      if (c === "r") {
        redSpawns.push({ cx: x, cy: y });
        continue;
      }
      if (c === "b") {
        blueSpawns.push({ cx: x, cy: y });
        continue;
      }
      if (c === "R") {
        if (redFlag) errors.push(`duplicate red flag 'R' at row ${y} col ${x}`);
        redFlag = { cx: x, cy: y };
        continue;
      }
      if (c === "B") {
        if (blueFlag) errors.push(`duplicate blue flag 'B' at row ${y} col ${x}`);
        blueFlag = { cx: x, cy: y };
        continue;
      }
      const tile = CHAR_TILE[c];
      if (tile === undefined) {
        errors.push(`row ${y} col ${x}: unknown character '${c}'`);
        continue;
      }
      grid.setTile(x, y, tile);
    }
  }

  if (redSpawns.length === 0) errors.push("no red spawns ('r')");
  if (blueSpawns.length === 0) errors.push("no blue spawns ('b')");
  // Teams need *not* match: a map may field 4 against 6 (SPEC §3.5). The
  // roster is built per team from these counts and MatchRules attributes
  // stats via slot.team, so nothing downstream needs them equal. The editor
  // still warns, since an uneven fight is usually an authoring slip.
  if (!redFlag) errors.push("missing red flag 'R'");
  if (!blueFlag) errors.push("missing blue flag 'B'");

  if (redFlag) grid.setTile(redFlag.cx, redFlag.cy, Tile.FlagRed);
  if (blueFlag) grid.setTile(blueFlag.cx, blueFlag.cy, Tile.FlagBlue);

  if (redFlag && blueFlag && redSpawns.length && blueSpawns.length) {
    const reachable = grid.floodFillReachable(redSpawns[0].cx, redSpawns[0].cy);
    for (const p of [redFlag, blueFlag, ...redSpawns, ...blueSpawns]) {
      const key = p.cy * width + p.cx;
      if (!reachable.has(key)) errors.push(`(${p.cx},${p.cy}) is not reachable`);
    }
  }

  if (errors.length > 0) {
    throw new MapValidationError(`map '${id}' failed validation:\n  ${errors.join("\n  ")}`);
  }

  return {
    id,
    name,
    width,
    height,
    grid,
    flags: { blue: blueFlag!, red: redFlag! },
    spawns: { blue: blueSpawns, red: redSpawns },
    bonusSpawns,
  };
}

/** "33×25 · 5v5" — a map's size and roster, read off the parsed map rather
 *  than hardcoded anywhere (specs/level-editor.md §5.2). Shown on every map
 *  card and on the room screen's map line. */
export function mapSizeLabel(map: MapDef): string {
  return `${map.width}×${map.height} · ${map.spawns.red.length}v${map.spawns.blue.length}`;
}

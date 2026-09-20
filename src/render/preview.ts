// Room-screen live preview — SPEC §6.1. A static Canvas2D thumbnail rather
// than a second PixiJS Application: this is a non-gameplay glance at the map
// and a hovered spawn point, not the arena itself (SPEC §7 is about arena
// rendering), and spinning up a second WebGL context for a small thumbnail
// isn't worth it.

import { Tile } from "../world/grid";
import type { MapDef } from "../world/maps/loader";
import { TEAM_COLOR, type TeamId } from "../game/config";
import { tankShapeOps } from "./tankShape";
import { Dir, DIR_ANGLE } from "../util/math";

const TILE_COLOR: Record<Tile, string> = {
  [Tile.Empty]: "#2a2f22",
  [Tile.Brick]: "#8a3b2b",
  [Tile.Steel]: "#8892a0",
  [Tile.Forest]: "#1f5c33",
  [Tile.Water]: "#2455a4",
  [Tile.Ice]: "#bfe4f2",
  [Tile.Sand]: "#d8c07a",
  [Tile.FlagBlue]: "#3d7dff",
  [Tile.FlagRed]: "#ff4d4d",
};

export function drawMapPreview(
  canvas: HTMLCanvasElement,
  map: MapDef,
  opts: { hoverCell?: { cx: number; cy: number }; hoverTeam?: TeamId } = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width / map.width;
  const ch = canvas.height / map.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      ctx.fillStyle = TILE_COLOR[map.grid.tileAt(cx, cy)];
      ctx.fillRect(cx * cw, cy * ch, cw + 0.5, ch + 0.5);
    }
  }

  const drawSpawns = (team: TeamId) => {
    ctx.fillStyle = team === "blue" ? "#7fb0ff" : "#ff9a9a";
    for (const p of map.spawns[team]) {
      // Centered on the spawn's own cell: a spawn is one cell (SPEC §3.5),
      // so the marker is half a cell in, not a whole one.
      ctx.beginPath();
      ctx.arc((p.cx + 0.5) * cw, (p.cy + 0.5) * ch, Math.max(1.5, cw * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  drawSpawns("blue");
  drawSpawns("red");

  if (opts.hoverCell) {
    const { cx, cy } = opts.hoverCell;
    ctx.strokeStyle = opts.hoverTeam ? hexColor(TEAM_COLOR[opts.hoverTeam]) : "#ffffff";
    ctx.lineWidth = Math.max(1.5, cw * 0.3);
    // One cell, outset by a quarter so the ring reads around the spawn dot.
    ctx.strokeRect(cx * cw - cw * 0.25, cy * ch - ch * 0.25, cw * 1.5, ch * 1.5);
  }
}

/** Same tank silhouette as the in-match sprite (SPEC §6.1) — drawn on
 *  Canvas2D rather than pulled from the PixiJS atlas, since this thumbnail
 *  doesn't warrant a second WebGL context (see file header). Faces the
 *  team's actual spawn direction (blue up, red down — world/tank.ts). */
export function drawTankPreview(canvas: HTMLCanvasElement, team: TeamId, nickname: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#14181f";
  ctx.fillRect(0, 0, w, h);

  // The nickname gets its own band at the bottom; the tank is centered in
  // what's left. Sizing the art against `h` and then writing the label below
  // it is what used to push the text off the canvas (SPEC §6.1).
  const labelBand = Math.round(h * 0.22);
  const artH = h - labelBand;
  const size = Math.min(w, artH) * 0.75;
  const cx = w / 2;
  const cy = artH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DIR_ANGLE[team === "blue" ? Dir.Up : Dir.Down]);
  ctx.translate(-size / 2, -size / 2);
  for (const op of tankShapeOps(size, TEAM_COLOR[team])) {
    if (op.kind === "rect") {
      ctx.fillStyle = hexColor(op.color);
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = hexColor(op.color);
      ctx.fill();
      ctx.lineWidth = Math.max(1, size / 32);
      ctx.strokeStyle = hexColor(op.strokeColor);
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // Shrink to fit rather than overflow — a 12-character nickname (SPEC §2.1)
  // is wider than the thumbnail at the nominal size.
  let fontPx = Math.max(10, Math.round(labelBand * 0.55));
  const maxTextW = w - 12;
  do {
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    fontPx--;
  } while (fontPx >= 8 && ctx.measureText(nickname).width > maxTextW);
  ctx.fillText(nickname, cx, h - Math.round(labelBand * 0.28));
}

function hexColor(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

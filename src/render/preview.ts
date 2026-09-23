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
import type { BonusKind } from "../world/bonus";
import { bonusIconOps, BONUS_PALETTE, type IconOp } from "./bonusShape";

/** Terrain swatches — shared with the level editor's grid and palette
 *  (specs/level-editor.md §6.1), so a map looks the same everywhere it is
 *  drawn outside the arena. */
export const TILE_COLOR: Record<Tile, string> = {
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


/** The shared tank silhouette (tankShape.ts) painted on Canvas2D, baked
 *  facing +X into a `size`-square at the context's current origin. */
function drawTankShape(ctx: CanvasRenderingContext2D, size: number, color: number) {
  for (const op of tankShapeOps(size, color)) {
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
}

function hexColor(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

/** Canvas2D twin of atlas.ts's drawIconOps — same op list (bonusShape.ts),
 *  different backend, so the How to Play artwork is literally the same
 *  drawing as the pickup in the arena. */
export function drawIconOps2d(ctx: CanvasRenderingContext2D, ops: IconOp[]) {
  for (const op of ops) {
    ctx.save();
    ctx.globalAlpha = op.alpha ?? 1;
    switch (op.kind) {
      case "rect":
        ctx.fillStyle = hexColor(op.color);
        ctx.beginPath();
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r ?? 0);
        ctx.fill();
        break;
      case "circle":
        ctx.fillStyle = hexColor(op.color);
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "ring":
        ctx.strokeStyle = hexColor(op.color);
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "poly":
        ctx.fillStyle = hexColor(op.color);
        ctx.beginPath();
        ctx.moveTo(op.points[0], op.points[1]);
        for (let i = 2; i < op.points.length; i += 2) ctx.lineTo(op.points[i], op.points[i + 1]);
        ctx.closePath();
        ctx.fill();
        break;
      case "line":
        ctx.strokeStyle = hexColor(op.color);
        ctx.lineWidth = op.width;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        break;
    }
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The bonus pickup exactly as it lies on the battlefield, filling the
 *  canvas — used by the How to Play legend (SPEC §4.3). */
export function drawBonusIcon(canvas: HTMLCanvasElement, kind: BonusKind) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const size = Math.min(canvas.width, canvas.height);
  ctx.save();
  ctx.translate((canvas.width - size) / 2, (canvas.height - size) / 2);
  drawIconOps2d(ctx, bonusIconOps(kind, size));
  ctx.restore();
}

/** A tank wearing the bonus — the same spinning aura the arena draws around
 *  a tank that picked it up (arena.ts syncAuras), frozen at one angle so the
 *  legend shows what to look for in a fight. The orbiting icons stick out
 *  past the ring, and the topmost one used to be clipped off the top edge
 *  while the bottom of the canvas sat empty, so the whole drawing is fitted
 *  and centred on its real bounding box rather than on the ring alone. */
export function drawTankWithAura(canvas: HTMLCanvasElement, kind: BonusKind, team: TeamId = "blue") {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const s = Math.min(w, h);
  const aura = BONUS_PALETTE[kind].aura;
  // Nominal geometry, relative to the tank's centre at (0, 0); scaled to fit
  // below.
  let tankSize = s * 0.5;
  let radius = tankSize * 0.72 + s * 0.06;
  let ringW = Math.max(2, s * 0.035);
  let iconSize = s * 0.24;
  // Three orbiting copies of the icon, upright, at the same thirds the
  // arena's aura places them at.
  const angles = [0, 1, 2].map((i) => (i * Math.PI * 2) / 3 - Math.PI / 2);

  // Bounding box of ring + icons around the tank centre.
  let minX = -radius - ringW / 2;
  let maxX = -minX;
  let minY = minX;
  let maxY = maxX;
  for (const a of angles) {
    minX = Math.min(minX, Math.cos(a) * radius - iconSize / 2);
    maxX = Math.max(maxX, Math.cos(a) * radius + iconSize / 2);
    minY = Math.min(minY, Math.sin(a) * radius - iconSize / 2);
    maxY = Math.max(maxY, Math.sin(a) * radius + iconSize / 2);
  }
  const pad = s * 0.02;
  const scale = Math.min(1, (w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
  tankSize *= scale;
  radius *= scale;
  ringW *= scale;
  iconSize *= scale;
  // Centre the bounding box, not the tank: the box is taller above the tank
  // than below it, which is exactly the asymmetry that clipped the top icon.
  const cx = w / 2 - ((minX + maxX) / 2) * scale;
  const cy = h / 2 - ((minY + maxY) / 2) * scale;

  ctx.save();
  ctx.strokeStyle = hexColor(aura);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = ringW;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DIR_ANGLE[Dir.Up]);
  ctx.translate(-tankSize / 2, -tankSize / 2);
  drawTankShape(ctx, tankSize, TEAM_COLOR[team]);
  ctx.restore();

  for (const a of angles) {
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius - iconSize / 2, cy + Math.sin(a) * radius - iconSize / 2);
    drawIconOps2d(ctx, bonusIconOps(kind, iconSize));
    ctx.restore();
  }
}

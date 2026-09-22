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
  drawTankShape(ctx, size, TEAM_COLOR[team]);
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
 *  legend shows what to look for in a fight. */
export function drawTankWithAura(canvas: HTMLCanvasElement, kind: BonusKind, team: TeamId = "blue") {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const tankSize = Math.min(w, h) * 0.5;
  const radius = tankSize * 0.72 + Math.min(w, h) * 0.06;
  const aura = BONUS_PALETTE[kind].aura;

  ctx.save();
  ctx.strokeStyle = hexColor(aura);
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.035);
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

  // Three orbiting copies of the icon, upright, at the same thirds the
  // arena's aura places them at.
  const iconSize = Math.min(w, h) * 0.24;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius - iconSize / 2, cy + Math.sin(a) * radius - iconSize / 2);
    drawIconOps2d(ctx, bonusIconOps(kind, iconSize));
    ctx.restore();
  }
}

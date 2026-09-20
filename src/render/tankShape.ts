// Single source of truth for the tank silhouette (SPEC §7) — baked facing
// +X (right) inside a `canvasSize`-px square, hitbox/margin/turret
// proportions all scaled from TANK_SIZE/TANK_HITBOX/TANK_MARGIN so that
// atlas.ts (PixiJS, the in-match sprite) and preview.ts (Canvas2D, the
// room-screen thumbnail) draw the exact same tank at two different sizes.

import { TANK_SIZE, TANK_HITBOX, TANK_MARGIN } from "../game/config";

export type TankShapeOp =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: number }
  | { kind: "circle"; cx: number; cy: number; r: number; color: number; strokeColor: number };

export function shade(color: number, factor: number): number {
  const r = Math.max(0, Math.min(255, ((color >> 16) & 0xff) * factor));
  const g = Math.max(0, Math.min(255, ((color >> 8) & 0xff) * factor));
  const b = Math.max(0, Math.min(255, (color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Ops are in the same local space the caller renders into: (0,0) is the
 *  top-left of a `canvasSize`-square canvas, tank baked facing right. The
 *  hull/tracks are pulled in from both ends of the hitbox (`shorten`) so the
 *  barrel up front and the muffler out back both read clearly instead of
 *  hugging the hitbox edge — rotation still pivots on (canvasSize/2,
 *  canvasSize/2), the sprite anchor, so shrinking symmetrically is what
 *  keeps the tank's visual center fixed while it turns. */
export function tankShapeOps(canvasSize: number, color: number): TankShapeOp[] {
  const x0 = canvasSize * (TANK_MARGIN / TANK_SIZE);
  const size = canvasSize * (TANK_HITBOX / TANK_SIZE);
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;

  const trackH = size * 0.22;
  const hullH = size - trackH * 2;
  const shorten = size * 0.12;
  const bodyLen = size - shorten * 2;
  const bodyX0 = x0 + shorten;

  const track = shade(color, 0.25);
  const treadMark = shade(color, 0.15);
  const gunmetal = 0x22262b;

  const ops: TankShapeOp[] = [];

  // Tracks (top and bottom, since the tank is baked facing right).
  ops.push({ kind: "rect", x: bodyX0, y: x0, w: bodyLen, h: trackH, color: track });
  ops.push({ kind: "rect", x: bodyX0, y: x0 + size - trackH, w: bodyLen, h: trackH, color: track });
  for (let i = 0; i < 5; i++) {
    const tx = bodyX0 + 2 + (i * (bodyLen - 4)) / 4;
    ops.push({ kind: "rect", x: tx, y: x0 + 1, w: 2, h: trackH - 2, color: treadMark });
    ops.push({ kind: "rect", x: tx, y: x0 + size - trackH + 1, w: 2, h: trackH - 2, color: treadMark });
  }

  // Hull.
  ops.push({ kind: "rect", x: bodyX0 + 1, y: x0 + trackH, w: bodyLen - 2, h: hullH, color });
  ops.push({ kind: "rect", x: bodyX0 + 1, y: x0 + trackH, w: bodyLen - 2, h: hullH * 0.35, color: shade(color, 1.25) });

  // Muffler: a stubby exhaust pipe out the rear, mirroring the barrel.
  const mufflerLen = size * 0.12;
  const mufflerH = size * 0.24;
  ops.push({ kind: "rect", x: bodyX0 - mufflerLen, y: cy - mufflerH / 2, w: mufflerLen + 2, h: mufflerH, color: gunmetal });
  ops.push({ kind: "rect", x: bodyX0 - mufflerLen, y: cy - mufflerH / 2, w: 2, h: mufflerH, color: shade(gunmetal, 1.7) });

  // Turret + barrel. The barrel reaches into the collision margin, same as
  // before the hull was shortened — that's what makes it now read as
  // sticking out front, since the hull retreats behind it.
  ops.push({ kind: "rect", x: cx, y: cy - size * 0.08, w: canvasSize / 2 - 1, h: size * 0.16, color: gunmetal });
  ops.push({ kind: "circle", cx, cy, r: size * 0.3, color: shade(color, 0.85), strokeColor: shade(color, 0.5) });

  return ops;
}

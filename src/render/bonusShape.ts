// Single source of truth for what each bonus *looks like* (SPEC §4.3, §7) —
// the same role tankShape.ts plays for the tank. Icons are declared as
// primitive ops in a unit square (0..1), so the exact same drawing renders at
// any size through either backend: PixiJS Graphics for the in-arena pickup
// sprite (atlas.ts) and Canvas2D for the How to Play illustrations
// (preview.ts). Nothing here imports a renderer.

import type { BonusKind } from "../world/bonus";

export type IconOp =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r?: number; color: number; alpha?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; color: number; alpha?: number }
  | { kind: "ring"; cx: number; cy: number; r: number; width: number; color: number; alpha?: number }
  | { kind: "poly"; points: number[]; color: number; alpha?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: number; alpha?: number };

/** Palette of a bonus: `bg`/`edge` are the pickup tile's plate, `fg` the
 *  symbol on it, and `aura` the colour of the ring that spins around a tank
 *  carrying it (arena.ts). Kept together so the aura can never drift away
 *  from the icon the player picked up. */
export type BonusPalette = { bg: number; edge: number; fg: number; aura: number };

export const BONUS_PALETTE: Record<BonusKind, BonusPalette> = {
  HELMET: { bg: 0x1b3a72, edge: 0x7fb0ff, fg: 0xcfe2ff, aura: 0x4d7cff },
  STAR: { bg: 0x6b4a00, edge: 0xffd23d, fg: 0xffe27a, aura: 0xffd23d },
  SPEED: { bg: 0x0d4d2a, edge: 0x4be08a, fg: 0xc9ffdf, aura: 0x33cc66 },
  SHOVEL: { bg: 0x4a3216, edge: 0xd6a35c, fg: 0xf0d9b5, aura: 0xd6a35c },
  CLOCK: { bg: 0x3a1d66, edge: 0xc79bff, fg: 0xf0e4ff, aura: 0x9955ee },
  GRENADE: { bg: 0x5e1414, edge: 0xff7a5c, fg: 0xffd9c2, aura: 0xdd3333 },
  RESPAWN: { bg: 0x0c4646, edge: 0x4fe0e0, fg: 0xd6ffff, aura: 0x22aaaa },
  MINE: { bg: 0x23262b, edge: 0x8f98a6, fg: 0xd7dde5, aura: 0x9aa4b2 },
};

/** Player-facing name and one-line effect, shared by the How to Play modal
 *  and anything else that needs to label a bonus. */
export const BONUS_INFO: Record<BonusKind, { title: string; text: string }> = {
  HELMET: { title: "Helmet", text: "A shield that soaks one hit and keeps you safe for a while." },
  STAR: { title: "Star", text: "Upgrades your tank: faster shells, more of them in the air, and at full rank you punch through steel." },
  SPEED: { title: "Speed", text: "Your tank drives noticeably faster for a short time." },
  SHOVEL: { title: "Shovel", text: "Team bonus — the brick around your own flag turns to steel until it wears off." },
  CLOCK: { title: "Clock", text: "Team bonus — every enemy tank is frozen in place for a few seconds." },
  GRENADE: { title: "Grenade", text: "Team bonus — destroys every enemy tank on the field at once." },
  RESPAWN: { title: "Respawn", text: "Team bonus — refills your team's pool of remaining respawns." },
  MINE: { title: "Mines", text: "Hands you proximity mines to drop behind you (Q, or Right Shift for player 2); only your team can see them." },
};

function starPoints(cx: number, cy: number, outer: number, inner: number, points: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/** The plate every bonus icon sits on: a rounded square filling the cell,
 *  so a pickup reads as a tank-sized object on the ground rather than a
 *  small pip. The symbol ops are drawn on top of it. */
function plate(p: BonusPalette): IconOp[] {
  return [
    { kind: "rect", x: 0.02, y: 0.02, w: 0.96, h: 0.96, r: 0.2, color: p.edge },
    { kind: "rect", x: 0.08, y: 0.08, w: 0.84, h: 0.84, r: 0.16, color: p.bg },
    { kind: "rect", x: 0.08, y: 0.08, w: 0.84, h: 0.3, r: 0.14, color: 0xffffff, alpha: 0.08 },
  ];
}

function symbolOps(kind: BonusKind, p: BonusPalette): IconOp[] {
  switch (kind) {
    case "HELMET":
      // A domed helmet with a brim — a half-disc sitting on a wide bar.
      return [
        { kind: "circle", cx: 0.5, cy: 0.56, r: 0.27, color: p.fg },
        { kind: "rect", x: 0.2, y: 0.56, w: 0.6, h: 0.14, color: p.fg },
        { kind: "rect", x: 0.16, y: 0.66, w: 0.68, h: 0.1, r: 0.05, color: p.edge },
        { kind: "rect", x: 0.46, y: 0.3, w: 0.08, h: 0.28, color: p.edge },
      ];
    case "STAR":
      return [
        { kind: "poly", points: starPoints(0.5, 0.52, 0.4, 0.17, 5), color: p.fg },
        { kind: "poly", points: starPoints(0.5, 0.52, 0.22, 0.09, 5), color: p.edge },
      ];
    case "SPEED":
      // Two forward chevrons, pointing the way the tank is about to go.
      return [
        { kind: "poly", points: [0.16, 0.2, 0.44, 0.5, 0.16, 0.8, 0.32, 0.8, 0.6, 0.5, 0.32, 0.2], color: p.fg },
        { kind: "poly", points: [0.44, 0.2, 0.72, 0.5, 0.44, 0.8, 0.6, 0.8, 0.88, 0.5, 0.6, 0.2], color: p.edge },
      ];
    case "SHOVEL":
      // Blade down, handle up with a T-grip.
      return [
        { kind: "rect", x: 0.44, y: 0.18, w: 0.12, h: 0.42, color: p.edge },
        { kind: "rect", x: 0.32, y: 0.12, w: 0.36, h: 0.12, r: 0.06, color: p.edge },
        { kind: "poly", points: [0.26, 0.55, 0.74, 0.55, 0.62, 0.86, 0.38, 0.86], color: p.fg },
      ];
    case "CLOCK":
      return [
        { kind: "circle", cx: 0.5, cy: 0.54, r: 0.34, color: p.fg },
        { kind: "circle", cx: 0.5, cy: 0.54, r: 0.27, color: p.bg },
        { kind: "rect", x: 0.42, y: 0.1, w: 0.16, h: 0.1, r: 0.04, color: p.edge },
        { kind: "line", x1: 0.5, y1: 0.54, x2: 0.5, y2: 0.34, width: 0.07, color: p.fg },
        { kind: "line", x1: 0.5, y1: 0.54, x2: 0.66, y2: 0.62, width: 0.07, color: p.edge },
      ];
    case "GRENADE":
      // A burst: spiked star around a bright core.
      return [
        { kind: "poly", points: starPoints(0.5, 0.52, 0.42, 0.18, 8), color: p.edge },
        { kind: "circle", cx: 0.5, cy: 0.52, r: 0.17, color: p.fg },
      ];
    case "RESPAWN":
      // A thick cross inside a broken ring — "one more life back".
      return [
        { kind: "ring", cx: 0.5, cy: 0.52, r: 0.35, width: 0.09, color: p.edge },
        { kind: "rect", x: 0.43, y: 0.28, w: 0.14, h: 0.48, r: 0.06, color: p.fg },
        { kind: "rect", x: 0.26, y: 0.45, w: 0.48, h: 0.14, r: 0.06, color: p.fg },
      ];
    case "MINE":
      // The dropped mine itself, so the pickup and what it leaves behind
      // are recognisably the same object (atlas.ts draws the field mine).
      return [
        { kind: "rect", x: 0.2, y: 0.46, w: 0.6, h: 0.08, r: 0.04, color: p.edge },
        { kind: "rect", x: 0.46, y: 0.2, w: 0.08, h: 0.6, r: 0.04, color: p.edge },
        { kind: "circle", cx: 0.5, cy: 0.5, r: 0.26, color: 0x15181c },
        { kind: "circle", cx: 0.5, cy: 0.5, r: 0.26, color: p.fg, alpha: 0.15 },
        { kind: "circle", cx: 0.5, cy: 0.5, r: 0.11, color: 0xff4d4d },
      ];
  }
}

/** Ops for one bonus icon, scaled into a `size`-px square with its top-left
 *  at (0,0) — same convention as tankShapeOps. */
export function bonusIconOps(kind: BonusKind, size: number): IconOp[] {
  const p = BONUS_PALETTE[kind];
  const ops = [...plate(p), ...symbolOps(kind, p)];
  return ops.map((op) => scaleOp(op, size));
}

/** Just the symbol, without the plate behind it — used where the icon sits
 *  on something that is already its own background (the dropped mine). */
export function bonusSymbolOps(kind: BonusKind, size: number): IconOp[] {
  return symbolOps(kind, BONUS_PALETTE[kind]).map((op) => scaleOp(op, size));
}

function scaleOp(op: IconOp, s: number): IconOp {
  switch (op.kind) {
    case "rect":
      return { ...op, x: op.x * s, y: op.y * s, w: op.w * s, h: op.h * s, r: op.r === undefined ? undefined : op.r * s };
    case "circle":
      return { ...op, cx: op.cx * s, cy: op.cy * s, r: op.r * s };
    case "ring":
      return { ...op, cx: op.cx * s, cy: op.cy * s, r: op.r * s, width: op.width * s };
    case "poly":
      return { ...op, points: op.points.map((v) => v * s) };
    case "line":
      return { ...op, x1: op.x1 * s, y1: op.y1 * s, x2: op.x2 * s, y2: op.y2 * s, width: op.width * s };
  }
}

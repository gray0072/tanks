// Procedural textures generated once at boot (SPEC §7) — no art assets to
// ship. Every texture here can be swapped for real art later without
// touching gameplay or arena-layout code.

import { Application, Graphics, Container, type Texture, Rectangle } from "pixi.js";
import { CELL, TANK_SIZE, TEAM_COLOR, BULLET_RADIUS, type TeamId } from "../game/config";
import { BRICK_QUARTERS } from "../world/grid";
import type { BonusKind } from "../world/bonus";
import { tankShapeOps, shade as shadeColor } from "./tankShape";
import { bonusIconOps, bonusSymbolOps, BONUS_PALETTE, type IconOp } from "./bonusShape";

export type Atlas = {
  terrain: Record<"steel" | "forest" | "water" | "ice" | "sand", Texture> & {
    /** Index i = the texture for (i + 1) quarters remaining, SPEC §3.3.
     *  brick[3] is pristine (4/4); brick[0] is the last surviving quarter. */
    brick: Texture[];
  };
  tank: Record<TeamId, Texture>;
  flag: Record<TeamId, Texture>;
  bullet: Texture;
  bonus: Record<BonusKind, Texture>;
  mine: Texture;
  spark: Texture;
};

function toTexture(app: Application, target: Container, size: number): Texture {
  return app.renderer.generateTexture({
    target,
    frame: new Rectangle(0, 0, size, size),
    resolution: 2,
  });
}

function tile(app: Application, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const tex = toTexture(app, g, CELL);
  g.destroy();
  return tex;
}

/** Renders shared icon ops (bonusShape.ts) into a PixiJS Graphics — the
 *  Canvas2D twin of this lives in preview.ts, and both consume the same op
 *  list so the How to Play art and the in-arena pickup can't diverge. */
export function drawIconOps(g: Graphics, ops: IconOp[]) {
  for (const op of ops) {
    switch (op.kind) {
      case "rect":
        if (op.r) g.roundRect(op.x, op.y, op.w, op.h, op.r);
        else g.rect(op.x, op.y, op.w, op.h);
        g.fill({ color: op.color, alpha: op.alpha ?? 1 });
        break;
      case "circle":
        g.circle(op.cx, op.cy, op.r).fill({ color: op.color, alpha: op.alpha ?? 1 });
        break;
      case "ring":
        g.circle(op.cx, op.cy, op.r).stroke({ width: op.width, color: op.color, alpha: op.alpha ?? 1 });
        break;
      case "poly":
        g.poly(op.points).fill({ color: op.color, alpha: op.alpha ?? 1 });
        break;
      case "line":
        g.moveTo(op.x1, op.y1).lineTo(op.x2, op.y2)
          .stroke({ width: op.width, color: op.color, alpha: op.alpha ?? 1, cap: "round" });
        break;
    }
  }
}

/** One brick texture per surviving-quarters count (1..4). The engine tracks
 *  only a count, not which corner was hit (grid.ts damageBrick), so damage is
 *  drawn as cracks spreading across the *whole* cell rather than as quadrants
 *  disappearing one by one: nothing in the picture then claims a particular
 *  corner took the shot, and a half-broken wall still reads as one wall.
 *  Coordinates below are in the unit square and scaled to CELL. */
const CRACK_STAGES: number[][][] = [
  // 3/4 left — one fissure right across the cell.
  [
    [0.0, 0.34, 0.26, 0.45, 0.47, 0.37, 0.73, 0.53, 1.0, 0.45],
  ],
  // 2/4 left — it branches to both edges.
  [
    [0.47, 0.37, 0.41, 0.12, 0.45, 0.0],
    [0.47, 0.37, 0.56, 0.7, 0.43, 1.0],
  ],
  // 1/4 left — a web over the whole face, about to give.
  [
    [0.26, 0.45, 0.08, 0.72, 0.0, 0.82],
    [0.73, 0.53, 0.88, 0.78, 1.0, 0.9],
    [0.56, 0.7, 0.82, 0.66, 1.0, 0.72],
    [0.0, 0.14, 0.2, 0.2, 0.3, 0.1],
  ],
];

/** Chips knocked out of the face, appearing with the later stages. Unit
 *  square, [x, y, w, h]. */
const CRACK_CHIPS: number[][][] = [
  [],
  [[0.44, 0.32, 0.12, 0.1]],
  [[0.2, 0.42, 0.14, 0.12], [0.62, 0.58, 0.16, 0.13], [0.46, 0.84, 0.1, 0.1]],
];

function brickTexture(app: Application, quartersRemaining: number): Texture {
  return tile(app, (g) => {
    const mortar = 0x3a2418;
    g.rect(0, 0, CELL, CELL).fill(mortar);

    // Four courses of staggered bricks, so the cell reads as masonry rather
    // than as four big blocks.
    const rows = 4;
    const rowH = CELL / rows;
    const brickW = CELL / 2;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = r % 2 === 0 ? 0 : -brickW / 2;
      for (let x = offset; x < CELL; x += brickW) {
        const bx = Math.max(0, x);
        const bw = Math.min(x + brickW, CELL) - bx - 1;
        if (bw <= 0) continue;
        const face = (r + Math.round(x / brickW)) % 2 === 0 ? 0x9c4632 : 0x8a3b2b;
        g.rect(bx, y, bw, rowH - 1).fill(face);
        g.rect(bx, y, bw, 1).fill(shadeColor(face, 1.18));
      }
    }

    const damage = BRICK_QUARTERS - Math.max(0, Math.min(BRICK_QUARTERS, quartersRemaining));
    for (let stage = 0; stage < damage && stage < CRACK_STAGES.length; stage++) {
      for (const chip of CRACK_CHIPS[stage]) {
        g.rect(chip[0] * CELL, chip[1] * CELL, chip[2] * CELL, chip[3] * CELL).fill(0x2a160f);
        g.rect(chip[0] * CELL, (chip[1] + chip[3]) * CELL - 1, chip[2] * CELL, 1).fill(0x7a4a34);
      }
      for (const path of CRACK_STAGES[stage]) {
        drawCrack(g, path);
      }
    }

    // Each hit leaves the face dirtier, so the damage reads even at a glance
    // from across the arena.
    if (damage > 0) g.rect(0, 0, CELL, CELL).fill({ color: 0x000000, alpha: damage * 0.07 });
  });
}

/** A jagged line across the cell: a dark gouge with a lit lower lip, which
 *  is what makes it look like a split in the surface and not a scratch. */
function drawCrack(g: Graphics, path: number[]) {
  const pt = (i: number) => [path[i * 2] * CELL, path[i * 2 + 1] * CELL] as const;
  const n = path.length / 2;
  const stroke = (width: number, color: number, alpha: number, dx: number, dy: number) => {
    const [x0, y0] = pt(0);
    g.moveTo(x0 + dx, y0 + dy);
    for (let i = 1; i < n; i++) {
      const [x, y] = pt(i);
      g.lineTo(x + dx, y + dy);
    }
    g.stroke({ width, color, alpha, cap: "round", join: "round" });
  };
  stroke(2.2, 0x23130c, 0.95, 0, 0);
  stroke(0.8, 0xc98b66, 0.45, 0.7, 0.7);
}

export function createAtlas(app: Application): Atlas {
  const terrain = {
    brick: [1, 2, 3, 4].map((q) => brickTexture(app, q)),
    steel: tile(app, (g) => {
      g.rect(0, 0, CELL, CELL).fill(0x8892a0);
      g.rect(1, 1, CELL - 2, CELL - 2).fill(0xaab4c0);
      g.rect(2, 2, CELL - 4, CELL - 4).fill(0x8892a0);
    }),
    forest: tile(app, (g) => {
      g.rect(0, 0, CELL, CELL).fill(0x1f5c33);
      g.circle(CELL * 0.3, CELL * 0.35, CELL * 0.28).fill(0x2c7a44);
      g.circle(CELL * 0.7, CELL * 0.55, CELL * 0.3).fill(0x2c7a44);
      g.circle(CELL * 0.5, CELL * 0.75, CELL * 0.25).fill(0x256a3a);
    }),
    water: tile(app, (g) => {
      g.rect(0, 0, CELL, CELL).fill(0x2455a4);
      g.rect(0, CELL * 0.3, CELL, 2).fill(0x3a6fc0);
      g.rect(0, CELL * 0.7, CELL, 2).fill(0x3a6fc0);
    }),
    ice: tile(app, (g) => {
      g.rect(0, 0, CELL, CELL).fill(0xbfe4f2);
      g.rect(0, 0, CELL, CELL).stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
    }),
    sand: tile(app, (g) => {
      g.rect(0, 0, CELL, CELL).fill(0xd8c07a);
      g.circle(CELL * 0.3, CELL * 0.4, 1.5).fill(0xc2a960);
      g.circle(CELL * 0.65, CELL * 0.65, 1.5).fill(0xc2a960);
    }),
  };

  const tankTex = (color: number): Texture => {
    const g = new Graphics();
    // Baked facing right (+X); arena.ts rotates the sprite by DIR_ANGLE.
    // Shape is shared with preview.ts (tankShape.ts) so the room-screen
    // thumbnail matches the tank you actually drive.
    for (const op of tankShapeOps(TANK_SIZE, color)) {
      if (op.kind === "rect") {
        g.rect(op.x, op.y, op.w, op.h).fill(op.color);
      } else {
        g.circle(op.cx, op.cy, op.r).fill(op.color);
        g.circle(op.cx, op.cy, op.r).stroke({ width: 1, color: op.strokeColor, alpha: 0.8 });
      }
    }

    const tex = toTexture(app, g, TANK_SIZE);
    g.destroy();
    return tex;
  };

  const flagTex = (color: number): Texture => {
    const g = new Graphics();
    g.rect(TANK_SIZE * 0.15, 2, 3, TANK_SIZE - 6).fill(0xdddddd);
    g.poly([TANK_SIZE * 0.15 + 3, 3, TANK_SIZE * 0.85, TANK_SIZE * 0.3, TANK_SIZE * 0.15 + 3, TANK_SIZE * 0.55]).fill(color);
    const tex = toTexture(app, g, TANK_SIZE);
    g.destroy();
    return tex;
  };

  // Sized off BULLET_RADIUS — the same value the sim collides bullets
  // against a wall's face with (sim.ts) — so the drawn sprite can never
  // drift out of sync with what physically stops at the wall.
  const bulletCanvas = BULLET_RADIUS * 2 + 2;
  const bulletG = new Graphics().circle(bulletCanvas / 2, bulletCanvas / 2, BULLET_RADIUS).fill(0xffffff);
  const bulletTex = toTexture(app, bulletG, bulletCanvas);
  bulletG.destroy();

  // The dropped mine, deliberately the same spiked silhouette as the MINE
  // bonus icon's symbol (bonusShape.ts) so picking one up and seeing one on
  // the ground read as the same object.
  const mineG = new Graphics();
  drawIconOps(mineG, bonusSymbolOps("MINE", 16));
  const mineTex = toTexture(app, mineG, 16);
  mineG.destroy();

  const sparkG = new Graphics().circle(8, 8, 8).fill({ color: 0xffffff, alpha: 1 });
  const sparkTex = toTexture(app, sparkG, 16);
  sparkG.destroy();

  // Full-cell icons (SPEC §4.3): a pickup is a tank-sized object on the
  // ground, drawn from the shared op list rather than a lettered disc, so
  // what the bonus does is readable without a legend.
  const bonus = {} as Record<BonusKind, Texture>;
  for (const kind of Object.keys(BONUS_PALETTE) as BonusKind[]) {
    const g = new Graphics();
    drawIconOps(g, bonusIconOps(kind, CELL));
    bonus[kind] = toTexture(app, g, CELL);
    g.destroy();
  }

  return {
    terrain,
    tank: { blue: tankTex(TEAM_COLOR.blue), red: tankTex(TEAM_COLOR.red) },
    flag: { blue: flagTex(TEAM_COLOR.blue), red: flagTex(TEAM_COLOR.red) },
    bullet: bulletTex,
    bonus,
    mine: mineTex,
    spark: sparkTex,
  };
}

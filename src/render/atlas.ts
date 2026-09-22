// Procedural textures generated once at boot (SPEC §7) — no art assets to
// ship. Every texture here can be swapped for real art later without
// touching gameplay or arena-layout code.

import { Application, Graphics, Container, type Texture, Rectangle } from "pixi.js";
import { CELL, TANK_SIZE, TEAM_COLOR, BULLET_RADIUS, type TeamId } from "../game/config";
import type { BonusKind } from "../world/bonus";
import { tankShapeOps } from "./tankShape";
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
 *  only a count, not which corner was actually shot (grid.ts damageBrick),
 *  so the crumble follows a fixed corner order — TR, then BL, then TL —
 *  leaving BR as the last quarter standing before the cell goes Empty. */
function brickTexture(app: Application, quartersRemaining: number): Texture {
  return tile(app, (g) => {
    const half = CELL / 2;
    const q = half - 1; // quadrant size, 1px mortar gap between them
    g.rect(0, 0, CELL, CELL).fill(0x3a2418); // mortar/rubble showing through gaps
    const quadrants = [
      { x: 0, y: 0, shade: 0x9c4632, damaged: quartersRemaining <= 1 }, // TL — goes 3rd
      { x: half + 1, y: 0, shade: 0x8a3b2b, damaged: quartersRemaining <= 3 }, // TR — goes 1st
      { x: 0, y: half + 1, shade: 0x8a3b2b, damaged: quartersRemaining <= 2 }, // BL — goes 2nd
      { x: half + 1, y: half + 1, shade: 0x9c4632, damaged: false }, // BR — never, until full destroy
    ];
    for (const qd of quadrants) {
      if (qd.damaged) {
        g.rect(qd.x, qd.y, q, q).fill(0x40291d);
        g.rect(qd.x + q * 0.2, qd.y + q * 0.35, q * 0.32, q * 0.24).fill(0x2c1a12);
        g.rect(qd.x + q * 0.5, qd.y + q * 0.12, q * 0.28, q * 0.22).fill(0x59392a);
      } else {
        g.rect(qd.x, qd.y, q, q).fill(qd.shade);
      }
    }
  });
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

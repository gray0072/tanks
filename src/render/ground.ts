// The open ground under everything — SPEC §7. Was a flat fill; now a grassy
// field with soft patches of darker and drier turf, blades, pebbles and a few
// bare-earth spots.
//
// It is ONE texture the size of the whole map, not a tile per cell: a repeated
// 32px tile reads as a grid no matter how it is drawn, which is exactly the
// look to avoid on the one layer with no grid of its own. Painted once on a
// Canvas2D per map (and cached, so a new round or a rematch reuses it), then
// shown as a single sprite — no per-frame cost at all.
//
// Cheap to build as well: the blotchy colour field is value noise computed on
// a canvas 1/GROUND_NOISE_STEP the size and scaled up with smoothing, so the
// browser's bilinear filter does the blending instead of a per-pixel loop.
// Deterministic per map, so every player in a room sees the same field.

import { Texture, CanvasSource } from "pixi.js";
import { CELL } from "../game/constants";
import type { MapDef } from "../world/maps/loader";
import { RNG } from "../util/math";

/** World units per noise sample: the size of the smallest colour blotch. */
const GROUND_NOISE_STEP = 8;
/** Longest side of the baked canvas in pixels — keeps a 64x64 map from
 *  asking for a 4096px texture while the built-ins still get ~2x detail. */
const GROUND_MAX_PX = 2048;
const GROUND_MAX_RES = 2;
const CACHE_LIMIT = 6;

/** Dark → mid → dry. Kept close together on purpose: this is what tanks,
 *  bullets and bonuses are read against, so it must stay quiet. */
const TURF: [number, number, number][] = [
  [0x23, 0x2b, 0x1c],
  [0x2c, 0x36, 0x22],
  [0x35, 0x3a, 0x25],
];
const BLADES = ["#3a4a2a", "#435430", "#1d2517", "#34402a"];
const PEBBLES = ["#4a4636", "#3e3b2e", "#56503e"];

const cache = new Map<string, HTMLCanvasElement>();

/** A fresh texture over the (cached) ground canvas for `map`. The caller owns
 *  the texture and destroys it; the canvas stays cached. */
export function groundTexture(map: MapDef): Texture {
  const canvas = groundCanvas(map);
  const res = canvas.width / (map.width * CELL);
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: res }) });
}

function groundCanvas(map: MapDef): HTMLCanvasElement {
  const key = `${map.id}:${map.width}x${map.height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = paintGround(map.width * CELL, map.height * CELL, hashString(key));
  cache.set(key, canvas);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return canvas;
}

function paintGround(w: number, h: number, seed: number): HTMLCanvasElement {
  const rng = new RNG(seed || 1);
  const res = Math.min(GROUND_MAX_RES, GROUND_MAX_PX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * res);
  canvas.height = Math.round(h * res);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(res, res);

  // 1. The colour field: three octaves of value noise at low resolution,
  //    blown up with smoothing. Octaves at unrelated scales (not multiples of
  //    a cell) so no blotch lines up with the grid.
  const nw = Math.ceil(w / GROUND_NOISE_STEP) + 1;
  const nh = Math.ceil(h / GROUND_NOISE_STEP) + 1;
  const octaves = [
    { scale: 23, weight: 0.55, noise: lattice(rng, nw, nh, 23) },
    { scale: 9, weight: 0.3, noise: lattice(rng, nw, nh, 9) },
    { scale: 3, weight: 0.15, noise: lattice(rng, nw, nh, 3) },
  ];
  const small = document.createElement("canvas");
  small.width = nw;
  small.height = nh;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let v = 0;
      for (const o of octaves) v += o.weight * o.noise(x, y);
      const [r, g, b] = turf(v);
      const i = (y * nw + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, nw * GROUND_NOISE_STEP, nh * GROUND_NOISE_STEP);

  const cells = (w * h) / (CELL * CELL);

  // 2. Bare earth: a few soft brown spots, each an irregular cluster of
  //    overlapping discs so none of them is a clean circle.
  for (let i = 0; i < cells / 14; i++) {
    const cx = rng.range(0, w);
    const cy = rng.range(0, h);
    const size = rng.range(10, 26);
    for (let k = 0; k < 5; k++) {
      const x = cx + rng.range(-size, size) * 0.6;
      const y = cy + rng.range(-size, size) * 0.6;
      const r = size * rng.range(0.4, 0.8);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(70, 58, 38, 0.22)");
      grad.addColorStop(1, "rgba(70, 58, 38, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // 3. Blades of grass, in tufts rather than evenly sprinkled — an even
  //    sprinkle reads as noise, tufts read as grass.
  ctx.lineCap = "round";
  ctx.lineWidth = 1;
  for (let i = 0; i < cells * 2.2; i++) {
    const tx = rng.range(0, w);
    const ty = rng.range(0, h);
    const blades = rng.int(3, 6);
    ctx.strokeStyle = rng.pick(BLADES);
    ctx.globalAlpha = rng.range(0.45, 0.8);
    ctx.beginPath();
    for (let b = 0; b < blades; b++) {
      const x = tx + rng.range(-3, 3);
      const y = ty + rng.range(-1.5, 1.5);
      const len = rng.range(2, 4.5);
      const lean = rng.range(-0.6, 0.6);
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean * len, y - len);
    }
    ctx.stroke();
  }

  // 4. Pebbles.
  for (let i = 0; i < cells * 0.7; i++) {
    ctx.globalAlpha = rng.range(0.5, 0.85);
    ctx.fillStyle = rng.pick(PEBBLES);
    const r = rng.range(0.6, 1.4);
    ctx.beginPath();
    ctx.ellipse(rng.range(0, w), rng.range(0, h), r * 1.3, r, rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/** Value noise on the low-res sample grid: random values on a lattice every
 *  `period` samples, bilinearly interpolated with a smoothstep in between.
 *  Returns 0..1. */
function lattice(rng: RNG, nw: number, nh: number, period: number) {
  const lw = Math.ceil(nw / period) + 2;
  const lh = Math.ceil(nh / period) + 2;
  const v = new Float32Array(lw * lh);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  const at = (x: number, y: number) => v[y * lw + x];
  return (x: number, y: number) => {
    const fx = x / period;
    const fy = y / period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const sx = smooth(fx - x0);
    const sy = smooth(fy - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bot - top) * sy;
  };
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function turf(v: number): [number, number, number] {
  // Stretch the octave sum (which bunches around 0.5) back out to 0..1.
  const t = Math.max(0, Math.min(1, (v - 0.5) * 2.2 + 0.5));
  const seg = t < 0.5 ? 0 : 1;
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const a = TURF[seg];
  const b = TURF[seg + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

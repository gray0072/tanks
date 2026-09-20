export type Vec2 = { x: number; y: number };

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt(dist2(ax, ay, bx, by));

export const normAngle = (a: number) => {
  const TAU = Math.PI * 2;
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};

export const angleDiff = (a: number, b: number) => {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

// 8-directional facing (4 cardinal + 4 diagonal), matches the tank's
// snap-to-45° movement — holding two adjacent direction keys (e.g. Up+Right)
// faces/drives diagonally (util/input.ts). Values are in compass order so
// DIR_ANGLE/DIR_VECTOR and dirFromAngle below can all derive from `index *
// 45°`, with Up at -90° (screen "up" is -Y).
export enum Dir {
  Up = 0,
  UpRight = 1,
  Right = 2,
  DownRight = 3,
  Down = 4,
  DownLeft = 5,
  Left = 6,
  UpLeft = 7,
}

const DIAG = Math.SQRT1_2; // normalized diagonal component, so diagonal speed == cardinal speed

export const DIR_VECTOR: Record<Dir, Vec2> = {
  [Dir.Up]: { x: 0, y: -1 },
  [Dir.UpRight]: { x: DIAG, y: -DIAG },
  [Dir.Right]: { x: 1, y: 0 },
  [Dir.DownRight]: { x: DIAG, y: DIAG },
  [Dir.Down]: { x: 0, y: 1 },
  [Dir.DownLeft]: { x: -DIAG, y: DIAG },
  [Dir.Left]: { x: -1, y: 0 },
  [Dir.UpLeft]: { x: -DIAG, y: -DIAG },
};

export const DIR_ANGLE: Record<Dir, number> = {
  [Dir.Up]: -Math.PI / 2,
  [Dir.UpRight]: -Math.PI / 4,
  [Dir.Right]: 0,
  [Dir.DownRight]: Math.PI / 4,
  [Dir.Down]: Math.PI / 2,
  [Dir.DownLeft]: (3 * Math.PI) / 4,
  [Dir.Left]: Math.PI,
  [Dir.UpLeft]: -(3 * Math.PI) / 4,
};

/** Rounds a free angle (radians, atan2 convention) to the nearest of the 8
 *  Dir values — e.g. for a touch d-pad, where the stick angle is continuous. */
export function dirFromAngle(angle: number): Dir {
  const idx = Math.round((angle + Math.PI / 2) / (Math.PI / 4));
  return (((idx % 8) + 8) % 8) as Dir;
}

export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 0xffffffff;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

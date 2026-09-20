import { Dir, DIR_VECTOR } from "../util/math";
import { BULLET_SPEED_BASE, BULLET_SPEED_STAR1, type TeamId } from "../game/config";

export type BulletState = {
  id: number;
  ownerSlot: number;
  team: TeamId;
  x: number;
  y: number;
  dir: Dir;
  speed: number;
  destroysSteel: boolean; // fired at STAR 3
  fullBrickHit: boolean; // fired at STAR 3 — destroys a whole brick cell per hit
};

let nextBulletId = 1;
export function resetBulletIds() {
  nextBulletId = 1;
}

export function createBullet(ownerSlot: number, team: TeamId, x: number, y: number, dir: Dir, star: number): BulletState {
  return {
    id: nextBulletId++,
    ownerSlot,
    team,
    x,
    y,
    dir,
    speed: star >= 1 ? BULLET_SPEED_STAR1 : BULLET_SPEED_BASE,
    destroysSteel: star >= 3,
    fullBrickHit: star >= 3,
  };
}

export function stepBullet(b: BulletState, dt: number) {
  const v = DIR_VECTOR[b.dir];
  b.x += v.x * b.speed * dt;
  b.y += v.y * b.speed * dt;
}

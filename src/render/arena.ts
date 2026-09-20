// The match scene graph — SPEC §3.3 (layer order) and §7 (rendering). Owns
// every sprite that represents world state; MatchScreen just feeds it
// snapshots and terrain events and calls tick() once per animation frame.

import { Container, Sprite, Graphics, Text, TextStyle } from "pixi.js";
import type { Atlas } from "./atlas";
import type { MapDef } from "../world/maps/loader";
import { Tile } from "../world/grid";
import type { Snapshot, MatchEvent } from "../world/sim";
import type { Slot } from "../world/tank";
import { DIR_ANGLE } from "../util/math";
import { CELL, TANK_SIZE, TEAM_COLOR, NET_SNAPSHOT_HZ, type TeamId } from "../game/config";
import { BRICK_QUARTERS } from "../world/grid";

const SNAP_INTERVAL_MS = 1000 / NET_SNAPSHOT_HZ;

type TankVisual = {
  root: Container;
  body: Sprite;
  shield: Graphics;
  label: Text;
  stars: Container;
  // Snapshots (TankSnap) don't carry team — it never changes mid-match, so
  // it's cheaper to keep it here from the Slot the visual was built from
  // than to resend it every tick.
  team: TeamId;
};

export class Arena {
  readonly world = new Container();

  private wallLayer = new Container(); // brick & steel — rendered ABOVE tanks/bullets, SPEC §3.3
  private decalLayer = new Container(); // water/ice/sand
  private forestLayer = new Container(); // topmost terrain layer, hides tanks
  private bonusLayer = new Container();
  private flagLayer = new Container();
  private tankLayer = new Container();
  private bulletLayer = new Container();
  private mineLayer = new Container();
  // Above forestLayer: where an ally tank's visual moves while it's standing
  // in forest, so its owner (and teammates) can still see it — an enemy
  // tank in the same bush stays in tankLayer, under the opaque forest tile,
  // and is simply not drawn (SPEC §3.3 "hides tanks").
  private friendlyOverlayLayer = new Container();
  private fxLayer = new Container();

  private wallSprites = new Map<number, Sprite>(); // key: cy*width+cx
  private bonusSprites = new Map<number, Sprite>();
  private mineSprites = new Map<number, Sprite>();
  private bulletSprites = new Map<number, Sprite>();
  private tankVisuals = new Map<number, TankVisual>();
  private flagSprites: Record<TeamId, Sprite>;
  private flagDestroyed: Record<TeamId, boolean> = { blue: false, red: false };

  private prev: Snapshot | null = null;
  private curr: Snapshot | null = null;
  private currAt = 0;
  // Interpolation window, seeded with the network default but replaced by
  // the *observed* gap between snapshots the moment a second one arrives —
  // the host's own view gets one every sim tick (30 Hz, host.ts), not the
  // network-throttled NET_SNAPSHOT_HZ (15 Hz) SNAP_INTERVAL_MS assumes. Using
  // the fixed constant there made `t` (below) never reach 1 before the next
  // snapshot replaced it, so a tank's rendered position perpetually lagged
  // its simulated one — invisible while driving straight, but a visible kink
  // right at a direction change, since prev/curr suddenly disagree on facing.
  private snapInterval = SNAP_INTERVAL_MS;

  constructor(private atlas: Atlas, private map: MapDef, slots: Slot[]) {
    const bg = new Graphics().rect(0, 0, map.width * CELL, map.height * CELL).fill(0x2a2f22);
    this.world.addChild(bg);
    this.world.addChild(this.decalLayer);
    this.world.addChild(this.bonusLayer);
    this.world.addChild(this.flagLayer);
    this.world.addChild(this.tankLayer);
    this.world.addChild(this.bulletLayer);
    this.world.addChild(this.mineLayer);
    this.world.addChild(this.wallLayer);
    this.world.addChild(this.forestLayer);
    this.world.addChild(this.friendlyOverlayLayer);
    this.world.addChild(this.fxLayer);

    this.buildTerrain();

    this.flagSprites = {
      blue: this.makeFlagSprite("blue"),
      red: this.makeFlagSprite("red"),
    };

    for (const slot of slots) this.tankVisuals.set(slot.id, this.makeTankVisual(slot));
  }

  private buildTerrain() {
    for (let cy = 0; cy < this.map.height; cy++) {
      for (let cx = 0; cx < this.map.width; cx++) {
        const t = this.map.grid.tileAt(cx, cy);
        this.placeTerrainSprite(cx, cy, t);
      }
    }
  }

  private placeTerrainSprite(cx: number, cy: number, tile: Tile) {
    const key = cy * this.map.width + cx;
    const existing = this.wallSprites.get(key);
    if (existing) {
      existing.destroy();
      this.wallSprites.delete(key);
    }
    let tex = null as Sprite["texture"] | null;
    let layer: Container | null = null;
    switch (tile) {
      case Tile.Brick: {
        const quarters = this.map.grid.brickQuartersAt(cx, cy);
        tex = this.atlas.terrain.brick[Math.max(0, Math.min(BRICK_QUARTERS, quarters) - 1)];
        layer = this.wallLayer;
        break;
      }
      case Tile.Steel: tex = this.atlas.terrain.steel; layer = this.wallLayer; break;
      case Tile.Forest: tex = this.atlas.terrain.forest; layer = this.forestLayer; break;
      case Tile.Water: tex = this.atlas.terrain.water; layer = this.decalLayer; break;
      case Tile.Ice: tex = this.atlas.terrain.ice; layer = this.decalLayer; break;
      case Tile.Sand: tex = this.atlas.terrain.sand; layer = this.decalLayer; break;
      default: return;
    }
    const sprite = new Sprite(tex);
    sprite.position.set(cx * CELL, cy * CELL);
    layer.addChild(sprite);
    if (layer === this.wallLayer) this.wallSprites.set(key, sprite);
  }

  /** Called for every "terrain" MatchEvent so brick/steel/fortify changes
   *  patch the scene incrementally instead of rebuilding the whole grid. */
  applyTerrainChange(cx: number, cy: number, tile: Tile) {
    this.placeTerrainSprite(cx, cy, tile);
  }

  /** Called for every "brickDamage" MatchEvent — swaps the wall sprite's
   *  texture to the next crumble stage in place, no sprite rebuild. */
  applyBrickDamage(cx: number, cy: number, quarters: number) {
    const sprite = this.wallSprites.get(cy * this.map.width + cx);
    if (!sprite) return;
    sprite.texture = this.atlas.terrain.brick[Math.max(0, Math.min(BRICK_QUARTERS, quarters) - 1)];
  }

  applyEvents(events: MatchEvent[]) {
    for (const e of events) {
      if (e.type === "impact") {
        this.spawnBurst(e.x, e.y, { tint: 0xd8c9a0, maxScale: 2.5, life: 0.18 });
      }
      if (e.type === "brickDamage") {
        this.applyBrickDamage(e.cx, e.cy, e.quarters);
      }
      if (e.type === "terrain") {
        this.applyTerrainChange(e.cx, e.cy, e.tile);
        if (e.tile === Tile.Empty) {
          this.spawnBurst(e.cx * CELL + CELL / 2, e.cy * CELL + CELL / 2, {
            tint: 0xb08a5c, maxScale: 5, life: 0.35,
          });
        }
      }
      if (e.type === "flagHit") this.destroyFlag(e.team);
      if (e.type === "kill") {
        const v = this.tankVisuals.get(e.victimSlot);
        if (v) this.spawnBurst(v.root.x + TANK_SIZE / 2, v.root.y + TANK_SIZE / 2, { tint: 0xffcc66, maxScale: 7, life: 0.33 });
      }
    }
  }

  private makeFlagSprite(team: TeamId): Sprite {
    const tl = this.map.flags[team];
    const sprite = new Sprite(this.atlas.flag[team]);
    sprite.position.set(tl.cx * CELL, tl.cy * CELL);
    this.flagLayer.addChild(sprite);
    return sprite;
  }

  private destroyFlag(team: TeamId) {
    if (this.flagDestroyed[team]) return;
    this.flagDestroyed[team] = true;
    const s = this.flagSprites[team];
    this.spawnBurst(s.x + TANK_SIZE / 2, s.y + TANK_SIZE / 2, { tint: 0xffcc66, maxScale: 9, life: 0.45 });
    s.alpha = 0.25;
  }

  private makeTankVisual(slot: Slot): TankVisual {
    const root = new Container();
    const body = new Sprite(this.atlas.tank[slot.team]);
    body.anchor.set(0.5);
    body.position.set(TANK_SIZE / 2, TANK_SIZE / 2);
    const shield = new Graphics();
    const style = new TextStyle({ fill: 0xffffff, fontSize: 9, fontFamily: "system-ui, sans-serif" });
    const label = new Text({ text: slot.nickname, style });
    label.anchor.set(0.5, 1);
    label.position.set(TANK_SIZE / 2, -3);
    const stars = new Container();
    stars.position.set(0, TANK_SIZE + 1);
    root.addChild(body, shield, label, stars);
    this.tankLayer.addChild(root);
    return { root, body, shield, label, stars, team: slot.team };
  }

  updateSlots(slots: Slot[]) {
    for (const slot of slots) {
      const v = this.tankVisuals.get(slot.id);
      if (v) v.label.text = slot.nickname;
    }
  }

  applySnapshot(snap: Snapshot) {
    const now = performance.now();
    if (this.curr) this.snapInterval = Math.max(1, now - this.currAt);
    this.prev = this.curr;
    this.curr = snap;
    this.currAt = now;
  }

  private spawnBurst(x: number, y: number, opts: { tint: number; maxScale: number; life: number }) {
    const s = new Sprite(this.atlas.spark);
    s.anchor.set(0.5);
    s.tint = opts.tint;
    s.position.set(x, y);
    s.blendMode = "add";
    this.fxLayer.addChild(s);
    let age = 0;
    const anim = () => {
      age += this.app ? this.app.ticker.deltaMS / 1000 : 1 / 60;
      const t = Math.min(1, age / opts.life);
      s.scale.set(0.4 + t * opts.maxScale);
      s.alpha = Math.max(0, 1 - t);
      if (t >= 1) {
        s.destroy();
        this.app?.ticker.remove(anim);
      }
    };
    this.app?.ticker.add(anim);
  }

  /** Set once by MatchScreen right after construction so fx animations can
   *  hook the shared ticker. */
  app: import("pixi.js").Application | null = null;

  tick(myTeams: Set<TeamId>) {
    if (!this.curr) return;
    const prev = this.prev ?? this.curr;
    const t = Math.max(0, Math.min(1, (performance.now() - this.currAt) / this.snapInterval));

    const prevTankBySlot = new Map(prev.tanks.map((tk) => [tk.slot, tk]));
    for (const tk of this.curr.tanks) {
      const v = this.tankVisuals.get(tk.slot);
      if (!v) continue;
      const p = prevTankBySlot.get(tk.slot) ?? tk;
      v.root.visible = tk.alive;
      if (!tk.alive) continue;
      v.root.position.set(lerp(p.x, tk.x, t), lerp(p.y, tk.y, t));
      v.body.rotation = DIR_ANGLE[tk.dir];

      const centerCx = Math.floor((v.root.x + TANK_SIZE / 2) / CELL);
      const centerCy = Math.floor((v.root.y + TANK_SIZE / 2) / CELL);
      const inForest = this.map.grid.tileAt(centerCx, centerCy) === Tile.Forest;
      const isMine = myTeams.has(v.team);
      if (inForest && isMine) {
        if (v.root.parent !== this.friendlyOverlayLayer) this.friendlyOverlayLayer.addChild(v.root);
        v.root.alpha = 0.55;
      } else {
        if (v.root.parent !== this.tankLayer) this.tankLayer.addChild(v.root);
        v.root.alpha = 1;
      }

      v.shield.clear();
      if (tk.invulnT > 0 || tk.helmetT > 0) {
        v.shield.circle(TANK_SIZE / 2, TANK_SIZE / 2, TANK_SIZE * 0.62).stroke({
          width: 2,
          color: tk.helmetT > 0 ? 0x4d7cff : 0xffffff,
          alpha: 0.5 + 0.5 * Math.sin(performance.now() / 100),
        });
      }
      v.stars.removeChildren();
      for (let i = 0; i < tk.star; i++) {
        const pip = new Sprite(this.atlas.bonus.STAR);
        pip.scale.set(0.4);
        pip.position.set(i * 7, 0);
        v.stars.addChild(pip);
      }
    }

    syncPool(this.bulletSprites, this.curr.bullets, this.bulletLayer, (b) => {
      const s = new Sprite(this.atlas.bullet);
      s.anchor.set(0.5);
      s.tint = TEAM_COLOR[b.team];
      return s;
    }, (s, b) => {
      s.position.set(b.x, b.y);
    });

    syncPool(this.bonusSprites, this.curr.bonuses, this.bonusLayer, (b) => {
      const s = new Sprite(this.atlas.bonus[b.kind]);
      s.anchor.set(0.5);
      return s;
    }, (s, b) => {
      s.position.set(b.cx * CELL + CELL / 2, b.cy * CELL + CELL / 2);
    });

    const visibleMines = this.curr.mines.filter((m) => myTeams.has(m.team));
    syncPool(this.mineSprites, visibleMines, this.mineLayer, () => {
      const s = new Sprite(this.atlas.mine);
      s.anchor.set(0.5);
      return s;
    }, (s, m) => {
      s.position.set(m.cx * CELL + CELL / 2, m.cy * CELL + CELL / 2);
    });
  }

  destroy() {
    this.world.destroy({ children: true });
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function syncPool<T extends { id: number }>(
  pool: Map<number, Sprite>,
  items: T[],
  layer: Container,
  create: (item: T) => Sprite,
  update: (sprite: Sprite, item: T) => void,
) {
  const seen = new Set<number>();
  for (const item of items) {
    seen.add(item.id);
    let sprite = pool.get(item.id);
    if (!sprite) {
      sprite = create(item);
      pool.set(item.id, sprite);
      layer.addChild(sprite);
    }
    update(sprite, item);
  }
  for (const [id, sprite] of pool) {
    if (!seen.has(id)) {
      sprite.destroy();
      pool.delete(id);
    }
  }
}

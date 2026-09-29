# 4. Tanks, weapons and bonuses

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 4.1 Tank

| Property | Value |
|---|---|
| Move speed | 84 px/s (sand ×0.55, `SPEED` bonus ×1.6) |
| Movement | 8-directional, snaps to 45° increments; the barrel points where you drive. Holding two adjacent direction keys (e.g. Up+Right) drives/fires diagonally; if a wall blocks one of the two axes, the tank strafes along whichever axis is still clear instead of stopping |
| Turning | Instant on normal ground, delayed on ice |
| Bullets in flight | 1, raised to 2 at `STAR 2` |
| Fire cooldown | 0.45 s |
| Bullet speed | 300 px/s, 420 px/s from `STAR 1` upward |
| Health | 1 hit = death (a `HELMET` shield absorbs one hit) |

## 4.2 Upgrade levels (`STAR`)

Upgrades are **per player**, kept through death (unlike the original — a 10-minute team match is too
long to reset progress on every respawn), and reset at match end.

| Level | Gains |
|---|---|
| 0 | Base tank |
| 1 | Faster bullets |
| 2 | Two bullets in flight |
| 3 | Bullets destroy steel and take a whole brick cell per hit |

## 4.3 Bonuses

Bonuses spawn one at a time at a random point from the map's `bonusSpawns`, despawning after
**15 s** if untouched. Both teams compete for the same pickups.

- **One bonus is on the field the moment a round starts**, so the opening rush has something to
  fight over; the rest follow at the room's rate.
- The rate is a **room setting, `bonusesPerMinute`: 1 – 10, default 6** — part of `MatchSettings`,
  host-only in the room screen (§6.1) like the other rules, and remembered per map. Each gap is
  `60 / rate` seconds, jittered ±20 % (`BONUS_SPAWN_JITTER`) so drops don't tick like a metronome.
- At most **2** on the field (`BONUS_MAX_ON_FIELD`), raised at high rates to however many the rate
  keeps alive for the despawn time (`ceil(rate × 15 / 60)`, i.e. 3 at 9–10/min), so the top of the
  range isn't quietly capped back down. A drop that finds the field full, or every spawn point
  taken, is skipped rather than queued.

| Bonus | Effect | Scope | Duration |
|---|---|---|---|
| `HELMET` | Shield absorbing one hit | Taker | 12 s or until hit |
| `STAR` | +1 upgrade level | Taker | Rest of match |
| `SPEED` | ×1.6 move speed | Taker | 10 s |
| `SHOVEL` | Your flag's pocket is rebuilt in steel — shot-out cells too — then reverts to fresh brick | **Your team** | 20 s |
| `CLOCK` | Enemy team frozen in place (can still be shot) | **Enemy team** | 6 s |
| `GRENADE` | Lobbed at the biggest enemy cluster; destroys enemies in its blast, at most half their team | **Enemy team** | ~0.5–1.2 s flight |
| `RESPAWN` | +3 respawns | **Your team** | permanent |
| `MINE` | Drop up to 3 proximity mines; 1-cell blast, visible only to your team | Taker | until used |

**GRENADE is a lobbed blast, not a wipe.** It used to destroy every enemy alive, which on a 5-a-side
map decided a round on one pickup. Now (`world/grenade.ts`, `Sim.throwGrenade`):
- **Aim.** On pickup it is thrown from the taker at the point whose blast catches the most enemies —
  candidates are each enemy and the centroid of its neighbours inside the radius — ties going to the
  point nearest the thrower, so with nobody bunched up it goes at the closest enemy. Tanks still
  under spawn protection are left out of the aiming (unless nobody else is alive).
- **Size follows the map.** Radius = `GRENADE_RADIUS_PER_SIZE` (0.16) × √(width × height) cells,
  clamped to 3–8: ~4.6 cells on 33x25, 3 on a small map, 8 on 64x64 — the same absolute radius
  would be a pinprick on a big map and the whole arena on a small one.
- **Flight.** 18 cells/s, clamped to 0.55–1.2 s, over walls. The landing ring is drawn for everyone
  from the moment it is thrown, with a shrinking inner ring as the countdown — a tank that drives
  out of it in time survives.
- **Blast.** Enemies whose centre is inside the ring are hit, nearest first, **at most
  ⌈enemy team size / 2⌉** (1 of 1, 1 of 2, 3 of 5, 10 of 20). A hit is a hit: a helmet absorbs it,
  spawn protection ignores it. Terrain and flags are untouched. Kills are credited to the thrower.
  The snapshot carries grenades in flight (`Snapshot.grenades`); the `grenadeBlast` event drives
  the explosion and its ring.

**SHOVEL works on the pocket the map built**, not on what is left of it: the cells orthogonally
next to the flag that were brick at round start (`flagPocketWalls` on the pristine `MapDef.grid`).
Brick still standing and cells already shot out both become steel, a cell a tank is standing in is
left open (a shovel never walls anyone in, and a mine in a rebuilt cell is gone), and when it runs
out every one of them comes back as **full brick** — Battle City's shovel, which repairs the base.
A shovel that turned only *surviving* brick to steel did nothing at all once the pocket had been
shot open, which is exactly when a team wants it. And because it is a team bonus, loudly announced,
**a map where either flag has no pocket never drops one** (`Sim.bonusKinds`): taking it would be a
pickup that visibly does nothing. Requiring both flags keeps it from being a dud for whichever team
happens to grab it.

Mines are laid on the **press edge** of the mine control, not while it is held — one press, one mine,
whether that press came from `Q` or the touch button (`Sim.stepFiring`; the per-tank `mineHeld` flag
is a host-side transient and is not in the snapshot).

A player holds **at most one** timed personal buff (`HELMET` / `SPEED`); taking a second replaces the
first. `STAR`, `RESPAWN`, and the team-scoped bonuses stack freely.

Team-scoped bonuses (`SHOVEL`, `CLOCK`, `GRENADE`, `RESPAWN`) announce themselves loudly: a full-width
banner, a distinct sound, and a HUD timer, so 10 players can tell what just happened.

**Look of a bonus.** Every bonus has one pictogram, declared once in `render/bonusShape.ts` as
primitive ops in a unit square plus a palette (plate, symbol, aura colour). A pickup on the ground is
drawn at a **full cell** — the same size as a tank, never a small pip — so what is lying there is
readable at a glance without a legend.

**Aura.** While a bonus is on a tank, three copies of its own icon orbit the tank inside a pulsing
ring in that bonus's colour (`Arena.syncAuras`). The set of rings is derived from state every frame,
not started and stopped by events: `HELMET`/`SPEED` show for as long as the snapshot reports the
buff, `MINE` for as long as the tank still holds mines, and anything else — a team bonus, a `STAR`
rank-up — flashes for 2.5 s from its `pickup` event. Stacked rings sit at increasing radii and spin
in alternating directions so two buffs stay separately readable.

The same op list renders through two backends — PixiJS in the arena (`render/atlas.ts`) and Canvas2D
for the How to Play legend (`render/preview.ts`), which shows, per bonus, the pickup as it lies on
the ground next to a tank wearing its aura. Neither can drift from the other.

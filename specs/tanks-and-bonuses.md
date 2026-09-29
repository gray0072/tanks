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

Bonuses spawn one at a time at a random point from the map's `bonusSpawns`, every **20–30 s**, max
**2** on the field, despawning after **15 s** if untouched. Both teams compete for the same pickups.

| Bonus | Effect | Scope | Duration |
|---|---|---|---|
| `HELMET` | Shield absorbing one hit | Taker | 12 s or until hit |
| `STAR` | +1 upgrade level | Taker | Rest of match |
| `SPEED` | ×1.6 move speed | Taker | 10 s |
| `SHOVEL` | Your flag's brick walls turn to steel, then revert | **Your team** | 20 s |
| `CLOCK` | Enemy team frozen in place (can still be shot) | **Enemy team** | 6 s |
| `GRENADE` | Every enemy tank currently alive is destroyed | **Enemy team** | instant |
| `RESPAWN` | +3 respawns | **Your team** | permanent |
| `MINE` | Drop up to 3 proximity mines; 1-cell blast, visible only to your team | Taker | until used |

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

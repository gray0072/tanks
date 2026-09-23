# 2. Match rules

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 2.1 Teams and slots

A room has **2 × teamSize slots**, half Blue and half Red, where `teamSize` is however many spawn
markers the loaded map declares (§3.5) — 5 a side for the built-in maps, 1 a side for the debug map,
and whatever a new map asks for. Every slot is always occupied, by a human or by a bot, so the teams
are always full and always symmetric.

- A slot is either **human** (nickname, 2–12 chars) or **bot**. A bot's name is its difficulty plus
  its 1-based slot position — `Easy1`, `Medium2`, `Hard3` — assigned the lowest free index, unique room-wide,
  and re-derived whenever that bot's difficulty changes, so the name always states how it plays.
- A joining player takes **any** slot, on either team, replacing the bot that sat there.
- A leaving player's slot reverts to a bot mid-match, keeping the tank's current state (position,
  upgrade level, lives) so the fight is not disturbed.
- One client may hold **two** slots at once (local co-op, §5.2). The two seats may be on the same
  team or on opposite teams.

## 2.2 Winning

A match ends the moment any of these is true:

| Condition | Winner |
|---|---|
| A team's **flag is destroyed** | The other team (instant) |
| A team's **respawns** hit 0 and its last tank dies | The other team |
| **Time limit** expires | Team with more frags; tie broken by flag armor remaining; still tied → draw |

Respawns are set as a **multiplier on team size**, not a flat pool: `×0 ×1 ×2 ×3 ×5 ×10 ×20 ×50
×100`, default **×10**. Each team's starting pool is `multiplier × its own slot count`, so a lopsided
map (4 vs 6) still gives both sides the same number of lives *per player*. The lobby shows what the
multiplier works out to — `×10 (50)`, or `×10 (50, 100)` (blue, red) when the teams differ in size.

Defaults: **×10 respawns** per player, **10 minute** limit.

**Every match starts on pristine terrain.** A `MapDef` is parsed once and cached (`maps/loader.ts`),
so the `Sim` takes a **copy** of its grid — shot-out bricks and `SHOVEL` walls belong to the match,
not to the map. Without the copy a rematch would begin on the last round's wreckage.

## 2.3 Lives, death, respawn

- Every death costs the team **one respawn**. Respawns are a shared team pool, not per-player.
- Respawn after **3 s** at a free spawn point in the team's spawn zone, with **3 s** of spawn
  invulnerability (blinking shield). Invulnerability breaks early if the tank fires.
- When a team's respawns reach 0, its dead players become spectators; the round continues until the
  team's last living tank dies.
- Falling into water, being crushed by a shovel-wall closing, or friendly fire (§2.5) all cost a
  respawn the same way.

## 2.4 Scoring

Per-player stats tracked and shown on the scoreboard: **frags, deaths, flag damage, bonuses taken,
assists** (damage to a tank killed by a teammate within 5 s). Team score = sum of frags. Stats are
match-local; nothing is persisted server-side.

## 2.5 Friendly fire

Off by default. A lobby toggle enables it (bullets damage teammates and your own flag walls) for
groups that want it. Bots are told about the setting and stop shooting through teammates when it's on.

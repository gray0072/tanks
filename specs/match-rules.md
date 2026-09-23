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

## 2.2 Rounds, winning and the match series

A match on a map is a **series of rounds**. A round is one fight on pristine terrain; the first team
to win **`winsTarget`** rounds takes the match.

`winsTarget` is **1 – 10, default 5**, and it is a **room setting** — part of `MatchSettings`
alongside the round length, the respawn pool and friendly fire. The host sets it in the room screen
(§6.1) and may change it right up to `Start match`; every guest sees the change arrive as room
state. It is not a creation-time choice and not a property of the map: the roster changes after a
room exists, people come and go, and a host should be able to retune a match without tearing the
room down.

### Ending a round

A round ends the moment any of these is true:

| Condition | Round winner |
|---|---|
| A team's **flag is destroyed** | The other team (instant) |
| A team's **respawns** hit 0 and its last tank dies | The other team |
| **Round time limit** expires | Decided on the ladder below |

**There are no drawn rounds.** A round the clock ran out on is decided by:

1. **Respawns left** — the pool is what a team spends to stay in the fight, so the side that spent
   less of it was ahead. Unlike a frag count it also charges the deaths nobody was credited for:
   water, mines, friendly fire.
2. **Closest to the enemy flag** — with the lives even, the team whose nearest living tank got
   deepest into the other's base was the one making the running. A team with nothing alive counts as
   infinitely far away.
3. **Sudden death** — dead level on both, so the clock is simply over-run and the round keeps
   playing until something separates the teams, which a tank moving is enough to do. The HUD says
   `SUDDEN DEATH` where the clock was, rather than showing a stopped `0:00`. Two evenly matched bot
   teams on a mirrored map tie on respawns often enough that this is a routine path, not a
   theoretical one.

The type says so too: `MatchRules.winner` is `TeamId | null`, with `null` meaning "still being
played". There is no `"draw"` to handle, and so no way for the series to stall on one.

### Between rounds

Unless the round decided the match:

1. The score goes up — **rounds won, per team** (`3 : 1`), over the frozen battlefield; nothing is
   simulated during the breather, so the position the round ended in stays on screen.
2. A **3-second countdown** (`ROUND_INTERMISSION`) runs.
3. At 0 the next round starts **immediately, on the same map**: terrain rebuilt, flags back, tanks at
   their spawns, respawn pools refilled and the **clock back to full**.

The renderer rebuilds its scene for the new round rather than patching it — a round's worth of
cell-by-cell terrain edits can't be reversed incrementally.

### Ending the match

When a team's wins reach `winsTarget`, the result screen replaces the intermission and states the
series score, winner's first: **`BLUE WINS 5:2`**. Its scoreboard is the **whole match**, not the
last round — per-player stats are summed over every round played (`world/series.ts`).

### Respawns and the clock

Both are **per round**. Respawns are set as a **multiplier on team size**, not a flat pool: `×0 ×1
×2 ×3 ×5 ×10 ×20 ×50 ×100`, default **×10**. Each team's starting pool is `multiplier × its own slot
count`, so a lopsided map (4 vs 6) still gives both sides the same number of lives *per player*. The
room shows what the multiplier works out to — `×10 (50)`, or `×10 (50, 100)` (blue, red) when the
teams differ in size.

The round time limit is **1 – 10 minutes, default 5** — shorter than a match, because it only bounds
one round of it.

**Every round starts on pristine terrain.** A `MapDef` is parsed once and cached (`maps/loader.ts`),
so each round's `Sim` takes a **copy** of its grid — shot-out bricks and `SHOVEL` walls belong to the
round, not to the map. Without the copy the next round would begin on the last one's wreckage.

> **As implemented.** The series lives on the host (`net/host.ts`), which owns the only `Sim`: it
> books the round, holds the intermission in its own frame loop, and builds a fresh `Sim` for the
> next round. Guests are told by two messages, `roundEnd` and `roundStart` (§9.3); the countdown
> itself runs client-side off the one figure `roundEnd` carries, so a breather costs two messages
> rather than one a second. The rules that decide what a round win *means* are in `world/series.ts`,
> kept out of the host so they can be tested headlessly (`tests/rounds.test.ts`).

## 2.3 Lives, death, respawn

- Every death costs the team **one respawn**. Respawns are a shared team pool, not per-player.
- Respawn after **3 s** at a free spawn point in the team's spawn zone, with **3 s** of spawn
  invulnerability (blinking shield). Invulnerability breaks early if the tank fires.
- When a team's respawns reach 0, its dead players become spectators; the round continues until the
  team's last living tank dies.
- Respawn pools are per round: the next round of the series refills both (§2.2).
- Falling into water, being crushed by a shovel-wall closing, or friendly fire (§2.5) all cost a
  respawn the same way.

## 2.4 Scoring

Per-player stats tracked and shown on the scoreboard: **frags, deaths, flag damage, bonuses taken,
assists** (damage to a tank killed by a teammate within 5 s). Team score = sum of frags. Stats are
**match**-local, not round-local — they accumulate across the series (§2.2) and are what the final
table shows. Nothing is persisted server-side.

Frags decide nothing on their own — a round the clock ran out on goes on respawns and position
(§2.2), and the *match* goes on rounds won, which is what the HUD shows beside the clock and what
the result banner states. Frags are there to tell players how they did.

## 2.5 Friendly fire

Off by default. A lobby toggle enables it (bullets damage teammates and your own flag walls) for
groups that want it. Bots are told about the setting and stop shooting through teammates when it's on.

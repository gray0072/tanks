# 10. Bots

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

Bots fill every unclaimed slot and must be good enough that a 1-human-vs-9-bots match is fun.

## 10.1 Core loop

**Utility AI** — each bot re-scores its actions every 150 ms (staggered across bots so the cost
spreads over ticks) and drives toward the winner:

| Action | Fires when |
|---|---|
| `AttackFlag` | Path to the enemy flag is viable and the team is not under pressure |
| `DefendFlag` | Enemies are near our base, or our flag has taken damage recently |
| `Hunt` | An enemy is close and exposed |
| `Evade` | A bullet is inbound (utility spike, overrides almost everything) |
| `Collect` | A bonus is on the field and reachable before the enemy |
| `Regroup` | Alone, low on team respawns, or heavily outnumbered locally |

Considerations are normalized 0..1 curves: distance to target, line of sight, local team advantage,
flag threat level, bonus value and contest risk, remaining buff time, own upgrade level.

**Team coordination** is a thin layer, not a full commander: the host keeps a per-team desired
assignment (roughly 2 defenders / 3 attackers, shifting toward defense when the flag is threatened)
and biases each bot's action scores toward its assigned role. It's enough to stop all 5 bots from
suiciding into the same lane.

**Pathing:** A* on the map’s own cell grid with a cost map (brick = expensive but passable by shooting,
water = blocked, sand = ×2, ice = ×1.5), recomputed on terrain change and at most once per second per
bot, cached per team.

> **As implemented.** Brick's cost comes from the bot's own profile, not from the shared cost map: a
> bot that never shoots brick (Easy) treats it as impassable and routes around, because a route it
> can't open is worse than a longer one it can walk. And an objective that sits on an impassable
> tile — a flag, always — is snapped to the nearest cell A* can actually stand on before the search
> runs. Without that snap, `AttackFlag` asked for the flag's own cell, got no path at all, and left
> the bot with no movement input; roughly three-quarters of all `AttackFlag` ticks produced nothing
> but stuck-escape jitter, and bots never damaged a flag in a whole match.
>
> A chosen action is also held for ~1.5 s (a bonus run, until the bonus resolves) before the
> probabilistic scoring is re-rolled. At a 100–250 ms re-score interval those dice came up several
> times a second, and bots oscillated between two goals on opposite sides of the map, converging on
> neither.

## 10.2 Fair perception

Bots run inside the host's authoritative simulation and could trivially read the whole world state.
They don't. Every bot perceives the arena through the same rules a player does:

- An enemy is **known** only while it is in line of sight and not concealed by `FOREST` — including
  the cell the enemy itself stands in, so sitting in forest genuinely hides you rather than merely
  making you awkward to shoot at.
- Losing sight leaves a **last-known position** that decays over a difficulty-dependent memory
  window, after which the bot searches rather than tracks.
- Bonus spawn *timing* is not knowledge — a bonus is only a target once it exists and is visible.
  (`Hard` is allowed to infer the ~20–30 s cadence, which is something an attentive human also does.)

This is what makes difficulty a real dial: harder bots think better, they don't see more.

## 10.3 Difficulty levels

Three levels — **Easy**, **Medium** (default), **Hard** — the internal ids are `easy`/`normal`/`hard`
(`config.ts`), with `BOT_DIFFICULTY_LABEL` supplying the displayed names. They differ in mechanical precision *and*
in which behaviors are unlocked at all, so higher difficulty reads as smarter play rather than just
faster twitching.

### Easy — "target practice"

A newcomer, or a filler tank for players who want a relaxed match.

- **Aim:** fires when the target is roughly in the barrel's lane, with a wide tolerance and a large
  angular error. Never leads a moving target — it shoots where you *are*, so strafing beats it.
- **Awareness:** forgets an enemy ~1 s after losing sight. Tracks one target at a time and
  tunnel-visions on it, ignoring a closer threat behind it.
- **Dodging:** only reacts to a bullet already very close and directly in line, and often reacts too
  late. Never pre-emptively leaves an enemy's firing lane.
- **Objective play:** attacks the enemy flag only when it happens to be nearby; defends only once
  the flag is *already* taking hits. Ignores the team role assignment most of the time.
- **Terrain:** does not shoot brick to open a path — if the route is blocked it goes around, and it
  will happily grind against a wall for a moment before re-pathing. Walks into sand and ice without
  accounting for them.
- **Bonuses:** picks up what it drives past; does not detour, does not contest.
- **Mines:** never uses them.
- **Idle tells:** short pauses and slightly wandering routes, so it reads as a tank being driven
  badly rather than a machine standing still.

### Medium — "a competent teammate"

The default. Plays the objective correctly and punishes mistakes, but is beatable by an attentive
player and makes recognizable errors.

- **Aim:** decent tolerance, small angular error, **partial target leading** (predicts roughly half
  the travel time), so straight-line running gets you hit. Respects its own fire cooldown instead of
  spamming.
- **Awareness:** ~2.5 s memory of a lost target, then a short search of the last-known area. Will
  switch targets when a closer or more dangerous one appears.
- **Dodging:** evades inbound bullets reliably when it has room, and avoids parking in a long open
  lane. Will back off from a straight-on duel it is losing.
- **Objective play:** follows the team role assignment. Attackers push the enemy flag pocket and
  chip its brick; defenders hold near the base and intercept. Reacts to the flag-threat signal and
  rotates home.
- **Terrain:** shoots through brick to open a lane when the detour is much longer, uses forest as
  cover to approach, avoids sand when a similar route exists, is cautious on ice.
- **Bonuses:** detours for a bonus when it is meaningfully closer than the nearest enemy. Values
  `STAR` and `HELMET` above the rest.
- **Team bonuses:** uses `SHOVEL` and `CLOCK` on pickup, without timing them.
- **Mines:** drops them on its own approach lanes when defending.
- **Errors it still makes:** over-commits to a kill, occasionally pushes alone, does not deny
  bonuses to the enemy.

### Hard — "plays to win"

For players who want the bot team to actually be a threat. Same information, much better decisions.

- **Aim:** tight tolerance, minimal error, **full lead prediction** including the target's current
  speed and surface modifier. Fires through brick at an enemy it knows is behind it when the shot is
  worth the ammunition. Pre-fires at a chokepoint an enemy is about to cross.
- **Awareness:** ~4 s memory, and it *infers*: it will check a bonus spawn point on cadence, and
  treats a teammate's death as evidence of an enemy in that area.
- **Dodging:** leaves enemy firing lanes **before** a shot is fired, dodges the instant a bullet is
  launched, and uses the 2-bullet cooldown window of an upgraded enemy to close distance.
- **Objective play:** coordinates — attackers **wait to push together** instead of trickling in, and
  the team commits to a flag rush when it has a local numbers advantage. Defenders keep an
  interlocking pair of angles on the flag pocket rather than both sitting in the same lane.
- **Target selection:** prioritizes the most dangerous enemy (high upgrade level, buffed, or closest
  to the flag) rather than the nearest one, and focus-fires with a teammate when both have line of
  sight.
- **Terrain:** deliberately opens brick lanes for the team push, ambushes from forest, denies the
  center by holding steel cover, and refuses to cross ice under fire.
- **Bonuses:** contests actively and **denies** — will body-block or race a bonus it cannot use
  simply to keep it away from the enemy.
- **Team bonuses:** timed. `GRENADE` is held until several enemies are alive and pressuring, or fired
  immediately if the flag is critical. `SHOVEL` is saved for an incoming push rather than burned on
  pickup. `CLOCK` is used to open a flag rush.
- **Mines:** placed at chokepoints and around the flag pocket, not scattered.
- **Retreat:** disengages when outnumbered locally and regroups instead of trading badly.

### Parameters

| Parameter | Easy | Medium | Hard |
|---|---|---|---|
| Reaction delay | 450 ms | 220 ms | 90 ms |
| Between-shot hesitation | 550 ms | 150 ms | 0 |
| Re-score interval | 250 ms | 150 ms | 100 ms |
| Aim error (±) | 14° | 5° | 1.5° |
| Fire tolerance | wide | medium | tight |
| Target leading | none | ~50 % | full |
| Target selection | sticky (tunnel vision) | nearest | most dangerous |
| Enemy memory | 1.0 s | 2.5 s | 4.0 s |
| Bullet evasion | late, in-line only | reliable | pre-emptive |
| Shoots brick to path | no | when it saves time | proactively, for the team |
| Bonus detour chance | 0 (never detours) | 45 % | 70 % |
| Bonus behavior | opportunistic | contests | contests + denies |
| Role adherence | ~35 % | ~85 % | ~100 % + coordinated pushes |
| Uses mines | no | own flag approach, or a chokepoint | chokepoints only |
| Times team bonuses | no | no | yes |
| Retreats when losing | no | sometimes | yes |

> **As implemented.** Two of these carry details the prose above doesn't imply, and both exist
> because the difficulty dial measurably pointed the *wrong way* without them (`tests/bots.test.ts`
> runs full bot-vs-bot matches and asserts the ranking):
>
> - **Fire tolerance is floored at the real hit window.** A bullet always travels exactly along
>   `tank.dir`, so what decides a hit is the lateral offset in pixels — half a hitbox, at any range —
>   not an angle. The angular tolerance only ever *widens* that window for a sloppy profile. Left
>   purely angular, Hard's 1.5° refused shots at close range that would have connected, and Easy's
>   18° cone let it take every shot Hard passed up; Easy beat Hard roughly 3 : 1.
> - **"Between-shot hesitation" is the main thing that makes Easy feel easy.** Reaction delay only
>   applies when a target is first acquired; without a separate per-shot pause, an Easy bot that had
>   locked on kept firing at its tank's full cooldown, which reads as relentless rather than clumsy.
> - **Target leading uses observed velocity, not assumed velocity.** Bots track how fast each enemy
>   they can see is actually moving. Leading on "TANK_SPEED in the direction it currently faces"
>   makes a full-lead profile shoot in front of tanks that are standing still.

All of these live in `config.ts` as three named profiles, so a fourth ("Insane", "Passive" for
testing) is a data change, not a code change.

## 10.4 Choosing difficulty in the lobby

Difficulty is **per bot slot**, defaulting to **Medium**.

- In **Create room**, `Default bot difficulty` sets the level every bot slot starts at — `Medium`
  unless changed.
- In the **room screen**, every bot slot carries a difficulty chip (`Easy` / `Medium` / `Hard`),
  shown right before the bot's name. The host clicks it to cycle that single bot's level, and the
  `All bots:` control above the rosters sets every bot
  slot at once — including a per-team variant, so you can hand one side `Hard` and the other `Easy`
  to balance an uneven human split.
- Mixed difficulties within a team are fully supported and are the point of per-slot control.
- Only the **host** changes difficulty; the setting is part of `roomState` and everyone sees it live
  in the roster and in the slot preview.
- Difficulty is a property of the **slot**, not of the bot instance: if a player leaves mid-match and
  a bot takes over their tank, that bot uses the slot's configured level.
- Levels are locked once the match starts and are editable again on the result screen before a
  rematch.

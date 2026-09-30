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
| `Hold` | A midfielder with nothing better to do: patrols its flank of the middle |

Considerations are normalized 0..1 curves: distance to target, line of sight, local team advantage,
flag threat level, bonus value and contest risk, remaining buff time, own upgrade level.

**Team coordination** is a thin layer, not a full commander (`ai/teamPlan.ts`). At the start of every
round each team draws a **posture** and deals its bots **roles** and **lanes**; the plan then holds
for the round, so no bot's job flips on its own.

- **Posture**, drawn at random per team per round: *aggressive* (30 %), *balanced* (45 %) or
  *defensive* (25 %) (`BOT_POSTURE_WEIGHTS`). It sets the split between the three roles as shares of
  the team (`BOT_POSTURE_SHARES`): aggressive ≈ 15 % defend / 20 % midfield / rest attack, balanced ≈
  25 / 30 / rest, defensive ≈ 40 / 35 / rest.
- **Roles**, from those shares for any team size (`roleCounts`): a lone bot attacks (the flag-threat
  signal still brings it home); two bots never both sit at home; from three up there is always at
  least one defender and one attacker. On 5 a side that is 1/1/3, 1/2/2 or 2/2/1; on 20 a side,
  balanced is 5/6/9. Defenders are the bots that start nearest home, with a little noise.
  - **Attack:** drives out along its lane to the middle of the map (`BOT_ATTACK_STAGE_ALONG`), then
    turns in on the enemy flag.
  - **Midfield:** patrols its lane between 30 % and 50 % of the way up the map (`Hold`), taking
    whatever comes through.
  - **Defend:** waits a few cells in front of the flag, defenders side by side rather than stacked
    (`BOT_GUARD_*`), and goes for anything it sees.
- **Lanes**: one per 8 cells of map width across the flag-to-flag line, up to three (left, middle,
  right). Attackers and midfielders are dealt round them from a random starting lane, so the team
  covers the flanks instead of every bot taking the same shortest route, and which flank gets the
  heavier push changes every round.
- **Threat response**, recomputed every tick: two or more enemies near our flag pull every
  midfielder back to defend until they are gone.

How closely a bot follows its role is its profile's `roleAdherence` (§10.3) — Easy wanders off its
job most of the time, Hard hardly ever. The lane is its route either way.

> **As implemented.** This replaced a per-tick "the 2–3 bots nearest our flag defend, the rest
> attack" rule, under which every attacker ran the same A* route to the enemy flag and the whole team
> arrived down one side. Measured as where tanks first cross the middle of the map, over 6 seeds of
> 40 s on each built-in: on `classic` the old split was 33 left / 8 right, now 20 / 18; on
> `crossroads` every crossing was down the centre, now 11 left / 21 centre / 7 right. Maps whose
> walls funnel traffic (`swamp`, `fortress`) look the same either way.

**Pathing:** A* on the map’s own cell grid with a cost map (brick = expensive but passable by shooting,
water = blocked, sand = ×2, ice = ×1.5), recomputed on terrain change and at most once per second per
bot, cached per team.

> **As implemented.** Brick's cost comes from the bot's own profile, not from the shared cost map.
> Easy's is `BOT_LAST_RESORT_BRICK_COST` (25 per cell): any sensible way round wins, but it is
> finite, so a goal with *no* way round — a walled-in flag, a plugged corridor — still gets a route
> through the wall, and the bot shoots it open. (It used to be infinite, and an Easy bot sat forever
> in front of a wall it had no idea it could shoot.) And an objective that sits on an impassable
> tile — a flag, always — is snapped to the nearest cell A* can actually stand on before the search
> runs. Without that snap, `AttackFlag` asked for the flag's own cell, got no path at all, and left
> the bot with no movement input; roughly three-quarters of all `AttackFlag` ticks produced nothing
> but stuck-escape jitter, and bots never damaged a flag in a whole match.
>
> A chosen action is also held for ~1.5 s (a bonus run, until the bonus resolves) before the
> probabilistic scoring is re-rolled. At a 100–250 ms re-score interval those dice came up several
> times a second, and bots oscillated between two goals on opposite sides of the map, converging on
> neither.
>
> **No dithering.** A bot turning back and forth on the spot reads as broken, so every per-tick
> choice that can flip is committed to for a beat (`BOT_*` in `constants.ts`):
> - *Path following* keeps its direction until that axis is done (`BOT_PATH_AXIS_DONE_PX`) instead
>   of re-picking the larger axis every tick — off both axes of a waypoint, that zig-zagged
>   Right, Down, Right, Down.
> - *Aim error* is re-sampled every `BOT_AIM_RESAMPLE_TIME` (0.4 s), not every tick, and a target
>   already being tracked keeps ×1.5 lane tolerance and holds the barrel for `BOT_AIM_HOLD_TIME`
>   after slipping off — a per-tick roll flipped a marginal target in and out of the firing window.
> - *A dodge* steps to the side the tank already leans toward and keeps that direction for
>   `BOT_EVADE_COMMIT_TIME`.
>
> Measured over 60 s bot-vs-bot matches on every map: quick A→B→A reversals went from ~1.0 to ~0.1
> per bot per second.

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

Four levels — **Easy**, **Medium** (default), **Hard**, **Extreme** — the internal ids are `easy`/`normal`/`hard`/`extreme`
(`config.ts`), with `BOT_DIFFICULTY_LABEL` supplying the displayed names. They differ in mechanical precision *and*
in which behaviors are unlocked at all, so higher difficulty reads as smarter play rather than just
faster twitching.

### Easy — "target practice"

A newcomer, or a filler tank for players who want a relaxed match.

- **Aim:** fires when the target is roughly in the barrel's lane, with a wide tolerance and a large
  angular error. Never leads a moving target — it shoots where you *are*, so strafing beats it.
- **Awareness:** forgets an enemy ~1 s after losing sight. Tracks one target at a time and
  tunnel-visions on it, ignoring a closer threat behind it.
- **Dodging:** only reacts to a bullet already very close and directly in line, and with a
  beginner's reaction time it mostly notices too late. Never pre-emptively leaves an enemy's firing
  lane.
- **Objective play:** attacks the enemy flag only when it happens to be nearby; defends only once
  the flag is *already* taking hits. Ignores the team role assignment most of the time.
- **Terrain:** goes around brick whenever there is any reasonable way round, but when there is none
  (a walled-in flag, a plugged corridor) it does work out that the wall can be shot, and shoots it
  open — slowly. Walks into sand and ice without accounting for them.
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
- **Team bonuses:** timed. `GRENADE` is valued by what its blast would catch right now (the same
  aiming the sim uses): raced when two or more enemies are bunched, or one is on our flag. `SHOVEL` is saved for an incoming push rather than burned on
  pickup. `CLOCK` is used to open a flag rush.
- **Mines:** placed at chokepoints and around the flag pocket, not scattered.
- **Retreat:** disengages when outnumbered locally and regroups instead of trading badly.
- **Friendly fire:** with friendly fire on, never fires down a lane with a teammate in it (the same
  check as Extreme's, below).

> **As implemented.** Two lines above were never built for Hard: its attackers do *not* wait to
> push together, and it does not ambush from forest. Both were built for Extreme instead and
> measured in the bot league — the push lost rounds and is off there too; the forest play is on.

### Extreme — "a team of strong players"

Hard's decisions with a pro's reflexes, and above all *teamwork*. The perception rules (§10.2)
still hold per bot; what is new is that the bots talk to each other.

- **Reflexes:** 160 ms reaction, no between-shot hesitation, 150 ms re-score, 0.75° aim error,
  5 s memory. Fast, still human.
- **Call-outs** (`ai/teamIntel.ts`): what one bot sees reaches its teammates after
  `BOT_COMMS_DELAY` (0.3 s, the time it takes to say it) — the voice channel a human team has. A
  heard sighting is a memory like any other: it decays from when it was *seen*, is never
  "visible" (no lead on hearsay), and a kill clears it. A call-out from across the map is
  information, not an order: a bot only hunts what is within engagement range, a defender only
  what is near its flag.
- **Spread attention:** the team board records who is hunting whom; at most `BOT_MAX_HUNTERS` (2)
  chase one enemy, so the rest of the team stays on its jobs. Point-blank is everyone's business.
- **No crowding:** a bot doesn't park on a spot a nearer teammate already holds — it takes a free
  cell two or three off — and steps round a teammate in its way instead of shoving into its back.
- **Friendly fire:** with it on, a shot is refused if a teammate is anywhere in the bullet's path
  — not only before the target, since a dodged bullet flies on — *or will be* by the time the
  bullet gets there, if it keeps driving the way it faces. A teammate's bullet is dodged like an
  enemy's. With friendly fire off bullets pass through teammates, so none of this applies.
- **Bushes, both ways:** waits in forest near its post (guard point, the far end of a midfield
  patrol) rather than in the open, and fires into a bush in its lane where an enemy it knew about
  went out of sight — recon by fire, at most every `BOT_PROBE_INTERVAL`.

> **As implemented — how Extreme was picked.** Each idea is a profile flag, so a candidate is a
> data set. `scripts/botLeague.ts` plays full rounds under the default rules (x10 lives, 5 min,
> flags live) on all six built-in maps from both sides.
>
> 1. A round robin of full-featured candidates: every one beat Hard, but barely beat *reflex*
>    (Extreme's timings with none of the teamwork).
> 2. An ablation, reflex + one idea against reflex, 96 rounds each: spacing 52, forest ambush 52,
>    recon fire 50, call-outs 48 — and below even: firing positions 45, pincer push 43, reacting
>    to every approaching enemy 42 (it pulled attackers off the objective).
> 3. Push and reaction retuned (quorum 2/3 to 1/2, wait 7 s to 4 s; react within 6 cells and not
>    while pushing) and re-tried on top of the four keepers ("core"), against reflex / Hard:
>    core 54 : 42 / 69 : 27; + column push 49 : 47 / 70 : 26; + reaction 51 : 45 / 61 : 35;
>    + pincer push 46 : 50 / 64 : 32.
> 4. A final round robin of core, core + column push and core + reaction: core first with
>    friendly fire off (51.6 %) and on (53.1 %), and it beat core + column push 53 : 43.
>
> So Extreme ships as core. `groupPush`, `reactsToApproach` and `firingPositions` stay in the code,
> off, for the next attempt.
>
> Against Hard on fresh seeds Extreme takes 110 of 180 rounds (61 %), K/D about 1.15. It *trails*
> Hard on frags over the first 75 s — it spends the opening getting into position — so
> `tests/bots.test.ts` checks it on rounds won, not on the frag window the lower rungs use.
>
> Friendly fire on, Extreme mirror, 12 rounds: the plain lane check took teamkills from about 100
> to 49; predicting teammates' movement and dodging their bullets took it to 18 — about 1.5 a
> round, out of some 100 kills.

### Parameters

| Parameter | Easy | Medium | Hard | Extreme |
|---|---|---|---|---|
| Reaction time | 600 ms | 350 ms | 200 ms | 160 ms |
| Between-shot hesitation | 800 ms | 150 ms | 0 | 0 |
| Re-score interval | 500 ms | 300 ms | 200 ms | 150 ms |
| Aim error (±) | 18° | 5° | 1.5° | 0.75° |
| Fire tolerance | wide | medium | tight | tight |
| Target leading | none | ~50 % | full | full |
| Target selection | sticky (tunnel vision) | nearest | most dangerous | most dangerous |
| Enemy memory | 1.0 s | 2.5 s | 4.0 s | 5.0 s |
| Bullet evasion | late, in-line only | reliable | pre-emptive | pre-emptive |
| Shoots brick to path | only when there is no way round | when it saves time | proactively, for the team | proactively |
| Bonus detour chance | 0 (never detours) | 45 % | 70 % | 70 % |
| Bonus behavior | opportunistic | contests | contests + denies | contests + denies |
| Role adherence | ~35 % | ~85 % | ~100 % | ~100 % |
| Uses mines | no | own flag approach, or a chokepoint | chokepoints only | chokepoints only |
| Times team bonuses | no | no | yes | yes |
| Retreats when losing | no | sometimes | yes | yes |
| Friendly-fire aware | no | no | yes | yes, and dodges teammates' bullets |
| Team call-outs, spread hunting | no | no | no | yes |
| Keeps spacing | no | no | no | yes |
| Waits in / fires into forest | no | no | no | yes |

> **As implemented.** Two of these carry details the prose above doesn't imply, and both exist
> because the difficulty dial measurably pointed the *wrong way* without them (`tests/bots.test.ts`
> runs full bot-vs-bot matches and asserts the ranking):
>
> - **Fire tolerance is floored at the real hit window.** A bullet always travels exactly along
>   `tank.dir`, so what decides a hit is the lateral offset in pixels — half a hitbox, at any range —
>   not an angle. The angular tolerance only ever *widens* that window for a sloppy profile. Left
>   purely angular, Hard's 1.5° refused shots at close range that would have connected, and Easy's
>   18° cone let it take every shot Hard passed up; Easy beat Hard roughly 3 : 1.
> - **Reaction time is human-scale.** Easy plays like a beginner (~0.6 s, decision included),
>   Medium like a regular player, Hard like a strong one (~0.2 s) — fast, but not faster than a
>   person can be; the old 90 ms read as an aimbot. The same number gates *both* firing at a target
>   that has just lined up *and* dodging: a bullet younger than the reaction time hasn't been
>   noticed yet.
> - **"Between-shot hesitation" is the main thing that makes Easy feel easy.** Reaction delay only
>   applies when a target is first acquired; without a separate per-shot pause, an Easy bot that had
>   locked on kept firing at its tank's full cooldown, which reads as relentless rather than clumsy.
> - **Target leading uses observed velocity, not assumed velocity.** Bots track how fast each enemy
>   they can see is actually moving. Leading on "TANK_SPEED in the direction it currently faces"
>   makes a full-lead profile shoot in front of tanks that are standing still.

All of these live in `constants.ts` (`BOT_PROFILE`) as four named profiles, so another one
("Passive" for testing) is a data change, not a code change — the bot league registers its
candidates exactly that way.

## 10.4 Choosing difficulty in the lobby

Difficulty is **per bot slot**, defaulting to **Medium**.

- In **Create room**, `Default bot difficulty` sets the level every bot slot starts at — `Medium`
  unless changed.
- In the **room screen**, every bot slot carries a difficulty chip (`Easy` / `Medium` / `Hard` / `Extreme`),
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

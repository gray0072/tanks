# Tanks — Specification & Project Plan

Team tank battle in the browser, blue against red, in the spirit of *Battle City*: destructible terrain,
power-ups, and a base flag that must be defended. Runs on desktop and mobile, joinable over the
internet by a short room code, and playable by two people on one keyboard.

> This document is the source of truth for the design. Code follows the spec, not the other way
> around. Numbers in tables are the tuning defaults — they live in `src/game/config.ts` and are
> expected to change during playtesting.

The spec is split across `specs/`; this file is the index. Section numbers (**§0 – §16**) are stable
and are cited throughout the code and the docs — use the table below to find the file a `§` lives in.

---

## Contents

| § | Section | File |
|---|---|---|
| 0 | Stack | [specs/stack-and-summary.md](specs/stack-and-summary.md#0-stack) |
| 1 | Product summary · design pillars | [specs/stack-and-summary.md](specs/stack-and-summary.md#1-product-summary) |
| 2 | Match rules — teams, winning, lives, scoring, friendly fire | [specs/match-rules.md](specs/match-rules.md) |
| 3 | The arena — dimensions, layout, surfaces, maps, map file format, example maps | [specs/arena.md](specs/arena.md) |
| 4 | Tanks, weapons and bonuses | [specs/tanks-and-bonuses.md](specs/tanks-and-bonuses.md) |
| 5 | Controls — desktop, local co-op, mobile, fullscreen | [specs/controls.md](specs/controls.md) |
| 6 | Screens — menu, room screen, HUD, live menu backdrop | [specs/screens.md](specs/screens.md) |
| 7 | Rendering (PixiJS) | [specs/rendering-and-simulation.md](specs/rendering-and-simulation.md#7-rendering-pixijs) |
| 8 | Simulation | [specs/rendering-and-simulation.md](specs/rendering-and-simulation.md#8-simulation) |
| 9 | Networking — topology, room code, messages, failure handling | [specs/networking.md](specs/networking.md) |
| 10 | Bots — core loop, fair perception, difficulty | [specs/bots.md](specs/bots.md) |
| 11 | Audio | [specs/audio.md](specs/audio.md) |
| 12 | Project structure · deployment | [specs/project-structure.md](specs/project-structure.md) |
| 13–16 | Plan, risks, out of scope, open questions | [specs/plan-and-risks.md](specs/plan-and-risks.md) |

### Companion specs

| Document | Scope |
|---|---|
| [specs/level-editor.md](specs/level-editor.md) | The in-game level editor and map library — its own detail sheet; the user-visible parts are folded into §3.4, §3.5, §6 and §9.3 |

### Related docs

- [README.md](README.md) — player-facing overview and how to run the project.
- [AGENTS.md](AGENTS.md) — working notes: current status, how to launch and verify the game.

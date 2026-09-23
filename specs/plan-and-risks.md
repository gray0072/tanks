# Plan, risks and scope

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 13. Plan

Each milestone ends in something playable — no milestone is pure plumbing.

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Scaffold** — Vite + TS + PixiJS, scaled world container, procedural atlas, fixed-step loop | An empty arena renders and scales correctly on desktop and phone |
| **M1** | **Terrain** — grid, 8 surfaces, the char-grid map format + loader + validator, `classic` map | The classic map draws with correct layering; brick destruction works from a debug key |
| **M2** | **One tank** — movement, grid collision, surface effects, firing, bullets, brick/steel damage | You can drive and shoot alone on the map, keyboard |
| **M3** | **Match rules** — teams, flags, spawns, the respawn pool, respawn timing, win conditions, HUD, result screen | A full match against dummy tanks starts and ends correctly |
| **M4** | **Bots** — utility AI, pathfinding, roles, fair perception, the three difficulty profiles | 1 human vs 9 bots is a real, winnable, losable match; an `Easy` team loses to a `Hard` team in a bot-vs-bot run |
| **M5** | **Bonuses** — all 8, timers, team-scope banners, mines | Bonuses meaningfully swing matches; nothing crashes on `GRENADE` |
| **M6** | **Screens & local co-op** — menu, create/join, room screen with live preview, settings, second seat | Two people play with bots on one keyboard, picking their own slots |
| **M7** | **Multiplayer** — PeerJS star, room code, protocol, host loop, client prediction, slot claiming over the wire, drop handling | Two devices on different networks play the same match by code |
| **M8** | **Mobile** — touch controls, orientation gate, quality tiers, safe areas | A full match played on a phone at 60 fps |
| **M9** | **Content & polish** — the two remaining maps, audio, effects, kill feed, balance pass | Five maps, sound, and a tuned game |
| **M10** | **Ship** — GitHub Pages deploy, README, invite links, first playtest round | Anyone can open a link and play |

**Cross-cutting from M0:** `config.ts` holds every tunable; the simulation stays free of rendering
and networking imports (so it can be run headless in tests); a `?debug=1` overlay shows tick rate,
fps, draw calls, and net stats.

**Testing:** unit tests for the grid, collision, rules, protocol round-trips, and map validation;
a headless determinism test running the same input log twice and diffing final state; a headless
bot-vs-bot soak (100 matches) that asserts every match terminates and no invariant breaks.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| 10-player star strains a home uplink | Binary deltas at 15 Hz keep the host near 50 KB/s up; ping is visible so the best-connected player hosts |
| Public PeerJS broker has no SLA | Failures are surfaced clearly; broker host/port/key are configurable; README documents self-hosting |
| Strict NAT blocks WebRTC | Google STUN handles most cases; TURN is out of scope, and the failure is reported honestly rather than hanging |
| Mobile perf with 10 tanks + effects | Tilemap batching, pooled effects, quality tiers, an FPS probe that downgrades automatically |
| Team balance is hard to tune with few testers | Bot-vs-bot soak runs surface degenerate strategies; every number lives in `config.ts` |
| Scope creep on the room screen | Slot picking + preview is the only pre-match feature; chat, profiles and stats are out of scope |

## 15. Out of scope

Host migration · dedicated/relay servers and TURN · accounts, persistent stats, ranking ·
matchmaking or a public room browser · in-game text/voice chat · a map editor · spectator mode for
non-participants · replays · anti-cheat beyond host validation · portrait mobile layout · more than
2 local seats · game modes other than base attack.

## 16. Open questions

- Should upgrade levels persist through death (spec says yes) or reset like Battle City? Decide after
  the M4 playtest.
- Are 25 respawns right for 10 minutes, or should the pool scale with team size?
- Does `GRENADE` wiping all 5 enemies feel great or miserable at this team size? Possible fallback:
  it only kills enemies in your half.
- One shared bonus pool, or team-side spawns to reduce center-map snowballing?

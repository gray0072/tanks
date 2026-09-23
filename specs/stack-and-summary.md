# Stack and product summary

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 0. Stack

| Tool | Version | Role |
|---|---|---|
| TypeScript | ^5.6 | The whole codebase; `npm run build` type-checks before bundling |
| PixiJS | ^8.20 | WebGL renderer for the arena — sprites, layers, effects. No DOM in the hot path |
| PeerJS | ^1.5 | WebRTC DataChannel wrapper: room codes map to peer ids, star topology (§9) |
| Vite | ^5.4 | Dev server and production bundler; `base: "/tanks/"` for GitHub Pages |
| tsx | ^4.19 | Runs the `.ts` test suites and `scripts/checkMaps.ts` under plain Node |
| node:test | Node 20 | Test runner for `tests/` (via `scripts/runTests.mjs`, which does the globbing) |
| gh-pages | ^6.3 | Manual publish of `dist/` to the `gh-pages` branch |

No UI framework, no state library, no CSS framework, no asset pipeline: screens are hand-rolled DOM
(§6), state lives in the `Sim` and the `RoomController`, and every texture is generated procedurally
at boot (§7).

---

## 1. Product summary

| | |
|---|---|
| Genre | Top-down arena tank shooter, team-based |
| Match | **Blue** vs **Red**, team size set by the loaded map. Empty slots are filled by bots (`Easy1`, `Medium2`, …) |
| Objective | Destroy the enemy flag, or run the enemy team out of respawns |
| Session length | 5–10 minutes |
| Platform | Browser: desktop (keyboard) and mobile (touch). No install, no accounts |
| Multiplayer | Peer-to-peer over WebRTC, join by a 6-character room code. No server to run |
| Local co-op | Two players on one machine — WASD and Arrow keys |
| Render | **PixiJS** (WebGL, Canvas2D fallback) |
| Hosting | Static build on GitHub Pages |

### Design pillars

1. **Readable at a glance.** The whole arena is on screen at once — no camera scrolling. What you
   see is what everyone sees.
2. **Battle City, but a team sport.** Familiar terrain and power-ups, re-scoped around two bases,
   two teams, and shared objectives.
3. **Zero friction to play.** Open a link, type a code, take a slot. No login, no download, no
   dedicated server.
4. **Same game on a phone.** Touch controls are a first-class input, not a port.

# Agent notes — Tanks project

Working notes for picking this project back up quickly. Not a design doc (that's `SPEC.md` plus
`specs/`) and not
a user-facing doc (that's `README.md`) — this is context for *how to work on it* efficiently.

## What this is, current status

Browser team tank battle in the spirit of *Battle City* (team size comes from the loaded map — 5 a
side on the built-ins, 1v1 on the debug map) — destructible terrain, power-ups, a flag
each team defends. TypeScript + PixiJS (WebGL) + PeerJS (WebRTC, star topology) + Vite, no backend,
static hosting on GitHub Pages.

**The spec — `SPEC.md` (an index) plus the section files in `specs/` — is the authoritative design
doc and must stay in sync with the code** — not a one-time
planning artifact. It already has explicit "As implemented" callout boxes wherever the real code
deviates from the original design (JSON wire protocol instead of binary, full snapshots instead of
deltas, simplified client-side interpolation instead of full prediction/reconciliation). Read those
before assuming the spec's prose is what's actually running.

**Status as of 2026-09-06:** rewrote the whole thing from an earlier 2–4 player Canvas2D prototype to
the current PixiJS/team design; verified working end-to-end (menu → create room → claim slot →
set bot difficulty → local co-op seat → ready → start → live team match with bots, terrain, bonuses,
kills, HUD). Followed by a bug-fixing pass: tank hitbox shrunk below its 32px slot + auto-center
assist (tanks were snagging in same-width corridors), tank sprite redrawn with tracks + barrel,
wall-hit/destruction VFX added, ally-vs-enemy forest concealment, bot stuck-detection with randomized
escape. Multiplayer (PeerJS) is implemented and type-safe but not yet tried across two
real devices — that's the natural next verification gap.

**2026-09-20:** mobile controls rebuilt (SPEC §5.3): the fixed d-pad/fire buttons are gone, replaced
by two full-height touch zones over the arena — a floating stick under whichever thumb lands on the
movement half, tap-anywhere-to-fire on the other, `MINE` in the outer corner. Pointer Events with
per-zone capture (the old `e.touches[0]` version let a second finger hijack the stick). Added a
fullscreen mode (SPEC §5.4, `util/fullscreen.ts`): automatic on match start on touch with a landscape
orientation lock, plus toggles in the match top bar and on the main menu. Along the way, mine-laying
became edge-triggered in `Sim.stepFiring` — holding the control used to lay one mine *per tick*.
Verified by driving a real Chromium at 844x390 with `hasTouch` via Playwright (stick tracks, canvas
changes while driving, fire/scoreboard/pause/rotate-notice/mirrored layout all behave); not yet run
on real phone hardware.
**2026-09-22:** mobile *menu* layout pass (SPEC §5.3, "Menu screens on a phone"), verified by
driving Chromium at 412x916 and 916x412 with `hasTouch` (Poco X6 Pro as the reference device). The
headline bug: `.screen` centered with plain `justify-content: center`, so any screen taller than the
viewport overflowed in both directions and its top was unreachable — the room screen lost its header,
room code and *Leave* button entirely. Now `safe center` (with an auto-margin `@supports not`
fallback). Alongside it: `min(NNvw, …)` panel widths swapped for `min(100%, …)` (vw ignores the
screen's padding and overflowed horizontally), safe-area insets on screen padding and modals, phone
media queries, the map-picker card moved from inline styles to a `.map-card` class so those queries
can shrink it, the room's tank-preview canvas hidden while nothing is hovered, and `How to Play`
opening scrolled past its first heading because `closeBtn.focus()` scrolled the Close button into
view (now `focus({ preventScroll: true })`).

**2026-09-22 (bonus art):** bonuses got a visual identity (SPEC §4.3, "Look of a bonus"). New
`render/bonusShape.ts` is the single source: per-bonus palette, player-facing name/effect text, and
the icon as primitive ops in a unit square, rendered through PixiJS in `atlas.ts` and Canvas2D in
`preview.ts`. Pickups are now full-cell pictograms instead of lettered discs; a tank carrying a bonus
wears a spinning ring of that icon (`Arena.syncAuras`, derived from the snapshot each frame, with a
2.5 s flash for pickups that leave no per-tank state); How to Play gained a per-bonus legend of
pickup + tank-with-aura + effect, and its overlay is now near-opaque. Verified by driving Chromium
through a real match (bots picking bonuses up) and screenshotting the legend, not just `tsc`.

**2026-09-23 (menu backdrop):** the menus no longer sit on black — `src/game/menuBackdrop.ts` runs a
real bot-vs-bot match (same `Sim`, bots and `Arena`) in a canvas layer behind `#ui`, blurred and
dimmed in CSS, with a spectator camera that drifts toward the closest blue/red pair and parks it
beside the menu panel (SPEC §6.3). `createPixiApp` grew `fit: "cover"`, a per-frame `zoom` and
`setFocus(point, anchor)` for it; `Screen.backdrop = false` is how MatchScreen/EditorScreen shut it
down, and Settings has an off switch. It is on by default for
everyone: gating it on `prefers-reduced-motion` made it look broken on Windows, where that query is
true whenever "Animation effects" is off. Verified by driving Chromium at 1280x720 and 412x916 —
including the toggle round-trip and that the backdrop's WebGL context is really gone in a match.

**2026-09-23 (React):** the whole UI layer was rewritten in React/TSX. `ScreenManager` and the
`Screen` mount/unmount protocol are gone: `src/ui/App.tsx` renders one `Route`
(`src/ui/routes.ts`) and navigation is `go(route)`, with live objects a screen must keep — a
`RoomController`, the editor's `EditorDoc` — carried inside the route. The old
`src/game/screens/*.ts`, `src/util/dialog.ts` and `src/render/hud.ts` were deleted and replaced by
`src/ui/screens/*.tsx`, `src/ui/components/{Hud,Modal}.tsx` and the `useEnterKey`/`useModal` hooks
(`showModal`'s `await` shape survived as a hook). Everything below the UI — `world/`, `ai/`,
`net/`, `render/` (Pixi), `audio/`, `game/{config,settings,touchControls,menuBackdrop}` — is
untouched, and the CSS class names are the same, so `style.css` was not edited at all. The pieces
that must stay imperative stayed imperative behind refs: the Pixi app, `Arena`, `TouchControls` and
the match's `requestAnimationFrame` loop all live in one effect in `Match.tsx`, and the editor's
grid is still painted by hand onto a Canvas2D with a version counter telling React it changed.
Verified by driving Chromium at 1280x720 (menu → How to Play → create → room → match → pause →
leave; editor paint/undo/test-play round trip; library export/delete modals) and at 412x916 /
916x412 with `hasTouch` (stick, fire zone, MINE, rotate notice, auto-fullscreen), plus `npm test`
(113 pass), `tsc` and `npm run build`.

**2026-09-23 (rounds):** a match is now a **series of rounds** (SPEC §2.2), not one fight, and
**the match rules moved into the room screen**. `MatchSettings` gained `winsTarget` (1–10, default
5) and it, the round time limit (now 1–10 min, default 5, was 5/10/15 default 10), the respawn
multiplier and friendly fire are host-only dropdowns in the room, live for every guest; Create Room
keeps only what must exist before a room does (nickname, map, starting bot difficulty), and
`settings.ts` still remembers a set per map. The room screen lost its tank preview (and
`render/preview.ts` its `drawTankPreview`) — same silhouette whatever slot you take, so it was
spending the panel's scarcest space on nothing.

Round flow: the host books the round (`world/series.ts` — pure, headless, `tests/rounds.test.ts`),
holds a 3 s intermission in its own frame loop *without* stepping the Sim, then builds a fresh `Sim`
for the next round. Two new wire messages, `roundEnd`/`roundStart`; `matchEnd` gained the series
score. `Match.tsx` rebuilds its `Arena` on `roundStart` (a round of cell-by-cell terrain edits can't
be un-patched) and shows the intermission overlay; the result banner is `BLUE WINS 2:0`.

**There are no drawn rounds, by type as well as by rule** — `winner` is `TeamId | null` everywhere,
`null` only meaning "still playing". A round the clock ran out on goes on respawns left, then on
which team's nearest living tank got closest to the enemy flag (`Sim.flagDistances`), and if both
tie the round runs past its clock in `suddenDeath` until something separates them. That last rung is
not theoretical: two even bot teams on a mirrored map tie on frags *and* respawns routinely — an
earlier version of this feature replayed drawn rounds and a bot room on `classic` with ×0 respawns
looped forever, drawing 3:3 with 2 alive each on every seed.

Create Room shrank to nickname + map + `Create`; its map card gained the map's blurb (now
`MAP_SOURCES[].blurb`, no longer a copy of the same strings in `MapLibrary.tsx`) and the whole card
opens the picker, which is why `useEnterKey` now also leaves `role="button"` alone — otherwise
`Enter` on the focused card both opened the library and created the room.

**The room's bot-difficulty chips were dead, and not because of the chips.** `RoomHost` hands its
own live `slots` array to `onRoomState` and mutates the `Slot` objects in place, so the reference
never changed and React bailed out of re-rendering: a difficulty change (all or per-slot), a claim,
a ready tick and a kick were all invisible to the host until something else forced a render.
`RoomScreen` now copies (`setSlots([...nextSlots])`). While there: the chips are gated on `isHost`
for real instead of only being styled `disabled` — a guest's click used to reach the host, which
applies `setBotDifficulty` from any peer (that host-side trust gap is untouched and still open).

Verified by driving Chromium: rules edited in the room (`/2`, 1 min, ×0) → round end → overlay →
round 2 with every brick back and the clock reset → `BLUE WINS 2:0`, settings still set on the way
back to the room, plus the same at 916x412 with touch. The old `×0`-respawn stall now resolves on
the first round.

Don't trust this paragraph's specifics for long; read the current code and git log, this rots fast.

## How to work with this project

- **Full rewrites are welcome when the spec and code diverge — don't patch around a mismatch.**
  Already granted for this project: bring the code in line with the spec, up to and including
  deleting and rewriting whole subsystems, rather than reconciling them. Don't ask again.
- **Verify by actually running it, not just `tsc`/build passing.** Type-checking proves the code
  compiles, not that the feature works — several reported bugs (stuck tanks, missing VFX, forest
  visibility) typed and built cleanly but were still wrong. See Testing below.
- **Requests tend to arrive as dense, multi-part messages, often in Russian, bundling several
  unrelated asks in one go, no numbering.** Parse into a checklist before starting and address every
  item — don't drop one because it seems minor next to the others. Docs/code/comments in this repo
  are English-only regardless of the language a request came in.
- Git commits: one-line subject only, no body, no Co-Authored-By trailer (global rule, applies here).

## Testing

`npm test` runs the committed headless suite (`tests/`, node:test via `tsx` — see
`scripts/runTests.mjs`, which exists because Node 20's `--test` won't glob or discover `.ts`):

- `tests/movement.test.ts` — tank movement: travel speed per direction and surface, collision
  against terrain/tanks/world bounds, ice sliding, and the turning/corner-assist rules. The
  headline invariant is that an **unobstructed turn never moves the tank's center on the cross
  axis** (see `Sim.cornerAssist`); regressing that makes the sprite visibly jump sideways.
- `tests/mapFormat.test.ts` — the map format's size/roster flexibility: a 2x2 map (the `MIN_MAP_W`/
  `MIN_MAP_H` floor) parses and plays, anything smaller or lopsided is rejected. Guards the claim in
  SPEC §3.5 that nothing in the engine is tied to the built-ins' 33x25 / 5-a-side shape.
- `tests/botNavigation.test.ts` — a full bot-vs-bot match on every production map, asserting no
  bot is wedged. The guard on movement changes that only show up under real pathing.
- `tests/controls.test.ts` — the input rules the touch layer and the keyboard share: mine-laying
  fires on the press edge (holding the control lays one mine, not one per tick) and the stick's
  continuous angle resolves to the right one of the 8 `Dir`s across each whole sector.
- `tests/mapEditor.test.ts` — the level editor's document model (`world/maps/editorModel.ts`):
  painting, the terrain-only rectangle fill, entity semantics (a flag *moves*, a spawn toggles and
  is capped), resize with an anchor, and the rule that **one gesture is one undo step**.
- `tests/rounds.test.ts` — the round series (SPEC §2.2) and how a timed-out round is decided: the
  score moves and the target ends the match, the score reads winner-first, stats accumulate across
  rounds, and `checkWinByTime` walks respawns → distance to the enemy flag → sudden death. The one
  that matters most is **"dead level goes to sudden death rather than a draw"**: a draw is the one
  outcome that could stall a series forever, so it must stay unreachable. The series rules are
  deliberately in `world/series.ts` rather than in `net/host.ts` so they can be tested without a
  browser.
- `tests/mapValidation.test.ts` — the editor's map rules (`world/maps/validateMap.ts`). The one that
  matters most is last: **every built-in map must produce zero errors** — a rule that rejects
  `classic` is a wrong rule, however sensible it reads.
- `tests/customMaps.test.ts` — the custom-map library's localStorage layer against a stubbed
  `localStorage`: copy naming, delete, corrupt-entry tolerance, and that a *save* fails loudly on a
  full quota (a silent one loses the player's map).
- `tests/bots.test.ts` — bot tactics per difficulty (SPEC §10): objective play, shooting through
  brick, bonus behaviour, fair perception, rate of fire, and an integration test that plays
  full bot-vs-bot matches and asserts **Hard > Medium > Easy**. That last one is the important
  one — every individual behaviour can look right while the profiles still rank backwards in a
  fight, which is exactly what was happening.

There's still no project `/run` skill, so anything the suite doesn't cover (rendering, netcode, the
touch overlay's layout and gestures) is still verified ad hoc:

- **Dev server:** `npm run dev` (Vite, port 5173) — served at **`http://localhost:5173/tanks/`**, not
  the bare root, because `vite.config.ts` sets `base: "/tanks/"` for GitHub Pages. Poll
  `curl -sf http://localhost:5173/tanks/` until it responds — don't blind-sleep. `lsof -ti:5173 |
  xargs kill` does **not** work here: stale Vite servers survive it, Vite silently takes 5174, 5175,
  … and the old one on 5173 answers with `504 (Outdated Optimize Dep)` and a blank `#ui`. Find them
  with `netstat -ano | grep LISTENING | grep :517` and kill by PID with `taskkill //PID <pid> //F`,
  then `rm -rf node_modules/.vite` if the 504 persists.
- **Driving it:** `chromium-cli` is not available in this Windows/Git-Bash environment. Fall back to
  Playwright: `npx playwright install chromium` (binaries were already cached under
  `~/AppData/Local/ms-playwright` last time), then a small Node script using
  `import { chromium } from "playwright"`. The `playwright` npm package itself isn't a project
  dependency — install it inside the scratchpad directory, isolated from this repo's own
  `package.json`, not the project root.
- **Map validation outside the browser:** `npm run maps:check` runs `scripts/checkMaps.ts` via `tsx`,
  validating every built-in map (plus the debug map) with the same parser the game uses, no browser
  needed.
- **Headless behavioral tests:** everything under `world/` and `ai/` has zero
  Vite-specific imports (only `world/maps/loader.ts` does, an `import.meta.env.DEV` check — which is
  why `tests/` builds maps with `parseMap` directly; the maps themselves are plain `.ts`
  template-literal exports, not raw-text file imports, so `mapFormat.ts` and the map files run under
  plain Node fine), so any of it can be exercised from a plain Node script or a new
  `tests/*.test.ts` — useful for verifying collision/movement/AI behavior deterministically instead
  of trying to catch a transient effect in a screenshot. Watch out for self-inflicted bugs in the
  test scenario itself
  (e.g. overlapping spawn points, a killed test tank respawning next tick because `respawnT` wasn't
  set) — trace tick-by-tick before concluding the product is broken.
- Worth doing early next session if more verification is needed: run `/run-skill-generator` to turn
  the above into a proper committed project skill instead of rediscovering it each time.

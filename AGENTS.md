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

**2026-09-23 (joining and leaving):** two membership bugs, and the first real two-browser
verification this project has had.
- An invite link **auto-connected**: `JoinRoom` called `join()` from an effect whenever
  `prefillCode` was set, so the form flashed past and the player was seated under a
  `randomGuestNickname()` they never saw, with no way back. A link now resolves to the join form
  (`deepLinkRoute` in `ui/routes.ts`, extracted from `main.tsx` so it is testable), code filled in,
  focus in the name field with the suggestion pre-selected.
- A guest that **closed its tab stayed in the roster forever**. `conn.on("close")` is not
  dependable. Fixed on both sides (SPEC §9.4): both peers destroy themselves on `pagehide` (the
  event a discarded mobile tab still fires, unlike `unload`), and the host additionally polls each
  connection's `RTCPeerConnection.connectionState` once a second through `net/liveness.ts`
  (`PeerWatchdog`: `failed`/`closed` drop at once, `disconnected` gets an 8 s grace so a roaming
  phone's ICE blip doesn't end its match). Both go down the existing `onPeerLeave` path.

Verified with two real Chromium contexts against the dev server (PeerJS's public broker, so this
needs internet): link → form → name → seated on the host; closing the guest's *tab* removed it in
under 6 s, and killing the whole context — nothing fires — had Chromium report `disconnected` at
~10 s with the watchdog dropping it ~8 s later. Worth knowing for the next session: `guest.close()`
and `guestCtx.close()` in Playwright exercise *different* code paths here, and only the second one
tests the watchdog.

**2026-09-23 (being thrown out):** a kicked guest kept looking at the lobby. Both halves were
missing: `kickSlot` only closed the socket (`net.kick`) and never sent the `kicked` message the
protocol already defined, and no screen listened for it either — `RoomCallbacks.onKicked` existed
and was wired to nothing. Now the host sends `kicked` and closes `KICK_CLOSE_DELAY` (0.25 s) later
so the message is really on the wire, and `RoomClient` funnels *both* a kick and a lost host into
one idempotent `onLeft({ reason, kicked })` which stops the input loop, clears `lastMatchStart` and
reports why; lobby, match and result all destroy the room and `go({ k: "menu", notice })`, and the
menu renders the notice. The same fix covers the host closing its tab, which stranded guests the
same way.

**There is now a way to test netcode.** `RoomHost` and `RoomClient` take an optional transport
factory (`HostTransport`/`ClientTransport`, `peer.ts`); production passes nothing and gets PeerJS,
`tests/kick.test.ts` passes a loopback and drives the two **real** room objects against each other.
Two things to know if you write more of these: `net/host.ts` imports fine under plain node (PeerJS
touches nothing at module load, and `listMaps()`'s `import.meta.env.DEV` only runs in a catch that
valid built-ins never reach), and `RoomClient` needs `requestAnimationFrame` stubbed on
`globalThis` or its input loop throws.

Verified in two Chromium contexts as well: kick → the guest lands on the menu reading "The host
removed you from the room." while the host's roster shows the slot back as a bot; host closes its
tab → the remaining guest gets "The host left — the room is gone."

**2026-09-23 (room codes you can keep):** the host may now name its room — `SERGEY`, `DVOR` — and
the choice is remembered (`UserSettings.roomCode`) and pre-filled, so one invite link keeps working
instead of six fresh characters being dictated every time. Codes widened to **3–12 of `A-Z0-9`**
for anything typed, while `generateRoomCode()` keeps the narrow look-alike-free alphabet: a
generated code gets read out loud, a chosen one doesn't. Collisions now split by who chose: a
generated `unavailable-id` is silently regenerated (which is what SPEC §9.2 always promised and
nothing implemented), a chosen one reports through `onLeft` rather than quietly hosting under a
different code. `RoomHost`'s constructor became an options object on the way past — it was up to
five positional parameters.

Two things worth keeping in mind here. A reload really does free the peer-id at once (the `pagehide`
teardown from the previous entry is what makes reclaiming the same code work), so **no auto-hosting
on load** was added on purpose: a reloaded host can't resume its match and guests don't
auto-reconnect, so opening a room unasked would be surprising, not helpful. And a deep link's code
is validated but **never truncated** — `normalizeRoomCode` caps typed input, `cleanRoomCode` does
not, because silently cutting a link's code to 12 characters would send the guest to a *different*
room. That one surfaced as a test failure when the length rule changed, which is exactly what the
test was for.

Verified in three Chromium contexts: room opened on `SERGEY`, guest joined via `?room=sergey`, a
second host asking for `SERGEY` got "already in use" instead of a silent re-code, and the first host
reloaded and re-opened `SERGEY` with the field already filled.

**2026-09-23 (telling yourself apart, and broken brick):** two rendering fixes.
- **Your own tank** now wears a gold chevron and a gold nickname (SPEC §7, `OWN_TANK_COLOR` in
  `render/arena.ts`); `ArenaOptions.mySlots` carries the slot ids and `Match.tsx` fills it from
  `room.mySlots()`. The marker lives in its own `selfLayer` **above the wall layers**, not inside
  the tank's container — the first version parented it to the tank and it was invisible half the
  time, because brick and steel draw over tanks (SPEC §3.3) and a tank standing against a wall has
  the cell above it covered. The menu backdrop passes no `mySlots`, so nothing there gets one.
- **Brick** is now a masonry-course tile whose damage is a crack pattern spreading over the whole
  cell (one fissure → branches → a web with chips), darkening per hit, instead of quadrants
  disappearing in a fixed TR→BL→TL order. The sim only stores a quarter *count* (`grid.ts`), so the
  old art was pointing at corners nobody had shot.

Verified by driving Chromium at 1280x720 through a real match (arrow visible over the wall above my
tank, cracked cells in the walls the bots had shot) plus a throwaway page rendering all four brick
stages side by side; `npm test` (113), `tsc`, `npm run build`.

**2026-09-29 (editor zoom):** the level editor's grid was a fitted canvas at 8–32 px a cell —
on a phone a 33x25 map came out ~11 px and missed taps. The canvas now fills the whole pane and
draws through a camera (`src/ui/editorCamera.ts`, pure, `tests/editorCamera.test.ts`): wheel/pinch
zoom, Space/middle/two-finger/Pan-tool panning, a minimap while zoomed, and a Whole/Back toggle
(`F`) that previews the full map and returns to the same view. A second finger mid-stroke cancels
the stroke (`EditorDoc.cancelStroke`) and becomes a pinch. Layout: size/anchor + problems moved
into the left column under the palette so the pane gets the full height. Verified by driving
Chromium at 1280x720 (wheel zoom, paint, Space-pan, peek round-trip) and at 412x916 / 916x412 with
touch (CDP two-finger pinch), plus `npm test` (163), `tsc`, `npm run build`. Not tried on real
phone hardware.

**2026-09-29 (constants):** every gameplay number now lives in `src/game/constants.ts`, grouped by
subsystem (players, map, tank, shooting, bonuses, respawns, rounds, sim, touch, bots, net, editor) —
including the tuning that used to sit as module-locals in `ai/bot.ts` (now `BOT_*`), `ai/teamPlan.ts`,
`world/rules.ts` (`ASSIST_WINDOW`), `world/grid.ts` (`BRICK_QUARTERS`) and `touchControls.ts`
(`TOUCH_*`). `game/config.ts` keeps only ids, labels and `DEBUG`. Purely cosmetic numbers (render,
menu backdrop, editor camera) stayed next to their code. The spawn cap is now
`MAX_PLAYERS_PER_TEAM = 20` (was `EDITOR_MAX_SPAWNS_PER_TEAM = 16`), enforced by the editor brush and
the validator, and `TEAM_SIZE` is gone: there is no default roster, `createDefaultSlots` requires
both team sizes and every caller takes them from the map's spawns.

**2026-09-29 (bonus rate):** the bonus drop rate is a room setting, `bonusesPerMinute` (1–10,
default 6; was a fixed 20–30 s gap, ~2.4/min), and every round opens with one bonus already on the
field (SPEC §4.3). `tests/bonusRate.test.ts` covers both. Worth knowing: the difficulty-ladder test
in `tests/bots.test.ts` failed on this change, and not because of it — over 8 seeds a map Hard
beats Medium by only ~2–4 % at *any* rate, and the old 2 seeds happened to favour Hard. It now
plays 8 seeds. Hard's thin edge over Medium is a real bot-tuning gap, still open.

**2026-09-29 (bots and respawns):** three fixes (SPEC §10, §2.3, §8).
- **Bot tuning.** Reaction times are human-scale (Easy 0.6 s, Medium 0.35 s, Hard 0.2 s — Hard was
  90 ms) and now also gate dodging: a bullet younger than that hasn't been "noticed". Easy is
  sloppier and slower on the trigger, but its brick cost is `BOT_LAST_RESORT_BRICK_COST` (25), not
  Infinity, so it goes round brick when it can and shoots through when there's no way round.
  Ladder over 8 seeds: Hard vs Medium went from +2 % to +20 %, Medium vs Easy stayed ~1.6 : 1.
- **Jitter.** Measured with a throwaway harness that tags which branch chose each bot's direction
  and counts A→B→A reversals within 4 ticks: ~1.0 per bot per second, now ~0.1. Three sources, each
  now committed to for a beat: path following re-picking the larger axis every tick (a
  Right/Down staircase), aim error re-rolled every tick (a marginal target flicking in and out of
  the lane), and dodges alternating sides.
- **Respawns** went to the team's *first free* spawn, so nearly everyone came back on spawn #1; now
  each slot returns to its own (`Sim.homeSpawn`). The "flash somewhere else first" was the renderer
  interpolating a respawned tank from its death position (`Arena.tick`).

**2026-09-29 (team plan, shovel, flag):**
- **Team plan** (`ai/teamPlan.ts`, SPEC §10.1) rewritten: per round each team draws a posture
  (aggressive/balanced/defensive) that splits its bots into defend/midfield/attack for any team
  size (`roleCounts`), and deals attackers and midfielders onto up to three lanes. Attackers stage
  at mid-map on their lane before turning on the flag; midfielders patrol (`Hold`); defenders
  spread in front of the flag. The plan is cached per `Sim` in a WeakMap (a round is a Sim), drawn
  from `sim.rng`; `computeTeamRoles` now returns `Map<slot, Assignment>` (`{ role, lane }`).
  `tests/teamPlan.test.ts`.
- **SHOVEL** rebuilds the flag pocket *as the map built it* (shot-out cells too), reverts it to
  fresh brick, skips a cell a tank stands in, and is never dropped unless both flags have a pocket
  (`Sim.bonusKinds`). `tests/shovel.test.ts`.
- **The flag waves** — it never did before; the request was that it shouldn't wave *fast*, so it's
  one gentle wave per 2.6 s. The atlas now holds only the pole (`flagPole`).

**2026-09-29 (cloud maps):** optional Google sign-in in Settings syncs the custom-map library
through Supabase (SPEC §6.4), modelled on `D:\Projects\my\swedish` (same env var names, PKCE,
"a failed fetch must throw, never read as empty"). Differences on purpose: one row per map rather
than one save blob, and local tombstones (`tanks.customMapsDeleted`) so deletes propagate.
`src/cloud/` holds it; `mapSync.ts` is DOM-free behind a `MapsRemote` interface and tested with a
two-device fake (`tests/mapSync.test.ts`). The Supabase side is `supabase/schema.sql`; keys come from
`.env.local` locally and Actions secrets in `deploy.yml`. **Not yet verified against the real
project** — only against a fake cloud and a dummy URL (sign-in reaches `/auth/v1/authorize` with
PKCE and the right redirect).

Two test-harness bugs surfaced on the way: `botFixture` counted shots by new bullet ids, which
misses every point-blank shot (the bullet hits within the tick it's born) — it now counts cooldown
resets; and the lead test's score was, with a helmeted target, only measuring flag damage.

**2026-09-29 (spectating, grenade, grass):**
- **Renamed custom maps kept their old name** in Create Room and the room: `loader.ts` cached parsed
  maps by template only, and a rename leaves the template alone. The cache key now includes the name.
- **Spectating** (SPEC §6.1): clicking your own last slot hands it to a bot; you stay in the room
  with no slot and can hire any bot slot back. `RoomHost.doRelease` no longer refuses the last
  primary slot. A spectator's match shows everything (forest hides nobody) and has no touch controls.
- **GRENADE** (SPEC §4.3, `world/grenade.ts`) is no longer "kill every enemy": lobbed at the biggest
  enemy knot, blast radius scaled by √(map area), a 0.55–1.2 s flight with a visible landing ring,
  and at most ⌈enemy team / 2⌉ kills. Bots value it by what the blast would catch.
- **Grass ground** (`render/ground.ts`): one map-sized Canvas2D texture (low-res value noise scaled
  up + off-grid tufts/pebbles), cached per map — no per-cell tiles, so no visible grid.
- **Speaker crackle at open** could not be reproduced headlessly and nothing creates audio before a
  match, so the fix targets the likely cause, the load spike at open: the menu backdrop is capped at
  30 fps and its first start waits for an idle moment. Audio also got 4 ms attacks and the context
  is suspended between matches. **Needs confirming on the user's machine.**
- README screenshots re-shot (Playwright, 2x) for the backdrop and the grass.

**2026-09-30 (Extreme bots, mines):** a fourth difficulty, **Extreme** (SPEC §10.3), and mines
now render under tanks (the mine layer sat above the tank layer).
- Every new behaviour is a `BotProfile` flag, and the shipped profile was *picked by a league*:
  `npx tsx scripts/botLeague.ts [seeds] [--ff] [--only a,b] [--vs x]` plays full default rounds on
  all six maps, both sides (~1.5 s a round). SPEC §10.3 has the whole run. Short version: pro
  timings alone ("reflex") already beat Hard; of the teamwork ideas only call-outs, spacing, forest
  ambush and recon fire held their own, while group pushes (pincer or column) and reacting to every
  approaching enemy *lost* rounds even after retuning. They are still in the code, off.
- Team state (call-outs, who hunts whom, push staging) is `ai/teamIntel.ts`, a board per Sim.
- Friendly-fire awareness is on for Hard and Extreme. The instrument that made it work: tag every
  shot at fire time and classify each teamkill (in lane at the trigger vs teammate drove in). The
  second kind dominated, hence the movement prediction and dodging friendly bullets.
- Fixed on the way, all difficulties: a bot escaping a stuck spot fired its planned shot along the
  random escape direction.
- The ladder test's Extreme rung is on **rounds won** (`playRound` in `tests/helpers.ts`), not
  frags: Extreme trails Hard on frags in the first 75 s and still wins ~61 % of rounds. One seed a
  map was a coin toss; three is stable.
- Open: the Extreme edge from teamwork is small next to its reflexes.

**2026-09-30 (ice, editor exit):**
- **Tanks couldn't turn on ice while a key was held.** Any held direction re-armed the slide
  (`slideT`), and a turn on ice waits for the slide to run out — so a *new* direction held down
  never took effect. Bots always hold a direction, so they drove on into walls and each other and
  piled up. Now only driving the way the tank faces keeps the slide going. On `iceworks` over full
  rounds, bots on ice stood still 37-51 % of the time before, 6-7 % after (time on ice itself
  ~30 % -> ~16 %). `tests/movement.test.ts` pins it; the old ice test only checked the key-release path.
- **The editor's leave dialog had no "discard".** SPEC said Save / Discard / Cancel, only two were
  built. `Modal` has an optional third button (`altLabel`, resolves `MODAL_ALT`); `Leave without
  saving` also clears `tanks.editorDraft`.

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
- **Line endings: LF everywhere, enforced by `.gitattributes`** (`* text=auto eol=lf`). Until
  2026-09-29 the repo was a CRLF/LF mix with nothing pinning it, and scripted edits on Windows kept
  breaking it — Python's text-mode `open(p, "w")` writes CRLF, so an LF file turned CRLF and a
  one-line change showed up as a whole-file diff (two commits had to be rewritten). Now git
  normalizes whatever gets written back to LF on `git add`, so that can't reach a commit. Still,
  in scripts prefer bytes (`open(p, "rb")`/`"wb"`) or `newline=""`, so the working tree matches
  the index and `git status` isn't full of phantom changes. The normalization commit is listed in
  `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per
  clone so local `git blame` skips it (GitHub does on its own).
- **Escape sequences in heredocs become real control bytes.** A `\n` or `\r` meant as literal
  text, written through a shell heredoc into a Python string, lands in the file as an actual
  newline/CR — a lone CR made git classify `AGENTS.md` as binary. Write such text with the
  Edit/Write tools, not through a script.

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
- `tests/editorCamera.test.ts` — the editor grid's zoom/pan camera (fit, zoom-around-a-point,
  bounds, no dragging the map out of sight) and `EditorDoc.cancelStroke`, which a pinch relies on.
- `tests/roomCode.test.ts` — room codes (SPEC §9.2): a generated code is short, valid and free of
  look-alikes; a *typed* one may be a name, may contain those same look-alikes, and is cleaned up
  for case and punctuation; length bounds; the peer-id round-trip. Then, over the loopback, the
  collision rule — a generated code is replaced silently, a chosen one is reported. The
  look-alike case is the one to keep: it guards against re-tightening the typed alphabet to the
  generated one.
- `tests/netHelpers.ts` — the loopback host/guest pair the two netcode suites share.
- `tests/kick.test.ts` — the first test of the netcode itself (SPEC §9.4), over the loopback
  transport seam: a guest saying hello is seated, a kick *tells* the guest before hanging up (the
  bug was a silent socket close), the slot reverts to a bot, no other slot is touched, the close
  that follows doesn't report a second reason, a lost host is an exit too, a screen mounting after
  an exit isn't replayed back into the room, and the host can kick neither itself nor a bot.
- `tests/joinAndLeave.test.ts` — the two edges of room membership (SPEC §6, §9.4): `deepLinkRoute`
  resolves an invite link to the *join form* and never to a room (plus the code-normalising cases),
  and `PeerWatchdog` decides when a peer is gone — dead states drop at once, a brief ICE blip is
  ridden out, a sustained disconnect drops once the grace is up, recovering resets that grace, and
  peers are judged independently. The PeerJS plumbing around it still needs two real browsers; the
  rule it feeds does not, which is why the rule lives apart from `peer.ts`.
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
- `tests/mapSync.test.ts` — cloud map sync over a fake two-device cloud: a map crosses devices, a delete propagates instead of being resurrected, the later edit wins, a failed pull writes and pushes nothing.
- `tests/teamPlan.test.ts` — the team plan: role counts add up for every size and posture, the plan holds for the round, a team spreads over at least two lanes, rounds differ, and a threat pulls midfielders home.
- `tests/shovel.test.ts` — SHOVEL rebuilds the pocket (gaps too), reverts to brick, never walls a tank in, and is not dropped where a flag has no pocket.
- `tests/grenade.test.ts` — GRENADE: radius scales with the map, the half-team cap, aiming at the
  biggest knot, a flight before the blast, a tank that drives out survives, a helmet absorbs it.
- `tests/spectate.test.ts` — releasing your last slot makes you a spectator (host and guest), a bot
  slot can be hired back, a spectator doesn't block Start.
- `tests/respawn.test.ts` — a tank respawns on its own slot's spawn, or another free one of its team's if that is blocked (the bug: everyone came back on spawn #1).
- `tests/bonusRate.test.ts` — the bonus drop rate (SPEC §4.3): one bonus on the field at round
  start, and drops per minute following the room's `bonusesPerMinute` across the range.
- `tests/bots.test.ts` — bot tactics per difficulty (SPEC §10): objective play, shooting through
  brick, bonus behaviour, fair perception, rate of fire, and an integration test that plays
  full bot-vs-bot matches and asserts **Hard > Medium > Easy**, plus **Extreme > Hard** on
  rounds won. That last one is the important
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

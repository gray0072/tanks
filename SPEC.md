# Tanks — Specification & Project Plan

Team tank battle in the browser, blue against red, in the spirit of *Battle City*: destructible terrain,
power-ups, and a base flag that must be defended. Runs on desktop and mobile, joinable over the
internet by a short room code, and playable by two people on one keyboard.

> This document is the source of truth for the design. Code follows the spec, not the other way
> around. Numbers in tables are the tuning defaults — they live in `src/game/config.ts` and are
> expected to change during playtesting.

---

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

---

## 2. Match rules

### 2.1 Teams and slots

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

### 2.2 Winning

A match ends the moment any of these is true:

| Condition | Winner |
|---|---|
| A team's **flag is destroyed** | The other team (instant) |
| A team's **respawns** hit 0 and its last tank dies | The other team |
| **Time limit** expires | Team with more frags; tie broken by flag armor remaining; still tied → draw |

Defaults: **25 respawns** per team, **10 minute** limit.

### 2.3 Lives, death, respawn

- Every death costs the team **one respawn**. Respawns are a shared team pool, not per-player.
- Respawn after **3 s** at a free spawn point in the team's spawn zone, with **3 s** of spawn
  invulnerability (blinking shield). Invulnerability breaks early if the tank fires.
- When a team's respawns reach 0, its dead players become spectators; the round continues until the
  team's last living tank dies.
- Falling into water, being crushed by a shovel-wall closing, or friendly fire (§2.5) all cost a
  respawn the same way.

### 2.4 Scoring

Per-player stats tracked and shown on the scoreboard: **frags, deaths, flag damage, bonuses taken,
assists** (damage to a tank killed by a teammate within 5 s). Team score = sum of frags. Stats are
match-local; nothing is persisted server-side.

### 2.5 Friendly fire

Off by default. A lobby toggle enables it (bullets damage teammates and your own flag walls) for
groups that want it. Bots are told about the setting and stop shooting through teammates when it's on.

---

## 3. The arena

### 3.1 Dimensions

No scrolling, no camera — the whole arena is always on screen. There's no fixed size or aspect
ratio, though: the arena is exactly as big as the loaded map's template (`map.width`/`map.height`,
§3.5), up to a `MAX_MAP_W`/`MAX_MAP_H` sanity ceiling (`config.ts`). Every built-in map happens to be
33 × 25 cells, but nothing enforces that — the debug map (§3.5) is 8 × 5.

| | |
|---|---|
| Terrain grid | **map.width × map.height cells** — per-map, not fixed (33 × 25 for every built-in map) |
| Cell | 32 × 32 logical px — one cell is one tank/flag slot, matching the map format's one-character-per-cell rule (§3.5): a `r`/`b`/`R`/`B` glyph *is* a full tank-sized square, not a quarter of one |
| Arena | **map.width × map.height × 32** logical px — 1056 × 800 for the built-in maps, no fixed aspect ratio |
| Tank footprint | 1 cell (32 × 32 px) slot; the actual collision/visual body is a smaller 24 × 24 box centered in it — turning into a same-width corridor would otherwise need pixel-perfect alignment |
| Movement grid | continuous, not quantized — a corner assist pulls the cross-axis position toward the nearest cell grid line, so turning into a same-width corridor doesn't need pixel-perfect alignment. It only fires while the tank is *blocked* and only when being aligned would actually clear the way: a turn with a free path ahead must never shift the tank's center sideways, and a tank driving into a solid wall must not creep along it |

The renderer scales the arena **uniformly** — one `min()`-derived factor for both axes — and centers
it in the area below the HUD's top bar (§6.2), so the map always keeps its proportions and cells stay
square. Whatever the aspect-ratio mismatch leaves over on one axis becomes an even letterbox margin
rather than a stretch. On a phone in landscape the arena fills the screen; in portrait the game asks
the player to rotate.

### 3.2 Layout

Mirror-symmetric along the horizontal axis:

- **Blue base** — bottom center. **Red base** — top center.
- Each base: a **flag** occupying 1 cell, walled in by brick on three sides (the classic eagle
  pocket), plus a spawn zone of 5 spawn points spread across the friendly half.
- Center of the map is contested open ground with cover, water, and the richest bonus spawns.

### 3.3 Surfaces

| Tile | Tank | Bullet | Effect |
|---|---|---|---|
| `EMPTY` | passes | passes | — |
| `BRICK` | blocks | **destroys 1 quarter-cell** | Destructible in quarter-cell chunks, like Battle City. `STAR 3` bullets destroy the whole cell |
| `STEEL` | blocks | blocks | Only `STAR 3` bullets destroy it |
| `FOREST` | passes | passes | Drawn **above** tanks — hides tanks and bullets inside it |
| `WATER` | blocks | passes | Impassable; animated |
| `ICE` | passes | passes | Low friction — the tank keeps sliding ~0.4 s after the key is released and cannot turn instantly |
| `SAND` | passes | passes | ×0.55 move speed |
| `FLAG` | blocks | **destroys → match ends** | 1 cell, one per team, team-colored |

Render layer order: ground → water → ice/sand decals → bonuses → flags → tanks → bullets → brick &
steel → forest → effects → HUD.

### 3.4 Maps

**Three built-in maps today**, with two more planned for M9, each a plain template literal
(`mapFormat.ts`, §3.5) in `src/world/maps/`, selected by the host in the lobby. The three shipped
ones happen to share a 33 × 25 grid and a 5-a-side roster, but nothing in the format or the engine
requires a common size — each map carries its own dimensions and its own spawn count.

| Map | Character | Status |
|---|---|---|
| `classic` | Battle City homage: brick mazes, steel spine, water gate at midfield | §3.6 |
| `crossroads` | Four open lanes meeting in the middle, minimal cover, fast and lethal | §3.6 |
| `swamp` | Water channels and sand flats; movement is the puzzle | §3.6 |
| `fortress` | Heavy steel around both bases; grinding, siege-flavored | authored in M9 |
| `iceworks` | Large ice fields; slippery approaches, hard to hold a firing line | authored in M9 |

#### Design rules

- A flag must be **reachable** from every spawn (enforced by the automated check in §3.5).
- A flag must **not** sit in a straight, permanently-open line of fire from an enemy spawn point —
  in particular the spawn that lines up with the flag's own row/column (there's always one dead
  center, by construction). `BRICK` alone doesn't satisfy this: it can be shot away, so a lane
  guarded only by brick eventually becomes a permanent sniping corridor once destroyed. At least one
  `STEEL` cell must interrupt that sightline.
- Keep it to **reasonable obstacles**, not a maze: a single small `STEEL` chokepoint (as little as a
  1 × 2 block) is enough to break the sightline while leaving the approach otherwise open for
  maneuvering — see how `classic`, `crossroads`, and `swamp` each drop one into the open ground at
  midfield, directly on the flag-to-flag axis.
- This isn't checked by the parser (§3.5's validation is structural/reachability only) — verify a new
  map by eye, or ad hoc with a small script that raycasts from each spawn to the enemy flag over the
  parsed `MapDef` and flags any line with no `STEEL` cell on it.

---

### 3.5 Map file format

**A plain character grid, one char per cell, is exactly the right format.** Every entity — flag or
spawn — is a single character in a single cell; nothing is a 2 × 2 block. One thing the format
doesn't handle for free:

| Concern | Answer |
|---|---|
| Brick is destroyed in **quarter-cells** (§3.3) | Not a problem: brick always *starts* whole. Quarter-cell state only ever arises from damage at runtime, so it never needs to be authored. |

Team size isn't fixed either, as a consequence of the single-char rule: it's however many `r`/`b`
markers the template has — 5 a side for every built-in map (§2.1), but nothing in the format
requires that (the debug map below is 1v1). id and name aren't part of the template at all; they're
supplied by whoever registers the map (`mapSources.ts`).

#### Character set

Two classes, one rule each — **uppercase is a flag, lowercase is a player, everything else is
terrain.**

| Char | Meaning |
|---|---|
| `.` | `EMPTY` |
| `#` | `BRICK` |
| `@` | `STEEL` |
| `%` | `FOREST` |
| `~` | `WATER` |
| `-` | `ICE` |
| `,` | `SAND` |
| `*` | bonus spawn point (renders as `EMPTY`) |
| `R` | Red flag |
| `B` | Blue flag |
| `r` | Red player spawn |
| `b` | Blue player spawn |

Glyphs were picked to be visually distinguishable in a wall of 33 × 25 text — `.` reads as
whitespace, `#` as a dense wall, `~` as water — rather than as mnemonic initials, which all blur
together at this density. **Spawn priority** (a respawning tank prefers its team's lowest-numbered
free spawn) comes from **scan order** — top-to-bottom, then left-to-right — not from an authored
index; where you place the character *is* the priority.

#### File layout

A map is a single JS template literal, nothing else — no header, no separator:

```
r......*
.##..##.
.R#..#B.
.##..##.
*......b
```

A leading/trailing newline (from writing the template on its own lines between the backticks) is
stripped; what's left fixes the map's width and height directly, no `size:` field needed. Row 0 is
the **top** of the arena, which is always the **Red** side.

Out-of-bounds is solid for movement and bullets regardless of what the template says, so a border
row is optional — the three large built-in maps draw one in `@` steel because it makes the boundary
visible while hand-editing, the debug map doesn't bother.

Every built-in map is its own `.ts` file exporting one template constant (`classic.ts`,
`crossroads.ts`, `swamp.ts`); `mapSources.ts` lists them with an id and display name. Plain strings
were chosen over JSON deliberately: a 25-row grid in JSON needs a quote pair and a comma on every
line, which is exactly the kind of noise that makes hand-edited ASCII art go wrong. And because
these are ordinary `.ts` modules rather than raw-text file imports, there's no Vite dev-server
special-casing to route around either (an earlier iteration of this format used `?raw`-imported
`.tmap` files specifically to dodge Vite treating `*.map` as a JSON sourcemap — moot once the map
itself is just a string in a `.ts` file).

#### Validation

Run at load in dev and by `npm run maps:check` in CI. A failure is loud in dev and the map is
dropped from the lobby list in production.

1. Every row the same length as row 0; only known characters; width and height between
   `MIN_MAP_W`/`MIN_MAP_H` and `MAX_MAP_W`/`MAX_MAP_H` (`config.ts`). The floor is **2 × 2** — the
   smallest grid that can still hold one flag and one spawn per team; the rest of the game reads
   its dimensions and its roster size off the map, so nothing else has to change.
2. Exactly one `R` and one `B`.
3. At least one `r` and one `b`; the two counts must match each other (symmetric teams — the same
   assumption `world/rules.ts` makes when it splits stats into two contiguous id ranges).
4. **Reachability:** flood fill over tank-passable cells (treating `BRICK` as passable, since it can
   be shot through) from a red spawn must reach both flags and every spawn. This is the check that
   catches a map where a water channel accidentally seals off a base.

#### Debug map

One specific, deliberately tiny map (`world/maps/debugMap.ts`) — same format, same parser, 1 v 1
on an 8 × 5 grid — for fast local iteration:

```
r......*
.##..##.
.R#..#B.
.##..##.
*......b
```

It's kept out of the room-creation picker (`listMaps()`) and only surfaces when `config.DEBUG` is
on, which skips the menu/room flow entirely and starts a match on it immediately, offline, bots
filling every spawn but slot 0, all-default settings (`main.ts`). Never ship `DEBUG` on.

---

### 3.6 Example maps

Three complete maps, all 33 × 25, written out in full — the format has no mirroring shorthand, so a
mirror-symmetric layout (all three built-ins are) is simply typed out twice by hand.

#### `classic.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@..............#R#..............@
@.r....r.......###.......r....r.@
@...##....##........##....##....@
@..%%...........r...........%%..@
@.########...#######...########.@
@..........*.........*..........@
@....@@......@@...@@......@@....@
@........~~~~~~~~~~~~~~~........@
@.....##....%%%%%%%%%....##.....@
@...--------.........--------...@
@.............,,,,,.............@
@.............,,@,,.............@
@.............,,,,,.............@
@...--------.........--------...@
@.....##....%%%%%%%%%....##.....@
@........~~~~~~~~~~~~~~~........@
@....@@......@@...@@......@@....@
@..........*.........*..........@
@.########...#######...########.@
@..%%...........b...........%%..@
@...##....##........##....##....@
@.b....b.......###.......b....b.@
@..............#B#..............@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

Both bases sit behind a brick pocket with the border at their back. Four brick blocks and two forest
patches give the spawn area cover; a 23-cell brick wall with two gaps forms the first defensive
line, with the half's two bonus spawns in the open just behind it; steel pillars and a 15-cell water
gate force the fight into two side lanes, and the 5 × 3 sand patch at midfield carries a single
steel cell dead-center, breaking the flag-to-flag sightline (§3.4's design rules).

#### `crossroads.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@..............#R#..............@
@..............###..............@
@..r.....r.............r.....r..@
@...............................@
@.......@...............@.......@
@.......@.......r.......@.......@
@####..######.......######..####@
@.....*......%%%%%%%......*.....@
@.....@@@@.............@@@@.....@
@...~~~~~~.............~~~~~~...@
@.........####.....####.........@
@........-------@-------........@
@.........####.....####.........@
@...~~~~~~.............~~~~~~...@
@.....@@@@.............@@@@.....@
@.....*......%%%%%%%......*.....@
@####..######.......######..####@
@.......@.......b.......@.......@
@.......@...............@.......@
@...............................@
@..b.....b.............b.....b..@
@..............###..............@
@..............#B#..............@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

Minimal cover and four wide lanes converging on an open, icy center. The brick band near each base
has three gaps, so pushes commit early and get read early. The `*` pair on the flanks behind that
band draws the fight; a single steel cell at the center of the ice sits on the flag-to-flag axis,
same purpose as `classic`'s midfield pillar.

#### `swamp.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@..............#R#..............@
@..............###..............@
@.r......r.............r......r.@
@...............................@
@....,,,,,,,....r....,,,,,,,....@
@~~~~~~...~~~~~~.~~~~~~...~~~~~~@
@.......*####.......####*.......@
@........%%%%%.....%%%%%........@
@...@@@@,,,,,,,...,,,,,,,@@@@...@
@..........~~~~~~~~~~~..........@
@............,,,@,,,............@
@....--------..%%%..--------....@
@............,,,@,,,............@
@..........~~~~~~~~~~~..........@
@...@@@@,,,,,,,...,,,,,,,@@@@...@
@........%%%%%.....%%%%%........@
@.......*####.......####*.......@
@~~~~~~...~~~~~~.~~~~~~...~~~~~~@
@....,,,,,,,....b....,,,,,,,....@
@...............................@
@.b......b.............b......b.@
@..............###..............@
@..............#B#..............@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

The full-width water bands leave exactly three crossings each — two flank gaps and a one-cell center
bridge — so every attack is committed and readable. Sand slows the approach on both flanks, and a
single steel cell sits in each of the two sand strips framing the center forest, on the flag-to-flag
axis, same purpose as the other two maps' midfield pillar.

---

## 4. Tanks, weapons and bonuses

### 4.1 Tank

| Property | Value |
|---|---|
| Move speed | 84 px/s (sand ×0.55, `SPEED` bonus ×1.6) |
| Movement | 8-directional, snaps to 45° increments; the barrel points where you drive. Holding two adjacent direction keys (e.g. Up+Right) drives/fires diagonally; if a wall blocks one of the two axes, the tank strafes along whichever axis is still clear instead of stopping |
| Turning | Instant on normal ground, delayed on ice |
| Bullets in flight | 1, raised to 2 at `STAR 2` |
| Fire cooldown | 0.45 s |
| Bullet speed | 300 px/s, 420 px/s from `STAR 1` upward |
| Health | 1 hit = death (a `HELMET` shield absorbs one hit) |

### 4.2 Upgrade levels (`STAR`)

Upgrades are **per player**, kept through death (unlike the original — a 10-minute team match is too
long to reset progress on every respawn), and reset at match end.

| Level | Gains |
|---|---|
| 0 | Base tank |
| 1 | Faster bullets |
| 2 | Two bullets in flight |
| 3 | Bullets destroy steel and take a whole brick cell per hit |

### 4.3 Bonuses

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

---

## 5. Controls

### 5.1 Desktop

| Action | Player 1 | Player 2 (local co-op) |
|---|---|---|
| Move | `W` `A` `S` `D` | Arrow keys |
| Fire | `Space` | `Enter` (or `Right Ctrl`) |
| Drop mine | `Q` | `Right Shift` |
| Scoreboard | hold `Tab` | — |
| Menu / pause overlay | `Esc` | — |

Holding two adjacent direction keys (e.g. `W`+`D`) drives/faces diagonally between them. Holding an
opposing pair on one axis (e.g. `W`+`S`) resolves last-pressed-wins, same as a single direction always
did, so tapping a second key never stalls the tank.

### 5.2 Local co-op (two on one machine)

A client can claim a **second seat** from the room screen (`Add local player 2`). Both tanks are
simulated and rendered on the same client and share its network connection — from the room's point
of view they are just two more occupied slots, each with its own nickname. The seats may be placed on
the same team or on opposing teams. Bots take back both slots if the client disconnects.

### 5.3 Mobile

No fixed d-pad. The battlefield is split down the middle into two full-height touch zones, and the
whole of each zone is the control:

| Zone | Control |
|---|---|
| **Movement half** (left by default) | A **floating stick**: it has no home position — it appears wherever the thumb lands and follows the drag, giving any of the 8 `Dir` values. Lift to stop. |
| **Fire half** (right by default) | **Tap anywhere to fire, hold to keep firing.** No aiming — the tank shoots where it faces, so the whole half can be one button. |
| `MINE` button | The one fixed widget, in the outer bottom corner of the fire half, inside the safe area. |

Why a floating stick rather than a d-pad in a corner: a phone held in landscape gives the thumbs a
small, *unpredictable* arc, and a fixed pad means looking away from the fight to find it. Putting the
origin under the thumb, wherever that is, means never looking down — the pattern Minecraft's mobile
build uses, for the same reason.

- **Dead zone** — 14px from the origin. Inside it the stick reads as "stop", so the tank can be held
  still without lifting the thumb.
- **Origin follow** — past 52px of travel the origin is dragged along behind the thumb at exactly one
  radius, so a long swipe never runs out of stick and never needs a re-grab.
- **Tap-to-fire latch** — a tap is shorter than `FIRE_COOLDOWN`, so a bare press-and-release gets
  swallowed whenever it lands mid-reload. A tap therefore holds `fire` for one full reload: every tap
  produces exactly one shot, fired the instant the gun is ready.
- **Pointer Events with per-zone pointer capture**, not touch events. Each thumb gets an independent
  stream; a second finger landing on the fire side cannot hijack the stick.
- `touch-action: none` on the zones — the browser never claims a drag as a scroll or a double-tap as
  a zoom.
- **Scoreboard, fullscreen and the pause menu are buttons in the top bar** (§6.2), the touch
  equivalents of `Tab` / `Esc`, which a phone doesn't have. The scoreboard button is a toggle, not a
  hold — there is no spare thumb.
- **Layout mirrors** for left-handed players (Settings → *Movement stick side*): the two halves and
  the `MINE` button all swap sides.
- The overlay is mounted on the **arena**, not the viewport, so the zones map exactly onto the
  battlefield and leave the stats bar and the system gesture strip above it alone.
- Portrait shows a "rotate your device" screen with a **Fullscreen & rotate** button — the arena is
  16:10 and unplayable portrait, and an orientation lock can only be taken while fullscreen (below),
  so offering fullscreen there is offering the rotation.
- Local co-op is desktop-only.

#### Menu screens on a phone

The match screen is landscape-only, but every menu screen has to work at both a 412x916 portrait and
a 916x412 landscape viewport (a Poco X6 Pro is the reference device).

- **Every scrolling screen centers with `justify-content: safe center`, never plain `center`.** With
  plain `center`, content taller than the viewport overflows equally in both directions and the part
  above the top edge cannot be scrolled back into view — on a phone that silently ate the room
  screen's header, room code and *Leave* button. The same rule applies to the modal overlays
  (How to Play, scoreboard, pause), which center a body that can be taller than a landscape phone.
- **Panel widths are `min(100%, …)`, not `min(NNvw, …)`.** `vw` ignores the screen's own padding, so
  a `92vw` panel inside a 24px-padded screen overflows horizontally on a narrow viewport.
- **Safe-area insets on the screen padding and the modal overlays** — the viewport is
  `viewport-fit=cover`, so a landscape notch would otherwise sit on top of the content.
- Two media queries do the squeezing: `max-width: 560px` (portrait — tighter padding, one-column
  room layout, two map cards per row, capped preview thumbnails) and
  `max-height: 520px and (orientation: landscape)` (a landscape phone is ~410px tall, so the
  subtitle and the map blurbs go and every fixed vertical cost shrinks).
- The room screen's **tank preview canvas is hidden while nothing is hovered** — a touch device
  never hovers, so an always-present blank 300x190 canvas only pushed *Start match* off the bottom.

### 5.4 Fullscreen

Browser chrome costs a landscape phone roughly a fifth of its height, and the URL bar's show/hide
animation resizes the arena mid-fight. Fullscreen is therefore the intended way to play on a phone.

- **Automatic on match start**, touch devices only, controlled by Settings → *Fullscreen on match
  start* (on by default). On entering fullscreen the game also asks for an **orientation lock to
  landscape**, which is only grantable while fullscreen.
- The request is **refused outside a user gesture** — which is exactly the case for a guest whose
  match was started by the host. When the immediate attempt fails, the player's next touch on the
  match screen is armed to do it instead.
- **Manual toggle** in three places: the `⛶` button in the match top bar, a `Fullscreen` button on
  the main menu, and the `Fullscreen & rotate` button on the portrait notice. The menu one matters
  because a phone has no `Esc` to leave fullscreen with.
- Fullscreen **persists across screens** — match → result → menu — rather than dropping out between
  matches. Exiting unlocks the orientation.
- Every call is treated as *may fail and that's not an error*: iPhone Safari has no element
  fullscreen at all, and desktop browsers refuse the orientation lock. The portrait notice stays in
  the product precisely because the lock can't be relied on.
- Vendor-prefixed spellings (`webkit*`, `ms*`) are handled in `util/fullscreen.ts`; nothing else in
  the codebase touches the Fullscreen or Screen Orientation APIs directly.

---

## 6. Screens

Screens are a stack managed by `ScreenManager`; exactly one is active and rendered per frame.

1. **Main Menu** — logo, `Create room`, `Join room`, `Settings`, `How to play`.
2. **Create room** — nickname, map picker (thumbnail + name + terrain summary), match settings
   (time limit, respawn count, friendly fire, **default bot difficulty — `Medium`**), `Create`.
   Produces the room code.
3. **Join room** — nickname, 6-character code field (auto-uppercase, auto-advance, paste-aware).
   A `?room=CODE` deep link skips straight here with the code filled in.
4. **Room / slot picker** — the heart of the pre-match flow, see §6.1.
5. **Match** — the arena plus HUD (§6.2).
6. **Scoreboard overlay** — held `Tab` or a HUD button; per-player stats, ping, team totals.
7. **Result** — winner banner, final scoreboard, MVP line, `Rematch` (host) / `Back to room`.
8. **Settings** — sound and music volume, render quality (auto/low/high), movement stick side
   (§5.3), fullscreen-on-match-start (§5.4), nickname, show-ping toggle.
9. **Disconnected overlay** — reconnect progress and a `Back to menu` escape hatch.

### 6.1 Room screen and slot preview

```
┌───────────────────────── ROOM  K7QM2X  [copy] [invite link] ──────────────────────┐
│   All bots: [ Easy | ✦Medium | Hard ]   blue ▾   red ▾                             │
│   BLUE  (3 humans)                     │  ┌──── PREVIEW ────────────────────────┐  │
│   ▸ 1         Sergey        host  ✔    │  │                                     │  │
│   ▸ 2  Medium Medium2       bot   ✔    │  │      [ map thumbnail, live ]        │  │
│   ▸ 3         Nina          44ms  ✔    │  │   spawn point of the hovered slot   │  │
│   ▸ 4  Hard   Hard4         bot   ✔    │  │   highlighted, flags marked         │  │
│   ▸ 5  Medium Medium5       bot   ✔    │  │                                     │  │
│                                         │  │   ┌───────┐  slot 2 · BLUE         │  │
│   RED   (1 human)                       │  │   │ tank  │  currently: Medium2    │  │
│   ▸ 1  Easy   Easy1         bot   ✔    │  │   │preview│  → you                  │  │
│   ▸ 2  Easy   Easy3         bot   ✔    │  │   └───────┘                         │  │
│   ▸ 3         Oleg          61ms  ✔    │  │                                     │  │
│   ▸ 4  Easy   Easy6         bot   ✔    │  │   Map: Classic · 10 min · 25 respawns│  │
│   ▸ 5  Easy   Easy7         bot   ✔    │  └─────────────────────────────────────┘  │
│                                                                                    │
│   [ Add local player 2 ]                              host: [ Start match ]        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- Every slot is a button. Clicking a **bot** slot claims it, moving you there **and returning your
  previous slot to a bot** — a swap, not a second seat. Clicking your own slot releases it back to a
  bot instead. Human-held slots (someone else's) are not clickable.
- **The preview updates on hover/focus**, before you commit: a live PixiJS thumbnail of the selected
  map with the hovered slot's spawn point pulsing, both flags marked, and a rendered preview of the
  tank you would drive in that team's colors with your nickname above it.
- Preview is also how the map choice is communicated — the host changing maps re-renders it for
  everyone in real time.
- Keyboard and touch navigable: arrow keys / swipe move the highlight, `Enter` / tap claims.
- Every bot slot shows its **difficulty (`Easy` / `Medium` / `Hard`)** as a button right before the
  bot's name — the host's per-bot difficulty control (§10.4), tap to cycle; `All bots:` sets every
  bot slot at once, or one team's at a time.
- The host may kick a player — their slot reverts to a bot at the slot's configured difficulty.
- The host never needs to press `Ready` — their own seat(s) don't count toward the gate, and
  `Start match` is available to them as soon as every *other* human slot is `Ready`.

### 6.2 HUD

**Top bar is a real layout row, not an overlay** — team respawns (blue left, red right), match timer,
team frag counts, flag-intact indicators — and the arena fills exactly the space left below it, not
the whole viewport (`MatchScreen`'s `.match-topbar` + `.match-arena`, a plain flex column). Everything
else layers on top of the arena only, so nothing else needs to dodge the stats bar: bottom-left, your
lives-equivalent state — upgrade stars, active buff with a shrinking timer, mine count; center-top,
event banners (team bonuses, flag under attack, "flag critical"); top-right, a compact event feed,
last 4 entries — kills and bonus pickups. A **flag-under-attack** warning pings the whole team with a
sound and an arrow pointing at the base. The top bar also carries the three HUD buttons —
**scoreboard**, **fullscreen**, **menu** — which are what a touch device has instead of `Tab`, the
browser's own fullscreen control and `Esc`; they are bound unconditionally, since a mouse user has no
reason to be denied them. On touch the personal-state line moves from the bottom-left of the arena to
the top-left, out from under the `MINE` button.

---

## 7. Rendering (PixiJS)

- **PixiJS v8**, `WebGL` preferred with automatic Canvas fallback, `autoDensity` on with
  `resolution = min(devicePixelRatio, 2)`.
- One `Application` and a world container **sized to the loaded map** (`map.width`/`height * CELL`,
  §3.1 — no fixed constant, `Sim.worldW`/`worldH` and `createPixiApp`'s params both derive it the
  same way), scaled by `min(vw/worldW, vh/worldH)` on **both axes** and centered in the mount —
  proportions preserved, with a letterbox margin on whichever axis the viewport's aspect ratio
  leaves over. All gameplay coordinates are logical px — resolution independence for free, identical
  simulation on every device.
- **Layers** are separate `Container`s in the order of §3.3, so z-order is structural, not sorted
  per frame.
- **Terrain** uses `@pixi/tilemap` (a single draw call per terrain layer). Only the changed cells are
  re-uploaded when brick is destroyed — no full-map rebuilds.
- **Textures** are generated procedurally at boot into a single `RenderTexture` atlas (brick, steel,
  forest, water frames, ice, sand, tank bodies per team and per upgrade level, bullets, bonuses,
  flags). No art assets to ship; the atlas can be swapped for real art later without touching
  gameplay code.
- **Effects** (explosions, spawn sparkles, muzzle flashes, mine blasts) are pooled sprites with
  short frame animations, capped at a budget so a `GRENADE` detonating 5 tanks stays smooth.
- **Quality tiers:** `high` = full effects + water animation; `low` = static water, halved particle
  budget, resolution clamped to 1. Auto-selected from a 2-second FPS probe at match start, and
  overridable in settings.

**Performance targets:** 60 fps on a 2020-era mid-range phone with 10 tanks, ~20 bullets and active
effects; ≤ 400 draw calls per frame; first interactive under 2 s on a cold cache.

---

## 8. Simulation

- **Fixed timestep, 30 Hz** (33.33 ms). Rendering runs at display rate and interpolates between the
  last two simulation states.
- **Deterministic given the same inputs**: no `Math.random` in the simulation — a seeded xorshift
  RNG, its seed distributed with the match start message. Bonus spawns, spawn point choice, and bot
  jitter all draw from it.
- **Collision** is grid-based: tanks test the 1 × 1 (up to 2 × 2 when straddling a cell boundary —
  the 24 px hitbox is smaller than the 32 px cell) cells they overlap, resolved per axis
  independently — moving diagonally into a wall that only blocks one axis keeps the tank moving on
  the other (a strafe/slide, not a hard stop). Bullets sweep every grid cell their leading edge
  crosses this tick, in travel order (a 2D walk, not just an axis-aligned one, since a bullet can be
  diagonal too) and hit the first solid cell or tank hitbox. No general physics engine.
- **Tick order:** inputs → tank movement & collisions → firing → bullet stepping & hits → terrain
  damage → bonus pickup & timers → deaths, the respawn pool, respawn timers → win conditions.

---

## 9. Networking

### 9.1 Topology

**Star, host-authoritative.** The host runs the only simulation that matters; clients predict
locally and reconcile.

Full mesh is wrong at this size — 10 peers means 45 connections. A star gives the host 9 connections
and every client exactly 1, which is also why the host must be the one with the best connection
(the room screen shows every ping, so the host can tell).

```
       client ─┐
       client ─┤
       client ─┼── HOST (authoritative sim + all bots) 
       client ─┤
       client ─┘
```

- Transport: **WebRTC DataChannel via PeerJS**, free public broker for signalling, Google STUN for
  NAT traversal. No server of our own, no public IP required.
- All bots run **on the host**, inside the authoritative simulation — bots cost nothing on clients
  and cannot desync.

### 9.2 Room code

6 characters from the 30-symbol alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0/O/1/I/L`), ≈ 7.3 ×
10⁸ combinations. The code **is** the host's PeerJS peer-id (namespaced as `tanks-<CODE>`), so no
lookup service is needed: joining is a direct `peer.connect('tanks-K7QM2X')`. On a code collision at
creation the host regenerates.

Invite links: `https://<pages-url>/?room=K7QM2X`.

### 9.3 Messages

| Message | Direction | Rate | Reliability |
|---|---|---|---|
| `hello` / `welcome` | both | once | reliable |
| `roomState` (slots, per-slot bot difficulty, map, settings, ready flags) | host → all | on change | reliable |
| `claimSlot` / `releaseSlot` / `setReady` | client → host | on action | reliable |
| `setBotDifficulty` (slot or all/team) | host-only, local → broadcast | on action | reliable |
| `matchStart` (map, seed, slot→tank mapping, difficulties, `t0`) | host → all | once | reliable |
| `input` `{seq, tick, seats:[{dir, fire, mine}]}` | client → host | 30 Hz | unreliable |
| `snapshot` (delta-encoded world state) | host → all | 15 Hz | unreliable |
| `events` (kill, pickup, flag hit, bonus, chat) | host → all | on event | reliable |
| `matchEnd` (results) | host → all | once | reliable |
| `ping` / `pong` | both | 1 Hz | unreliable |

**Snapshot contents:** tick, per-tank `{id, x, y, dir, state, upgrade, buffFlags}`, live bullets
`{id, x, y, dir}`, bonus entities, terrain changes since the client's last acknowledged tick, team
respawns and scores. Delta-encoded against the last acknowledged snapshot; a full snapshot is sent
every 2 s and on request. Budget: ~300 B per snapshot → **≈ 5 KB/s down** per client, ~1 KB/s up.
Payloads are packed binary (`ArrayBuffer`), not JSON.

> **As implemented:** every snapshot is a full snapshot, sent as JSON, at `NET_SNAPSHOT_HZ`. Terrain
> changes travel as their own reliable `terrain` events instead of a per-tick diff, so the client
> never needs to reconstruct a delta. This is simpler and easier to get right without two real
> devices to test against; it costs more bandwidth than the spec's binary deltas, which is the right
> trade for a room capped at 10 players. Switching to binary deltas later is a codec change, not an
> architecture change — see `net/protocol.ts`.

**Client-side:** prediction with input replay for your own seats, 100 ms interpolation delay for
everything else, and a snap-if-off-by-more-than-half-a-cell reconciliation rule. Bullets are never
predicted — the 100 ms of latency is honest and avoids phantom kills.

> **As implemented:** the client does not run a shadow simulation or replay inputs — it renders every
> tank, including its own, by interpolating between the last two snapshots (`render/arena.ts`). This
> is honest about latency in the same spirit as the bullet rule above, just applied to every tank,
> and it avoids a whole class of prediction/reconciliation bugs that can only really be shaken out by
> playtesting over a real, lossy connection. Revisit once there's real latency data to tune against.
> The interpolation window isn't the fixed `NET_SNAPSHOT_HZ` delay either — it's the *observed* gap
> between the last two snapshots. That matters because the host's own view gets a snapshot every sim
> tick (30 Hz, `host.ts`), not the network-throttled rate the fixed constant assumed; using the fixed
> value there meant the interpolated position perpetually lagged the true one, invisible while
> driving straight but a visible kink right at a direction change.

### 9.4 Failure handling

- **Client drops:** its slots revert to bots immediately; the tanks keep fighting. A 60-second grace
  window lets the same nickname reclaim its slots on reconnect, mid-match.
- **Host drops:** the match cannot continue — clients see the disconnect overlay and are returned to
  the main menu with the room code preserved so someone can recreate it. *Host migration is
  explicitly out of scope* (§13): it means transferring the authoritative sim mid-match, and the
  complexity is not worth it for a 10-minute casual match.
- **Broker unreachable:** create/join fails with a clear message and a retry, plus a note in the
  README about self-hosting a broker.
- **Cheating:** the host is authoritative and validates every input (rate, direction, fire cooldown),
  which stops the casual case. A malicious *host* can cheat freely; that is accepted — matches are
  ad-hoc games among people who shared a code.

---

## 10. Bots

Bots fill every unclaimed slot and must be good enough that a 1-human-vs-9-bots match is fun.

### 10.1 Core loop

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

### 10.2 Fair perception

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

### 10.3 Difficulty levels

Three levels — **Easy**, **Medium** (default), **Hard** — the internal ids are `easy`/`normal`/`hard`
(`config.ts`), with `BOT_DIFFICULTY_LABEL` supplying the displayed names. They differ in mechanical precision *and*
in which behaviors are unlocked at all, so higher difficulty reads as smarter play rather than just
faster twitching.

#### Easy — "target practice"

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

#### Medium — "a competent teammate"

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

#### Hard — "plays to win"

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

#### Parameters

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

### 10.4 Choosing difficulty in the lobby

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

---

## 11. Audio

WebAudio, synthesized at runtime (no shipped samples): fire, ricochet, brick crumble, steel clang,
explosion, spawn, bonus pickup, team bonus fanfare, flag hit alarm, match end. Ducking so a
`GRENADE` doesn't blow out the mix. Muted by default on mobile until first interaction (autoplay
policy), with a clear unmute affordance. Music is a single low-key loop, off by default.

---

## 12. Project structure

```
tanks/
├─ index.html
├─ package.json · tsconfig.json · vite.config.ts
├─ SPEC.md · README.md
├─ scripts/
│  ├─ checkMaps.ts          # `npm run maps:check` — validates every map outside the browser
│  └─ runTests.mjs          # `npm test` — globs and runs tests/*.test.ts under node:test
├─ tests/                   # headless suites: movement, controls, map format, bot nav, bot tactics
└─ src/
   ├─ main.ts                  # bootstrap, ScreenManager, ?room= deep link
   ├─ style.css                # the one stylesheet for every DOM screen + HUD
   ├─ game/
   │  ├─ config.ts             # all tunables from this spec
   │  ├─ settings.ts           # persisted per-viewer settings (volume, quality, ...)
   │  ├─ touchControls.ts      # the mobile two-zone overlay (§5.3): floating stick + fire half
   │  ├─ ScreenManager.ts
   │  └─ screens/              # MainMenu, CreateRoom, JoinRoom, Room, Match, Result, Settings
   ├─ world/
   │  ├─ grid.ts               # terrain, destruction, queries
   │  ├─ maps/
   │  │  ├─ mapFormat.ts       # pure parseMap()/MapDef/validator (§3.5), no Vite imports
   │  │  ├─ mapChars.ts        # terrain glyph table
   │  │  ├─ classic.ts · crossroads.ts · swamp.ts  # one template constant each (§3.6)
   │  │  ├─ mapSources.ts      # id + name + template for the three above
   │  │  ├─ debugMap.ts        # the debug map's own id/template (§3.5 "Debug map")
   │  │  └─ loader.ts          # registry: listMaps()/getMap() over the above
   │  ├─ tank.ts · bullet.ts · bonus.ts · flag.ts
   │  ├─ sim.ts                # fixed-step tick, deterministic, snapshot()
   │  └─ rules.ts              # respawns, scoring, win conditions
   ├─ ai/
   │  ├─ bot.ts                # utility scoring + actions + fair perception
   │  ├─ pathfinder.ts         # A* over the cost grid
   │  └─ teamPlan.ts           # role assignment
   ├─ net/
   │  ├─ peer.ts               # PeerJS wrapper, star topology
   │  ├─ protocol.ts           # message shapes for §9.3 (JSON, not binary — see §9.3 note)
   │  ├─ room.ts               # RoomController interface shared by host.ts/client.ts
   │  ├─ host.ts               # authoritative sim loop + broadcast + bots
   │  ├─ client.ts             # mirrors host state, ships local input
   │  └─ roomCode.ts
   ├─ render/
   │  ├─ app.ts                # Pixi app, scaling
   │  ├─ atlas.ts              # procedural texture generation
   │  ├─ arena.ts              # layers, sprites, snapshot interpolation, fx
   │  ├─ preview.ts            # room-screen map & tank preview (Canvas2D)
   │  └─ hud.ts                # DOM HUD overlay + top-bar action buttons (§6.2)
   ├─ audio/audio.ts
   └─ util/                    # math (incl. seeded RNG), input, storage, dialog (Enter binding),
                               # fullscreen (§5.4: prefixes + orientation lock, all failure-tolerant)
```

### Deployment — GitHub Pages

The build is a static site with no backend, published to `https://gray0072.github.io/tanks/`.

- `vite.config.ts` sets `base: "/tanks/"` — the repo subpath. Without it every asset URL 404s once
  deployed, and the dev server then also serves from `/tanks/`.
- `package.json` carries `predeploy: npm run build` and `deploy: gh-pages -d dist` for publishing
  by hand from a working copy.
- `.github/workflows/deploy.yml` is the normal path: every push to `main` runs `npm ci`,
  `npm run build` and `peaceiris/actions-gh-pages@v4` with `permissions: contents: write`,
  publishing `./dist` to the `gh-pages` branch.

Two deliberate deviations from the wording above, both explained where they matter: the network
protocol carries JSON, not packed binary (§9.3), and client-side prediction is simplified rather than
full replay/reconciliation (§9.3) — both correctness-over-optimization calls that can't be verified
without real multi-device testing.

---

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

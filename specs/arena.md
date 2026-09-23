# 3. The arena

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 3.1 Dimensions

No scrolling, no camera — the whole arena is always on screen. There's no fixed size or aspect
ratio, though: the arena is exactly as big as the loaded map's template (`map.width`/`map.height`,
§3.5), up to a `MAX_MAP_W`/`MAX_MAP_H` sanity ceiling (`config.ts`). Every built-in map happens to be
33 × 25 cells, but nothing enforces that — the debug map (§3.5) is 8 × 5.

| | |
|---|---|
| Terrain grid | **map.width × map.height cells** — per-map, not fixed (33 × 25 for three of the six built-ins; the others range from 30 × 20 to 41 × 19) |
| Cell | 32 × 32 logical px — one cell is one tank/flag slot, matching the map format's one-character-per-cell rule (§3.5): a `r`/`b`/`R`/`B` glyph *is* a full tank-sized square, not a quarter of one |
| Arena | **map.width × map.height × 32** logical px — 1056 × 800 for a 33 × 25 map, no fixed aspect ratio |
| Tank footprint | 1 cell (32 × 32 px) slot; the actual collision/visual body is a smaller 24 × 24 box centered in it — turning into a same-width corridor would otherwise need pixel-perfect alignment |
| Movement grid | continuous, not quantized — a corner assist pulls the cross-axis position toward the nearest cell grid line, so turning into a same-width corridor doesn't need pixel-perfect alignment. It only fires while the tank is *blocked* and only when being aligned would actually clear the way: a turn with a free path ahead must never shift the tank's center sideways, and a tank driving into a solid wall must not creep along it |

The renderer scales the arena **uniformly** — one `min()`-derived factor for both axes — and centers
it in the area below the HUD's top bar (§6.2), so the map always keeps its proportions and cells stay
square. Whatever the aspect-ratio mismatch leaves over on one axis becomes an even letterbox margin
rather than a stretch. On a phone in landscape the arena fills the screen; in portrait the game asks
the player to rotate.

## 3.2 Layout

Mirror-symmetric along the horizontal axis:

- **Blue base** — bottom center. **Red base** — top center.
- Each base: a **flag** occupying 1 cell, walled in by brick on three sides (the classic eagle
  pocket), plus a spawn zone of 5 spawn points spread across the friendly half.
- Center of the map is contested open ground with cover, water, and the richest bonus spawns.

## 3.3 Surfaces

| Tile | Tank | Bullet | Effect |
|---|---|---|---|
| `EMPTY` | passes | passes | — |
| `BRICK` | blocks | **destroys 1 quarter-cell** | Destructible in quarter-cell chunks, like Battle City. `STAR 3` bullets destroy the whole cell. *Drawn* as cracks spreading over the whole cell, not as quarters vanishing — the sim tracks a count, not which corner was hit, so the picture must not claim one (§7) |
| `STEEL` | blocks | blocks | Only `STAR 3` bullets destroy it |
| `FOREST` | passes | passes | Drawn **above** tanks — hides tanks and bullets inside it. An enemy whose whole footprint is on forest is not drawn at all, including the parts that reach past its hull (nickname, rank pips, shield ring, bonus auras); one straddling a forest edge stays drawn and is only partly covered. Teammates stay visible through forest, faded |
| `WATER` | blocks | passes | Impassable; animated |
| `ICE` | passes | passes | Low friction — the tank keeps sliding ~0.4 s after the key is released and cannot turn instantly |
| `SAND` | passes | passes | ×0.55 move speed |
| `FLAG` | blocks | **destroys → match ends** | 1 cell, one per team, team-colored |

Render layer order: ground → water → ice/sand decals → bonuses → flags → tanks → bullets → brick &
steel → forest → friendly-in-forest overlay → own-tank markers (§7) → effects → HUD.

## 3.4 Maps

**Six built-in maps**, each a plain template literal (`mapFormat.ts`, §3.5) in
`src/world/maps/`, selected by the host in the lobby. Three of them happen to share a 33 × 25 grid;
`thicket` is a wider, shorter 30 × 20, `fortress` a tall 35 × 27 and `iceworks` a wide 41 × 19. All
six are 5 a side — nothing in the format or the engine requires a common size, each map carries its
own dimensions and its own spawn count. The bases are deliberately not all arranged the same way:
three maps face them top-to-bottom, `thicket` and `iceworks` left-to-right, `fortress` on a
diagonal.

| Map | Character | Status |
|---|---|---|
| `classic` | Battle City homage: brick mazes, steel spine, water gate at midfield | §3.6 |
| `crossroads` | Four open lanes meeting in the middle, minimal cover, fast and lethal | §3.6 |
| `swamp` | Water channels and sand flats; movement is the puzzle | §3.6 |
| `thicket` | Wide and horizontal (30 × 20), bases left and right, dense forest cover | §3.6 |
| `fortress` | Walled keeps in opposite corners (35 × 27); grinding, siege-flavored | §3.6 |
| `iceworks` | Wide (41 × 19), bases left and right, large ice fields and a steel spine | §3.6 |

**Player-made maps.** Alongside the built-ins, a player can author maps in the in-game level
editor (`specs/level-editor.md`). They use this exact format, go through this exact parser, live in
`localStorage` under `tanks.customMaps`, and are addressed by a `custom-<hex>` id — so everything
downstream (room, Sim, previews, bot navigation) treats them like any other map. Built-in maps are
read-only in the editor: they can be copied, never overwritten. A custom map travels to guests as
text on `roomState`/`matchStart` (§9.3).

### Design rules

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

## 3.5 Map file format

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

### Character set

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

### File layout

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
row is optional — every built-in map draws one in `@` steel because it makes the boundary
visible while hand-editing, the debug map doesn't bother.

Every built-in map is its own `.ts` file exporting one template constant (`classic.ts`,
`crossroads.ts`, `swamp.ts`, `thicket.ts`, `fortress.ts`, `iceworks.ts`); `mapSources.ts` lists them with an id and display name. Plain strings
were chosen over JSON deliberately: a 25-row grid in JSON needs a quote pair and a comma on every
line, which is exactly the kind of noise that makes hand-edited ASCII art go wrong. And because
these are ordinary `.ts` modules rather than raw-text file imports, there's no Vite dev-server
special-casing to route around either (an earlier iteration of this format used `?raw`-imported
`.tmap` files specifically to dodge Vite treating `*.map` as a JSON sourcemap — moot once the map
itself is just a string in a `.ts` file).

### Validation

Run at load in dev and by `npm run maps:check` in CI. A failure is loud in dev and the map is
dropped from the lobby list in production.

1. Every row the same length as row 0; only known characters; width and height between
   `MIN_MAP_W`/`MIN_MAP_H` and `MAX_MAP_W`/`MAX_MAP_H` (`config.ts`). The floor is **2 × 2** — the
   smallest grid that can still hold one flag and one spawn per team; the rest of the game reads
   its dimensions and its roster size off the map, so nothing else has to change.
2. Exactly one `R` and one `B`.
3. At least one `r` and one `b`. The two counts need **not** match: the roster is built per team
   from these counts and `world/rules.ts` attributes a slot's stats via `slot.team`, so a 4-v-6 map
   plays. The level editor warns about it (uneven fights are usually an authoring slip) but does
   not block it.
4. **Reachability:** flood fill over tank-passable cells (treating `BRICK` as passable, since it can
   be shot through) from a red spawn must reach both flags and every spawn. This is the check that
   catches a map where a water channel accidentally seals off a base.

The level editor runs a **stricter superset** of these (`world/maps/validateMap.ts`,
`specs/level-editor.md` §7) before it will let a map be saved as playable, reported as a list of
individually-addressable problems rather than one thrown message: an 8 × 8 … 64 × 64 size window
inside the engine's own 2 × 2 … 128 × 128, at most 16 spawns a team, no spawn or flag within
Chebyshev distance 2 of an enemy spawn, and per-spawn reachability that names *which* spawn is
walled in. It also raises non-blocking warnings, including the "no open lane to a flag" design rule
above — which nothing checked until now.

### Debug map

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
filling every spawn but slot 0, all-default settings (`main.tsx`). Never ship `DEBUG` on.

---

## 3.6 Example maps

Six complete maps written out in full — the format has no mirroring shorthand, so a
symmetric layout (every built-in is one) is simply typed out twice by hand. The first three are
33 × 25 and mirror top-to-bottom; `thicket` (30 × 20) and `iceworks` (41 × 19) mirror left-to-right;
`fortress` (35 × 27) is the odd one out, symmetric under a 180° rotation rather than a reflection,
which is what lets its two keeps sit in opposite corners.

### `classic.ts`

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

### `crossroads.ts`

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

### `swamp.ts`

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

### `thicket.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@...%%.....%%....%%.....%%...@
@.r...%%%%..%%..%%..%%%%...b.@
@.....%%%%..%%..%%..%%%%.....@
@.%%%.......,,..,,.......%%%.@
@.%%%..r....,,..,,....b..%%%.@
@.#........%%%..%%%........#.@
@.#.%%%*...%%%..%%%...*%%%.#.@
@##.%%%................%%%.##@
@R#......r....@@....b......#B@
@##.%%%.......@@.......%%%.##@
@.#.%%%....%%%..%%%....%%%.#.@
@.#....*...%%%..%%%...*....#.@
@.%%%..r....,,..,,....b..%%%.@
@.%%%.......,,..,,.......%%%.@
@.....%%%%..%%..%%..%%%%.....@
@.r...%%%%..%%..%%..%%%%...b.@
@...%%.....%%....%%.....%%...@
@............................@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

Wide rather than tall: 30 × 20, mirrored left-to-right, with both flags against the side
walls at mid-height and the fight running along the long axis. Forest is the dominant terrain —
every lane in and out of a base runs through at least one stand of it, so concealment (§3.3, allies
see through forest, enemies don't) is the map's main tactical currency rather than walls. Cover is
otherwise deliberately thin: two brick columns screen each base's approach, sand patches slow the
outer lanes, and the flag-to-flag row is broken by a 4 × 2 steel block dead center, the midfield
pillar every map carries.

### `fortress.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@......@.....#.......#............@
@.R.#r.@.,r,.#.......#..%%%%..@@..@
@..#...@.....#..%%...#..%%%%..@@..@
@.#....#.....#..%%...#..%%%%......@
@.r..%.@...*.#.......#......*.....@
@.....%@........~~~~~~..-----.,,..@
@@@@#@@@.....#..~~~~~~..-----.,,..@
@........@@@.#..........-----.,,..@
@.,.~~~~.r@@.#................,,..@
@.r..........#@@@#@@@.........,,..@
@######.#####.@.....@.#####.###...@
@.............@.*...@.............@
@.............#..,..#.............@
@.............@...*.@.............@
@...###.#####.@.....@.#####.######@
@..,,.........@@@#@@@#..........b.@
@..,,................#.@@b.~~~~.,.@
@..,,.-----..........#.@@@........@
@..,,.-----..~~~~~~..#.....@@@#@@@@
@..,,.-----..~~~~~~........@%.....@
@.....*......#.......#.*...@.%..b.@
@......%%%%..#...%%..#.....#....#.@
@..@@..%%%%..#...%%..#.....@...#..@
@..@@..%%%%..#.......#.,b,.@.b#.B.@
@............#.......#.....@......@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

The only built-in whose bases are not opposite each other across an axis: red's keep is in the
top-left corner, blue's in the bottom-right, and the layout is symmetric under a 180° rotation. Each
flag sits behind two walls — a steel keep whose only ways in are a brick gate east and another
south, inside a brick rampart with one gap on each of its two sides — so a push has to break four
things in sequence and can come at either wall. The two remaining corners are open ground (forest,
sand, a pond, an ice patch) and carry the flanking routes. Dead center is a steel citadel with a
brick door on each side and two `*` spawns inside it: the map's midfield pillar grown into a room,
worth shooting your way into and hard to hold.

### `iceworks.ts`

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@.......@....~...%%...%%...~....@.......@
@.%%..------r~...%%.%.%%...~b------..%%.@
@.%%..------.~.####...####.~.------..%%.@
@.....------.~.####...####.~.------.....@
@.....------*~......@......~*------.....@
@###@.r.............@.............b.@###@
@..#.~........----..#..----........~.#..@
@.,#.~...@@@..----..@..----..@@@...~.#,.@
@.R.,r,..@@@..--*-..@..-*--..@@@..,b,.B.@
@.,#.~...@@@..----..@..----..@@@...~.#,.@
@..#.~........----..#..----........~.#..@
@###@.r.............@.............b.@###@
@.....------*~......@......~*------.....@
@.....------.~.####...####.~.------.....@
@.%%..------.~.####...####.~.------..%%.@
@.%%..------r~...%%.%.%%...~b------..%%.@
@.......@....~...%%...%%...~....@.......@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

Wide and short (41 × 19), mirrored left-to-right like `thicket` but the opposite idea: almost no
concealment, and traction is the scarce resource. Four large ice floors fill the corners and two
more flank the center, so most of the map is a surface tanks overshoot on (§3.3) — chasing a kill
across one usually means sliding past the shot. A steel spine runs down the middle with a brick
panel top and bottom, leaving two open lanes around it and two that must be shot open; it also sits
on the flag-to-flag row, doing the midfield pillar's job. Each flag is in a shed of brick against
the side wall with a single doorway, water channels screen the approach to it, and the machinery
blocks either side of midfield give the only hard cover on the route in.

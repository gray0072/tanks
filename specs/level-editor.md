# Level editor — specification

Status: **implemented** (2026-09-22). The user-visible parts are folded into `SPEC.md` (§3.4 Maps,
§3.5 Map file format, §6 Screens, §9.3 Messages); this file stays as the editor's own detail sheet.
Where the build deviates from the design below, the text has been corrected to match the code —
the deviations are called out inline as **Shipped as** notes.

A browser-local level editor for the map format of `SPEC.md` §3.5. Custom maps live in
`localStorage`, are authored with a Paint-like palette + drag-to-fill, are validated before they can
be played, and are playable in exactly the same flow as a built-in map — including over the network,
where the map travels to guests as text.

---

## 1. Goals and non-goals

**Goals**

- Author a playable map without leaving the game: resize the grid, paint terrain, place flags and
  spawns, validate, save, play.
- Never let an unplayable map reach a match. Validation is the gate, not a hint.
- Built-in maps are **read-only**: they can be opened, previewed and **copied**, never overwritten.
- One map library screen serves both "pick a map to play" and "pick a map to edit".
- Persist locally only — no backend (the project has none, `SPEC.md` §0).

**Non-goals (v1)**

- Sharing/publishing maps to other players out-of-band beyond copy-paste text import/export (§8).
- Authoring bot hint data, scripted events, or per-map rules (time limit/respawns stay room
  settings, remembered per map id by `game/settings.ts` as they already are).
- A tile-level undo history that survives a reload (undo is in-memory, §6.6).
- Editing a map while a room is open. The editor is reachable from the menu only (§4).

---

## 2. Data model and storage

### 2.1 What a custom map is

The same character grid as a built-in map (`SPEC.md` §3.5) plus the id/name that `mapSources.ts`
supplies for built-ins. Nothing about the parser changes; a custom map is fed to the *same*
`parseMap`.

```ts
// world/maps/customMaps.ts
export type CustomMap = {
  id: string;         // "custom-<8 hex>", unique, never reused after delete
  name: string;       // 1..24 chars, trimmed, unique among custom maps (§5.4)
  template: string;   // the character grid, "\n"-joined, no leading/trailing newline
  createdAt: number;  // epoch ms
  updatedAt: number;  // epoch ms
  origin:             // provenance, shown as a hint on the library card
    | { kind: "blank" }
    | { kind: "builtin"; id: string }   // copied from a built-in
    | { kind: "custom"; id: string }    // copied from another custom map
    | { kind: "import" };               // pasted text (§8)
};
```

### 2.2 localStorage layout

Two keys, read and written by `customMaps.ts` directly rather than through `util/storage.ts` — that
wrapper swallows every failure, which is right for a volume slider and wrong for a map (§2.4):

| Key | Contents |
|---|---|
| `tanks.customMaps` | `{ v: 1, maps: CustomMap[] }` — the library, newest-updated first |
| `tanks.editorDraft` | `{ v: 1, mapId: string \| null, name, template, savedAt }` — crash/refresh recovery for unsaved work (§6.8) |

`v` is a schema version. On load, an unknown/missing `v`, a non-array `maps`, or an entry failing a
shape check is dropped (the entry, not the whole library) and logged; the library never throws into
the UI. Stored maps are **not** re-validated at load time — an invalid map is allowed to exist in
storage so the editor can reopen and fix it; only *playing* it is gated (§5.3, §7).

Budget: a 64 × 64 map is ~4 KB of text, so ~100 maps fits comfortably inside the usual 5 MB origin
quota. No compression.

### 2.3 Registry integration

`world/maps/loader.ts` gains custom-map awareness so the rest of the game keeps addressing maps by
id:

- `listMaps()` — unchanged, built-ins only (this is what "built-in" means downstream).
- `listCustomMapEntries()` — the stored records, each with its parsed `MapDef` when it parses and
  its validation problems when it doesn't, so the library can show a broken map with a badge.
- `listPlayableMaps()` — built-ins followed by valid custom maps. This is what the library screen
  and Create Room resolve a map id against.
- `getMap(id)` — resolves built-ins, the debug map, then custom maps out of `localStorage`, plus an
  in-memory **transient** registry (§9) so a guest can hold a host's custom map without storing it.

Ids are namespaced by the `custom-` prefix, so `id.startsWith("custom-")` is the read-only check and
there's no way for a custom map to shadow a built-in.

### 2.4 Save failures

`saveSetting` ignoring a `QuotaExceededError` is fine for a volume slider and not fine for a map.
The library module writes with its own `try/catch` and surfaces the failure to the editor as a
blocking error ("Couldn't save — browser storage is full or blocked"), leaving the editor dirty and
the draft in memory, so nothing is silently lost.

---

## 3. Sizes and limits

| Constant (`game/config.ts`) | Value | Why |
|---|---|---|
| `EDITOR_MIN_W`, `EDITOR_MIN_H` | **8** | The engine floor is 2 × 2 (`MIN_MAP_W/H`) — enough to *parse*, far too small to be a match. 8 × 8 is the smallest grid where two bases plus cover is a game, and it's still tiny enough for quick test maps. |
| `EDITOR_MAX_W`, `EDITOR_MAX_H` | **64** | Half the engine's `MAX_MAP_W/H` = 128. At 64 × 64 the arena is 2048 logical px and already letterboxes hard on a phone; the cap also keeps the editor's per-cell work and the stored record small. |
| `EDITOR_MAX_SPAWNS_PER_TEAM` | **16** | 16 a side = 32 tanks. Past what the room screen's two roster columns show comfortably (`SPEC.md` §6.1) and past what the bots were tuned for, but nothing in the engine assumes a roster size — it is built from the map's spawn count — so the cap is a deliberate ceiling rather than a structural one. |
| `EDITOR_MAX_BONUS_SPAWNS` | **16** | Sanity bound; `BONUS_MAX_ON_FIELD` is 2, so past a handful of points it's only variety. |
| `EDITOR_MAX_NAME` | **24** chars | Fits the library card and the room screen's "Map: …" line. |

`EDITOR_*` are editor-only bounds that sit *inside* the engine's `MIN_MAP_*`/`MAX_MAP_*`, which stay
as they are — the built-in debug map (8 × 5) and the 2 × 2 parser test must keep working.

---

## 4. Flow

```
Main Menu
  ├─ Create Room ──────► Map Library (mode: "pick") ──► Create Room form ──► Room ──► Match
  │                          │  (select a map, then Continue)
  └─ Level Editor ─────► Map Library (mode: "manage") ──► Editor ──┬─► Save ──► back to Library
                                                                   └─► Test play ──► Match (offline)
```

Two entry points, **one screen** (`MapLibraryScreen`) in two modes:

- **`pick`** — reached from `Create Room`, replacing the inline map grid that used to live in
  `CreateRoomScreen` (§5.5). Primary action per card: **Select**. Management actions (Copy,
  Edit, Delete, New) are present here too, so a player who wants "this map but with more cover" can
  branch off without backing out to the menu.
- **`manage`** — reached from a new `Level Editor` button on the main menu. Same list, primary
  action per card: **Edit** (built-ins: **Copy**, since Edit is disabled). No Select/Continue.

Back from the library returns to whatever opened it (Main Menu, or the Create Room form after
Continue). Leaving the editor with unsaved changes prompts (§6.8).

The room screen has no map switcher of its own today (the map is chosen before the room exists), so
it only *shows* the map — name, size and roster — plus `Save to my maps` when the host's map is one
of theirs (§9).

---

## 5. Map library screen

### 5.1 Layout

```
┌──────────────────────────── MAPS ─────────────────────────────────────┐
│  [ Built-in | Custom | All ]                       [ + New map ]      │
│                                                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐             │
│  │  [thumbnail]  │  │  [thumbnail]  │  │  [thumbnail]   │             │
│  │ Classic       │  │ Thicket       │  │ My Fortress    │             │
│  │ 33×25 · 5v5   │  │ 30×20 · 5v5   │  │ 24×18 · 3v3    │             │
│  │ Battle City…  │  │ Wide, forest… │  │ edited 2h ago  │             │
│  │ built-in      │  │ built-in      │  │ ⚠ 2 problems   │             │
│  │ [Copy]        │  │ [Copy]        │  │ [Edit][Copy][X]│             │
│  └───────────────┘  └───────────────┘  └────────────────┘             │
│                                                                       │
│  [ Back ]                                   [ Continue ]  (pick mode) │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.2 Card contents

Every card — built-in and custom alike — shows, under the existing `drawMapPreview` thumbnail:

1. **Name**.
2. **`WIDTH×HEIGHT · NvN`** — the requested addition. Size is `map.width × map.height`; the roster is
   `map.spawns.red.length` vs `map.spawns.blue.length`, rendered `5v5` when symmetric (always, for a
   valid map) — read off the parsed `MapDef`, never hardcoded. A custom map that fails to parse shows
   its raw grid's dimensions and `—` for the roster.
3. **Blurb** for built-ins (today's `MAP_BLURB`), **relative `updatedAt`** for custom maps.
4. A **source tag**: `built-in` or `custom`, plus `⚠ N problems` when validation failed (§7).

The same size/roster line is added to the room screen's map line (`Map: Classic · 33×25 · 5v5 ·
10 min · 25 respawns`), so the information is where the decision is made.

### 5.3 Actions

**A click on the card body is the primary action**: `Edit` in `manage` mode (a built-in says why it
can't be edited instead), `Select` in `pick` mode. The buttons inside the card stop the click, so
`Copy` or `Delete` never also opens the map.

| Action | Built-in | Custom | Behaviour |
|---|---|---|---|
| **Select** (pick mode) | ✔ | valid only | Takes that map and returns to Create Room; `Continue` does the same for whatever is already highlighted, so the screen can be left without changing anything. An invalid custom map is not selectable — the button is disabled. |
| **Edit** | ✖ — hidden, replaced by a hint ("Built-in maps can't be edited — copy it first") | ✔ | Opens the editor on that map. Invalid maps open fine — that's how you fix them. |
| **Copy** | ✔ | ✔ | Creates a new custom map from the source's template, name `"<source> copy"` (then `copy 2`, …, §5.4), `origin` recording the source. Appears in the list immediately, selected; it does **not** auto-open the editor (copying to get a starting point for several variants is common). |
| **Delete** | ✖ | ✔ | Confirm dialog naming the map. Removes the record and its `tanks.roomSetups` entry. If it was the last-played map (`tanks.lastMap`) or the room's current map, selection falls back to the first built-in. |
| **New map** | — | — | Creates a blank map of the default size (§6.2) named `"New map"` and opens the **editor** directly. |

Undo for Delete: none; the confirm dialog is the guard. Deliberate — a trash bin in localStorage
costs quota and complexity for a single-user local library.

### 5.4 Names

Trimmed, 1..`EDITOR_MAX_NAME` chars, unique among custom maps (case-insensitive); a collision
auto-suffixes ` 2`, ` 3`, … on copy/import, and is a save-blocking error with an inline message when
typed by hand. Built-in names are not reserved — a custom `Classic` is allowed, since ids, not names,
address maps, and the `built-in`/`custom` tag disambiguates.

### 5.5 What this replaces

`CreateRoomScreen`'s inline `[data-f=maps]` card row goes away, replaced by a read-only
`Map: <name> · W×H · NvN  [Change…]` row that opens the library in `pick` mode. Per-map room settings
(`loadRoomSetup`/`saveRoomSetup`) keep working unchanged, keyed by the custom map's id like any
other.

---

## 6. Editor screen

### 6.1 Layout

```
┌── EDITOR ── [ Name: My Fortress      ]  24×18 · 3v3 ────────────────────────┐
│ PALETTE          │                                                          │
│ ▸ . Empty        │        ┌───────────────────────────────────┐             │
│ ▸ # Brick        │        │                                   │             │
│ ▸ @ Steel        │        │        grid canvas                │             │
│ ▸ % Forest       │        │   (click paint, drag rect-fill)   │             │
│ ▸ ~ Water        │        │                                   │             │
│ ▸ - Ice          │        └───────────────────────────────────┘             │
│ ▸ , Sand         │                                                          │
│ ▸ * Bonus        │   Size  W [ − 24 + ]   H [ − 18 + ]   anchor [3×3 grid]  │
│ ── entities ──   │                                                          │
│ ▸ R Red flag     │   ⚠ Problems (2)                                         │
│ ▸ B Blue flag    │    • Red spawn (3,1) can't reach the blue flag           │
│ ▸ r Red spawn    │    • Blue has 3 spawns, red has 2                        │
│ ▸ b Blue spawn   │                                                          │
│                  │   [ Undo ][ Redo ]   [ Test play ]  [ Back ]  [ Save ]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

The grid is one `<canvas>` (same renderer family as `render/preview.ts`, not PixiJS — this is UI, not
the arena), scaled to `min(availW / w, availH / h)` with a floor of 8 px and a ceiling of 32 px per
cell, scrolled inside its pane when the map is bigger than the pane. A 1 px grid line every cell, a
brighter one every 5, and the map border drawn just outside the grid so out-of-bounds solidity
(`SPEC.md` §3.5) reads visually.

### 6.2 New-map default

`20 × 16`, all `EMPTY` with a `@` steel border, one flag and one spawn per team pre-placed (red top,
blue bottom, mirrored) and two bonus spawns at midfield — i.e. **a new map is valid the moment it is
created**, so the first thing a new author sees is a green "Ready to play", not a wall of errors.

### 6.3 Palette

One brush at a time. Terrain brushes are the `mapChars.ts` glyphs plus `*` (bonus spawn); entity
brushes are `R`, `B`, `r`, `b`. Each palette row shows the glyph, the swatch color from
`preview.ts`'s `TILE_COLOR`, the name, and for entities a live count (`r · 3/8`). Digit keys `1..9`
and `E` (eraser) select brushes; the eraser writes `EMPTY`.

### 6.4 Painting rules

| Gesture | Terrain brush (`. # @ % ~ - , *`) | Entity brush (`R B r b`) |
|---|---|---|
| Click / tap | Paint one cell | Place one entity in that cell |
| Drag | **Paint continuously** along the pointer path (freehand, Paint-style) — the default mode | Nothing beyond the initial cell |
| Shift-drag, or drag with `Rect` mode on | **Rectangle fill**: live preview outline while dragging, commit on release, filling every cell of the rectangle | Not supported |
| Right-click / two-finger tap | Erase to `EMPTY` | Erase to `EMPTY` (removes the entity) |

- **Rectangle fill is terrain-only**, as requested: forest, walls, water, ice, sand, brick, empty and
  bonus spawns can be dragged out as a block; flags and player spawns cannot be mass-placed, because
  each is a discrete objective/roster entity, not a surface.
- Painting terrain **over** an entity removes that entity, with the palette count updating live — no
  silent survival of an overwritten spawn.
- Placing `R`/`B` **moves** the existing flag rather than adding one: there is exactly one per team by
  construction, so the flag brush is "pick it up and drop it here". Placing it on the cell it already
  occupies is a no-op, not a delete.
- Placing `r`/`b` **adds** a spawn, up to `EDITOR_MAX_SPAWNS_PER_TEAM` (past the cap the brush
  refuses with a toast); placing on an existing spawn of the same team removes it (toggle), which is
  how you delete one without switching brushes. Placing a red spawn on a blue spawn replaces it.
- Spawn **priority** is scan order (`SPEC.md` §3.5), not placement order — the editor shows the
  resulting index on each spawn marker so this isn't a surprise.
- Every gesture is a single undo step: one click = one step, one drag (freehand or rect) = one step.
- Painting never writes out of bounds; a rectangle is clamped to the grid.

### 6.5 Resize

Two spinners (W, H) with `−`/`+` and direct numeric entry, clamped to
`EDITOR_MIN_*`..`EDITOR_MAX_*`, plus a 3 × 3 **anchor** control picking which corner/edge stays fixed
(default: top-left).

- **Growing** adds `EMPTY` cells on the side(s) away from the anchor. If the map has a complete steel
  border, growing offers (checkbox, default on) to redraw the border on the new outer ring, so the
  common case doesn't leave a frame stranded mid-map.
- **Shrinking** discards the cells outside the new rectangle. If any *entity* (flag/spawn) or any
  non-`EMPTY` terrain would be discarded, confirm first, naming the count: "Shrinking removes 1 blue
  spawn and 37 painted cells." Shrinking away a flag is allowed — validation then complains; the
  editor never silently relocates an entity.
- Resize is one undo step, terrain and entities together.

### 6.6 Undo/redo

In-memory ring of the last **50** states (whole-grid snapshots — a 64 × 64 grid is 4 KB, so 50 of
them is 200 KB, much cheaper than a command log is to get right). `Ctrl+Z` / `Ctrl+Shift+Z` plus
buttons. Cleared on leaving the editor; never persisted.

### 6.7 Test play

`Test play` is enabled only when validation passes. It starts an **offline** room-of-one on the
current (possibly unsaved) template, every other slot a bot at the room default difficulty — exactly
what `config.DEBUG` does today (`main.ts`), but reached from the editor. The map is registered in the
transient registry (§2.3) under the working id, so nothing needs to be saved to try it. Leaving the
match returns to the editor with the work and the undo stack intact.

### 6.8 Dirty state, autosave, leaving

- Any mutation marks the editor dirty and writes `tanks.editorDraft` (debounced ~1 s).
- `Back` while dirty → dialog: `Save` / `Discard` / `Cancel`. `Save` is blocked by validation errors
  (§7) and the dialog says so, offering `Save as draft` (keeps `tanks.editorDraft`, doesn't touch the
  library) instead.
- On opening the editor, if `tanks.editorDraft` exists and is newer than the stored map it belongs to,
  offer to restore it ("Unsaved changes from <relative time> — Restore / Discard").
- A successful save clears the draft.
- `beforeunload` is **not** hooked (a hostile pattern on a game page); the draft covers a reload.

### 6.9 Keyboard and touch

- `1..9`, `E` — brush; `Shift`-drag — rectangle; `Ctrl+Z`/`Ctrl+Shift+Z` — undo/redo; `Ctrl+S` —
  save; `Esc` — back (same dirty prompt).
- Touch: the palette becomes a horizontally-scrolling strip above the grid, painting is bound to a
  single pointer via per-pointer capture (the rule the match's touch layer learned in `SPEC.md`
  §5.3), and the grid pane scrolls when the map overflows it.

> **Shipped as:** the `Rect` toggle sits in its own row above the grid rather than in the palette —
> on a phone the palette is a scrolling strip, and the one control a touch device *cannot* reach
> another way must not be the one that scrolls out of sight. Pinch-to-zoom isn't implemented: the
> cell size is fitted to the pane (8–32px) and the pane scrolls, which covers the same need with no
> gesture to get wrong.

---

## 7. Validation

One pure function, shared by the editor, the library and the room:

```ts
// world/maps/validateMap.ts
export type MapProblem = { severity: "error" | "warning"; message: string; cells?: CellPos[] };
export function validateMapTemplate(template: string): MapProblem[];
```

The editor runs it after every committed gesture (O(cells), trivially fast at ≤ 64 × 64) and renders
the list under the grid; clicking a problem highlights its `cells` on the canvas. `parseMap` keeps
its own structural checks — it must, it's also the built-ins' CI gate — so `validateMapTemplate`
calls `parseMap`, converts a `MapValidationError` into errors, and adds the editor-level rules below.

### 7.1 Errors (block Save-as-playable, Select and Test play)

1. **Size** within `EDITOR_MIN_*`..`EDITOR_MAX_*`; every row the same length; only known glyphs.
2. **Exactly one red flag and one blue flag.**
3. **At least one spawn per team**, at most `EDITOR_MAX_SPAWNS_PER_TEAM` each. The counts need not
   be equal — uneven teams are a **warning**, not an error (see §7.2).
4. **Reachability — the requested rule, strengthened.** Flood fill over cells a tank can eventually
   occupy — `STEEL` and `WATER` block, `BRICK` is passable (it can be shot open),
   `EMPTY`/`FOREST`/`ICE`/`SAND`/flag/spawn cells pass — and require **every spawn of both teams** to
   reach **both flags and every other spawn**. This is the "no player is walled in by steel or water,
   everyone can fight their way to a flag" rule. Cheapest equivalent implementation: one flood from
   the red flag, then assert it covers the blue flag and every spawn — reachability here is
   symmetric. Today's `parseMap` floods only from red spawn 0; the editor's check reports *which*
   spawn is cut off, by coordinate.
5. **No entity on an impassable cell** — a flag or spawn glyph *is* its own cell, so in practice this
   surfaces via rule 4; stated separately because it yields a far better message ("Blue spawn (4,9) is
   surrounded by water").
6. **Spawn separation:** no spawn within Chebyshev distance 2 of an **enemy** spawn — spawning
   face-to-face is a coin flip, not a map. Same-team spawns may touch.
7. **Flag not within Chebyshev distance 2 of an enemy spawn**, same reason.
8. **Bonus spawns** ≤ `EDITOR_MAX_BONUS_SPAWNS`.
9. **Name** non-empty, ≤ `EDITOR_MAX_NAME`, unique among custom maps (§5.4).

### 7.2 Warnings (shown, never block)

1. **Uneven teams** — one side has more spawns than the other. Playable (the engine sizes each team
   from its own spawn count), but far more often a slip than a design.
2. **Open sightline to a flag** — `SPEC.md` §3.4's design rule, finally machine-checked: for each
   enemy spawn sharing the flag's row or column, raycast along it; if no `STEEL` cell interrupts the
   line, warn ("Blue flag is on an open line of fire from red spawn (16,1) — put a steel block on
   that lane"). Brick doesn't count; it gets shot away.
3. **Lopsided map** — the reachable area closer to red differs from the area closer to blue by > 20 %.
4. **Sealed pockets** — passable cells unreachable from the flags (wasted space, or an accident);
   warns with the count and highlights them.
5. **No bonus spawn points** — bonuses (`SPEC.md` §4.3) then never appear; rarely intended.
6. **Flag fully exposed** — no `BRICK`/`STEEL` among the 8 cells around a flag.
7. **Cramped** — fewer than ~12 passable cells per tank on the map.

> **Shipped as:** two warnings from the first draft are gone. "A spawn on `ICE` or `SAND`" is
> unrepresentable — a spawn glyph *is* its cell, so the terrain under it is always `EMPTY` (§3.5);
> and "roster changed relative to the map this was copied from" needs provenance the validator
> doesn't get handed, for a fact the size/roster line already shows.

### 7.3 Where validation is enforced

| Point | Behaviour |
|---|---|
| Editor, live | Problem list; `Save` disabled on errors (`Save as draft` offered), `Test play` disabled on errors |
| Library | Invalid custom maps listed with `⚠ N problems`, not selectable, still editable/copyable/deletable |
| `RoomHost.setMap` | Rejects an id that doesn't resolve or doesn't parse, as `doSetMap` already does |
| Guest receiving a custom map (§9) | Parses the received template; on failure shows "The host's map couldn't be loaded" and refuses the match rather than desyncing |

---

## 8. Import / export

Cheap, because the format is already text, and the only way to move a map between two browsers
without a backend:

- **Export** (card menu, custom *and* built-in): a modal with the template in a pre-selected
  `<textarea>`, plus `Copy to clipboard` and `Download .txt`. The first line is `# <name>` — a comment
  line the importer strips and the parser never sees.
- **Import** (library toolbar): paste into a textarea → validate → on success create a custom map
  with `origin: { kind: "import" }` and the `# <name>` line's name (or `Imported map`); on failure,
  show the same problem list and refuse.

---

## 9. Networking a custom map

A guest doesn't have the host's `localStorage`. Today `roomState`/`matchStart` carry only `mapId`
(`net/protocol.ts`), which is enough only for built-ins.

- Both messages gain an optional `mapTemplate?: { id: string; name: string; template: string }`, sent
  **only when `mapId` starts with `custom-`**. Built-in traffic stays byte-identical to today.
- The client registers it in an in-memory **transient registry** (`registerTransientMap`, cleared on
  leaving the room) so `getMap(id)` resolves it everywhere — room preview, sim, result screen — with
  no storage write. A guest never silently gains a map in their library.
- The guest's room screen shows the map with a `custom` tag and a `Save to my maps` button; that is
  the only path from someone else's map into local storage (name-collision suffixing per §5.4).
- The template is ≤ ~4 KB, so it rides the existing JSON messages — no chunking.
- If the received template fails to parse, the guest shows the §7.3 error and does not start.

Host side: `doSetMap` resolves through `getMap` (built-in, custom, transient) instead of
`listMaps().some(...)`, and rebroadcasts `roomState` including `mapTemplate`, so late joiners and
reconnects get it too.

---

## 10. Files touched

| File | Change |
|---|---|
| `src/world/maps/customMaps.ts` | **new** — CRUD over `tanks.customMaps`, id generation, name uniquing, quota-aware save |
| `src/world/maps/validateMap.ts` | **new** — §7 rules on top of `parseMap` |
| `src/world/maps/editorModel.ts` | **new** — grid buffer ⇄ template, paint/rect/entity ops, resize, undo stack (pure, headless-testable) |
| `src/world/maps/loader.ts` | custom + transient resolution in `getMap`; `listCustomMaps`, `listPlayableMaps` |
| `src/game/screens/MapLibraryScreen.ts` | **new** — §5, both modes |
| `src/game/screens/EditorScreen.ts` | **new** — §6 |
| `src/game/screens/CreateRoomScreen.ts` | inline map grid → `Map: … [Change…]` row (§5.5) |
| `src/game/screens/MainMenuScreen.ts` | `Level Editor` button |
| `src/game/screens/RoomScreen.ts` | size/roster on the map line; `Save to my maps` for a received custom map |
| `src/game/config.ts` | `EDITOR_*` constants (§3) |
| `src/net/protocol.ts`, `host.ts`, `client.ts` | optional `mapTemplate` (§9) |
| `src/render/preview.ts` | reused for library thumbnails; the editor canvas shares `TILE_COLOR` |
| `src/style.css` | library cards, editor layout, palette, phone breakpoints |

---

## 11. Testing

Headless (`tests/`, the project's `node:test` suite — `editorModel.ts` and `validateMap.ts` are
deliberately free of DOM and Vite imports so they run there):

- `tests/mapEditor.test.ts` — paint one cell; rect fill covers exactly the dragged rectangle, clamped
  at the edges; rect fill with an entity brush is rejected; painting terrain over an entity drops the
  entity; flag placement moves rather than duplicates; spawn toggle and the per-team cap; undo/redo
  restores exact templates; resize grow/shrink under each anchor keeps the right cells and drops the
  right entities; template → model → template round-trips byte-identically.
- `tests/mapValidation.test.ts` — one case per §7.1 error and §7.2 warning on minimal hand-written
  grids: a spawn sealed behind steel, one sealed behind water, one reachable **only through brick**
  (must pass), mismatched spawn counts, missing/duplicate flag, adjacent enemy spawns, size outside
  the editor bounds; plus **every built-in map must produce zero errors** — a rule that rejects
  `classic` is a wrong rule, and this is the net that catches it.
- `tests/customMaps.test.ts` — storage CRUD against a stubbed `localStorage`: copy naming, delete,
  corrupt-entry tolerance, schema-version handling.

Manual (per `AGENTS.md`, driving a real Chromium with Playwright) — all of this was run and passes:
copy a built-in → edit the copy → shift-drag a water block → resize (with the "shrinking removes N"
confirm) → undo → rename → save → the library shows it with the right `W×H · NvN` → Create Room →
`Change…` → Select → the room's map line and the match both run on it. Also: a new map is valid on
creation; walling a spawn in with steel disables `Save` and `Test play` and names that spawn;
`Test play` round-trips back into the editor with the work intact; delete confirms; export/import
round-trips and a too-small import is refused with the reason; freehand drag paints a run of cells
and a right-drag erases it; on a 412 × 916 phone the palette becomes a strip, a tap places an entity
and nothing overflows horizontally.

---

## 12. Open questions

1. **Mirror tools** — `Mirror horizontally / vertically` (paint one half, get a symmetric map) is the
   single biggest authoring accelerator and is deliberately out of v1. Add right after the core loop
   is real?
2. **Per-map room defaults** — should a saved map carry suggested time limit/respawns instead of
   relying on `tanks.roomSetups` keyed by id? Only really matters once maps are shared (§8).
3. **Seed maps** — worth shipping a couple of small "template" maps (empty arena, symmetric skeleton)
   visible only in the library, alongside the four production ones?

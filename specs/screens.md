# 6. Screens

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

Screens are a stack managed by `ScreenManager`; exactly one is active and rendered per frame.

1. **Main Menu** — logo, `Create room`, `Join room`, `Level editor`, `Settings`, `How to play`.
2. **Create room** — nickname, the chosen map (thumbnail + name + size/roster, with `Change…`
   opening the map library below), match settings (time limit, respawn count, friendly fire,
   **default bot difficulty — `Medium`**), `Create`. Produces the room code.
3. **Join room** — nickname, 6-character code field (auto-uppercase, auto-advance, paste-aware).
   A `?room=CODE` deep link skips straight here with the code filled in.
4. **Map library** — one screen in two modes (`specs/level-editor.md` §5): opened from `Create
   room` to pick a map, or from the menu's `Level editor` to manage them. Every card carries the
   map's thumbnail, name, **size and roster (`33×25 · 5v5`)**, and its actions — clicking the card itself does the obvious one (`Edit` here, `Select` when picking a map for a room), with buttons for `Select`, `Edit`
   (custom only), `Copy`, `Export`, `Delete` (custom only) — plus `New map` and `Import…`.
5. **Level editor** — palette, grid, resize with an anchor, live validation, `Test play`
   (`specs/level-editor.md` §6).
6. **Room / slot picker** — the heart of the pre-match flow, see §6.1.
7. **Match** — the arena plus HUD (§6.2).
8. **Scoreboard overlay** — held `Tab` or a HUD button; per-player stats, ping, team totals.
9. **Result** — winner banner, final scoreboard, MVP line, `Rematch` (host) / `Back to room`.
10. **Settings** — sound and music volume, render quality (auto/low/high), movement stick side
   (§5.3), fullscreen-on-match-start (§5.4), nickname, show-ping toggle.
11. **Disconnected overlay** — reconnect progress and a `Back to menu` escape hatch.

## 6.1 Room screen and slot preview

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
│   ▸ 4  Easy   Easy6         bot   ✔    │  │   Map: Classic · 10 min · ×10 (50) respawns│  │
│   ▸ 5  Easy   Easy7         bot   ✔    │  └─────────────────────────────────────┘  │
│                                                                                    │
│   [ Add local player 2 ]                              host: [ Start match ]        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **A guest who joins by code is seated automatically** on the first free bot slot, on whichever
  team has fewer humans — arriving with a room code already means "I want to play", so nobody has to
  find a bot row first. They can still click another slot to move.
- Every slot is a button. Clicking a **bot** slot claims it, moving you there **and returning your
  previous slot to a bot** — a swap, not a second seat. Clicking your own slot releases it back to a
  bot instead; releasing player 2's slot drops the second seat entirely, so the button goes back to
  `Add local player 2`. Your last primary slot can't be released — you would vanish from the roster.
  Human-held slots (someone else's) are not clickable.
- **The preview updates on hover/focus**, before you commit: a live PixiJS thumbnail of the selected
  map with the hovered slot's spawn point pulsing, both flags marked, and a rendered preview of the
  tank you would drive in that team's colors with your nickname above it.
- Preview is also how the map choice is communicated — the host changing maps re-renders it for
  everyone in real time.
- Keyboard and touch navigable: arrow keys / swipe move the highlight, `Enter` / tap claims.
- Every bot slot shows its **difficulty (`Easy` / `Medium` / `Hard`)** as a button right before the
  bot's name — the host's per-bot difficulty control (§10.4), tap to cycle; `All bots:` sets every
  bot slot at once, or one team's at a time.
- **Respawns per player** is a host-only dropdown here, live for everyone (§2.2): the roster can
  change after the room was created — a new map resizes the teams — so the pool is retunable
  without leaving the lobby. Guests see the same value as text.
- The host may kick a player — their slot reverts to a bot at the slot's configured difficulty.
- The host never needs to press `Ready` — their own seat(s) don't count toward the gate, and
  `Start match` is available to them as soon as every *other* human slot is `Ready`.

## 6.2 HUD

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

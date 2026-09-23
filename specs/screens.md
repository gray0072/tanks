# 6. Screens

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

Screens are React components over a single `Route` value held by `<App>` (`src/ui/routes.ts`);
exactly one is active and rendered per frame. Navigation is `go(route)` — a state update, not a
mount/unmount protocol — and live objects a screen needs to survive the move (a `RoomController`,
the editor's working document) travel inside the route.

1. **Main Menu** — logo, `Create room`, `Join room`, `Level editor`, `Settings`, `How to play`,
   over the live backdrop (§6.3). Carries a **notice** when the player did not arrive here by
   choice — `The host removed you from the room.`, `The host left — the room is gone.` (§9.4).
2. **Create room** — nickname, **room code** (optional: empty means "generate one", or type your
   own — §9.2), the chosen map, `Create`. Nothing else: the
   match rules and the bot difficulty are the *room's* (§6.1, §2.2), so this screen only carries
   the last-used set for that map across. The map is a card — thumbnail, name, size/roster and the
   map's **blurb**, the same line the library card shows — and the **whole card opens the map
   library**, not just its `Change…` button: the card is the thing being chosen. It is a focusable
   `role="button"`, so `Enter` on it opens the library instead of triggering `Create`.
3. **Join room** — nickname, 6-character code field (auto-uppercase, auto-advance, paste-aware).
   A `?room=CODE` invite link opens **this screen** with the code filled in, the room named in a
   hint, and the focus in the nickname field with its suggested `Guest1234` pre-selected — it never
   connects on its own. A link is an invitation, not a decision: joining automatically seated the
   player under a name they never saw and gave them no way back to change it.
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
   (§5.3), fullscreen-on-match-start (§5.4), **live battle behind the menus** (§6.3), nickname,
   show-ping toggle.
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
│                                         │  │   Map: Classic · 33×25 · 5v5        │  │
│   RED   (1 human)                       │  │                                     │  │
│   ▸ 1  Easy   Easy1         bot   ✔    │  │   Rounds to win  [ 5 ▾ ]            │  │
│   ▸ 2  Easy   Easy3         bot   ✔    │  │   Round time     [ 5 min ▾ ]        │  │
│   ▸ 3         Oleg          61ms  ✔    │  │   Respawns       [ ×10 (50) ▾ ]     │  │
│   ▸ 4  Easy   Easy6         bot   ✔    │  │   [x] Friendly fire                 │  │
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
- **The preview updates on hover/focus**, before you commit: a thumbnail of the selected map with
  the hovered slot's spawn point pulsing and both flags marked. There is no separate tank preview —
  the tank is the same silhouette in the team's colour whatever slot you take, so it was a picture
  that told you nothing, taking the room's scarcest space.
- Preview is also how the map choice is communicated — the host changing maps re-renders it for
  everyone in real time.
- Keyboard and touch navigable: arrow keys / swipe move the highlight, `Enter` / tap claims.
- Every bot slot shows its **difficulty (`Easy` / `Medium` / `Hard`)** as a button right before the
  bot's name — the host's per-bot difficulty control (§10.4), tap to cycle; `All bots:` sets every
  bot slot at once, or one team's at a time.
- **The match rules live here**, as host-only dropdowns, live for everyone (§2.2): **rounds to
  win**, **round time limit**, **respawns per player** and **friendly fire**. This is the room's own
  state (`MatchSettings`), not a creation-time choice: the roster changes after a room exists (a new
  map resizes the teams), people arrive and leave, and the host should be able to retune a match
  without tearing the room down. Create Room is left with what must be decided *before* a room can
  exist — nickname, map and the difficulty its bots start at. Guests see the same rules as one line
  of text, and every change reaches them as room state.
- Each map remembers the rules it was last played with (`settings.ts`), so switching back to a map
  brings its settings back rather than a global default.
- The host may kick a player — their slot reverts to a bot at the slot's configured difficulty.
- The host never needs to press `Ready` — their own seat(s) don't count toward the gate, and
  `Start match` is available to them as soon as every *other* human slot is `Ready`.

## 6.2 HUD

**Top bar is a real layout row, not an overlay** — team respawns (blue left, red right), the centre
column holding the **rounds-won score** over the round timer (`3 : 1 /5` — the score decides the
match, the clock only bounds a round, §2.2; a round running past its clock reads `SUDDEN DEATH`
there instead of a stopped `0:00`),
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

### Between rounds

The intermission (§2.2) is an overlay **on the arena, not over the whole screen**: a dimmed, lightly
blurred wash with the round's outcome (`RED TAKES THE ROUND` — always a team, there are no drawn
rounds), the rounds-won score
in team colours, what the target is (`First to 5 wins the match`) and a 3-2-1 count-in ending in
`GO`. The battlefield stays visible and frozen behind it, so the position the round ended in is what
the players look at while they read the score. The overlay swallows the touch zones, so local input
is cleared and the sticks released the moment it appears — same rule as the pause menu.

The **result screen** ends the series rather than the round: its banner is the series score,
winner's first (`BLUE WINS 5:2`), with the rounds spelled out below it and a match-wide scoreboard.

## 6.3 Live menu backdrop

Every menu screen is drawn over a **real bot-vs-bot match**, not a static image: `MenuBackdrop`
(`src/game/menuBackdrop.ts`) runs the same `Sim`, the same `BotController`s and the same `Arena`
renderer a match uses, into its own canvas layer behind `#ui`. Nothing else about it is like a
match — it is the menu's wallpaper, and every rule below exists to keep it from competing with the
menu in front of it.

- **It is scenery, not a match.** All slots are bots at `hard` (a livelier fight), there is no HUD,
  no nicknames over the tanks and **no audio at all** — a menu that fires cannons at someone who
  hasn't started anything is a bug, not atmosphere. The layer has `pointer-events: none`, so every
  click belongs to the menu.
- **It reads as texture.** CSS does the work: a light blur, reduced saturation, and a scrim that is
  heaviest in the middle of the screen — exactly where the title and the menu panel sit. The panels
  themselves stay fully opaque, so the only text ever over live pixels is the title, subtitle and
  the GitHub link, which carry a shadow.
- **A spectator camera** frames the fight instead of showing the whole map: the view is scaled to
  *cover* the viewport (letterbox bars behind a menu would look like a bug), zoomed in by viewport
  width, and drifts toward the midpoint of the closest blue/red pair — speed-capped and with a dead
  zone, so it drifts rather than chases. On a wide screen it holds that point at ~¼ of the width,
  in the space the centred menu panel doesn't use. Forest concealment is off: it hides enemies from
  a *player*, and a backdrop whose tanks disappear into the bushes is a backdrop of empty scenery.
- **Rounds are short** (2½ minutes, generous respawns) and each one picks a different built-in map,
  so a long menu session doesn't settle into one picture. Custom maps are excluded.
- **It yields.** `<App>` starts and stops it per route (`wantsBackdrop`); the match
  and the editor own the canvas themselves, so it is destroyed outright — WebGL context included —
  before either mounts, and rebuilt when the menu comes back. It also stops while the tab is hidden.
- **On by default for everyone**, `prefers-reduced-motion` included, with a one-click off switch in
  Settings. Windows' "Animation effects" toggle alone puts a desktop browser in reduced-motion, so
  keying the backdrop off that media query meant most Windows players never saw the feature at all
  and a Settings switch that appeared to do nothing.

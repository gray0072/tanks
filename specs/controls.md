# 5. Controls

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 5.1 Desktop

| Action | Player 1 | Player 2 (local co-op) |
|---|---|---|
| Move | `W` `A` `S` `D` | Arrow keys |
| Fire | `Left Shift` | `Right Shift` |
| Drop mine | `Q` | `M` |
| Scoreboard | hold `Tab` | — |
| Menu / pause overlay | `Esc` | — |

**Bindings are physical keys** (`KeyboardEvent.code`), never the character produced, so they are
the same on a Russian or any other layout: `Q` is whatever key sits where `Q` sits (Й), `M` likewise.

**`Ctrl` is deliberately unbound.** It is the natural fire key next to `WASD`, but `Ctrl`+`W` closes
the tab and `Ctrl`+`Tab` switches it, and a page cannot stop either: browser-reserved chords are
never delivered cancellable. Keyboard Lock would intercept them, but only while fullscreen and only
on Chromium — not a base a control scheme can stand on. `Shift` carries no such chords with `WASD`
or the arrows, so fire lives there instead.

Holding two adjacent direction keys (e.g. `W`+`D`) drives/faces diagonally between them. Holding an
opposing pair on one axis (e.g. `W`+`S`) resolves last-pressed-wins, same as a single direction always
did, so tapping a second key never stalls the tank.

## 5.2 Local co-op (two on one machine)

A client can claim a **second seat** from the room screen (`Add local player 2`). Both tanks are
simulated and rendered on the same client and share its network connection — from the room's point
of view they are just two more occupied slots, each with its own nickname. The seats may be placed on
the same team or on opposing teams. Bots take back both slots if the client disconnects.

## 5.3 Mobile

No fixed d-pad. The battlefield is split down the middle into two full-height touch zones, and the
whole of each zone is the control:

| Zone | Control |
|---|---|
| **Movement half** (left by default) | A **floating stick**: it has no home position — it appears wherever the thumb lands and follows the drag, giving any of the 8 `Dir` values. Lift to stop. |
| **Fire half** (right by default) | **Tap anywhere to fire, hold to keep firing.** No aiming — the tank shoots where it faces, so the whole half can be one button. |
| `MINE` button | The one fixed widget, in the outer top corner of the fire half, inside the safe area — clear of the low arc the firing thumb sweeps. |

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

### Menu screens on a phone

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
- **Modal overlays wash out what is behind them** — `rgba(8,11,16,0.97)` plus a backdrop blur. How to
  Play is a long read and the menu showing through the old 0.88 wash made it hard to focus on.
- **How to Play takes the width it can get and pins its own footer** (`.modal-howto`): up to 880px
  instead of the shared 560px cap, the prose scrolls inside `.modal-scroll`, and *Close* sits in a
  `.modal-actions` bar below it — at the end of the prose it was several screens down on a desktop.
  The bonus legend goes two-up above 780px.
- The room screen's **tank preview canvas is hidden while nothing is hovered** — a touch device
  never hovers, so an always-present blank 300x190 canvas only pushed *Start match* off the bottom.

## 5.4 Fullscreen

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

# Tanks

**Live: [gray0072.github.io/tanks](https://gray0072.github.io/tanks/)**

A browser tank battle in the spirit of *Battle City* — blue against red, with destructible
terrain, power-ups, and a flag you have to defend. Plays on desktop and on a phone, join a friend's
match with a 6-character code, or hand a second player the arrow keys and share one keyboard.

> **Status: playable prototype.** [SPEC.md](SPEC.md) indexes the authoritative design and project
> plan; the sections themselves live in [specs/](specs/).
> A full local match works today — menu, room/slot picking with live preview, PixiJS rendering, the
> classic/crossroads/swamp/thicket maps, tanks/bullets/terrain/bonuses/flags/respawns, and bots at all three
> difficulties, plus a headless test suite (`npm test`) covering movement, bot navigation and bot
> tactics. Mobile touch controls and fullscreen are implemented and checked in an emulated phone
> browser; multiplayer (PeerJS star topology) is implemented but not yet verified on two real
> devices over the internet, and nothing has been tried on actual phone hardware. See
> [§13 Plan](specs/plan-and-risks.md#13-plan) for what's left.

## What it is

- **Team battle, blue vs red.** The roster is as big as the map's spawn count — five a side on every
  shipped map — and every slot is always filled: humans take the seats they want, bots
  (`Easy1`…`Hard10`, named after their difficulty) hold the rest, at **Easy / Medium / Hard**, set
  per bot or for everyone at once.
- **Destroy the enemy flag** to win, or grind the enemy team out of respawns. Ten minutes,
  25 respawns, one arena.
- **Battle City terrain** — brick, steel, forest, water, ice, sand — and eight power-ups, several of
  which affect your whole team (`SHOVEL`, `CLOCK`, `GRENADE`, `RESPAWN`).
- **Four maps** — `classic`, `crossroads`, `swamp`, `thicket` — chosen by the host in the lobby and previewed
  live, with your spawn point highlighted, before the match starts. A map is a plain block of text
  and carries its own size and roster, anything from 2×2 up to 128×128, so adding one is a file.
- **Your lobby setup sticks.** Create Room reopens on the map you played last, and each map keeps
  its own time limit, respawn pool, bot difficulty and friendly-fire toggle.
- **Join by code.** Peer-to-peer over WebRTC — no server to run, no public IP, no accounts.
- **Two players, one keyboard.** WASD and the arrow keys, same team or opposite ones.
- **Phone-ready.** Split-screen touch controls and a real fullscreen mode, the whole arena on screen,
  60 fps as a target on mid-range devices.

## Features

| Feature | What it does |
|---|---|
| Team deathmatch with an objective | Blue vs red. Destroy the enemy flag for an instant win, or run the enemy out of respawns before the 10-minute clock expires |
| Bots on every free slot | Difficulty per bot or for the whole roster at once — Easy / Medium / Hard, with genuinely different tactics, not just different aim |
| Destructible terrain | Brick crumbles cell by cell, steel resists until you're upgraded, forest conceals, water stops tanks but not bullets, ice slides, sand slows |
| Eight power-ups | `HELMET` `STAR` `SPEED` `MINE` are yours; `SHOVEL` `CLOCK` `GRENADE` `RESPAWN` swing the whole team |
| Peer-to-peer multiplayer | Host's browser runs the authoritative sim; guests join with a 6-character code or an invite link. No backend |
| Local co-op | A second player on the same keyboard, on either team |
| Touch controls | Split-screen: floating stick under one thumb, tap-anywhere fire under the other |
| Fullscreen | Auto on match start on touch, with landscape lock; toggle in the top bar and menu |
| Four maps with live preview | `classic`, `crossroads`, `swamp`, `thicket` — the lobby previews the arena and highlights the spawn you're hovering |
| Per-map lobby memory | The map you played last reopens preselected, with the time limit, respawns, bot difficulty and friendly-fire setting you last used **on that map** |

## How it works

1. **Create a room** — pick the map, time limit, respawns and default bot difficulty. You get a
   6-character code and an invite link.
2. **Take a slot** — click any slot on either team; the preview shows the map, your spawn and your
   tank. Friends join with the code, bots hold everything nobody claimed.
3. **Start the match** — the host's browser simulates everything and streams snapshots to the
   guests at 20 Hz.
4. **Win** — blow up the enemy flag, or outlast them on respawns. The result screen has the
   full scoreboard and a way straight back to the room.

## Tech

**TypeScript** · **PixiJS** (WebGL rendering) · **PeerJS** (WebRTC DataChannel) · **Vite** ·
static hosting on **GitHub Pages**. No backend, no shipped art — textures are generated procedurally
at boot.

## Controls

| Action | Player 1 | Player 2 (same machine) |
|---|---|---|
| Move | `W` `A` `S` `D` | Arrow keys |
| Fire | `Space` | `Enter` / `Right Ctrl` |
| Drop mine (needs the `MINE` bonus) | `Q` | `Right Shift` |
| Scoreboard | hold `Tab` | |
| Menu | `Esc` | |

Hold two direction keys at once to drive diagonally. In the menus, `Enter` triggers the screen's
primary button — create the room, join, save, start the match.

`Esc` opens the in-match menu. Playing on your own, that really pauses: the simulation stops dead
and picks up where it left off. With other players connected the match can't be frozen, so it's
just a menu over a running game.

On a phone or tablet, the battlefield is split in half and each half *is* a control:

- **Movement half** (left by default) — put a thumb down anywhere in it and drag. A stick appears
  under your thumb, wherever that is, and the tank drives that way in any of 8 directions. Lift to
  stop. Drag far and the stick follows you, so you never run out of travel or have to re-grab.
- **Fire half** (right by default) — tap anywhere to fire, hold to keep firing. The tank shoots where
  it faces, so there's nothing to aim and no button to find.
- **`MINE`** sits in the outer bottom corner, the only fixed button.
- Left-handed? *Settings → Movement stick side* swaps the two halves and the `MINE` button with them.
- The top bar carries the three buttons a phone needs and a keyboard doesn't: scoreboard, fullscreen,
  and the pause menu.

Landscape only — portrait shows a rotate prompt.

**Fullscreen** is how it's meant to be played on a phone: browser chrome eats a fifth of a landscape
screen and its show/hide animation resizes the arena mid-fight. Starting a match on a touch device
goes fullscreen and asks for a landscape orientation lock automatically (*Settings → Fullscreen on
match start*, on by default). It's also a button in the match top bar and on the main menu — worth
knowing, since a phone has no `Esc` to get back out with.

## Playing together

One player creates a room and gets a code like `K7QM2X` (or an invite link `?room=K7QM2X`). Everyone
else joins with it, picks a slot on either team — the preview shows the map, your spawn point, and
your tank before you commit — and hits ready. Any slot you don't fill is played by a bot, so the
teams are always full whether there are two of you or ten. Clicking another slot moves you there;
your own seat always keeps a slot, so you can't accidentally drop yourself out of the roster.

The room creator hosts the match: their browser runs the authoritative simulation and all the bots.
If someone drops, a bot takes their tank over for the rest of the match.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into ./dist
npm run preview    # serve the build locally
npm run deploy     # publish ./dist to the gh-pages branch
npm run maps:check # validate the built-in maps in src/world/maps/
npm test           # headless suite: movement, bot navigation, bot tactics
```

`vite.config.ts` sets `base: "/tanks/"`, the repo subpath GitHub Pages serves from — which is also
why `npm run dev` opens at <http://localhost:5173/tanks/>. Pushing to `main` deploys automatically
via [.github/workflows/deploy.yml](.github/workflows/deploy.yml); `npm run deploy` publishes from
your machine instead.

## Project structure

```
src/
  main.ts            # entry: debug shortcut, ?room= deep link, or the main menu
  game/              # screens (menu, create, join, room, match, result, settings)
    config.ts        # every tuning number: speeds, timings, bot profiles
  world/             # the simulation — no rendering, no DOM, no network
    sim.ts           # authoritative tick: movement, bullets, bonuses, flags
    grid.ts bullet.ts bonus.ts flag.ts rules.ts tank.ts
    maps/            # map sources as text + parser/validator
  ai/                # bots: per-tank controller, pathfinder, team role planner
  net/               # RoomHost / RoomClient behind one RoomController interface
    peer.ts          # PeerJS plumbing; protocol.ts — wire messages
  render/            # PixiJS: arena, procedurally generated atlas, HUD, previews
  util/              # input, math, storage, dialog helpers
tests/               # headless node:test suites (movement, map format, bot navigation, bot tactics)
scripts/             # map validation and the test runner
```

The build is a plain static site — `./dist/` can be hosted anywhere that can serve it from
`/tanks/`.

## Roadmap

Milestones **M0 – M10** are laid out in [§13 Plan](specs/plan-and-risks.md#13-plan).

- [x] M0–M6 — scaffold, terrain, tanks, match rules, bots, bonuses, screens + local co-op
- [x] M7 — multiplayer (PeerJS star topology, room code, host-authoritative sim) — *implemented,
      not yet played across two real devices*
- [x] M8 — mobile touch controls (floating stick + tap-to-fire halves), fullscreen and orientation
  gate — *verified in an emulated phone browser, not yet on real hardware*
- [ ] M9 — `fortress` and `iceworks` maps, real audio mixing pass, effects/kill-feed polish, balance
- [ ] M10 — GitHub Pages deploy

Deliberately **not** planned: host migration, dedicated servers, accounts and ranking, matchmaking,
a map editor, replays. See [§15 Out of scope](specs/plan-and-risks.md#15-out-of-scope).

## License

MIT.

## Credits

Inspired by *Battle City* (Namco, 1985).

# Tanks

A browser tank battle in the spirit of *Battle City* — **5 vs 5**, blue against red, with destructible
terrain, power-ups, and a flag you have to defend. Plays on desktop and on a phone, join a friend's
match with a 6-character code, or hand a second player the arrow keys and share one keyboard.

> **Status: playable prototype.** [SPEC.md](SPEC.md) is the authoritative design and project plan.
> A full local match works today — menu, room/slot picking with live preview, PixiJS rendering, the
> classic/crossroads/swamp maps, tanks/bullets/terrain/bonuses/flags/tickets, and bots at all three
> difficulties. Multiplayer (PeerJS star topology) and mobile touch controls are implemented but not
> yet verified on two real devices over the internet or on an actual phone. See
> [SPEC.md §13](SPEC.md#13-plan) for what's left.

## What it is

- **5 vs 5 team battle.** Every slot is always filled — humans take the seats they want, bots
  (`Easy1`…`Hard10`, named after their difficulty) hold the rest, at **Easy / Medium / Hard** — set per bot or for everyone at once.
- **Destroy the enemy flag** to win, or grind the enemy team out of respawn tickets. Ten minutes,
  25 tickets, one arena.
- **Battle City terrain** — brick, steel, forest, water, ice, sand — and eight power-ups, several of
  which affect your whole team (`SHOVEL`, `CLOCK`, `GRENADE`, `TICKET`).
- **Five fixed-size maps**, chosen by the host in the lobby, previewed live before the match starts.
- **Join by code.** Peer-to-peer over WebRTC — no server to run, no public IP, no accounts.
- **Two players, one keyboard.** WASD and the arrow keys, same team or opposite ones.
- **Phone-ready.** Touch controls, the whole arena on screen, 60 fps as a target on mid-range devices.

## Tech

**TypeScript** · **PixiJS** (WebGL rendering) · **PeerJS** (WebRTC DataChannel) · **Vite** ·
static hosting on **GitHub Pages**. No backend, no shipped art — textures are generated procedurally
at boot.

## Controls

| Action | Player 1 | Player 2 (same machine) |
|---|---|---|
| Move | `W` `A` `S` `D` | Arrow keys |
| Fire | `Space` | `Enter` / `Right Ctrl` |
| Drop mine | `Q` | `Right Shift` |
| Scoreboard | hold `Tab` | |
| Menu | `Esc` | |

On mobile: a virtual d-pad under the left thumb, fire under the right. Landscape only.

## Playing together

One player creates a room and gets a code like `K7QM2X` (or an invite link `?room=K7QM2X`). Everyone
else joins with it, picks a slot on either team — the preview shows the map, your spawn point, and
your tank before you commit — and hits ready. Any slot you don't fill is played by a bot, so the
match is 5v5 whether there are two of you or ten.

The room creator hosts the match: their browser runs the authoritative simulation and all the bots.
If someone drops, a bot takes over their tank and they have 60 seconds to reclaim it.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into ./dist
npm run preview    # serve the build locally
npm run deploy     # publish ./dist to the gh-pages branch
npm run maps:check # validate the built-in maps in src/world/maps/
```

The build is a plain static site — `./dist/` can be hosted anywhere.

## Roadmap

Milestones **M0 – M10** are laid out in [SPEC.md §13](SPEC.md#13-plan).

- [x] M0–M6 — scaffold, terrain, tanks, match rules, bots, bonuses, screens + local co-op
- [x] M7 — multiplayer (PeerJS star topology, room code, host-authoritative sim) — *implemented,
      not yet played across two real devices*
- [x] M8 — mobile touch controls + orientation gate — *implemented, not yet tried on a real phone*
- [ ] M9 — `fortress` and `iceworks` maps, real audio mixing pass, effects/kill-feed polish, balance
- [ ] M10 — GitHub Pages deploy

Deliberately **not** planned: host migration, dedicated servers, accounts and ranking, matchmaking,
a map editor, replays. See [SPEC.md §15](SPEC.md#15-out-of-scope).

## License

MIT.

## Credits

Inspired by *Battle City* (Namco, 1985).

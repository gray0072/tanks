# Tank Battle 5×5

A browser-based multiplayer top-down shooter. Two teams of 5 tanks fight to destroy the enemy flag. Up to 5 human players per team; empty slots are filled with bots.

**Play online:** https://gray0072.github.io/tanks/

## How to Play

Open the link above, enter a name, and click **JOIN GAME**. Any player can press **START GAME** — empty slots fill with bots automatically.

| Action | Key / Button |
|---|---|
| Movement | `WASD` |
| Aim | Mouse |
| Fire | Left mouse button |

**Objective:** destroy the enemy flag on the opposite side of the field.

## Features

**Teams**
- 🟢 Green — spawn on the left (slots 0–4)
- 🔴 Red — spawn on the right (slots 5–9)
- Up to 5 human players per team; bots fill the rest

**Field Pickups**

| Icon | Type | Effect |
|---|---|---|
| Cross | Health pack | +35 HP |
| Lightning | Speed boost | ×1.7 speed for 8 sec |
| Flame | Fire rate boost | ×2.8 fire rate for 8 sec |

Pickups are collected automatically on contact. AI tanks chase them too.

**Other**
- Walls are destructible — take 3 hits to break
- Tanks respawn 3 seconds after death in their own zone
- Map and wall layout are randomized each game
- Server auto-resets to lobby 5 seconds after game over

## Stack

- React 18 + TypeScript + Vite 5
- MUI v5 + Zustand v4
- Canvas 2D API for rendering
- [Partykit](https://partykit.io) — authoritative game server (Cloudflare Workers, free tier)
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)

## Architecture

```
Browser (Vite/React)          Partykit (Cloudflare Workers)
  ConnectScreen ──────────────── WebSocket ──────────────→ party/index.ts
  GameCanvas  ←── TICK (20/s) ───────────────────────────     game loop
              ──── INPUT (20/s) ──────────────────────────→    engine.ts
```

- Server runs the game loop at 20 TPS and broadcasts state to all clients
- Clients send keyboard/mouse input; server is authoritative
- Particles are client-side only (spawned from server events)

## Deployment

Frontend is hosted on **GitHub Pages**, auto-deployed on push to `main` via GitHub Actions.

Game server runs on **Partykit** at `tanks.gray0072.partykit.dev` — always online, no local server needed.

### Local development

```bash
npm install
npm run party   # Partykit dev server → http://localhost:1999
npm run dev     # Vite → http://localhost:5173
```

### Deploy server

```bash
npx partykit deploy
```

## License

MIT

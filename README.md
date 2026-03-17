# Tank Battle 5×5

A browser-based top-down shooter mini-game. Two teams of 5 tanks fight to destroy the enemy flag. You control one tank on the Green team; the other nine are AI.

## How to Play

Open `tanks.html` in your browser — no installation required.

| Action | Key / Button |
|---|---|
| Movement | `WASD` |
| Aim | Mouse |
| Fire | Left mouse button |

**Objective:** destroy the Red flag on the right side of the field.

## Features

**Teams**
- 🟢 Green — you + 4 AI allies, spawn on the left
- 🔴 Red — 5 AI enemies, spawn on the right

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

## Screenshot

> Dark arena, green and red tanks, flags on each side, glowing pickups scattered across the field.

## Stack

- Vanilla HTML + Canvas 2D API
- No frameworks or dependencies
- Font: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (Google Fonts)

## Running

```bash
# Just open the file in a browser:
open tanks.html        # macOS
start tanks.html       # Windows
xdg-open tanks.html   # Linux
```

Or drag `tanks.html` into a browser window.

## License

MIT

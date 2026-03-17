# Prompt: Tank Battle 5×5 Mini-Game

## Task

Build a "Tanks" mini-game with AI in a single HTML file with no external dependencies.

### Game Rules

- 2 teams: **Green** (player + 4 AI) vs **Red** (5 AI)
- Goal — destroy the enemy flag
- Each flag has a health bar
- The team that destroys the enemy flag first wins

### Mechanics

- **Player controls:** WASD — movement, mouse — turret aim, LMB — fire
- **Respawn:** 3-second countdown after death, then the tank respawns in its own zone
- **Destructible walls:** randomly generated, take 3 hits to destroy, change color as they take damage
- **Pickups** (spawn on the field, disappear when collected):
  - 💚 **Health** — restores 35 HP
  - ⚡ **Speed** — +70% movement speed for 8 seconds
  - 🔥 **Fire rate** — fire rate ×2.8 for 8 seconds
- **AI enemies:** choose between attacking the flag, chasing enemies, defending the base, and collecting pickups; handle getting stuck by re-routing

### Visual Style

- Retro font **Press Start 2P**
- Dark color scheme (#0a0a0a background)
- HUD with flag health bars at the top of the screen
- Player buff indicators with countdown timers
- Particles and explosions on hits and deaths
- Pulsating pickup icons on the field
- Ghost tank with respawn progress bar at the death location

### Technical Constraints

- Single file `tanks.html`, no external JS libraries
- Canvas 2D API, requestAnimationFrame game loop
- Field resolution: 960×640 px

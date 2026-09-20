// Terrain-character vocabulary for the map format (mapFormat.ts, SPEC §3.5).

import { Tile } from "../grid";

export const CHAR_TILE: Record<string, Tile> = {
  ".": Tile.Empty,
  "*": Tile.Empty, // bonus spawn point; parseMap records it as an entity, not a tile
  "#": Tile.Brick,
  "@": Tile.Steel,
  "%": Tile.Forest,
  "~": Tile.Water,
  "-": Tile.Ice,
  ",": Tile.Sand,
};

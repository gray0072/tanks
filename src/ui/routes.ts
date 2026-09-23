// The whole navigation model: exactly one route is rendered at a time, which
// is the same "single stack" the old ScreenManager enforced (SPEC §6) — only
// now it's a value in React state instead of a mounted object.

import type { RoomController } from "../net/room";
import type { EditorDoc } from "../world/maps/editorModel";
import type { PlayerStats } from "../world/rules";
import type { TeamId } from "../game/config";

/** Two modes over the one map list — specs/level-editor.md §5. `pick` is
 *  opened from Create Room and returns to it; `manage` is the Level Editor
 *  entry on the main menu. */
export type LibraryRoute = {
  k: "library";
  mode: "pick" | "manage";
  selectedMapId?: string;
};

export type EditorRoute = {
  k: "editor";
  /** The custom map being edited, or null for a brand-new one. */
  mapId: string | null;
  /** The library this editor was opened from; Back and a successful Save
   *  return there. */
  from: LibraryRoute;
  /** Carried across a test match so the working grid and the undo stack
   *  survive the round trip (specs/level-editor.md §6.7). */
  doc?: EditorDoc;
  name?: string;
};

export type Route =
  | { k: "menu" }
  | { k: "join"; code?: string }
  | { k: "create"; mapId?: string }
  | { k: "settings" }
  | LibraryRoute
  | EditorRoute
  | { k: "room"; room: RoomController }
  /** `returnTo` replaces "back to the main menu" for a match started from
   *  somewhere other than a room — the editor's Test play. */
  | { k: "match"; room: RoomController; returnTo?: EditorRoute }
  | {
      k: "result";
      room: RoomController;
      winner: TeamId | "draw" | null;
      stats: Record<number, PlayerStats>;
      returnTo?: EditorRoute;
    };

export type Navigate = (route: Route) => void;

/** Screens that draw their own canvas take the WebGL context over from the
 *  live menu backdrop (SPEC §6.3). */
export function wantsBackdrop(route: Route): boolean {
  return route.k !== "match" && route.k !== "editor";
}

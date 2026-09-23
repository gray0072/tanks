// The whole navigation model: exactly one route is rendered at a time, which
// is the same "single stack" the old ScreenManager enforced (SPEC §6) — only
// now it's a value in React state instead of a mounted object.

import { cleanRoomCode, isValidRoomCode } from "../net/roomCode";
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
  /** `notice` is why the player is back here rather than where they were —
   *  kicked, or the host disappeared (SPEC §9.4). */
  | { k: "menu"; notice?: string }
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
      winner: TeamId | null;
      stats: Record<number, PlayerStats>;
      /** Rounds won per team — the series score, e.g. 5:2 (SPEC §2.2). */
      wins: Record<TeamId, number>;
      returnTo?: EditorRoute;
    };

export type Navigate = (route: Route) => void;

/** Where a `?room=CODE` invite link lands, or null when the query string
 *  carries no usable code (SPEC §6, §9.2).
 *
 *  It lands on the **join form**, with the code filled in — never on the room
 *  itself. A link is an invitation, not a decision: the player still has to
 *  say who they are, and joining under an auto-generated `Guest1234` they
 *  never saw, with no way back to change it, is what the auto-connect this
 *  replaced actually did. */
export function deepLinkRoute(search: string): Route | null {
  // Cleaned but never truncated: a link whose code is too long is a link to
  // nowhere, not a link to the first twelve characters of somewhere.
  const code = cleanRoomCode(new URLSearchParams(search).get("room") ?? "");
  return isValidRoomCode(code) ? { k: "join", code } : null;
}

/** Screens that draw their own canvas take the WebGL context over from the
 *  live menu backdrop (SPEC §6.3). */
export function wantsBackdrop(route: Route): boolean {
  return route.k !== "match" && route.k !== "editor";
}

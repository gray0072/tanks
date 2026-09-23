import "./style.css";
import { ScreenManager } from "./game/ScreenManager";
import { menuBackdrop } from "./game/menuBackdrop";
import { MainMenuScreen } from "./game/screens/MainMenuScreen";
import { JoinRoomScreen } from "./game/screens/JoinRoomScreen";
import { MatchScreen } from "./game/screens/MatchScreen";
import { RoomHost } from "./net/host";
import { normalizeRoomCode, isValidRoomCode } from "./net/roomCode";
import { DEBUG } from "./game/config";
import { DEBUG_MAP_ID } from "./world/maps/debugMap";

const root = document.getElementById("ui");
if (!root) throw new Error("#ui not found");

// The menu backdrop's canvas layer sits behind #ui (see style.css) and is
// started/stopped by the ScreenManager per screen — SPEC §6.3.
const backdropLayer = document.createElement("div");
backdropLayer.className = "menu-backdrop";
backdropLayer.setAttribute("aria-hidden", "true");
document.body.insertBefore(backdropLayer, root);
menuBackdrop.attach(backdropLayer);

const screens = new ScreenManager(root);

if (DEBUG) {
  // Skip the menu/room flow entirely: an offline room-of-one on the debug
  // map, bots filling every spawn but slot 0, all-default settings, match
  // started immediately (SPEC §3.5 "Debug map").
  const room = new RoomHost("Debug", false, {}, DEBUG_MAP_ID);
  room.startMatch();
  screens.go(new MatchScreen(screens, room));
} else {
  const params = new URLSearchParams(location.search);
  const roomParam = normalizeRoomCode(params.get("room") ?? "");
  if (isValidRoomCode(roomParam)) {
    screens.go(new JoinRoomScreen(screens, roomParam));
  } else {
    screens.go(new MainMenuScreen(screens));
  }
}

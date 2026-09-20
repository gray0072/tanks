import "./style.css";
import { ScreenManager } from "./game/ScreenManager";
import { MainMenuScreen } from "./game/screens/MainMenuScreen";
import { JoinRoomScreen } from "./game/screens/JoinRoomScreen";
import { MatchScreen } from "./game/screens/MatchScreen";
import { RoomHost } from "./net/host";
import { normalizeRoomCode, isValidRoomCode } from "./net/roomCode";
import { DEBUG } from "./game/config";
import { DEBUG_MAP_ID } from "./world/maps/debugMap";

const root = document.getElementById("ui");
if (!root) throw new Error("#ui not found");

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

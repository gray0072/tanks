import "./style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { menuBackdrop } from "./game/menuBackdrop";
import { deepLinkRoute, type Route } from "./ui/routes";
import { RoomHost } from "./net/host";
import { DEBUG } from "./game/config";
import { DEBUG_MAP_ID } from "./world/maps/debugMap";

const root = document.getElementById("ui");
if (!root) throw new Error("#ui not found");

// The menu backdrop's canvas layer sits behind #ui (see style.css) and is
// started/stopped per route by <App> — SPEC §6.3. It stays outside React:
// it owns a WebGL context and a Sim of its own, neither of which belongs in
// a component's render output.
const backdropLayer = document.createElement("div");
backdropLayer.className = "menu-backdrop";
backdropLayer.setAttribute("aria-hidden", "true");
document.body.insertBefore(backdropLayer, root);
menuBackdrop.attach(backdropLayer);

function initialRoute(): Route {
  if (DEBUG) {
    // Skip the menu/room flow entirely: an offline room-of-one on the debug
    // map, bots filling every spawn but slot 0, all-default settings, match
    // started immediately (SPEC §3.5 "Debug map").
    const room = new RoomHost({ nickname: "Debug", online: false, callbacks: {}, mapId: DEBUG_MAP_ID });
    room.startMatch();
    return { k: "match", room };
  }
  return deepLinkRoute(location.search) ?? { k: "menu" };
}

createRoot(root).render(
  <StrictMode>
    <App initial={initialRoute()} />
  </StrictMode>,
);

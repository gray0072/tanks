import { useState } from "react";
import { menuBackdrop } from "../game/menuBackdrop";
import { wantsBackdrop, type Route } from "./routes";
import { MainMenu } from "./screens/MainMenu";
import { JoinRoom } from "./screens/JoinRoom";
import { CreateRoom } from "./screens/CreateRoom";
import { SettingsScreen } from "./screens/SettingsScreen";
import { MapLibrary } from "./screens/MapLibrary";
import { Editor } from "./screens/Editor";
import { RoomScreen } from "./screens/RoomScreen";
import { Match } from "./screens/Match";
import { Result } from "./screens/Result";

let backdropOn: boolean | null = null;

/** Called during render, not from an effect, and on purpose: a screen that
 *  owns the canvas itself must never share a frame (or a WebGL context) with
 *  the backdrop's renderer, and child effects run before the parent's. The
 *  equality guard makes it idempotent, so a re-render — or StrictMode's
 *  double render — costs nothing. */
function syncBackdrop(on: boolean) {
  if (backdropOn === on) return;
  backdropOn = on;
  menuBackdrop.setVisible(on);
}

export function App({ initial }: { initial: Route }) {
  const [route, go] = useState<Route>(initial);
  syncBackdrop(wantsBackdrop(route));

  switch (route.k) {
    case "menu":
      return <MainMenu go={go} />;
    case "join":
      return <JoinRoom go={go} prefillCode={route.code ?? ""} />;
    case "create":
      return <CreateRoom go={go} initialMapId={route.mapId} />;
    case "settings":
      return <SettingsScreen go={go} />;
    case "library":
      return <MapLibrary go={go} route={route} />;
    case "editor":
      return <Editor key={route.mapId ?? "new"} go={go} route={route} />;
    case "room":
      return <RoomScreen go={go} room={route.room} />;
    case "match":
      return <Match go={go} room={route.room} returnTo={route.returnTo} />;
    case "result":
      return (
        <Result
          go={go}
          room={route.room}
          winner={route.winner}
          stats={route.stats}
          wins={route.wins}
          returnTo={route.returnTo}
        />
      );
  }
}

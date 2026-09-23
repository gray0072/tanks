import { useEffect, useRef, useState } from "react";
import type { Navigate } from "../routes";
import { listMaps, listPlayableMaps } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import { drawMapPreview } from "../../render/preview";
import { RoomHost } from "../../net/host";
import { useEnterKey } from "../hooks/useEnterKey";
import {
  loadUserSettings,
  saveUserSettings,
  randomGuestNickname,
  loadLastMapId,
  saveLastMapId,
  loadRoomSetup,
  saveRoomSetup,
  type RoomSetup,
} from "../../game/settings";
import {
  BOT_DIFFICULTY_LABEL,
  RESPAWN_MULTIPLIERS,
  respawnLabel,
  type BotDifficulty,
} from "../../game/config";

/** `initialMapId` is what the map library (specs/level-editor.md §5) hands
 *  back on Continue; without one, reopen on the map played last, unless it
 *  has since been deleted or dropped from the build. */
function resolveMapId(initialMapId?: string): string {
  const maps = listPlayableMaps();
  const wanted = initialMapId ?? loadLastMapId();
  return (wanted && maps.some((m) => m.id === wanted) ? wanted : maps[0]?.id) ?? "classic";
}

export function CreateRoom({ go, initialMapId }: { go: Navigate; initialMapId?: string }) {
  const [mapId] = useState(() => resolveMapId(initialMapId));
  const [nickname, setNickname] = useState(() => loadUserSettings().nickname || randomGuestNickname());
  const [setup, setSetup] = useState<RoomSetup>(() => loadRoomSetup(mapId));
  const [error, setError] = useState("");
  const thumb = useRef<HTMLCanvasElement>(null);

  // The map line replaces the old inline card grid: the library screen owns
  // picking now, so this is just "what am I about to play" plus a way in.
  const map = listPlayableMaps().find((m) => m.id === mapId) ?? listMaps()[0];

  useEffect(() => {
    if (thumb.current && map) drawMapPreview(thumb.current, map);
  }, [map]);

  const persistNickname = () => {
    const nick = nickname.trim().slice(0, 12);
    if (nick) saveUserSettings({ ...loadUserSettings(), nickname: nick });
    return nick;
  };

  const openLibrary = () => {
    // Each map keeps its own settings, so stash the current form under the
    // outgoing map before leaving for the picker.
    saveRoomSetup(mapId, setup);
    persistNickname();
    go({ k: "library", mode: "pick", selectedMapId: mapId });
  };

  const create = () => {
    const nick = persistNickname() || randomGuestNickname();
    saveUserSettings({ ...loadUserSettings(), nickname: nick });
    saveRoomSetup(mapId, setup);
    saveLastMapId(mapId);

    const room = new RoomHost(nick, true, { onError: (msg) => setError(msg) });
    room.setMap(mapId);
    room.setSettings({ timeLimit: setup.timeLimit, respawnMult: setup.respawnMult, friendlyFire: setup.friendlyFire });
    room.setBotDifficulty("all", setup.botDifficulty);
    go({ k: "room", room });
  };
  const createRef = useRef(create);
  createRef.current = create;
  useEnterKey(() => createRef.current());

  return (
    <div className="screen">
      <div className="title">Create Room</div>
      <div className="panel panel-wide">
        <label>
          Nickname
          <input type="text" maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>

        <label>Map</label>
        <div className="row between wrap map-row">
          <div className="row">
            <canvas ref={thumb} className="map-row-thumb" width={120} height={76} />
            <div>
              <b>{map?.name}</b>
              <div className="map-meta">{map ? mapSizeLabel(map) : ""}</div>
            </div>
          </div>
          <button onClick={openLibrary}>Change…</button>
        </div>

        <div className="row wrap">
          <label>
            Time limit
            <select
              value={setup.timeLimit}
              onChange={(e) => setSetup({ ...setup, timeLimit: Number(e.target.value) })}
            >
              <option value={300}>5 min</option>
              <option value={600}>10 min</option>
              <option value={900}>15 min</option>
            </select>
          </label>
          <label>
            Respawns per player
            {/* The pool each multiplier works out to depends on this map's
                roster, so the options follow the map. */}
            <select
              value={setup.respawnMult}
              onChange={(e) => setSetup({ ...setup, respawnMult: Number(e.target.value) })}
            >
              {RESPAWN_MULTIPLIERS.map((m) => (
                <option key={m} value={m}>
                  {map ? respawnLabel(m, map.spawns.blue.length, map.spawns.red.length) : `x${m}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default bot difficulty
            <select
              value={setup.botDifficulty}
              onChange={(e) => setSetup({ ...setup, botDifficulty: e.target.value as BotDifficulty })}
            >
              <option value="easy">{BOT_DIFFICULTY_LABEL.easy}</option>
              <option value="normal">{BOT_DIFFICULTY_LABEL.normal}</option>
              <option value="hard">{BOT_DIFFICULTY_LABEL.hard}</option>
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={setup.friendlyFire}
              onChange={(e) => setSetup({ ...setup, friendlyFire: e.target.checked })}
            />{" "}
            Friendly fire
          </label>
        </div>

        <div className="error">{error}</div>
        <div className="row between">
          <button onClick={() => go({ k: "menu" })}>Back</button>
          <button className="primary" onClick={() => createRef.current()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Navigate } from "../routes";
import type { RoomController } from "../../net/room";
import type { MapDef } from "../../world/maps/loader";
import type { Slot } from "../../world/tank";
import { getMap, getTransientSource } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import {
  createCustomMap,
  getCustomMap,
  isCustomMapId,
  MapStorageError,
  uniqueMapName,
} from "../../world/maps/customMaps";
import { drawMapPreview, drawTankPreview } from "../../render/preview";
import { useEnterKey } from "../hooks/useEnterKey";
import {
  BOT_DIFFICULTIES as DIFFS,
  BOT_DIFFICULTY_LABEL as DIFF_LABEL,
  DEFAULT_RESPAWN_MULT,
  RESPAWN_MULTIPLIERS,
  respawnLabel,
  type TeamId,
} from "../../game/config";

export function RoomScreen({ go, room }: { go: Navigate; room: RoomController }) {
  const [slots, setSlots] = useState<Slot[]>(room.slots);
  const [mapId, setMapId] = useState(room.mapId);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [pendingLocalSeat, setPendingLocalSeat] = useState<0 | 1>(0);
  const [banner, setBanner] = useState("");
  /** Bumped by the things that change the room without a room-state update
   *  coming back — the local co-op seat, the host's own settings, a map
   *  saved into the library. */
  const [, forceRender] = useState(0);
  const navigated = useRef(false);

  useEffect(() => {
    room.setCallbacks({
      onRoomState: (nextSlots, nextMapId) => {
        setSlots(nextSlots);
        setMapId(nextMapId);
      },
      onMatchStart: () => {
        if (navigated.current) return;
        navigated.current = true;
        go({ k: "match", room });
      },
      onError: (msg) => setBanner(msg),
    });
  }, [room, go]);

  const isHost = room.isHost;
  const code = room.roomCode;
  const mySlotIds = new Set(room.mySlots().map((s) => s.id));
  const myReady = room.mySlots()[0]?.ready ?? false;
  // The host starts the match themselves, so their own seat(s) don't need to
  // be Ready — only other humans block Start match.
  const humansReady = slots.filter((s) => s.kind === "human" && s.owner !== "host").every((s) => s.ready);
  const mult = room.settings?.respawnMult ?? DEFAULT_RESPAWN_MULT;

  /** Respawns read as `x10 (50)`, or `x10 (50, 100)` when the map fields
   *  different-sized teams — the pool is per team, so one number wouldn't be
   *  the whole story. Roster comes from the live slots, which follow the map. */
  const respawnOptionLabel = (m: number) =>
    respawnLabel(m, slots.filter((s) => s.team === "blue").length, slots.filter((s) => s.team === "red").length);

  // Enter is the room's primary action: start the match as host, toggle Ready
  // as a guest. It reads the live state on press.
  const primary = () => {
    if (isHost) {
      if (humansReady) room.startMatch();
    } else {
      room.setReady(!myReady);
    }
  };
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEnterKey(() => primaryRef.current());

  const onSlotClick = (slotId: number) => {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    if (mySlotIds.has(slotId)) {
      // Your primary seat always keeps a slot (see RoomHost.doRelease) — say
      // so instead of letting the click look like it did nothing.
      const primaries = room.mySlots().filter((s) => s.ownerSeat === 0);
      if (slot.ownerSeat === 0 && primaries.length <= 1) {
        setBanner("You need a slot — click another slot to move there.");
        return;
      }
      room.releaseSlot(slotId);
    } else if (slot.kind === "bot") {
      setPendingLocalSeat(0);
      room.claimSlot(slotId, pendingLocalSeat);
    }
  };

  const map = mapId ? getMap(mapId) : null;
  const hovered = hoverSlot !== null ? slots.find((s) => s.id === hoverSlot) : undefined;

  return (
    <div className="screen">
      <div className="row between room-header">
        <div className="title" style={{ fontSize: "1.4rem" }}>
          Room {code ? <span style={{ letterSpacing: ".2em" }}>{code}</span> : "(offline)"}
        </div>
        <div className="row">
          {code ? (
            <>
              <button onClick={() => navigator.clipboard?.writeText(code).catch(() => {})}>Copy code</button>
              <button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(location.origin + location.pathname + "?room=" + code)
                    .catch(() => {});
                  setBanner("Invite link copied.");
                }}
              >
                Invite link
              </button>
            </>
          ) : null}
          <button
            onClick={() => {
              room.destroy();
              go({ k: "menu" });
            }}
          >
            Leave
          </button>
        </div>
      </div>
      <div className="hint">{banner}</div>
      <div className="room-layout">
        <div className="room-rosters">
          {(["blue", "red"] as TeamId[]).map((team) => (
            <div key={team} className={"team-block " + team}>
              <h3>{team.toUpperCase()}</h3>
              {slots
                .filter((s) => s.team === team)
                .map((s) => (
                  <SlotRow
                    key={s.id}
                    slot={s}
                    mine={mySlotIds.has(s.id)}
                    isHost={isHost}
                    onHover={() => setHoverSlot(s.id)}
                    onClick={() => onSlotClick(s.id)}
                    onCycleDifficulty={() => {
                      const next = DIFFS[(DIFFS.indexOf(s.botDifficulty) + 1) % DIFFS.length];
                      room.setBotDifficulty(s.id, next);
                    }}
                    onKick={() => room.kickSlot?.(s.id)}
                  />
                ))}
            </div>
          ))}
          <div className="row wrap">
            <span className="hint">All bots:</span>
            {DIFFS.map((d) => (
              <button key={d} className="chip" onClick={() => room.setBotDifficulty("all", d)}>
                {DIFF_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="preview-panel">
          <MapPreview map={map} hovered={hovered} />
          <TankPreview hovered={hovered} />
          {/* Size and roster sit where the decision is made, same as on a map
              card (specs/level-editor.md §5.2). */}
          <div className="hint">
            {map
              ? "Map: " +
                map.name +
                " · " +
                mapSizeLabel(map) +
                " · " +
                (((room.settings?.timeLimit ?? 0) / 60) | 0) +
                " min · " +
                respawnOptionLabel(mult) +
                " respawns"
              : ""}
          </div>
          <div className="row wrap">
            {map ? (
              <SaveMapAction
                mapId={map.id}
                mapName={map.name}
                onSaved={(msg) => {
                  setBanner(msg);
                  forceRender((n) => n + 1);
                }}
              />
            ) : null}
          </div>
          <div className="row wrap">
            {isHost ? (
              <label>
                Respawns per player
                <select
                  value={mult}
                  onChange={(e) => {
                    room.setSettings({ respawnMult: Number(e.target.value) });
                    forceRender((n) => n + 1);
                  }}
                >
                  {RESPAWN_MULTIPLIERS.map((m) => (
                    <option key={m} value={m}>
                      {respawnOptionLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="hint">Respawns per player: {respawnOptionLabel(mult)}</span>
            )}
          </div>
          <div className="row wrap">
            {room.hasLocalSeat2() ? (
              <button
                onClick={() => {
                  room.removeLocalSeat();
                  setPendingLocalSeat(0);
                  forceRender((n) => n + 1);
                }}
              >
                Remove local player 2
              </button>
            ) : (
              <button
                onClick={() => {
                  room.addLocalSeat();
                  setPendingLocalSeat(1);
                  forceRender((n) => n + 1);
                }}
              >
                Add local player 2
              </button>
            )}
          </div>
          {pendingLocalSeat === 1 ? <div className="hint">Player 2: pick a bot slot below.</div> : null}
          <div className="row between">
            {isHost ? (
              <button className="primary" disabled={!humansReady} onClick={() => room.startMatch()}>
                Start match
              </button>
            ) : (
              <button className={myReady ? "primary" : ""} onClick={() => room.setReady(!myReady)}>
                {myReady ? "Ready ✔" : "Ready"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  mine,
  isHost,
  onHover,
  onClick,
  onCycleDifficulty,
  onKick,
}: {
  slot: Slot;
  mine: boolean;
  isHost: boolean;
  onHover: () => void;
  onClick: () => void;
  onCycleDifficulty: () => void;
  onKick: () => void;
}) {
  return (
    <div className={"slot-row " + (mine ? "mine" : "")} onMouseEnter={onHover} onClick={onClick}>
      {slot.kind === "bot" ? (
        <button
          className={"chip " + (isHost ? "" : "disabled")}
          onClick={(e) => {
            e.stopPropagation();
            onCycleDifficulty();
          }}
        >
          {DIFF_LABEL[slot.botDifficulty]}
        </button>
      ) : (
        <span />
      )}
      <span>
        {slot.nickname}
        {slot.kind === "human" && slot.ownerSeat === 1 ? " (P2)" : ""}
      </span>
      <span className="hint">{slot.kind === "bot" ? "bot" : mine ? "you" : ""}</span>
      {slot.kind === "human" && !mine && isHost ? (
        <button
          className="small"
          onClick={(e) => {
            e.stopPropagation();
            onKick();
          }}
        >
          kick
        </button>
      ) : (
        <span />
      )}
      <span className="ready">{slot.ready ? "✔" : ""}</span>
    </div>
  );
}

function MapPreview({ map, hovered }: { map: MapDef | null; hovered: Slot | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !map) return;
    let hoverCell: { cx: number; cy: number } | undefined;
    if (hovered) {
      // Same indexing as Sim's tank placement, so the ring marks the spawn
      // this slot will actually get.
      const spawns = map.spawns[hovered.team];
      hoverCell = spawns[hovered.id % spawns.length] ?? spawns[0];
    }
    drawMapPreview(canvas.current, map, { hoverCell, hoverTeam: hovered?.team });
  }, [map, hovered]);
  return <canvas ref={canvas} width={256} height={160} />;
}

/** Hidden, not just cleared, while nothing is hovered: a touch device never
 *  hovers, so a permanently blank 300x190 canvas would only push the Start
 *  match button off the bottom of a phone screen. */
function TankPreview({ hovered }: { hovered: Slot | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !hovered) return;
    drawTankPreview(canvas.current, hovered.team, hovered.nickname);
  }, [hovered]);
  return <canvas ref={canvas} width={300} height={190} hidden={!hovered} />;
}

/** A guest is playing on the host's own map; offer to keep it. This is the
 *  only way someone else's map enters the local library
 *  (specs/level-editor.md §9). */
function SaveMapAction({
  mapId,
  mapName,
  onSaved,
}: {
  mapId: string;
  mapName: string;
  onSaved: (message: string) => void;
}) {
  const source = isCustomMapId(mapId) ? getTransientSource(mapId) : null;
  if (!source || getCustomMap(mapId)) return null;
  return (
    <>
      <span className="map-tag">custom</span>
      <button
        className="small"
        onClick={() => {
          try {
            createCustomMap({ name: uniqueMapName(mapName), template: source.template, origin: { kind: "import" } });
            onSaved('"' + mapName + '" saved to your maps.');
          } catch (e) {
            onSaved(e instanceof MapStorageError ? e.message : "Couldn't save that map.");
          }
        }}
      >
        Save to my maps
      </button>
    </>
  );
}

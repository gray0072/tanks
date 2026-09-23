import { useEffect, useRef, useState } from "react";
import type { EditorRoute, Navigate } from "../routes";
import type { RoomController } from "../../net/room";
import type { PlayerStats } from "../../world/rules";
import { seriesScoreLabel } from "../../world/series";
import type { TeamId } from "../../game/config";
import { useEnterKey } from "../hooks/useEnterKey";

export function Result({
  go,
  room,
  winner,
  stats,
  wins,
  returnTo,
}: {
  go: Navigate;
  room: RoomController;
  winner: TeamId | null;
  stats: Record<number, PlayerStats>;
  /** Rounds won per team over the whole series (SPEC §2.2) — the match was
   *  decided by these, not by frags, so they lead the banner. */
  wins: Record<TeamId, number>;
  /** Set when the match came from somewhere other than a room — the level
   *  editor's Test play (specs/level-editor.md §6.7). Replaces both exits,
   *  since there's no room to go back to. */
  returnTo?: EditorRoute;
}) {
  const [banner, setBanner] = useState("");

  const score = seriesScoreLabel(wins, winner);
  // Every round has a winner and the series ends when one team reaches the
  // target, so the only way here without a winner is a match abandoned.
  const bannerText = winner ? `${winner.toUpperCase()} WINS ${score}` : `MATCH ENDED ${score}`;
  const bannerClass = winner ?? "";

  const rows = room.slots
    .map((s) => ({ slot: s, st: stats[s.id] }))
    .filter((r) => r.st)
    .sort((a, b) => b.st.frags - a.st.frags);
  const mvp = rows[0];

  useEffect(() => {
    // Without this the room still delivers to the unmounted match screen's
    // callbacks, so a host who starts the next match while a guest is reading
    // the scoreboard leaves that guest behind.
    room.setCallbacks({
      onMatchStart: () => go({ k: "match", room, returnTo }),
      // A fresh series' first round arrives as matchStart; a later round
      // can't reach this screen, but hooking it keeps a guest from being
      // stranded here if one ever does.
      onRoundStart: () => go({ k: "match", room, returnTo }),
      onError: (msg) => setBanner(msg),
    });
  }, [room, go, returnTo]);

  const exit = () => {
    if (returnTo) {
      room.destroy();
      go(returnTo);
      return;
    }
    room.destroy();
    go({ k: "menu" });
  };
  const toRoom = () => {
    if (returnTo) {
      room.destroy();
      go(returnTo);
      return;
    }
    go({ k: "room", room });
  };
  const toRoomRef = useRef(toRoom);
  toRoomRef.current = toRoom;
  useEnterKey(() => toRoomRef.current());

  return (
    <div className="screen">
      <div className={`result-banner ${bannerClass}`}>{bannerText}</div>
      {/* The series score again, spelled out — the banner reads "BLUE WINS
          5:2", which is terse enough to be worth stating once in full. */}
      <div className="hint">
        Rounds won — Blue {wins.blue}, Red {wins.red}
      </div>
      <div className="hint">{banner}</div>
      {mvp ? (
        <div className="hint">
          MVP: {mvp.slot.nickname} — {mvp.st.frags} frags
        </div>
      ) : null}
      <div className="panel panel-wide">
        <div className="sb-row" style={{ fontWeight: 700 }}>
          <span>Player</span>
          <span>Frags</span>
          <span>Deaths</span>
          <span>Assists</span>
        </div>
        {rows.map((r) => (
          <div key={r.slot.id} className={`sb-row sb-${r.slot.team}`}>
            <span>{r.slot.nickname}</span>
            <span>{r.st.frags}</span>
            <span>{r.st.deaths}</span>
            <span>{r.st.assists}</span>
          </div>
        ))}
        <div className="row between" style={{ marginTop: 10 }}>
          <button onClick={exit}>Main Menu</button>
          <button className="primary" onClick={() => toRoomRef.current()}>
            Back to room
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Navigate } from "../routes";
import { RoomClient } from "../../net/client";
import { normalizeRoomCode, isValidRoomCode } from "../../net/roomCode";
import { loadUserSettings, saveUserSettings, randomGuestNickname } from "../../game/settings";
import { useEnterKey } from "../hooks/useEnterKey";

export function JoinRoom({ go, prefillCode }: { go: Navigate; prefillCode: string }) {
  const [nickname, setNickname] = useState(() => loadUserSettings().nickname || randomGuestNickname());
  const nameField = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(prefillCode);
  const [error, setError] = useState("");
  /** The connection in flight. Ownership passes to the room screen once it
   *  connects; only a client that never got there is torn down on unmount. */
  const room = useRef<RoomClient | null>(null);
  const navigated = useRef(false);

  // Read through refs: `join` is called from an effect that must not re-run
  // when the form changes, and from handlers that want the latest values.
  const form = useRef({ nickname, code });
  form.current = { nickname, code };

  const join = () => {
    const nick = form.current.nickname.trim().slice(0, 12) || randomGuestNickname();
    const roomCode = normalizeRoomCode(form.current.code);
    if (!isValidRoomCode(roomCode)) {
      setError("Enter a 6-character room code.");
      return;
    }
    saveUserSettings({ ...loadUserSettings(), nickname: nick });
    setError("Connecting…");

    room.current?.destroy();
    room.current = new RoomClient(roomCode, nick, {
      onRoomState: () => {
        if (navigated.current || !room.current) return;
        navigated.current = true;
        go({ k: "room", room: room.current });
      },
      onError: (msg) => setError(msg),
    });
  };
  const joinRef = useRef(join);
  joinRef.current = join;

  useEnterKey(() => joinRef.current());

  // An invite link fills the code in and stops there — the name is the one
  // thing the link can't know, so it is what gets the focus, pre-selected so
  // the suggested `Guest1234` is replaced by just typing.
  useEffect(() => {
    if (!prefillCode) return;
    nameField.current?.focus();
    nameField.current?.select();
  }, [prefillCode]);

  useEffect(
    () => () => {
      if (!navigated.current) room.current?.destroy();
    },
    [],
  );

  return (
    <div className="screen">
      <div className="title">Join Room</div>
      <div className="panel">
        {prefillCode ? <div className="hint">You were invited to room {prefillCode}.</div> : null}
        <label>
          Nickname
          <input
            ref={nameField}
            type="text"
            maxLength={12}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label>
          Room code
          <input
            type="text"
            className="code-input"
            maxLength={6}
            placeholder="ABC123"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
          />
        </label>
        <div className="error">{error}</div>
        <div className="row between">
          <button onClick={() => go({ k: "menu" })}>Back</button>
          <button className="primary" onClick={() => joinRef.current()}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import type { Navigate } from "../routes";
import { loadUserSettings, saveUserSettings, type Quality, type TouchSide } from "../../game/settings";
import { audio } from "../../audio/audio";
import { menuBackdrop as backdrop } from "../../game/menuBackdrop";
import { useEnterKey } from "../hooks/useEnterKey";

export function SettingsScreen({ go }: { go: Navigate }) {
  const [s, setS] = useState(loadUserSettings);

  const save = () => {
    const settings = { ...s, nickname: s.nickname.trim().slice(0, 12) };
    saveUserSettings(settings);
    audio.setVolume(settings.volume);
    // The backdrop reads the setting when it starts, so a toggle only takes
    // effect on the next start — force one either way as we leave.
    backdrop.setVisible(false);
    backdrop.setVisible(true);
    go({ k: "menu" });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEnterKey(() => saveRef.current());

  return (
    <div className="screen">
      <div className="title">Settings</div>
      <div className="panel">
        <label>
          Nickname
          <input
            type="text"
            maxLength={12}
            value={s.nickname}
            onChange={(e) => setS({ ...s, nickname: e.target.value })}
          />
        </label>
        <label>
          Volume
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.volume * 100)}
            onChange={(e) => setS({ ...s, volume: Number(e.target.value) / 100 })}
          />
        </label>
        <label>
          Render quality
          <select value={s.quality} onChange={(e) => setS({ ...s, quality: e.target.value as Quality })}>
            <option value="auto">Auto</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Movement stick side (touch)
          <select value={s.touchSide} onChange={(e) => setS({ ...s, touchSide: e.target.value as TouchSide })}>
            <option value="left">Left — fire on the right</option>
            <option value="right">Right — fire on the left</option>
          </select>
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={s.autoFullscreen}
            onChange={(e) => setS({ ...s, autoFullscreen: e.target.checked })}
          />{" "}
          Fullscreen on match start (touch)
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={s.menuBackdrop}
            onChange={(e) => setS({ ...s, menuBackdrop: e.target.checked })}
          />
          <span>Live battle behind the menus</span>
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={s.showPing}
            onChange={(e) => setS({ ...s, showPing: e.target.checked })}
          />{" "}
          Show ping
        </label>
        <div className="row between">
          <button onClick={() => go({ k: "menu" })}>Back</button>
          <button className="primary" onClick={() => saveRef.current()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

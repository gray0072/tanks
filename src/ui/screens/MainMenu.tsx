import { useEffect, useState } from "react";
import type { Navigate } from "../routes";
import { useEnterKey } from "../hooks/useEnterKey";
import { fullscreenSupported, isFullscreen, onFullscreenChange, toggleFullscreen } from "../../util/fullscreen";
import { HowToPlay } from "./HowToPlay";

export function MainMenu({ go, notice }: { go: Navigate; notice?: string }) {
  const [howTo, setHowTo] = useState(false);
  const [fullscreen, setFullscreen] = useState(isFullscreen);

  useEffect(() => onFullscreenChange(() => setFullscreen(isFullscreen())), []);

  useEnterKey(() => go({ k: "create" }), !howTo);

  return (
    <div className="screen">
      <div className="title">TANKS</div>
      <div className="subtitle">Team tank battle — Battle City style</div>
      {/* Why the player is looking at the menu instead of the room they were
          in a moment ago (SPEC §9.4). */}
      {notice ? <div className="error menu-notice">{notice}</div> : null}
      <div className="panel">
        <button className="primary" onClick={() => go({ k: "create" })}>
          Create Room
        </button>
        <button onClick={() => go({ k: "join" })}>Join Room</button>
        <button onClick={() => go({ k: "library", mode: "manage" })}>Level Editor</button>
        <button onClick={() => go({ k: "settings" })}>Settings</button>
        <button onClick={() => setHowTo(true)}>How to Play</button>
        {/* Offered on the menu as well as in-match so there's a way back out:
            a match auto-enters fullscreen on a phone (SPEC §5.4) and a phone
            has no Esc key to leave it with. */}
        {fullscreenSupported() ? (
          <button onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>
        ) : null}
      </div>
      <a
        className="repo-link"
        href="https://github.com/gray0072/tanks"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
          />
        </svg>
        Source on GitHub
      </a>
      {howTo ? <HowToPlay onClose={() => setHowTo(false)} /> : null}
    </div>
  );
}

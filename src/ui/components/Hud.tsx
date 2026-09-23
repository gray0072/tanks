// Match HUD — SPEC §6.2. Plain DOM (React), not Pixi Text: text-heavy chrome
// that changes at a low frequency is simpler and more accessible as HTML.
// Two components, not one: the stats/timer bar is a real layout row above the
// arena (`.match-topbar`), while everything else (banner, feed, bottom stats,
// scoreboard) overlays the arena itself (`.match-arena`) — see Match.tsx for
// where each is rendered.

import { useImperativeHandle, useState, type RefObject } from "react";
import type { Snapshot } from "../../world/sim";
import type { TeamId } from "../../game/config";

export type HudAction = "scoreboard" | "fullscreen" | "menu";

export type ScoreRow = { nickname: string; team: TeamId; frags: number; deaths: number; assists: number };

/** Banners and feed lines are transient and self-expiring, so they stay
 *  inside the HUD and are pushed in imperatively rather than being mirrored
 *  in the match's own state. */
export type HudHandle = {
  banner(text: string, ms?: number): void;
  feed(text: string): void;
};

export function HudTop({
  snap,
  frags,
  scoreboardPinned,
  fullscreenAvailable,
  fullscreenActive,
  onAction,
}: {
  snap: Snapshot | null;
  frags: Record<TeamId, number>;
  scoreboardPinned: boolean;
  fullscreenAvailable: boolean;
  fullscreenActive: boolean;
  onAction: (action: HudAction) => void;
}) {
  const minutes = snap ? Math.floor(snap.timeLeft / 60) : 0;
  const seconds = snap ? Math.floor(snap.timeLeft % 60) : 0;
  // Plain text glyphs, not emoji (🚩/💥 render as fixed-color glyphs that
  // ignore .hud-blue/.hud-red's `color`, so both teams' flags looked the
  // same) — these inherit the team color correctly.
  const flag = (team: TeamId) => (snap ? (snap.flagAlive[team] ? "⚑" : "✕") : "");
  const respawns = (team: TeamId) => (snap ? String(snap.respawns[team]) : "");

  return (
    <div className="hud-top">
      <div className="hud-team hud-blue">
        <span className="hud-respawns">{respawns("blue")}</span> respawns ·{" "}
        <span className="hud-frags">{frags.blue}</span> frags <span className="hud-flag">{flag("blue")}</span>
      </div>
      <div className="hud-timer">{minutes + ":" + String(seconds).padStart(2, "0")}</div>
      <div className="hud-team hud-red">
        <span className="hud-flag">{flag("red")}</span> <span className="hud-frags">{frags.red}</span> frags ·{" "}
        <span className="hud-respawns">{respawns("red")}</span>
      </div>
      {/* The only way to reach the scoreboard, the pause menu and fullscreen
          on a phone, where there is no Tab, no Esc and no browser chrome —
          but shown unconditionally, since a mouse user has no reason to be
          denied them either. Each blurs itself, or Space/Enter would
          re-trigger it mid-match. */}
      <div className="hud-actions">
        <HudButton action="scoreboard" title="Scoreboard (Tab)" active={scoreboardPinned} onAction={onAction}>
          ≡
        </HudButton>
        {fullscreenAvailable ? (
          <HudButton action="fullscreen" title="Fullscreen" active={fullscreenActive} onAction={onAction}>
            ⛶
          </HudButton>
        ) : null}
        <HudButton action="menu" title="Menu (Esc)" active={false} onAction={onAction}>
          ❚❚
        </HudButton>
      </div>
    </div>
  );
}

function HudButton({
  action,
  title,
  active,
  onAction,
  children,
}: {
  action: HudAction;
  title: string;
  active: boolean;
  onAction: (action: HudAction) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={"hud-btn" + (active ? " active" : "")}
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.currentTarget.blur();
        onAction(action);
      }}
    >
      {children}
    </button>
  );
}

let nextMessageId = 1;
type Message = { id: number; text: string };

export function HudOverlay({
  ref,
  snap,
  mySlot,
  scoreboard,
}: {
  ref: RefObject<HudHandle | null>;
  snap: Snapshot | null;
  mySlot: number | null;
  /** The rows to show, or null while the scoreboard is hidden. */
  scoreboard: ScoreRow[] | null;
}) {
  const [banners, setBanners] = useState<Message[]>([]);
  const [feed, setFeed] = useState<Message[]>([]);
  useImperativeHandle(ref, () => {
    const expire = (setList: (fn: (prev: Message[]) => Message[]) => void, id: number, ms: number) => {
      setTimeout(() => setList((prev) => prev.filter((m) => m.id !== id)), ms);
    };
    return {
      banner(text: string, ms = 3000) {
        const id = nextMessageId++;
        setBanners((prev) => [...prev, { id, text }]);
        expire(setBanners, id, ms);
      },
      feed(text: string) {
        const id = nextMessageId++;
        setFeed((prev) => [{ id, text }, ...prev].slice(0, 4));
        expire(setFeed, id, 6000);
      },
    };
  }, []);

  const me = snap && mySlot !== null ? snap.tanks.find((t) => t.slot === mySlot) : null;

  return (
    <div className="hud-overlay">
      <div className="hud-banner">
        {banners.map((b) => (
          <div key={b.id} className="hud-banner-item">
            {b.text}
          </div>
        ))}
      </div>
      <div className="hud-feed">
        {feed.map((f) => (
          <div key={f.id} className="hud-feed-item">
            {f.text}
          </div>
        ))}
      </div>
      <div className="hud-bottom">
        <span className="hud-stars">{me ? "★".repeat(me.star) : ""}</span>
        <span className="hud-buff">
          {me ? (me.helmetT > 0 ? "Shield " + me.helmetT.toFixed(0) + "s" : me.speedT > 0 ? "Speed " + me.speedT.toFixed(0) + "s" : "") : ""}
        </span>
        <span className="hud-mines">{me && me.mines > 0 ? "Mines: " + me.mines : ""}</span>
      </div>
      <div className="hud-scoreboard" hidden={!scoreboard}>
        {(scoreboard ?? []).map((r, i) => (
          <div key={i} className={"sb-row sb-" + r.team}>
            <span>{r.nickname}</span>
            <span>{r.frags}</span>
            <span>{r.deaths}</span>
            <span>{r.assists}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

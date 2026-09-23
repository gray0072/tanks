import { useEffect, useRef, useState } from "react";
import type { EditorRoute, Navigate } from "../routes";
import { NO_INPUT, type RoomController } from "../../net/room";
import type { Snapshot, MatchEvent } from "../../world/sim";
import { getMap } from "../../world/maps/loader";
import { createPixiApp, type PixiHost } from "../../render/app";
import { createAtlas } from "../../render/atlas";
import { Arena } from "../../render/arena";
import { Input } from "../../util/input";
import { audio } from "../../audio/audio";
import { loadUserSettings } from "../../game/settings";
import { TouchControls } from "../../game/touchControls";
import {
  enterFullscreen,
  fullscreenSupported,
  isFullscreen,
  lockLandscape,
  onFullscreenChange,
  toggleFullscreen,
} from "../../util/fullscreen";
import { CELL, DEFAULT_WINS_TARGET, type TeamId } from "../../game/config";
import { useEnterKey } from "../hooks/useEnterKey";
import { HudOverlay, HudTop, type HudAction, type HudHandle, type ScoreRow } from "../components/Hud";

type LiveStat = { frags: number; deaths: number };

const IS_TOUCH = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

export function Match({
  go,
  room,
  returnTo,
}: {
  go: Navigate;
  room: RoomController;
  /** Set when the match was started from somewhere other than a room — the
   *  level editor's Test play hands back the editor to return to
   *  (specs/level-editor.md §6.7). */
  returnTo?: EditorRoute;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [frags, setFrags] = useState<Record<TeamId, number>>({ blue: 0, red: 0 });
  // Rounds won so far and, between rounds, what to show over the frozen
  // battlefield while the next one is counted in (SPEC §2.2).
  const [wins, setWins] = useState<Record<TeamId, number>>({ blue: 0, red: 0 });
  const [intermission, setIntermission] = useState<{
    winner: TeamId;
    wins: Record<TeamId, number>;
    seconds: number;
  } | null>(null);
  const [paused, setPaused] = useState(false);
  // How many rounds take the match (SPEC §2.2). Settled when the match
  // started and fixed for its whole length, so it is read once.
  const [winsTarget] = useState(() => room.settings?.winsTarget || DEFAULT_WINS_TARGET);
  const [scoreboard, setScoreboard] = useState<ScoreRow[] | null>(null);
  const [scoreboardPinned, setScoreboardPinned] = useState(false);
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  const [rotateNotice, setRotateNotice] = useState(false);

  const screenEl = useRef<HTMLDivElement>(null);
  const pixiHostEl = useRef<HTMLDivElement>(null);
  const arenaEl = useRef<HTMLDivElement>(null);
  const hud = useRef<HudHandle>(null);

  const input = useRef<Input>(null);
  if (!input.current) input.current = new Input();
  const pixi = useRef<PixiHost | null>(null);
  const arena = useRef<Arena | null>(null);
  const touch = useRef<TouchControls | null>(null);

  const pausedRef = useRef(false);
  const endedRef = useRef(false);
  /** Rebuilds the scene for a new round; set once the renderer is up. */
  const rebuildArena = useRef<(() => void) | null>(null);
  /** The frame loop reads this rather than the state, same as it does for
   *  the pause flag — it runs outside React's render cycle. */
  const intermissionRef = useRef(false);
  intermissionRef.current = intermission !== null;
  const goRef = useRef(go);
  goRef.current = go;

  // Per-slot bookkeeping the HUD and the scoreboard read; fixed for the
  // lifetime of the match, so it lives in refs rather than state.
  const meta = useRef<{
    nicknames: Map<number, string>;
    slotTeams: Map<number, TeamId>;
    liveStats: Map<number, LiveStat>;
    myTeams: Set<TeamId>;
  }>(null);
  if (!meta.current) {
    const nicknames = new Map<number, string>();
    const slotTeams = new Map<number, TeamId>();
    const liveStats = new Map<number, LiveStat>();
    const myTeams = new Set<TeamId>();
    for (const s of room.slots) {
      nicknames.set(s.id, s.nickname);
      slotTeams.set(s.id, s.team);
      liveStats.set(s.id, { frags: 0, deaths: 0 });
    }
    for (const s of room.mySlots()) myTeams.add(s.team);
    meta.current = { nicknames, slotTeams, liveStats, myTeams };
  }

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    // With nobody else in the match, Esc really stops the world; with other
    // players connected the match keeps running and this is just a menu.
    if (next) {
      if (room.canPauseMatch()) room.setMatchPaused(true);
      // Nothing feeds input while the menu is up, so clear it — otherwise a
      // running match would keep replaying whatever was held when it opened.
      room.setLocalInput(0, NO_INPUT);
      if (room.hasLocalSeat2()) room.setLocalInput(1, NO_INPUT);
      // The overlay covers the touch zones, so their pointerup never arrives —
      // without this the tank would resume still driving and firing.
      touch.current?.release();
    } else {
      room.setMatchPaused(false);
    }
  };
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  const onHudAction = (action: HudAction) => {
    if (action === "menu") togglePauseRef.current();
    if (action === "fullscreen") void toggleFullscreen();
    if (action === "scoreboard") {
      setScoreboardPinned((pinned) => {
        const next = !pinned;
        input.current!.setTouchScoreboard(next);
        return next;
      });
    }
  };

  const leaveMatch = () => {
    room.setMatchPaused(false);
    if (returnTo) {
      room.destroy();
      goRef.current(returnTo);
      return;
    }
    room.destroy();
    goRef.current({ k: "menu" });
  };

  // One effect for the whole match: the Pixi app, the room callbacks, the
  // window listeners and the frame loop all start and stop together.
  useEffect(() => {
    const seat = input.current!;
    let disposed = false;
    let raf = 0;

    audio.unlock();
    audio.setVolume(loadUserSettings().volume);

    const bump = (slot: number, key: keyof LiveStat) => {
      const st = meta.current!.liveStats.get(slot);
      if (st) st[key]++;
    };
    const teamFrags = (team: TeamId): number => {
      let sum = 0;
      for (const [slot, st] of meta.current!.liveStats) if (meta.current!.slotTeams.get(slot) === team) sum += st.frags;
      return sum;
    };

    let statsDirty = false;
    const onEvents = (events: MatchEvent[]) => {
      arena.current?.applyEvents(events);
      for (const e of events) {
        if (e.type === "kill") {
          const killer = e.killerSlot !== null ? meta.current!.nicknames.get(e.killerSlot) ?? "?" : "Something";
          hud.current?.feed(killer + " destroyed " + (meta.current!.nicknames.get(e.victimSlot) ?? "?"));
          if (e.killerSlot !== null) bump(e.killerSlot, "frags");
          bump(e.victimSlot, "deaths");
          statsDirty = true;
          audio.explosion();
        }
        if (e.type === "pickup") {
          hud.current?.feed((meta.current!.nicknames.get(e.slot) ?? "?") + " picked up " + e.kind);
          audio.bonusPickup();
        }
        if (e.type === "flagHit") {
          hud.current?.banner(e.team.toUpperCase() + " FLAG DESTROYED", 4000);
          audio.flagAlarm();
        }
        if (e.type === "teamBonus") {
          hud.current?.banner(e.team.toUpperCase() + " team: " + e.kind + "!");
          audio.teamBonusFanfare();
        }
        if (e.type === "terrain") audio.brickCrumble();
      }
      setFrags({ blue: teamFrags("blue"), red: teamFrags("red") });
    };

    room.setCallbacks({
      onSnapshot: (s) => {
        arena.current?.applySnapshot(s);
        setSnap(s);
      },
      onMatchEvents: onEvents,
      onRoundEnd: (e) => {
        setWins(e.wins);
        setIntermission({ winner: e.winner, wins: e.wins, seconds: Math.ceil(e.nextRoundIn) });
        // Same reason the pause menu does it: the overlay swallows the touch
        // zones' pointerup, and nothing should carry over into the next round.
        room.setLocalInput(0, NO_INPUT);
        if (room.hasLocalSeat2()) room.setLocalInput(1, NO_INPUT);
        touch.current?.release();
        audio.matchEnd();
      },
      onRoundStart: (e) => {
        setWins(e.wins);
        setIntermission(null);
        // The terrain is back to the map's own state, so the scene that was
        // patched cell-by-cell through a whole round has to be thrown away.
        rebuildArena.current?.();
      },
      onMatchEnd: (winner, stats, seriesWins) => {
        if (endedRef.current) return;
        endedRef.current = true;
        audio.matchEnd();
        goRef.current({ k: "result", room, winner, stats, wins: seriesWins, returnTo });
      },
      onLeft: ({ reason }) => {
        if (endedRef.current) return;
        endedRef.current = true;
        room.destroy();
        goRef.current({ k: "menu", notice: reason });
      },
      onError: (msg) => hud.current?.banner(msg),
    });

    void (async () => {
      const map = getMap(room.mapId);
      const mount = document.createElement("div");
      mount.className = "pixi-mount";
      pixiHostEl.current?.appendChild(mount);
      const host = await createPixiApp(mount, map.width * CELL, map.height * CELL);
      if (disposed) {
        // The screen went away while the renderer was still starting up —
        // drop it rather than leaving an orphaned WebGL context behind.
        host.destroy();
        mount.remove();
        return;
      }
      pixi.current = host;
      const atlas = createAtlas(host.app);
      // The Pixi app and its mount outlive a round; only the scene graph is
      // rebuilt, exactly as the menu backdrop does between its own rounds.
      const buildArena = () => {
        if (arena.current) {
          host.world.removeChild(arena.current.world);
          arena.current.destroy();
        }
        const world = new Arena(atlas, map, room.slots);
        world.app = host.app;
        host.world.addChild(world.world);
        arena.current = world;
      };
      buildArena();
      rebuildArena.current = buildArena;

      if (IS_TOUCH && arenaEl.current) {
        // Mounted on the arena, not the whole screen: the zones then line up
        // with the battlefield and leave the top bar (and the system gesture
        // strip above it) alone. See touchControls.ts for the scheme.
        arenaEl.current.classList.add("has-touch");
        touch.current = new TouchControls(arenaEl.current, seat, loadUserSettings().touchSide);
      }
    })();

    const onKeyDown = () => {
      if (seat.consumeEscape()) togglePauseRef.current();
    };
    const checkOrientation = () => setRotateNotice(IS_TOUCH && window.innerHeight > window.innerWidth);
    const onFs = () => {
      setFullscreen(isFullscreen());
      checkOrientation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", checkOrientation);
    const unbindFullscreen = onFullscreenChange(onFs);
    checkOrientation();

    // Phones only, and only if the player left the setting on. The request is
    // refused outside a user gesture, which is exactly what happens to a guest
    // whose match was started by the host — so when the immediate attempt
    // fails we arm the player's next touch to do it instead.
    const armFullscreenOnGesture = () => {
      const once = () => {
        screenEl.current?.removeEventListener("pointerdown", once);
        void enterFullscreen().then((ok) => ok && void lockLandscape());
      };
      screenEl.current?.addEventListener("pointerdown", once);
    };
    if (IS_TOUCH && fullscreenSupported() && loadUserSettings().autoFullscreen) {
      void enterFullscreen().then((ok) => {
        if (disposed) return;
        if (ok) void lockLandscape();
        else armFullscreenOnGesture();
      });
    }

    let scoreboardWasHeld = false;
    const loop = () => {
      if (!pausedRef.current && !intermissionRef.current) {
        room.setLocalInput(0, seat.getSeatInput(0));
        if (room.hasLocalSeat2()) room.setLocalInput(1, seat.getSeatInput(1));
      }
      arena.current?.tick(meta.current!.myTeams);

      const held = seat.scoreboardHeld();
      if (held && (!scoreboardWasHeld || statsDirty)) {
        setScoreboard(
          room.slots
            .map((s) => ({
              nickname: s.nickname,
              team: s.team,
              ...meta.current!.liveStats.get(s.id)!,
              assists: 0,
            }))
            .sort((a, b) => b.frags - a.frags),
        );
        statsDirty = false;
      } else if (!held && scoreboardWasHeld) {
        setScoreboard(null);
      }
      scoreboardWasHeld = held;

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      disposed = true;
      rebuildArena.current = null;
      room.setMatchPaused(false);
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", checkOrientation);
      unbindFullscreen();
      touch.current?.destroy();
      touch.current = null;
      arena.current?.destroy();
      arena.current = null;
      pixi.current?.destroy();
      pixi.current = null;
    };
  }, [room, returnTo]);

  useEffect(() => {
    // The rotate notice covers the touch zones, same as the pause menu does.
    if (rotateNotice) touch.current?.release();
  }, [rotateNotice]);

  // The countdown between rounds ticks locally off the one figure the host
  // sent (SPEC §2.2) — it's a display, and the host alone decides when the
  // next round actually starts.
  useEffect(() => {
    if (!intermission) return;
    const id = setInterval(() => {
      setIntermission((cur) => (cur ? { ...cur, seconds: Math.max(0, cur.seconds - 1) } : cur));
    }, 1000);
    return () => clearInterval(id);
  }, [intermission !== null]);

  return (
    <div className="screen match-screen" ref={screenEl}>
      {/* Top row is a real layout row (stats + timer), not an overlay — the
          arena below it gets the rest of the screen, not the whole viewport. */}
      <div className="match-topbar">
        <HudTop
          snap={snap}
          frags={frags}
          wins={wins}
          winsTarget={winsTarget}
          scoreboardPinned={scoreboardPinned}
          fullscreenAvailable={fullscreenSupported()}
          fullscreenActive={fullscreen}
          onAction={onHudAction}
        />
      </div>
      <div className="match-arena" ref={arenaEl}>
        {/* The renderer's canvas goes in its own box ahead of the overlay, so
            the HUD (and the touch zones, appended after it) stay on top. */}
        <div ref={pixiHostEl} />
        <HudOverlay ref={hud} snap={snap} mySlot={room.mySlots()[0]?.id ?? null} scoreboard={scoreboard} />
      </div>
      {intermission ? (
        <RoundOverlay
          winner={intermission.winner}
          wins={intermission.wins}
          winsTarget={winsTarget}
          seconds={intermission.seconds}
        />
      ) : null}
      {paused ? (
        <PauseOverlay freezes={room.canPauseMatch()} onResume={() => togglePauseRef.current()} onLeave={leaveMatch} />
      ) : null}
      {rotateNotice ? <RotateNotice /> : null}
    </div>
  );
}

/** The breather between two rounds (SPEC §2.2): who took the round, where
 *  the series stands, and the count-in to the next one. The battlefield is
 *  left visible and frozen behind it — nothing is simulated while this is up. */
function RoundOverlay({
  winner,
  wins,
  winsTarget,
  seconds,
}: {
  winner: TeamId;
  wins: Record<TeamId, number>;
  winsTarget: number;
  seconds: number;
}) {
  const headline = winner.toUpperCase() + " TAKES THE ROUND";
  return (
    <div className="round-overlay">
      <div className="round-body">
        <div className={"round-headline " + winner}>{headline}</div>
        <div className="round-score">
          <span className="hud-blue">{wins.blue}</span>
          <span className="round-score-sep">:</span>
          <span className="hud-red">{wins.red}</span>
        </div>
        <div className="hint">First to {winsTarget} wins the match</div>
        <div className="round-countdown">{seconds > 0 ? seconds : "GO"}</div>
        <div className="hint">Next round — walls rebuilt, clock reset</div>
      </div>
    </div>
  );
}

function PauseOverlay({
  freezes,
  onResume,
  onLeave,
}: {
  freezes: boolean;
  onResume: () => void;
  onLeave: () => void;
}) {
  // Enter resumes while the menu is up. Nothing is focused on purpose: a
  // focused Resume button would toggle the pause a second time off the same
  // press (useEnterKey leaves a focused BUTTON alone).
  useEnterKey(onResume);
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  return (
    <div className="hud-scoreboard pause-overlay" style={{ pointerEvents: "auto" }}>
      <div className="pause-menu">
        <div className="title" style={{ fontSize: "1.4rem" }}>
          {freezes ? "Paused" : "Menu"}
        </div>
        <button className="primary" onClick={onResume}>
          {freezes ? "Resume" : "Back to match"}
        </button>
        <button className="danger" onClick={onLeave}>
          Leave match
        </button>
      </div>
    </div>
  );
}

function RotateNotice() {
  return (
    <div className="rotate-notice" style={{ display: "flex" }}>
      <div className="rotate-body">
        <div>Rotate your device — Tanks plays in landscape.</div>
        {/* The only way out on a device with rotation locked in its own
            settings: an orientation lock can only be taken while fullscreen,
            so offering fullscreen here is offering the rotation. */}
        {fullscreenSupported() ? (
          <button
            className="primary"
            type="button"
            onClick={() => void enterFullscreen().then((ok) => ok && void lockLandscape())}
          >
            Fullscreen &amp; rotate
          </button>
        ) : null}
      </div>
    </div>
  );
}

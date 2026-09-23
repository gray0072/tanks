// The How to Play overlay and its bonus legend (SPEC §4.3, "Look of a
// bonus"). The two pictures per row are canvases drawn with the same code the
// arena uses (render/bonusShape.ts via render/preview.ts), so the legend
// can't go stale.

import { useEffect, useRef } from "react";
import { BONUS_KINDS, type BonusKind } from "../../world/bonus";
import { BONUS_INFO } from "../../render/bonusShape";
import { drawBonusIcon, drawTankWithAura } from "../../render/preview";
import { useEnterKey } from "../hooks/useEnterKey";

/** Nominal CSS size of the two illustrations in the bonus legend (matched by
 *  `.bonus-pic-icon` / `.bonus-pic-aura` in style.css). The canvas surfaces
 *  are allocated at this times the device pixel ratio. */
const LEGEND_ICON_PX = 46;
const LEGEND_AURA_PX = 80;

function dpr(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

function BonusRow({ kind }: { kind: BonusKind }) {
  const icon = useRef<HTMLCanvasElement>(null);
  const aura = useRef<HTMLCanvasElement>(null);
  const info = BONUS_INFO[kind];

  useEffect(() => {
    if (icon.current) drawBonusIcon(icon.current, kind);
    if (aura.current) drawTankWithAura(aura.current, kind);
  }, [kind]);

  // Attribute size (the drawing surface) is DPR-scaled; the displayed box is
  // CSS-sized, so a phone media query can shrink the row without the art
  // going soft.
  const iconPx = Math.round(LEGEND_ICON_PX * dpr());
  const auraPx = Math.round(LEGEND_AURA_PX * dpr());
  return (
    <div className="bonus-row">
      <canvas ref={icon} className="bonus-pic bonus-pic-icon" width={iconPx} height={iconPx} />
      <canvas ref={aura} className="bonus-pic bonus-pic-aura" width={auraPx} height={auraPx} />
      <div className="bonus-text">
        <b>{info.title}</b>
        <br />
        {info.text}
      </div>
    </div>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);

  // The overlay takes Enter over for itself while it's up, so Enter closes it
  // instead of running the action behind it.
  useEnterKey(onClose);

  useEffect(() => {
    // Takes focus off the "How to Play" button that opened this, which would
    // otherwise swallow Enter and re-open the overlay. `preventScroll` so the
    // body always opens at the top, at the Objective heading.
    closeBtn.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="hud-scoreboard modal-center" style={{ pointerEvents: "auto" }}>
      {/* Close lives in a pinned footer, not at the end of the prose: on a
          desktop the body is several screens long, and a button that far down
          is effectively unreachable without scrolling to the bottom first. */}
      <div className="modal-body modal-howto">
        <div className="modal-scroll">
          <h3>Objective</h3>
          <p>
            Two teams, blue and red. Destroy the enemy flag, or grind the enemy team out of respawns
            before the clock runs out. Any slot you don't take is filled by a bot.
          </p>
          <h3>Controls — keyboard</h3>
          <p>
            <b>Player 1:</b> WASD move, 1 fire, 2 mine.
            <br />
            <b>Player 2 (same keyboard):</b> Arrow keys move, N fire, M mine.
            <br />
            Hold two direction keys to drive diagonally. Hold Tab for the scoreboard, Esc pauses.
          </p>
          <h3>Controls — touch</h3>
          <p>
            Put a thumb down anywhere on the <b>left half</b> of the battlefield and drag: a stick
            appears under your thumb and the tank drives that way, in any of 8 directions. Lift to
            stop.
            <br />
            <b>Tap anywhere on the right half</b> to fire; hold it down to keep firing. The MINE
            button in the top corner drops a mine.
            <br />
            Left-handed? Settings → Movement stick side swaps the two halves. The buttons in the top
            bar are the scoreboard, fullscreen and the pause menu.
          </p>
          <h3>Terrain</h3>
          <p>
            Brick breaks under fire, steel doesn't (until you're upgraded), forest hides you, water
            blocks tanks but not bullets, ice makes you slide, sand slows you down.
          </p>
          <h3>Bonuses</h3>
          <p>
            Bonuses appear on the battlefield now and then; drive over one to take it. The left
            picture is what lies on the ground, the right one is a tank carrying it — while a bonus
            is on you, its icons spin around your tank in that bonus's colour.
          </p>
          <div className="bonus-legend">
            {BONUS_KINDS.map((kind) => (
              <BonusRow key={kind} kind={kind} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button ref={closeBtn} className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

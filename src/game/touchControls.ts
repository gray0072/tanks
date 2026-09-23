// Mobile touch controls (SPEC §5.3).
//
// Two full-height zones over the battlefield rather than fixed widgets: the
// movement half is a *floating* stick — it has no home position, it appears
// wherever the thumb lands (the Minecraft pattern) — and the whole other half
// is the fire button, so shooting is a tap anywhere on that side instead of a
// 76px target you have to find without looking. One small MINE button is the
// only thing with a fixed position, parked in the outer top corner of the
// fire side — above the low arc a thumb sweeps while shooting.
//
// Pointer Events, not Touch Events: the old touch-event version read
// `e.touches[0]`, so the moment a second finger went down on the fire side
// the stick started following *it* and the tank drove off on its own. Pointer
// capture per zone gives each thumb its own independent stream.

import { FIRE_COOLDOWN } from "./config";
import type { Input } from "../util/input";
import { dirFromAngle } from "../util/math";

/** Radius, in px, the thumb must travel from the stick's origin before the
 *  tank moves at all — below it the stick reads as "stop", so you can hold
 *  still without lifting your thumb. */
const DEAD_ZONE = 14;
/** Knob travel. Past this the origin is dragged along behind the thumb, so a
 *  long swipe never runs out of stick and never needs a re-grab. */
const STICK_RADIUS = 52;
/** A tap is shorter than the reload, so a bare press-and-release would be
 *  silently swallowed whenever it landed mid-cooldown. Holding `fire` for one
 *  full reload makes every tap produce exactly one shot, as soon as the gun
 *  is ready. */
const FIRE_TAP_MS = Math.ceil(FIRE_COOLDOWN * 1000);

export type TouchSide = "left" | "right";

export class TouchControls {
  private root: HTMLDivElement;
  private moveZone: HTMLDivElement;
  private fireZone: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private movePointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private firePointers = new Set<number>();
  private firePressedAt = 0;
  private fireTimer = 0;

  constructor(host: HTMLElement, private input: Input, side: TouchSide) {
    this.root = document.createElement("div");
    this.root.className = `touch-controls side-${side}`;
    this.root.innerHTML = `
      <div class="tc-zone tc-move"></div>
      <div class="tc-zone tc-fire"><span class="tc-fire-hint">TAP TO FIRE</span></div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <button class="tc-btn tc-mine" type="button">MINE</button>
    `;
    host.appendChild(this.root);

    this.moveZone = this.q(".tc-move");
    this.fireZone = this.q(".tc-fire");
    this.stick = this.q(".tc-stick");
    this.knob = this.q(".tc-knob");

    this.moveZone.addEventListener("pointerdown", this.onMoveDown);
    this.moveZone.addEventListener("pointermove", this.onMoveMove);
    this.moveZone.addEventListener("pointerup", this.onMoveUp);
    this.moveZone.addEventListener("pointercancel", this.onMoveUp);

    this.fireZone.addEventListener("pointerdown", this.onFireDown);
    this.fireZone.addEventListener("pointerup", this.onFireUp);
    this.fireZone.addEventListener("pointercancel", this.onFireUp);

    const mine = this.q<HTMLButtonElement>(".tc-mine");
    mine.addEventListener("pointerdown", this.onMineDown);
    mine.addEventListener("pointerup", this.onMineUp);
    mine.addEventListener("pointercancel", this.onMineUp);
    // The MINE button sits inside the fire zone; without this its taps would
    // also register as "shoot".
    mine.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  private q<T extends HTMLElement = HTMLDivElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  // --- movement stick -------------------------------------------------------

  private onMoveDown = (e: PointerEvent) => {
    if (this.movePointer !== null) return; // a second finger on this side is ignored
    e.preventDefault();
    this.movePointer = e.pointerId;
    this.moveZone.setPointerCapture(e.pointerId);
    this.placeOrigin(e.clientX, e.clientY);
    this.stick.classList.add("active");
    this.drawKnob(0, 0);
    this.input.setTouchDir(null);
  };

  private onMoveMove = (e: PointerEvent) => {
    if (e.pointerId !== this.movePointer) return;
    e.preventDefault();
    const rect = this.root.getBoundingClientRect();
    let dx = e.clientX - rect.left - this.originX;
    let dy = e.clientY - rect.top - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // Drag the origin along so it trails the thumb at exactly one radius:
      // the stick stays at full deflection and keeps responding to small
      // corrections instead of pinning at the rim.
      const k = (len - STICK_RADIUS) / len;
      this.originX += dx * k;
      this.originY += dy * k;
      this.stick.style.left = `${this.originX}px`;
      this.stick.style.top = `${this.originY}px`;
      dx -= dx * k;
      dy -= dy * k;
    }
    this.drawKnob(dx, dy);
    this.input.setTouchDir(len < DEAD_ZONE ? null : dirFromAngle(Math.atan2(dy, dx)));
  };

  private onMoveUp = (e: PointerEvent) => {
    if (e.pointerId !== this.movePointer) return;
    this.movePointer = null;
    this.stick.classList.remove("active");
    this.input.setTouchDir(null);
  };

  private placeOrigin(clientX: number, clientY: number) {
    const rect = this.root.getBoundingClientRect();
    this.originX = clientX - rect.left;
    this.originY = clientY - rect.top;
    this.stick.style.left = `${this.originX}px`;
    this.stick.style.top = `${this.originY}px`;
  }

  private drawKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // --- fire -----------------------------------------------------------------

  private onFireDown = (e: PointerEvent) => {
    e.preventDefault();
    this.fireZone.setPointerCapture(e.pointerId);
    this.firePointers.add(e.pointerId);
    if (this.firePointers.size === 1) {
      this.firePressedAt = performance.now();
      clearTimeout(this.fireTimer);
      this.input.setTouchFire(true);
      this.root.classList.add("firing");
    }
  };

  private onFireUp = (e: PointerEvent) => {
    if (!this.firePointers.delete(e.pointerId)) return;
    if (this.firePointers.size > 0) return;
    this.root.classList.remove("firing");
    const remaining = FIRE_TAP_MS - (performance.now() - this.firePressedAt);
    if (remaining <= 0) {
      this.input.setTouchFire(false);
    } else {
      clearTimeout(this.fireTimer);
      this.fireTimer = window.setTimeout(() => this.input.setTouchFire(false), remaining);
    }
  };

  // --- mine -----------------------------------------------------------------
  // No latch here: the sim drops a mine on the press edge (Sim.stepFiring), so
  // holding the button still costs exactly one mine.

  private onMineDown = (e: PointerEvent) => {
    e.preventDefault();
    this.input.setTouchMine(true);
  };

  private onMineUp = () => this.input.setTouchMine(false);

  /** Clears everything the player was holding — used when the pause menu
   *  opens over the controls, which eats the matching pointerup. */
  release() {
    this.movePointer = null;
    this.firePointers.clear();
    this.stick.classList.remove("active");
    this.root.classList.remove("firing");
    clearTimeout(this.fireTimer);
    this.input.setTouchDir(null);
    this.input.setTouchFire(false);
    this.input.setTouchMine(false);
  }

  destroy() {
    this.release();
    this.root.remove();
  }
}

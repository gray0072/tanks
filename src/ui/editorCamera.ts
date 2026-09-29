// The level editor's view of its grid — specs/level-editor.md §6.1. Pure
// numbers, no DOM, so the zoom/pan rules can be tested headless.
//
// A camera is a cell size in CSS pixels plus where the map's top-left corner
// sits inside the pane. The pane always shows the whole map at the smallest
// zoom ("fit"); zooming in lets the map overflow the pane, and the offset is
// clamped so it can never be dragged out of sight.

export type Camera = { s: number; ox: number; oy: number };
export type Size = { w: number; h: number };

/** Largest cell the fitted view uses — a 2x2 map shouldn't fill the screen
 *  with four giant squares. */
export const FIT_MAX_CELL = 40;
/** How far in you can zoom, whatever the map. Big enough for a fingertip. */
export const MAX_CELL = 64;
/** Room left around an overflowing map, so its edge cells aren't stuck
 *  under the pane's corner buttons. */
export const EDGE_MARGIN = 28;

export function fitScale(pane: Size, map: Size): number {
  const s = Math.min(pane.w / map.w, pane.h / map.h);
  return Math.max(1, Math.min(FIT_MAX_CELL, s));
}

export function scaleRange(pane: Size, map: Size): { min: number; max: number } {
  const min = fitScale(pane, map);
  return { min, max: Math.max(min, MAX_CELL) };
}

/** Centers an axis that fits and keeps an overflowing one within the pane
 *  (plus a margin). */
function clampAxis(offset: number, pane: number, content: number): number {
  if (content <= pane) return (pane - content) / 2;
  return Math.min(EDGE_MARGIN, Math.max(pane - content - EDGE_MARGIN, offset));
}

export function clampCamera(cam: Camera, pane: Size, map: Size): Camera {
  const { min, max } = scaleRange(pane, map);
  const s = Math.min(max, Math.max(min, cam.s));
  return {
    s,
    ox: clampAxis(cam.ox, pane.w, map.w * s),
    oy: clampAxis(cam.oy, pane.h, map.h * s),
  };
}

export function fitCamera(pane: Size, map: Size): Camera {
  return clampCamera({ s: fitScale(pane, map), ox: 0, oy: 0 }, pane, map);
}

/** Zoom by `factor`, keeping the map point under (px, py) where it is. */
export function zoomAt(cam: Camera, factor: number, px: number, py: number, pane: Size, map: Size): Camera {
  const { min, max } = scaleRange(pane, map);
  const s = Math.min(max, Math.max(min, cam.s * factor));
  const k = s / cam.s;
  return clampCamera({ s, ox: px - (px - cam.ox) * k, oy: py - (py - cam.oy) * k }, pane, map);
}

/** Put map point (mx, my) — in cells — at the middle of the pane. */
export function centerOn(cam: Camera, mx: number, my: number, pane: Size, map: Size): Camera {
  return clampCamera({ s: cam.s, ox: pane.w / 2 - mx * cam.s, oy: pane.h / 2 - my * cam.s }, pane, map);
}

/** True when the camera shows every cell of the map. */
export function showsWholeMap(cam: Camera, pane: Size, map: Size): boolean {
  const eps = 0.5;
  return (
    cam.ox >= -eps &&
    cam.oy >= -eps &&
    cam.ox + map.w * cam.s <= pane.w + eps &&
    cam.oy + map.h * cam.s <= pane.h + eps
  );
}

/** The cell under a pane-relative point; may be outside the map. */
export function cellUnder(cam: Camera, px: number, py: number): { cx: number; cy: number } {
  return { cx: Math.floor((px - cam.ox) / cam.s), cy: Math.floor((py - cam.oy) / cam.s) };
}

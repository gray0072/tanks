// The level editor — specs/level-editor.md §6. Palette on the left, the grid
// on a Canvas2D filling the rest (UI, not the arena: no second WebGL context,
// same reasoning as render/preview.ts) behind a zoom/pan camera
// (ui/editorCamera.ts), size/anchor controls and the live problem list under
// the palette.
//
// The document itself (world/maps/editorModel.ts) stays a mutable object in a
// ref, not React state: it is a big grid with an undo stack, and a paint
// stroke touches it many times per second. React is told "something changed"
// with a version counter, and the grid is painted onto the canvas by hand.

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorRoute, Navigate } from "../routes";
import { EditorDoc, EditorModel, isEntityGlyph, isTerrainGlyph, type Anchor } from "../../world/maps/editorModel";
import {
  clearEditorDraft,
  createCustomMap,
  getCustomMap,
  listCustomMaps,
  loadEditorDraft,
  MapStorageError,
  saveEditorDraft,
  uniqueMapName,
  updateCustomMap,
} from "../../world/maps/customMaps";
import { hasErrors, validateMapTemplate, type Cell } from "../../world/maps/validateMap";
import { registerTransientMap } from "../../world/maps/loader";
import { CHAR_TILE } from "../../world/maps/mapChars";
import { TILE_COLOR } from "../../render/preview";
import {
  cellUnder,
  centerOn,
  clampCamera,
  fitCamera,
  scaleRange,
  showsWholeMap,
  zoomAt,
  type Camera,
  type Size,
} from "../editorCamera";
import { useModal } from "../hooks/useModal";
import { loadUserSettings, randomGuestNickname } from "../../game/settings";
import { RoomHost } from "../../net/host";
import {
  EDITOR_MAX_H,
  EDITOR_MAX_NAME,
  EDITOR_MAX_W,
  EDITOR_MIN_H,
  EDITOR_MIN_W,
  TEAM_COLOR,
} from "../../game/config";

type PaletteEntry = { glyph: string; label: string; color: string };

const TERRAIN_PALETTE: PaletteEntry[] = [
  { glyph: ".", label: "Empty", color: TILE_COLOR[CHAR_TILE["."]] },
  { glyph: "#", label: "Brick", color: TILE_COLOR[CHAR_TILE["#"]] },
  { glyph: "@", label: "Steel", color: TILE_COLOR[CHAR_TILE["@"]] },
  { glyph: "%", label: "Forest", color: TILE_COLOR[CHAR_TILE["%"]] },
  { glyph: "~", label: "Water", color: TILE_COLOR[CHAR_TILE["~"]] },
  { glyph: "-", label: "Ice", color: TILE_COLOR[CHAR_TILE["-"]] },
  { glyph: ",", label: "Sand", color: TILE_COLOR[CHAR_TILE[","]] },
  { glyph: "*", label: "Bonus", color: "#ffd23d" },
];

const ENTITY_PALETTE: PaletteEntry[] = [
  { glyph: "R", label: "Red flag", color: hex(TEAM_COLOR.red) },
  { glyph: "B", label: "Blue flag", color: hex(TEAM_COLOR.blue) },
  { glyph: "r", label: "Red spawn", color: "#ff9a9a" },
  { glyph: "b", label: "Blue spawn", color: "#7fb0ff" },
];

const PALETTE = [...TERRAIN_PALETTE, ...ENTITY_PALETTE];

/** Transient id the test match runs under when the map has never been saved. */
const TEST_MAP_ID = "custom-editor-test";

export function Editor({ go, route }: { go: Navigate; route: EditorRoute }) {
  // Everything the editor opens with, settled once: the working document,
  // its name, and whether it already counts as unsaved work.
  const [initial] = useState(() => {
    const record = route.mapId ? getCustomMap(route.mapId) : null;
    if (route.doc) {
      // Coming back from a test match with work in hand: it was never saved
      // to the library on the way out, so it's still dirty.
      return { doc: route.doc, name: route.name ?? record?.name ?? "New map", dirty: true };
    }
    if (record) return { doc: EditorDoc.fromTemplate(record.template), name: record.name, dirty: false };
    return { doc: new EditorDoc(EditorModel.blank()), name: uniqueMapName("New map"), dirty: false };
  });
  const doc = useRef<EditorDoc>(initial.doc);
  const mapId = useRef<string | null>(route.mapId);
  const dirty = useRef(initial.dirty);
  const [name, setName] = useState(initial.name);

  /** Bumped whenever the document changes, which is what makes React redraw
   *  the palette counts, the size fields, the problem list and the grid. */
  const [version, setVersion] = useState(0);
  const [brush, setBrush] = useState("#");
  const [rectMode, setRectMode] = useState(false);
  const [toast, setToast] = useState("");
  const [anchorX, setAnchorX] = useState<Anchor>("start");
  const [anchorY, setAnchorY] = useState<Anchor>("start");
  const [highlight, setHighlight] = useState<Cell[]>([]);
  const [wField, setWField] = useState(() => String(doc.current.model.width));
  const [hField, setHField] = useState(() => String(doc.current.model.height));

  const canvas = useRef<HTMLCanvasElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    start: { cx: number; cy: number };
    current: { cx: number; cy: number };
    rect: boolean;
  } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { show, node: modal } = useModal();

  const model = doc.current.model;

  // The document is a ref, so `version` is how it reports a change here.
  const problems = useMemo(() => {
    const others = listCustomMaps()
      .filter((m) => m.id !== mapId.current)
      .map((m) => m.name);
    return validateMapTemplate(doc.current.template, { name, otherNames: others });
  }, [version, name]);
  const blocked = hasErrors(problems);

  const showToast = (msg: string) => {
    setToast(msg);
    if (!msg) return;
    setTimeout(() => setToast((current) => (current === msg ? "" : current)), 3000);
  };

  const markDirty = () => {
    dirty.current = true;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveEditorDraft({ mapId: mapId.current, name, template: doc.current.template, savedAt: Date.now() });
    }, 1000);
  };
  const markDirtyRef = useRef(markDirty);
  markDirtyRef.current = markDirty;

  // --- view (zoom and pan, §6.1) ---------------------------------------------

  /** The camera lives in refs, not state: a pinch moves it 60+ times a second
   *  and only the canvas needs to know. `fitMode` means "keep showing the
   *  whole map" — it survives a pane or map resize by refitting. */
  const cam = useRef<Camera>({ s: 16, ox: 0, oy: 0 });
  const fitMode = useRef(true);
  /** Where the view was before the "whole map" peek, to go back to. */
  const peekFrom = useRef<Camera | null>(null);
  const paneSize = useRef<Size>({ w: 0, h: 0 });
  const [wholeVisible, setWholeVisible] = useState(true);
  const [peeking, setPeeking] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const minimap = useRef<HTMLCanvasElement>(null);

  const mapSize = (): Size => ({ w: doc.current.model.width, h: doc.current.model.height });

  const setCamera = (next: Camera) => {
    cam.current = clampCamera(next, paneSize.current, mapSize());
    fitMode.current = false;
    peekFrom.current = null;
    setPeeking(false);
    redrawRef.current();
  };

  const zoomBy = (factor: number, px = paneSize.current.w / 2, py = paneSize.current.h / 2) => {
    setCamera(zoomAt(cam.current, factor, px, py, paneSize.current, mapSize()));
  };

  /** One button for both directions: show the whole map, then press again to
   *  return to exactly where you were zoomed in. */
  const toggleWhole = () => {
    if (peekFrom.current) {
      const back = peekFrom.current;
      setCamera(back);
      return;
    }
    if (fitMode.current) return;
    peekFrom.current = cam.current;
    fitMode.current = true;
    setPeeking(true);
    redrawRef.current();
  };
  const toggleWholeRef = useRef(toggleWhole);
  toggleWholeRef.current = toggleWhole;
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  // --- drawing ---------------------------------------------------------------

  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  /** The canvas always fills its pane; the camera decides which cells land
   *  where. Drawn in device pixels with cell edges rounded, so a fractional
   *  zoom never leaves hairline seams between cells. */
  const redraw = () => {
    const el = canvas.current;
    const box = pane.current?.getBoundingClientRect();
    if (!el || !box) return;
    const m = doc.current.model;
    const map = mapSize();
    paneSize.current = { w: Math.max(1, box.width - 2), h: Math.max(1, box.height - 2) };
    cam.current = fitMode.current
      ? fitCamera(paneSize.current, map)
      : clampCamera(cam.current, paneSize.current, map);
    setWholeVisible(showsWholeMap(cam.current, paneSize.current, map));

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(paneSize.current.w * dpr);
    const bh = Math.round(paneSize.current.h * dpr);
    if (el.width !== bw || el.height !== bh) {
      el.width = bw;
      el.height = bh;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05080c";
    ctx.fillRect(0, 0, bw, bh);

    const S = cam.current.s * dpr;
    const OX = cam.current.ox * dpr;
    const OY = cam.current.oy * dpr;
    const X = (x: number) => Math.round(OX + x * S);
    const Y = (y: number) => Math.round(OY + y * S);
    const x0 = Math.max(0, Math.floor(-OX / S));
    const y0 = Math.max(0, Math.floor(-OY / S));
    const x1 = Math.min(m.width - 1, Math.floor((bw - OX) / S));
    const y1 = Math.min(m.height - 1, Math.floor((bh - OY) / S));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const g = m.at(x, y);
        ctx.fillStyle = cellColor(g);
        ctx.fillRect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
        if (g === "*") {
          ctx.fillStyle = "#ffd23d";
          ctx.beginPath();
          ctx.arc(OX + (x + 0.5) * S, OY + (y + 0.5) * S, Math.max(1.5, S * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Spawns carry their scan-order index (SPEC §3.5: where you place the
    // marker *is* the priority), so the numbering isn't a surprise later.
    for (const glyph of ["r", "b"] as const) {
      m.find(glyph).forEach((p, i) => {
        const cx = OX + (p.x + 0.5) * S;
        const cy = OY + (p.y + 0.5) * S;
        ctx.fillStyle = glyph === "r" ? "#ff9a9a" : "#7fb0ff";
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, S * 0.34), 0, Math.PI * 2);
        ctx.fill();
        if (cam.current.s >= 14) {
          ctx.fillStyle = "#0b0f14";
          ctx.font = Math.round(S * 0.5) + "px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), cx, cy + dpr);
        }
      });
    }

    if (cam.current.s >= 6) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      for (let x = x0; x <= x1 + 1; x++) line(ctx, X(x), Y(y0), X(x), Y(y1 + 1));
      for (let y = y0; y <= y1 + 1; y++) line(ctx, X(x0), Y(y), X(x1 + 1), Y(y));
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      for (let x = Math.ceil(x0 / 5) * 5; x <= x1 + 1; x += 5) line(ctx, X(x), Y(y0), X(x), Y(y1 + 1));
      for (let y = Math.ceil(y0 / 5) * 5; y <= y1 + 1; y += 5) line(ctx, X(x0), Y(y), X(x1 + 1), Y(y));
    }

    // The map's edge is solid in play (SPEC §3.5), so it gets a visible border
    // just outside the grid.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(X(0) - dpr, Y(0) - dpr, X(m.width) - X(0) + 2 * dpr, Y(m.height) - Y(0) + 2 * dpr);

    ctx.lineWidth = 2 * dpr;
    for (const c of highlightRef.current) {
      ctx.strokeStyle = "#ffd23d";
      ctx.strokeRect(X(c.cx) + dpr, Y(c.cy) + dpr, X(c.cx + 1) - X(c.cx) - 2 * dpr, Y(c.cy + 1) - Y(c.cy) - 2 * dpr);
    }

    const d = drag.current;
    if (d?.rect) {
      const r = m.normalizeRect(d.start.cx, d.start.cy, d.current.cx, d.current.cy);
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(X(r.x0), Y(r.y0), X(r.x1 + 1) - X(r.x0), Y(r.y1 + 1) - Y(r.y0));
    }

    drawMinimap();
  };

  /** The overview in the pane's corner: the whole map small, with the part
   *  on screen outlined. Only shown while zoomed in far enough to hide some
   *  of the map. */
  const minimapScale = () => {
    const m = doc.current.model;
    const box = paneSize.current.w < 420 ? 92 : 140;
    return Math.max(1, Math.min(box / m.width, box / m.height));
  };
  const drawMinimap = () => {
    const el = minimap.current;
    if (!el) return;
    const m = doc.current.model;
    const dpr = window.devicePixelRatio || 1;
    const ms = minimapScale();
    const cssW = m.width * ms;
    const cssH = m.height * ms;
    el.style.width = cssW + "px";
    el.style.height = cssH + "px";
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (el.width !== bw || el.height !== bh) {
      el.width = bw;
      el.height = bh;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const k = ms * dpr;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const g = m.at(x, y);
        ctx.fillStyle = g === "r" ? "#ff9a9a" : g === "b" ? "#7fb0ff" : g === "*" ? "#ffd23d" : cellColor(g);
        ctx.fillRect(Math.floor(x * k), Math.floor(y * k), Math.ceil(k), Math.ceil(k));
      }
    }
    const c = cam.current;
    const vx = Math.max(0, -c.ox / c.s);
    const vy = Math.max(0, -c.oy / c.s);
    const vw = Math.min(m.width, (paneSize.current.w - c.ox) / c.s) - vx;
    const vh = Math.min(m.height, (paneSize.current.h - c.oy) / c.s) - vy;
    ctx.strokeStyle = "#ffd23d";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(vx * k + dpr, vy * k + dpr, vw * k - 2 * dpr, vh * k - 2 * dpr);
  };

  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    redrawRef.current();
  }, [version, highlight]);

  useEffect(() => {
    const el = pane.current;
    const ro = el ? new ResizeObserver(() => redrawRef.current()) : null;
    if (el && ro) ro.observe(el);
    return () => {
      ro?.disconnect();
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  const setCameraRef = useRef(setCamera);
  setCameraRef.current = setCamera;

  // Wheel zooms around the cursor; a sideways scroll (a trackpad's two-finger
  // swipe) pans instead. A native listener, because React's onWheel is
  // passive and couldn't stop the page from scrolling.
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (!e.ctrlKey && dx !== 0) {
        const c = cam.current;
        setCameraRef.current({ s: c.s, ox: c.ox - dx, oy: c.oy - dy });
        return;
      }
      const box = el.getBoundingClientRect();
      // A trackpad pinch arrives as ctrl+wheel with small deltas.
      const factor = Math.pow(e.ctrlKey ? 1.01 : 1.0015, -dy);
      zoomByRef.current(factor, e.clientX - box.left - 1, e.clientY - box.top - 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    setWField(String(doc.current.model.width));
    setHField(String(doc.current.model.height));
  }, [version]);

  // --- painting and gestures ---------------------------------------------------

  /** Every pointer currently down on the grid, in pane coordinates. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** A one-pointer pan (middle button, Space, the Pan tool, or a press off the
   *  map), or a two-finger pinch that zooms and pans together. */
  const gesture = useRef<
    | { kind: "pan"; id: number; x: number; y: number }
    | { kind: "pinch"; d0: number; cam0: Camera; mx: number; my: number }
    | null
  >(null);

  const local = (e: React.PointerEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    return cellUnder(cam.current, p.x, p.y);
  };

  /** Right button / two fingers erase, whatever the palette says (§6.4). */
  const brushFor = (e: React.PointerEvent) => (e.button === 2 || (e.buttons & 2) !== 0 ? "." : brush);

  const reportPaint = (result: string) => {
    if (result === "spawn-limit") showToast("That team already has the maximum number of spawns.");
    else if (result === "bonus-limit") showToast("The map already has the maximum number of bonus points.");
    else if (result === "entity-rect") showToast("Flags and spawns are placed one at a time, not dragged.");
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const c = cam.current;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture.current = {
      kind: "pinch",
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      cam0: c,
      // The map point under the fingers' midpoint, which the pinch keeps
      // under their midpoint however they move.
      mx: (mid.x - c.ox) / c.s,
      my: (mid.y - c.oy) / c.s,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();

    // A second finger turns whatever the first one started into a pinch. The
    // stroke it may already have painted is taken back, so reaching for a
    // zoom never leaves a stray cell behind.
    if (e.pointerType === "touch" && pointers.current.size === 2) {
      if (drag.current) {
        drag.current = null;
        if (doc.current.cancelStroke()) setVersion((v) => v + 1);
      }
      startPinch();
      redrawRef.current();
      return;
    }
    // Per-pointer ownership, not a document-level listener: an extra finger
    // or button never hijacks a stroke (SPEC §5.3's lesson).
    if (drag.current || gesture.current) return;

    const cell = cellUnder(cam.current, p.x, p.y);
    const offMap = !doc.current.model.inBounds(cell.cx, cell.cy);
    if (e.button === 1 || panModeRef.current || spaceHeldRef.current || offMap) {
      gesture.current = { kind: "pan", id: e.pointerId, x: p.x, y: p.y };
      return;
    }
    const g = brushFor(e);
    drag.current = { id: e.pointerId, start: cell, current: cell, rect: (rectMode || e.shiftKey) && isTerrainGlyph(g) };
    doc.current.beginStroke();
    if (!drag.current.rect) reportPaint(doc.current.model.paint(cell.cx, cell.cy, g));
    redrawRef.current();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);

    const gs = gesture.current;
    if (gs?.kind === "pan" && gs.id === e.pointerId) {
      const c = cam.current;
      setCamera({ s: c.s, ox: c.ox + p.x - gs.x, oy: c.oy + p.y - gs.y });
      gs.x = p.x;
      gs.y = p.y;
      return;
    }
    if (gs?.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const range = scaleRange(paneSize.current, mapSize());
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const s = Math.min(range.max, Math.max(range.min, (gs.cam0.s * d) / gs.d0));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setCamera({ s, ox: mid.x - gs.mx * s, oy: mid.y - gs.my * s });
      return;
    }

    const dr = drag.current;
    if (!dr || dr.id !== e.pointerId) return;
    const cell = cellAt(e);
    if (cell.cx === dr.current.cx && cell.cy === dr.current.cy) return;
    dr.current = cell;
    const g = brushFor(e);
    // Entity brushes don't drag (§6.4) — only the cell that was clicked.
    if (!dr.rect && isTerrainGlyph(g)) reportPaint(doc.current.model.paint(cell.cx, cell.cy, g));
    redrawRef.current();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    const gs = gesture.current;
    if (gs) {
      // A pinch lasts until every finger is up: the one left behind must not
      // start painting where it happens to rest.
      if ((gs.kind === "pan" && gs.id === e.pointerId) || (gs.kind === "pinch" && pointers.current.size === 0)) {
        gesture.current = null;
      }
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.rect) {
      reportPaint(doc.current.model.fillRect(d.start.cx, d.start.cy, d.current.cx, d.current.cy, brushFor(e)));
    }
    drag.current = null;
    if (doc.current.endStroke()) markDirtyRef.current();
    setVersion((v) => v + 1);
  };

  /** Drag on the overview to move the view there. */
  const onMinimapPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    const ms = minimapScale();
    setCamera(centerOn(cam.current, (e.clientX - box.left) / ms, (e.clientY - box.top) / ms, paneSize.current, mapSize()));
  };

  /** Clicking a problem while zoomed in brings its first cell into view. */
  const showProblem = (cells: Cell[]) => {
    setHighlight(cells);
    const c = cells[0];
    if (!c || fitMode.current) return;
    const p = paneSize.current;
    const onScreen =
      cam.current.ox + c.cx * cam.current.s >= 0 &&
      cam.current.oy + c.cy * cam.current.s >= 0 &&
      cam.current.ox + (c.cx + 1) * cam.current.s <= p.w &&
      cam.current.oy + (c.cy + 1) * cam.current.s <= p.h;
    if (!onScreen) setCamera(centerOn(cam.current, c.cx + 0.5, c.cy + 0.5, p, mapSize()));
  };

  // --- resize ---------------------------------------------------------------

  const applyResize = async (rawW: string, rawH: string) => {
    const m = doc.current.model;
    const w = clampInt(rawW, EDITOR_MIN_W, EDITOR_MAX_W, m.width);
    const h = clampInt(rawH, EDITOR_MIN_H, EDITOR_MAX_H, m.height);
    if (w === m.width && h === m.height) {
      setWField(String(m.width));
      setHField(String(m.height));
      return;
    }
    const loss = m.resizeLoss(w, h, anchorX, anchorY);
    if (loss.entities || loss.painted) {
      const parts: string[] = [];
      if (loss.entities) parts.push(loss.entities + " flag/spawn marker(s)");
      if (loss.painted) parts.push(loss.painted + " painted cell(s)");
      const ok = await show({
        title: "Resize to " + w + "×" + h + "?",
        message: "Shrinking removes " + parts.join(" and ") + ".",
        confirmLabel: "Resize",
        danger: true,
      });
      if (ok === null) {
        setWField(String(m.width));
        setHField(String(m.height));
        return;
      }
    }
    doc.current.commit((d) => d.resize(w, h, anchorX, anchorY));
    markDirtyRef.current();
    setVersion((v) => v + 1);
  };

  // --- draft / save / leave ----------------------------------------------------

  const save = async (): Promise<boolean> => {
    if (hasErrors(problems)) return false;
    try {
      if (mapId.current && getCustomMap(mapId.current)) {
        updateCustomMap(mapId.current, { name, template: doc.current.template });
      } else {
        const created = createCustomMap({
          name: uniqueMapName(name),
          template: doc.current.template,
          origin: { kind: "blank" },
        });
        mapId.current = created.id;
      }
    } catch (e) {
      showToast(e instanceof MapStorageError ? e.message : "Couldn't save the map.");
      return false;
    }
    dirty.current = false;
    clearEditorDraft();
    go(route.from);
    return true;
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const back = async () => {
    if (!dirty.current) {
      go(route.from);
      return;
    }
    const ok = await show({
      title: "Leave the editor?",
      message: blocked
        ? "This map still has problems, so it can't be saved — leaving keeps it as a draft you can restore next time."
        : "You have unsaved changes.",
      confirmLabel: blocked ? "Leave as draft" : "Save and leave",
      cancelLabel: "Keep editing",
    });
    if (ok === null) return;
    if (blocked) {
      saveEditorDraft({ mapId: mapId.current, name, template: doc.current.template, savedAt: Date.now() });
      go(route.from);
      return;
    }
    await saveRef.current();
  };
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    if (route.doc) return; // came back from a test match, already holding the work
    let cancelled = false;
    void (async () => {
      const draft = loadEditorDraft();
      if (!draft || draft.mapId !== mapId.current) return;
      if (draft.template === doc.current.template) return;
      const record = mapId.current ? getCustomMap(mapId.current) : null;
      if (record && draft.savedAt <= record.updatedAt) return;
      const ok = await show({
        title: "Restore unsaved changes?",
        message: "There are unsaved changes from " + new Date(draft.savedAt).toLocaleString() + ".",
        confirmLabel: "Restore",
        cancelLabel: "Discard",
      });
      if (cancelled) return;
      if (ok === null) {
        clearEditorDraft();
        return;
      }
      doc.current = EditorDoc.fromTemplate(draft.template);
      if (draft.name) setName(draft.name);
      dirty.current = true;
      setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [route.doc, show]);

  /** An offline room of one on the working grid — nothing has to be saved to
   *  try it, and the doc (with its undo stack) comes back with us (§6.7). */
  const testPlay = () => {
    if (blocked) return;
    const id = mapId.current ?? TEST_MAP_ID;
    try {
      registerTransientMap(id, name, doc.current.template);
    } catch {
      showToast("That map can't be played yet.");
      return;
    }
    const nickname = loadUserSettings().nickname || randomGuestNickname();
    const room = new RoomHost({ nickname, online: false, callbacks: {}, mapId: id });
    room.startMatch();
    go({
      k: "match",
      room,
      returnTo: { ...route, mapId: mapId.current, doc: doc.current, name },
    });
  };

  // --- keyboard ---------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey ? doc.current.redo() : doc.current.undo()) setVersion((v) => v + 1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void backRef.current();
        return;
      }
      if (e.key === " ") {
        // Held Space pans with the left button, as in most paint programs.
        e.preventDefault();
        spaceHeldRef.current = true;
        setSpaceHeld(true);
        return;
      }
      if (e.key.toLowerCase() === "e") {
        setBrush(".");
        return;
      }
      if (e.key.toLowerCase() === "f") {
        toggleWholeRef.current();
        return;
      }
      if (e.key === "+" || e.key === "=") {
        zoomByRef.current(1.25);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        zoomByRef.current(0.8);
        return;
      }
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && PALETTE[digit - 1]) {
        setBrush(PALETTE[digit - 1].glyph);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // --- layout -----------------------------------------------------------------

  const counts: Record<string, string> = {
    R: model.count("R") + "/1",
    B: model.count("B") + "/1",
    r: String(model.count("r")),
    b: String(model.count("b")),
    "*": String(model.count("*")),
  };
  const paletteRow = (entry: PaletteEntry, index: number) => (
    <button
      key={entry.glyph}
      className={"palette-row " + (brush === entry.glyph ? "active" : "")}
      onClick={() => setBrush(entry.glyph)}
    >
      <span className="swatch" style={{ background: entry.color }} />
      <span className="palette-glyph">{entry.glyph}</span>
      <span className="palette-label">{entry.label}</span>
      <span className="hint">{counts[entry.glyph] ?? (index < 9 ? String(index + 1) : "")}</span>
    </button>
  );
  const anchors: Anchor[] = ["start", "center", "end"];

  return (
    <div className="screen editor-screen">
      <div className="row between wrap editor-header">
        <div className="row wrap">
          <label className="editor-name">
            Name
            <input
              type="text"
              maxLength={EDITOR_MAX_NAME}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markDirtyRef.current();
              }}
            />
          </label>
          <span className="map-meta">
            {model.width}×{model.height} · {model.count("r")}v{model.count("b")}
          </span>
        </div>
        <div className="row wrap">
          <button
            disabled={!doc.current.canUndo}
            onClick={() => {
              if (doc.current.undo()) setVersion((v) => v + 1);
            }}
          >
            Undo
          </button>
          <button
            disabled={!doc.current.canRedo}
            onClick={() => {
              if (doc.current.redo()) setVersion((v) => v + 1);
            }}
          >
            Redo
          </button>
          <button disabled={blocked} onClick={testPlay}>
            Test play
          </button>
          <button onClick={() => void backRef.current()}>Back</button>
          <button className="primary" disabled={blocked} onClick={() => void saveRef.current()}>
            Save
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="panel editor-palette">
          {TERRAIN_PALETTE.map(paletteRow)}
          <div className="hint palette-sep">Entities — placed one at a time</div>
          {ENTITY_PALETTE.map((e, i) => paletteRow(e, i + TERRAIN_PALETTE.length))}
        </div>
        <div className="editor-main">
          <div className={"editor-canvas-pane" + (panMode || spaceHeld ? " panning" : "")} ref={pane}>
            <canvas
              ref={canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
            {/* The tools a touch device can't reach any other way (no Shift,
                no Space, no wheel) sit on the grid itself, so they never
                scroll out of sight on a phone. */}
            <div className="editor-overlay editor-overlay-tl">
              <button
                className={"overlay-btn " + (rectMode ? "active" : "")}
                title="Rectangle fill (or hold Shift) — terrain only"
                onClick={() => setRectMode((v) => !v)}
              >
                ▭ Rect
              </button>
              <button
                className={"overlay-btn " + (panMode ? "active" : "")}
                title="Drag to move the map (or hold Space)"
                onClick={() => setPanMode((v) => !v)}
              >
                ✋ Pan
              </button>
            </div>
            <div className="editor-overlay editor-overlay-tr">
              <button className="overlay-btn" title="Zoom out (−)" onClick={() => zoomBy(0.8)}>
                −
              </button>
              <button className="overlay-btn" title="Zoom in (+)" onClick={() => zoomBy(1.25)}>
                +
              </button>
              <button
                className={"overlay-btn " + (peeking ? "active" : "")}
                title={peeking ? "Back to where you were (F)" : "Show the whole map (F)"}
                disabled={wholeVisible && !peeking}
                onClick={toggleWhole}
              >
                {peeking ? "↩ Back" : "⤢ Whole"}
              </button>
            </div>
            <canvas
              ref={minimap}
              className="editor-minimap"
              style={{ display: wholeVisible ? "none" : undefined }}
              onPointerDown={onMinimapPointer}
              onPointerMove={onMinimapPointer}
            />
            {toast && <div className="editor-toast">{toast}</div>}
          </div>
          <div className="hint editor-tip">
            <span className="tip-fine">
              Wheel zooms · Space-drag or middle-drag moves the map · right-drag erases · Shift-drag fills a
              rectangle
            </span>
            <span className="tip-coarse">Pinch to zoom · two fingers move the map · Pan for one-finger scrolling</span>
          </div>
        </div>
        <div className="editor-extras">
          <div className="row wrap editor-size">
            <label>
              W <input type="text" inputMode="numeric" value={wField} onChange={(e) => setWField(e.target.value)} />
            </label>
            <button className="small" onClick={() => void applyResize(String(model.width - 1), hField)}>
              −
            </button>
            <button className="small" onClick={() => void applyResize(String(model.width + 1), hField)}>
              +
            </button>
          </div>
          <div className="row wrap editor-size">
            <label>
              H <input type="text" inputMode="numeric" value={hField} onChange={(e) => setHField(e.target.value)} />
            </label>
            <button className="small" onClick={() => void applyResize(wField, String(model.height - 1))}>
              −
            </button>
            <button className="small" onClick={() => void applyResize(wField, String(model.height + 1))}>
              +
            </button>
          </div>
          <div className="row wrap editor-size">
            <button onClick={() => void applyResize(wField, hField)}>Resize</button>
            <span className="hint">Anchor</span>
            <div className="anchor-grid">
              {anchors.map((ay) =>
                anchors.map((ax) => (
                  <button
                    key={ay + ax}
                    className={"anchor-cell " + (anchorX === ax && anchorY === ay ? "active" : "")}
                    title={ay + "/" + ax}
                    onClick={() => {
                      setAnchorX(ax);
                      setAnchorY(ay);
                    }}
                  />
                )),
              )}
            </div>
          </div>
          <div className="editor-problems">
            {problems.length === 0 ? (
              <div className="editor-ok">Ready to play.</div>
            ) : (
              problems.map((p, i) => (
                <button
                  key={i}
                  className={"problem problem-" + p.severity}
                  onClick={() => showProblem(p.cells ?? [])}
                >
                  {p.severity === "error" ? "✖" : "⚠"} {p.message}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
      {modal}
    </div>
  );
}

function cellColor(glyph: string): string {
  if (isEntityGlyph(glyph)) {
    if (glyph === "R") return hex(TEAM_COLOR.red);
    if (glyph === "B") return hex(TEAM_COLOR.blue);
    return TILE_COLOR[CHAR_TILE["."]];
  }
  const tile = CHAR_TILE[glyph];
  return tile === undefined ? "#000" : TILE_COLOR[tile];
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}

function clampInt(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

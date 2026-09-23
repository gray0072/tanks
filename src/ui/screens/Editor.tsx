// The level editor — specs/level-editor.md §6. Palette on the left, the grid
// on a Canvas2D in the middle (UI, not the arena: no second WebGL context,
// same reasoning as render/preview.ts), size/anchor controls and the live
// problem list under it.
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

const MIN_CELL_PX = 8;
const MAX_CELL_PX = 32;
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
  const drag = useRef<{ start: { cx: number; cy: number }; current: { cx: number; cy: number }; rect: boolean } | null>(
    null,
  );
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

  // --- drawing ---------------------------------------------------------------

  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  /** One cell is a square of the same size on both axes, floored at 8px so a
   *  64x64 map stays clickable (it scrolls inside its pane instead). */
  const redraw = () => {
    const el = canvas.current;
    const box = pane.current?.getBoundingClientRect();
    if (!el || !box) return;
    const m = doc.current.model;
    const avail = { w: Math.max(120, box.width - 2), h: Math.max(120, box.height - 2) };
    const fit = Math.floor(Math.min(avail.w / m.width, avail.h / m.height));
    const s = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, fit || MIN_CELL_PX));
    if (el.width !== m.width * s || el.height !== m.height * s) {
      el.width = m.width * s;
      el.height = m.height * s;
    }

    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);

    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const g = m.at(x, y);
        ctx.fillStyle = cellColor(g);
        ctx.fillRect(x * s, y * s, s, s);
        if (g === "*") {
          ctx.fillStyle = "#ffd23d";
          ctx.beginPath();
          ctx.arc(x * s + s / 2, y * s + s / 2, Math.max(1.5, s * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Spawns carry their scan-order index (SPEC §3.5: where you place the
    // marker *is* the priority), so the numbering isn't a surprise later.
    for (const glyph of ["r", "b"] as const) {
      m.find(glyph).forEach((p, i) => {
        ctx.fillStyle = glyph === "r" ? "#ff9a9a" : "#7fb0ff";
        ctx.beginPath();
        ctx.arc(p.x * s + s / 2, p.y * s + s / 2, Math.max(2, s * 0.34), 0, Math.PI * 2);
        ctx.fill();
        if (s >= 14) {
          ctx.fillStyle = "#0b0f14";
          ctx.font = Math.round(s * 0.5) + "px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), p.x * s + s / 2, p.y * s + s / 2 + 1);
        }
      });
    }

    if (s >= 6) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= m.width; x++) line(ctx, x * s, 0, x * s, m.height * s);
      for (let y = 0; y <= m.height; y++) line(ctx, 0, y * s, m.width * s, y * s);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      for (let x = 0; x <= m.width; x += 5) line(ctx, x * s, 0, x * s, m.height * s);
      for (let y = 0; y <= m.height; y += 5) line(ctx, 0, y * s, m.width * s, y * s);
    }

    for (const c of highlightRef.current) {
      ctx.strokeStyle = "#ffd23d";
      ctx.lineWidth = 2;
      ctx.strokeRect(c.cx * s + 1, c.cy * s + 1, s - 2, s - 2);
    }

    const d = drag.current;
    if (d?.rect) {
      const r = m.normalizeRect(d.start.cx, d.start.cy, d.current.cx, d.current.cy);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x0 * s, r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s);
    }
  };
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    redrawRef.current();
  }, [version, highlight]);

  useEffect(() => {
    const onResize = () => redrawRef.current();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  useEffect(() => {
    setWField(String(doc.current.model.width));
    setHField(String(doc.current.model.height));
  }, [version]);

  // --- painting --------------------------------------------------------------

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const m = doc.current.model;
    return {
      cx: Math.floor(((e.clientX - box.left) / box.width) * m.width),
      cy: Math.floor(((e.clientY - box.top) / box.height) * m.height),
    };
  };

  /** Right button / two fingers erase, whatever the palette says (§6.4). */
  const brushFor = (e: React.PointerEvent) => (e.button === 2 || (e.buttons & 2) !== 0 ? "." : brush);

  const reportPaint = (result: string) => {
    if (result === "spawn-limit") showToast("That team already has the maximum number of spawns.");
    else if (result === "bonus-limit") showToast("The map already has the maximum number of bonus points.");
    else if (result === "entity-rect") showToast("Flags and spawns are placed one at a time, not dragged.");
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Per-pointer capture, not a document-level listener: a second finger must
    // never hijack a stroke (the same rule the match's touch layer learned,
    // SPEC §5.3).
    if (drag.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cell = cellAt(e);
    const g = brushFor(e);
    drag.current = { start: cell, current: cell, rect: (rectMode || e.shiftKey) && isTerrainGlyph(g) };
    doc.current.beginStroke();
    if (!drag.current.rect) reportPaint(doc.current.model.paint(cell.cx, cell.cy, g));
    redrawRef.current();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const cell = cellAt(e);
    if (cell.cx === d.current.cx && cell.cy === d.current.cy) return;
    d.current = cell;
    const g = brushFor(e);
    // Entity brushes don't drag (§6.4) — only the cell that was clicked.
    if (!d.rect && isTerrainGlyph(g)) reportPaint(doc.current.model.paint(cell.cx, cell.cy, g));
    redrawRef.current();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.rect) {
      reportPaint(doc.current.model.fillRect(d.start.cx, d.start.cy, d.current.cx, d.current.cy, brushFor(e)));
    }
    drag.current = null;
    if (doc.current.endStroke()) markDirtyRef.current();
    setVersion((v) => v + 1);
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
    const room = new RoomHost(nickname, false, {}, id);
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
      if (e.key.toLowerCase() === "e") {
        setBrush(".");
        return;
      }
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && PALETTE[digit - 1]) {
        setBrush(PALETTE[digit - 1].glyph);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
          <div className="row wrap editor-tools">
            {/* The Rectangle toggle lives outside the palette: on a phone the
                palette is a scrolling strip, and a touch device has no Shift
                to fall back on. */}
            <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={rectMode}
                onChange={(e) => setRectMode(e.target.checked)}
              />{" "}
              Rectangle
            </label>
            <span className="hint">
              Drag to paint; a rectangle fills a block — terrain only, not flags or spawns.
            </span>
          </div>
          <div className="editor-canvas-pane" ref={pane}>
            <canvas
              ref={canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
          <div className="row wrap editor-size">
            <label>
              Width <input type="text" inputMode="numeric" value={wField} onChange={(e) => setWField(e.target.value)} />
            </label>
            <button className="small" onClick={() => void applyResize(String(model.width - 1), hField)}>
              −
            </button>
            <button className="small" onClick={() => void applyResize(String(model.width + 1), hField)}>
              +
            </button>
            <label>
              Height{" "}
              <input type="text" inputMode="numeric" value={hField} onChange={(e) => setHField(e.target.value)} />
            </label>
            <button className="small" onClick={() => void applyResize(wField, String(model.height - 1))}>
              −
            </button>
            <button className="small" onClick={() => void applyResize(wField, String(model.height + 1))}>
              +
            </button>
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
          <div className="hint">{toast}</div>
          <div className="editor-problems">
            {problems.length === 0 ? (
              <div className="editor-ok">Ready to play.</div>
            ) : (
              problems.map((p, i) => (
                <button
                  key={i}
                  className={"problem problem-" + p.severity}
                  onClick={() => setHighlight(p.cells ?? [])}
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

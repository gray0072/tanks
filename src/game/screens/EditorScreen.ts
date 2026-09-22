// The level editor — specs/level-editor.md §6. Palette on the left, the grid
// on a Canvas2D in the middle (UI, not the arena: no second WebGL context, same
// reasoning as render/preview.ts), size/anchor controls and the live problem
// list under it.

import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { EditorDoc, EditorModel, isEntityGlyph, isTerrainGlyph, type Anchor } from "../../world/maps/editorModel";
import {
  clearEditorDraft,
  createCustomMap,
  getCustomMap,
  loadEditorDraft,
  MapStorageError,
  saveEditorDraft,
  uniqueMapName,
  updateCustomMap,
} from "../../world/maps/customMaps";
import { hasErrors, validateMapTemplate, type Cell, type MapProblem } from "../../world/maps/validateMap";
import { listCustomMaps } from "../../world/maps/customMaps";
import { registerTransientMap } from "../../world/maps/loader";
import { CHAR_TILE } from "../../world/maps/mapChars";
import { TILE_COLOR } from "../../render/preview";
import { showModal } from "../../util/dialog";
import { loadUserSettings, randomGuestNickname } from "../settings";
import { RoomHost } from "../../net/host";
import { MatchScreen } from "./MatchScreen";
import {
  EDITOR_MAX_H,
  EDITOR_MAX_NAME,
  EDITOR_MAX_W,
  EDITOR_MIN_H,
  EDITOR_MIN_W,
  TEAM_COLOR,
} from "../../game/config";

export type EditorOptions = {
  /** The custom map being edited, or null for a brand-new one. */
  mapId: string | null;
  /** Where Back and a successful Save return to. */
  onDone: () => void;
  /** Handed back when returning from a test match, so the working grid and
   *  the undo stack survive the round trip (§6.7). */
  doc?: EditorDoc;
  name?: string;
};

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

export class EditorScreen implements Screen {
  private el!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private doc: EditorDoc;
  private mapId: string | null;
  private name: string;
  private brush = "#";
  private rectMode = false;
  private dirty = false;
  private problems: MapProblem[] = [];
  private highlight: Cell[] = [];
  private anchorX: Anchor = "start";
  private anchorY: Anchor = "start";
  private cellPx = 16;
  private dragStart: { cx: number; cy: number } | null = null;
  private dragCurrent: { cx: number; cy: number } | null = null;
  private dragRect = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private toast = "";

  constructor(private screens: ScreenManager, private opts: EditorOptions) {
    this.mapId = opts.mapId;
    const record = this.mapId ? getCustomMap(this.mapId) : null;
    if (opts.doc) {
      this.doc = opts.doc;
      this.name = opts.name ?? record?.name ?? "New map";
      // Coming back from a test match with work in hand: it was never saved
      // to the library on the way out, so it's still dirty.
      this.dirty = true;
    } else if (record) {
      this.doc = EditorDoc.fromTemplate(record.template);
      this.name = record.name;
    } else {
      this.doc = new EditorDoc(EditorModel.blank());
      this.name = uniqueMapName("New map");
    }
  }

  mount(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "screen editor-screen";
    root.appendChild(this.el);
    this.render();
    this.revalidate();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.onResize);
    void this.maybeRestoreDraft();
  }

  // --- layout ---------------------------------------------------------------

  private render() {
    this.el.innerHTML = `
      <div class="row between wrap editor-header">
        <div class="row wrap">
          <label class="editor-name">Name
            <input type="text" data-f="name" maxlength="${EDITOR_MAX_NAME}" value="${escapeAttr(this.name)}" />
          </label>
          <span class="map-meta" data-f="size"></span>
        </div>
        <div class="row wrap">
          <button data-a="undo">Undo</button>
          <button data-a="redo">Redo</button>
          <button data-a="test">Test play</button>
          <button data-a="back">Back</button>
          <button class="primary" data-a="save">Save</button>
        </div>
      </div>
      <div class="editor-layout">
        <div class="panel editor-palette" data-f="palette"></div>
        <div class="editor-main">
          <div class="row wrap editor-tools">
            <label style="flex-direction:row;align-items:center;gap:6px">
              <input type="checkbox" data-f="rect" style="width:auto" /> Rectangle
            </label>
            <span class="hint">Drag to paint; a rectangle fills a block — terrain only, not flags or spawns.</span>
          </div>
          <div class="editor-canvas-pane" data-f="pane"><canvas data-f="grid"></canvas></div>
          <div class="row wrap editor-size">
            <label>Width <input type="text" inputmode="numeric" data-f="w" /></label>
            <button class="small" data-size="w-1">−</button>
            <button class="small" data-size="w+1">+</button>
            <label>Height <input type="text" inputmode="numeric" data-f="h" /></label>
            <button class="small" data-size="h-1">−</button>
            <button class="small" data-size="h+1">+</button>
            <button data-a="resize">Resize</button>
            <span class="hint">Anchor</span>
            <div class="anchor-grid" data-f="anchor"></div>
          </div>
          <div class="hint" data-f="toast"></div>
          <div class="editor-problems" data-f="problems"></div>
        </div>
      </div>
    `;
    this.canvas = this.el.querySelector<HTMLCanvasElement>("[data-f=grid]")!;
    this.renderPalette();
    this.renderAnchor();
    this.syncSizeFields();
    this.wire();
    this.layoutCanvas();
  }

  private renderPalette() {
    const host = this.el.querySelector<HTMLDivElement>("[data-f=palette]")!;
    const model = this.doc.model;
    const counts: Record<string, string> = {
      R: `${model.count("R")}/1`,
      B: `${model.count("B")}/1`,
      r: `${model.count("r")}`,
      b: `${model.count("b")}`,
      "*": `${model.count("*")}`,
    };
    const row = (e: PaletteEntry, index: number) => `
      <button class="palette-row ${this.brush === e.glyph ? "active" : ""}" data-brush="${escapeAttr(e.glyph)}">
        <span class="swatch" style="background:${e.color}"></span>
        <span class="palette-glyph">${escapeHtml(e.glyph)}</span>
        <span class="palette-label">${e.label}</span>
        <span class="hint">${counts[e.glyph] ?? (index < 9 ? String(index + 1) : "")}</span>
      </button>`;
    host.innerHTML = `
      ${TERRAIN_PALETTE.map(row).join("")}
      <div class="hint palette-sep">Entities — placed one at a time</div>
      ${ENTITY_PALETTE.map((e, i) => row(e, i + TERRAIN_PALETTE.length)).join("")}
    `;
    host.querySelectorAll<HTMLButtonElement>("[data-brush]").forEach((b) => {
      b.onclick = () => {
        this.brush = b.dataset.brush!;
        this.renderPalette();
      };
    });
  }

  private renderAnchor() {
    const host = this.el.querySelector<HTMLDivElement>("[data-f=anchor]")!;
    const anchors: Anchor[] = ["start", "center", "end"];
    host.innerHTML = anchors
      .map((ay) =>
        anchors
          .map(
            (ax) =>
              `<button class="anchor-cell ${this.anchorX === ax && this.anchorY === ay ? "active" : ""}" data-ax="${ax}" data-ay="${ay}" title="${ay}/${ax}"></button>`,
          )
          .join(""),
      )
      .join("");
    host.querySelectorAll<HTMLButtonElement>("[data-ax]").forEach((b) => {
      b.onclick = () => {
        this.anchorX = b.dataset.ax as Anchor;
        this.anchorY = b.dataset.ay as Anchor;
        this.renderAnchor();
      };
    });
  }

  private wire() {
    // The Rectangle toggle lives outside the palette: on a phone the palette
    // is a scrolling strip, and a touch device has no Shift to fall back on.
    const rect = this.el.querySelector<HTMLInputElement>("[data-f=rect]")!;
    rect.checked = this.rectMode;
    rect.onchange = () => {
      this.rectMode = rect.checked;
    };

    const nameInput = this.el.querySelector<HTMLInputElement>("[data-f=name]")!;
    nameInput.oninput = () => {
      this.name = nameInput.value;
      this.markDirty();
      this.revalidate();
    };

    this.el.querySelector<HTMLButtonElement>("[data-a=undo]")!.onclick = () => {
      if (this.doc.undo()) this.afterChange();
    };
    this.el.querySelector<HTMLButtonElement>("[data-a=redo]")!.onclick = () => {
      if (this.doc.redo()) this.afterChange();
    };
    this.el.querySelector<HTMLButtonElement>("[data-a=test]")!.onclick = () => this.testPlay();
    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => void this.back();
    this.el.querySelector<HTMLButtonElement>("[data-a=save]")!.onclick = () => void this.save();
    this.el.querySelector<HTMLButtonElement>("[data-a=resize]")!.onclick = () => void this.applyResize();

    this.el.querySelectorAll<HTMLButtonElement>("[data-size]").forEach((b) => {
      b.onclick = () => {
        const [axis, delta] = [b.dataset.size![0], Number(b.dataset.size!.slice(1))];
        const field = this.el.querySelector<HTMLInputElement>(`[data-f=${axis}]`)!;
        field.value = String(Number(field.value) + delta);
        void this.applyResize();
      };
    });

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private syncSizeFields() {
    this.el.querySelector<HTMLInputElement>("[data-f=w]")!.value = String(this.doc.model.width);
    this.el.querySelector<HTMLInputElement>("[data-f=h]")!.value = String(this.doc.model.height);
  }

  private onResize = () => this.layoutCanvas();

  /** One cell is a square of the same size on both axes, floored at 8px so a
   *  64x64 map stays clickable (it scrolls inside its pane instead). */
  private layoutCanvas() {
    const pane = this.el.querySelector<HTMLDivElement>("[data-f=pane]")!;
    const { width, height } = this.doc.model;
    const box = pane.getBoundingClientRect();
    const avail = { w: Math.max(120, box.width - 2), h: Math.max(120, box.height - 2) };
    const fit = Math.floor(Math.min(avail.w / width, avail.h / height));
    this.cellPx = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, fit || MIN_CELL_PX));
    this.canvas.width = width * this.cellPx;
    this.canvas.height = height * this.cellPx;
    this.draw();
  }

  // --- drawing ---------------------------------------------------------------

  private draw() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const m = this.doc.model;
    const s = this.cellPx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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
          ctx.font = `${Math.round(s * 0.5)}px system-ui, sans-serif`;
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

    for (const c of this.highlight) {
      ctx.strokeStyle = "#ffd23d";
      ctx.lineWidth = 2;
      ctx.strokeRect(c.cx * s + 1, c.cy * s + 1, s - 2, s - 2);
    }

    if (this.dragRect && this.dragStart && this.dragCurrent) {
      const r = this.doc.model.normalizeRect(
        this.dragStart.cx,
        this.dragStart.cy,
        this.dragCurrent.cx,
        this.dragCurrent.cy,
      );
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x0 * s, r.y0 * s, (r.x1 - r.x0 + 1) * s, (r.y1 - r.y0 + 1) * s);
    }
  }

  // --- painting --------------------------------------------------------------

  private cellAt(e: PointerEvent): { cx: number; cy: number } {
    const box = this.canvas.getBoundingClientRect();
    return {
      cx: Math.floor(((e.clientX - box.left) / box.width) * this.doc.model.width),
      cy: Math.floor(((e.clientY - box.top) / box.height) * this.doc.model.height),
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    // Per-pointer capture, not a document-level listener: a second finger must
    // never hijack a stroke (the same rule the match's touch layer learned,
    // SPEC §5.3).
    if (this.dragStart) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const cell = this.cellAt(e);
    this.dragStart = cell;
    this.dragCurrent = cell;
    this.dragRect = (this.rectMode || e.shiftKey) && isTerrainGlyph(this.brushFor(e));
    this.doc.beginStroke();
    if (!this.dragRect) this.applyBrush(cell, this.brushFor(e));
    this.draw();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragStart) return;
    const cell = this.cellAt(e);
    if (cell.cx === this.dragCurrent?.cx && cell.cy === this.dragCurrent?.cy) return;
    this.dragCurrent = cell;
    // Entity brushes don't drag (§6.4) — only the cell that was clicked.
    if (!this.dragRect && isTerrainGlyph(this.brushFor(e))) this.applyBrush(cell, this.brushFor(e));
    this.draw();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.dragStart) return;
    if (this.dragRect && this.dragCurrent) {
      const res = this.doc.model.fillRect(
        this.dragStart.cx,
        this.dragStart.cy,
        this.dragCurrent.cx,
        this.dragCurrent.cy,
        this.brushFor(e),
      );
      this.reportPaint(res);
    }
    this.dragStart = null;
    this.dragCurrent = null;
    this.dragRect = false;
    if (this.doc.endStroke()) this.markDirty();
    this.afterChange();
  };

  /** Right button / two fingers erase, whatever the palette says (§6.4). */
  private brushFor(e: PointerEvent): string {
    const erasing = e.button === 2 || (e.buttons & 2) !== 0;
    return erasing ? "." : this.brush;
  }

  private applyBrush(cell: { cx: number; cy: number }, glyph: string) {
    this.reportPaint(this.doc.model.paint(cell.cx, cell.cy, glyph));
  }

  private reportPaint(result: string) {
    if (result === "spawn-limit") this.setToast("That team already has the maximum number of spawns.");
    else if (result === "bonus-limit") this.setToast("The map already has the maximum number of bonus points.");
    else if (result === "entity-rect") this.setToast("Flags and spawns are placed one at a time, not dragged.");
  }

  private afterChange() {
    this.renderPalette();
    this.syncSizeFields();
    this.layoutCanvas();
    this.revalidate();
  }

  // --- resize ---------------------------------------------------------------

  private async applyResize() {
    const w = clampInt(this.el.querySelector<HTMLInputElement>("[data-f=w]")!.value, EDITOR_MIN_W, EDITOR_MAX_W, this.doc.model.width);
    const h = clampInt(this.el.querySelector<HTMLInputElement>("[data-f=h]")!.value, EDITOR_MIN_H, EDITOR_MAX_H, this.doc.model.height);
    if (w === this.doc.model.width && h === this.doc.model.height) {
      this.syncSizeFields();
      return;
    }
    const loss = this.doc.model.resizeLoss(w, h, this.anchorX, this.anchorY);
    if (loss.entities || loss.painted) {
      const parts: string[] = [];
      if (loss.entities) parts.push(`${loss.entities} flag/spawn marker(s)`);
      if (loss.painted) parts.push(`${loss.painted} painted cell(s)`);
      const ok = await showModal(this.el, {
        title: `Resize to ${w}×${h}?`,
        message: `Shrinking removes ${parts.join(" and ")}.`,
        confirmLabel: "Resize",
        danger: true,
      });
      if (ok === null) {
        this.syncSizeFields();
        return;
      }
    }
    this.doc.commit((m) => m.resize(w, h, this.anchorX, this.anchorY));
    this.markDirty();
    this.afterChange();
  }

  // --- validation -------------------------------------------------------------

  private revalidate() {
    const others = listCustomMaps().filter((m) => m.id !== this.mapId).map((m) => m.name);
    this.problems = validateMapTemplate(this.doc.template, { name: this.name, otherNames: others });
    const blocked = hasErrors(this.problems);

    const sizeEl = this.el.querySelector<HTMLSpanElement>("[data-f=size]")!;
    const m = this.doc.model;
    sizeEl.textContent = `${m.width}×${m.height} · ${m.count("r")}v${m.count("b")}`;

    const host = this.el.querySelector<HTMLDivElement>("[data-f=problems]")!;
    if (this.problems.length === 0) {
      host.innerHTML = `<div class="editor-ok">Ready to play.</div>`;
    } else {
      host.innerHTML = this.problems
        .map(
          (p, i) =>
            `<button class="problem problem-${p.severity}" data-problem="${i}">${p.severity === "error" ? "✖" : "⚠"} ${escapeHtml(p.message)}</button>`,
        )
        .join("");
      host.querySelectorAll<HTMLButtonElement>("[data-problem]").forEach((b) => {
        b.onclick = () => {
          this.highlight = this.problems[Number(b.dataset.problem)].cells ?? [];
          this.draw();
        };
      });
    }

    this.el.querySelector<HTMLButtonElement>("[data-a=save]")!.disabled = blocked;
    this.el.querySelector<HTMLButtonElement>("[data-a=test]")!.disabled = blocked;
    this.el.querySelector<HTMLButtonElement>("[data-a=undo]")!.disabled = !this.doc.canUndo;
    this.el.querySelector<HTMLButtonElement>("[data-a=redo]")!.disabled = !this.doc.canRedo;
  }

  // --- draft / save / leave ----------------------------------------------------

  private markDirty() {
    this.dirty = true;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      saveEditorDraft({ mapId: this.mapId, name: this.name, template: this.doc.template, savedAt: Date.now() });
    }, 1000);
  }

  private async maybeRestoreDraft() {
    if (this.opts.doc) return; // came back from a test match, already holding the work
    const draft = loadEditorDraft();
    if (!draft || draft.mapId !== this.mapId) return;
    if (draft.template === this.doc.template) return;
    const record = this.mapId ? getCustomMap(this.mapId) : null;
    if (record && draft.savedAt <= record.updatedAt) return;
    const ok = await showModal(this.el, {
      title: "Restore unsaved changes?",
      message: `There are unsaved changes from ${new Date(draft.savedAt).toLocaleString()}.`,
      confirmLabel: "Restore",
      cancelLabel: "Discard",
    });
    if (ok === null) {
      clearEditorDraft();
      return;
    }
    this.doc = EditorDoc.fromTemplate(draft.template);
    this.name = draft.name || this.name;
    this.dirty = true;
    this.render();
    this.revalidate();
  }

  private async save(): Promise<boolean> {
    if (hasErrors(this.problems)) return false;
    try {
      if (this.mapId && getCustomMap(this.mapId)) {
        updateCustomMap(this.mapId, { name: this.name, template: this.doc.template });
      } else {
        const created = createCustomMap({
          name: uniqueMapName(this.name),
          template: this.doc.template,
          origin: { kind: "blank" },
        });
        this.mapId = created.id;
      }
    } catch (e) {
      this.setToast(e instanceof MapStorageError ? e.message : "Couldn't save the map.");
      return false;
    }
    this.dirty = false;
    clearEditorDraft();
    this.opts.onDone();
    return true;
  }

  private async back() {
    if (!this.dirty) {
      this.opts.onDone();
      return;
    }
    const blocked = hasErrors(this.problems);
    const ok = await showModal(this.el, {
      title: "Leave the editor?",
      message: blocked
        ? "This map still has problems, so it can't be saved — leaving keeps it as a draft you can restore next time."
        : "You have unsaved changes.",
      confirmLabel: blocked ? "Leave as draft" : "Save and leave",
      cancelLabel: "Keep editing",
    });
    if (ok === null) return;
    if (blocked) {
      saveEditorDraft({ mapId: this.mapId, name: this.name, template: this.doc.template, savedAt: Date.now() });
      this.opts.onDone();
      return;
    }
    await this.save();
  }

  /** An offline room of one on the working grid — nothing has to be saved to
   *  try it, and the doc (with its undo stack) comes back with us (§6.7). */
  private testPlay() {
    if (hasErrors(this.problems)) return;
    const id = this.mapId ?? TEST_MAP_ID;
    try {
      registerTransientMap(id, this.name, this.doc.template);
    } catch {
      this.setToast("That map can't be played yet.");
      return;
    }
    const nickname = loadUserSettings().nickname || randomGuestNickname();
    const room = new RoomHost(nickname, false, {}, id);
    room.startMatch();
    this.screens.go(
      new MatchScreen(this.screens, room, () => {
        room.destroy();
        this.screens.go(
          new EditorScreen(this.screens, { ...this.opts, mapId: this.mapId, doc: this.doc, name: this.name }),
        );
      }),
    );
  }

  private setToast(msg: string) {
    this.toast = msg;
    const el = this.el.querySelector<HTMLDivElement>("[data-f=toast]");
    if (el) el.textContent = msg;
    if (!msg) return;
    setTimeout(() => {
      if (this.toast !== msg) return;
      this.toast = "";
      const live = this.el.querySelector<HTMLDivElement>("[data-f=toast]");
      if (live) live.textContent = "";
    }, 3000);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey ? this.doc.redo() : this.doc.undo()) this.afterChange();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.save();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      void this.back();
      return;
    }
    if (e.key.toLowerCase() === "e") {
      this.brush = ".";
      this.renderPalette();
      return;
    }
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && PALETTE[digit - 1]) {
      this.brush = PALETTE[digit - 1].glyph;
      this.renderPalette();
    }
  };

  unmount() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onResize);
    if (this.draftTimer) clearTimeout(this.draftTimer);
  }
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}

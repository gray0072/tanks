// The one map list in the game — specs/level-editor.md §5. Two modes over the
// same screen: `pick` (opened from Create Room, primary action Select) and
// `manage` (opened from the main menu's Level Editor, primary action Edit).
// Management actions live in both, so "this map but with more cover" doesn't
// mean backing out to the menu first.

import type { Screen } from "../ScreenManager";
import { ScreenManager } from "../ScreenManager";
import { listMaps, listCustomMapEntries, type CustomMapEntry, type MapDef } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import { MAP_SOURCES } from "../../world/maps/mapSources";
import {
  copyMapInto,
  deleteCustomMap,
  createCustomMap,
  MapStorageError,
  uniqueMapName,
  type CustomMap,
} from "../../world/maps/customMaps";
import { hasErrors, validateMapTemplate } from "../../world/maps/validateMap";
import { drawMapPreview } from "../../render/preview";
import { showModal } from "../../util/dialog";
import { forgetRoomSetup, loadLastMapId, saveLastMapId } from "../settings";
import { EditorScreen } from "./EditorScreen";

export type LibraryMode = "pick" | "manage";

export type LibraryOptions = {
  mode: LibraryMode;
  /** Highlighted on open, and what `Continue` returns if nothing is clicked. */
  selectedMapId?: string;
  /** pick mode only — the chosen map id. */
  onPick?: (mapId: string) => void;
  onBack: () => void;
};

const MAP_BLURB: Record<string, string> = {
  classic: "Battle City homage: brick mazes, steel spine, water gate at midfield.",
  crossroads: "Four open lanes meeting in the middle, minimal cover, fast and lethal.",
  swamp: "Water channels and sand flats — movement is the puzzle.",
  thicket: "Wide and horizontal, bases left and right, dense forest cover.",
  fortress: "Walled keeps in opposite corners — a siege from both directions at once.",
  iceworks: "Broad ice floors either side of a steel spine; nothing stops where you meant it to.",
};

type Filter = "all" | "builtin" | "custom";

export class MapLibraryScreen implements Screen {
  private el!: HTMLElement;
  private filter: Filter = "all";
  private selected: string;

  constructor(private screens: ScreenManager, private opts: LibraryOptions) {
    this.selected = opts.selectedMapId ?? loadLastMapId() ?? listMaps()[0]?.id ?? "classic";
  }

  mount(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "screen";
    root.appendChild(this.el);
    this.render();
  }

  private render() {
    const pick = this.opts.mode === "pick";
    this.el.innerHTML = `
      <div class="title" style="font-size:1.6rem">${pick ? "Choose a map" : "Level Editor"}</div>
      <div class="panel panel-wide">
        <div class="row between wrap">
          <div class="row wrap">
            ${(["all", "builtin", "custom"] as Filter[])
              .map(
                (f) =>
                  `<button class="chip ${this.filter === f ? "active" : ""}" data-filter="${f}">${
                    f === "all" ? "All" : f === "builtin" ? "Built-in" : "Custom"
                  }</button>`,
              )
              .join("")}
          </div>
          <div class="row wrap">
            <button data-a="import">Import…</button>
            <button class="${pick ? "" : "primary"}" data-a="new">+ New map</button>
          </div>
        </div>
        <div class="error" data-f="error"></div>
        <div class="row wrap map-grid" data-f="cards"></div>
        <div class="row between">
          <button data-a="back">Back</button>
          ${pick ? `<button class="primary" data-a="continue">Continue</button>` : ""}
        </div>
      </div>
    `;

    const cards = this.el.querySelector<HTMLDivElement>("[data-f=cards]")!;
    if (this.filter !== "custom") {
      for (const map of listMaps()) cards.appendChild(this.builtinCard(map));
    }
    if (this.filter !== "builtin") {
      const entries = listCustomMapEntries();
      if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "hint";
        empty.textContent = "No maps of your own yet — copy a built-in one, or start from a blank grid.";
        cards.appendChild(empty);
      }
      for (const entry of entries) cards.appendChild(this.customCard(entry));
    }

    this.wire();
  }

  private card(): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "map-card";
    return card;
  }

  private builtinCard(map: MapDef): HTMLDivElement {
    const card = this.card();
    card.dataset.map = map.id;
    card.classList.toggle("selected", map.id === this.selected);
    card.innerHTML = `
      <canvas width="160" height="100"></canvas>
      <b>${escapeHtml(map.name)}</b>
      <span class="map-meta">${mapSizeLabel(map)}</span>
      <span class="hint">${escapeHtml(MAP_BLURB[map.id] ?? "")}</span>
      <span class="map-tag">built-in</span>
      <div class="row wrap map-actions">
        ${this.opts.mode === "pick" ? `<button class="small" data-select="${map.id}">Select</button>` : ""}
        <button class="small" disabled title="Built-in maps can't be edited — copy one to make it yours.">Edit</button>
        <button class="small" data-copy="${map.id}">Copy</button>
        <button class="small" data-export="${map.id}">Export</button>
      </div>
    `;
    drawMapPreview(card.querySelector("canvas")!, map);
    return card;
  }

  private customCard(entry: CustomMapEntry): HTMLDivElement {
    const { record, map, problems } = entry;
    const errors = problems.filter((p) => p.severity === "error").length;
    const card = this.card();
    card.dataset.map = record.id;
    if (map) card.dataset.editable = "1";
    card.classList.toggle("selected", record.id === this.selected);
    const size = map
      ? mapSizeLabel(map)
      : `${templateWidth(record.template)}×${templateHeight(record.template)} · —`;
    card.innerHTML = `
      <canvas width="160" height="100"></canvas>
      <b>${escapeHtml(record.name)}</b>
      <span class="map-meta">${size}</span>
      <span class="hint">edited ${relativeTime(record.updatedAt)}</span>
      <span class="map-tag">custom${errors ? ` · <span class="map-problem">⚠ ${errors} problem${errors > 1 ? "s" : ""}</span>` : ""}</span>
      <div class="row wrap map-actions">
        ${this.opts.mode === "pick" ? `<button class="small" data-select="${record.id}" ${map ? "" : "disabled"}>Select</button>` : ""}
        <button class="small" data-edit="${record.id}">Edit</button>
        <button class="small" data-copy="${record.id}">Copy</button>
        <button class="small" data-export="${record.id}">Export</button>
        <button class="small danger" data-delete="${record.id}">Delete</button>
      </div>
    `;
    const canvas = card.querySelector<HTMLCanvasElement>("canvas")!;
    if (map) drawMapPreview(canvas, map);
    else canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    return card;
  }

  private wire() {
    // The card itself is the primary action — Edit in the editor's own list,
    // Select when a room is being set up. The buttons inside it stop the
    // click so a Copy or a Delete doesn't also open the map.
    this.el.querySelectorAll<HTMLDivElement>(".map-card").forEach((card) => {
      const id = card.dataset.map!;
      card.classList.add("clickable");
      card.onclick = () => this.activate(id);
      card.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => e.stopPropagation()));
    });

    this.el.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((b) => {
      b.onclick = () => {
        this.filter = b.dataset.filter as Filter;
        this.render();
      };
    });
    this.el.querySelector<HTMLButtonElement>("[data-a=back]")!.onclick = () => this.opts.onBack();
    this.el.querySelector<HTMLButtonElement>("[data-a=continue]")?.addEventListener("click", () => this.pick(this.selected));
    this.el.querySelector<HTMLButtonElement>("[data-a=new]")!.onclick = () => this.openEditor(null);
    this.el.querySelector<HTMLButtonElement>("[data-a=import]")!.onclick = () => void this.importMap();

    this.el.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((b) => {
      b.onclick = () => this.pick(b.dataset.select!);
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((b) => {
      b.onclick = () => this.openEditor(b.dataset.edit!);
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
      b.onclick = () => this.copy(b.dataset.copy!);
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((b) => {
      b.onclick = () => void this.exportMap(b.dataset.export!);
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((b) => {
      b.onclick = () => void this.remove(b.dataset.delete!);
    });
  }

  /** What a click on the card body does. In `manage` mode that's Edit — a
   *  built-in can't be edited, so it says why instead of doing nothing. */
  private activate(mapId: string) {
    const isCustom = this.el.querySelector<HTMLDivElement>(`.map-card[data-map="${mapId}"]`)?.dataset.editable === "1"
      || listCustomMapEntries().some((e) => e.record.id === mapId);
    if (this.opts.mode === "manage") {
      if (!isCustom) {
        this.setError("Built-in maps can't be edited — use Copy to make one yours.");
        return;
      }
      this.openEditor(mapId);
      return;
    }
    const entry = listCustomMapEntries().find((e) => e.record.id === mapId);
    if (entry && !entry.map) {
      this.setError("That map has problems to fix before it can be played — open it with Edit.");
      return;
    }
    this.pick(mapId);
  }

  private pick(mapId: string) {
    this.selected = mapId;
    saveLastMapId(mapId);
    this.opts.onPick?.(mapId);
  }

  private openEditor(mapId: string | null) {
    const back = () =>
      this.screens.go(
        new MapLibraryScreen(this.screens, { ...this.opts, selectedMapId: this.selected }),
      );
    this.screens.go(new EditorScreen(this.screens, { mapId, onDone: back }));
  }

  private copy(id: string) {
    const source = this.sourceOf(id);
    if (!source) return;
    try {
      const copy = copyMapInto(source, source.builtin);
      this.selected = copy.id;
      this.render();
    } catch (e) {
      this.showError(e);
    }
  }

  private async remove(id: string) {
    const record = listCustomMapEntries().find((e) => e.record.id === id)?.record;
    if (!record) return;
    const ok = await showModal(this.el, {
      title: `Delete "${record.name}"?`,
      message: "This can't be undone — the map is only stored in this browser.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok === null) return;
    deleteCustomMap(id);
    forgetRoomSetup(id);
    if (this.selected === id) {
      const fallback = listMaps()[0]?.id ?? "classic";
      this.selected = fallback;
      if (loadLastMapId() === id) saveLastMapId(fallback);
    }
    this.render();
  }

  private async exportMap(id: string) {
    const source = this.sourceOf(id);
    if (!source) return;
    // The `# name` header is a comment the importer strips; parseMap never
    // sees it (specs/level-editor.md §8).
    const text = `# ${source.name}\n${source.template}`;
    const result = await showModal(this.el, {
      title: `Export "${source.name}"`,
      message: "Copy this text to move the map to another browser.",
      text,
      readOnlyText: true,
      confirmLabel: "Copy to clipboard",
    });
    if (result !== null) navigator.clipboard?.writeText(text).catch(() => {});
  }

  private async importMap() {
    const text = await showModal(this.el, {
      title: "Import a map",
      message: "Paste a map exported from another browser.",
      text: "",
      confirmLabel: "Import",
    });
    if (text === null) return;
    const lines = text.replace(/\r/g, "").split("\n");
    let name = "Imported map";
    if (lines[0]?.startsWith("#")) name = lines.shift()!.slice(1).trim() || name;
    const template = lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    const problems = validateMapTemplate(template);
    if (hasErrors(problems)) {
      this.setError(
        `That map can't be imported: ${problems.filter((p) => p.severity === "error").map((p) => p.message).join(" ")}`,
      );
      return;
    }
    try {
      const created: CustomMap = createCustomMap({
        name: uniqueMapName(name),
        template,
        origin: { kind: "import" },
      });
      this.selected = created.id;
      this.setError("");
      this.render();
    } catch (e) {
      this.showError(e);
    }
  }

  /** Name + template for any map id, built-in or custom — the only thing
   *  copy and export need, and the one place the two kinds are unified. */
  private sourceOf(id: string): { id: string; name: string; template: string; builtin: boolean } | null {
    const builtin = MAP_SOURCES.find((m) => m.id === id);
    if (builtin) return { id, name: builtin.name, template: builtin.template, builtin: true };
    const record = listCustomMapEntries().find((e) => e.record.id === id)?.record;
    return record ? { id, name: record.name, template: record.template, builtin: false } : null;
  }

  private showError(e: unknown) {
    this.setError(e instanceof MapStorageError ? e.message : "Something went wrong saving the map.");
  }

  private setError(msg: string) {
    const el = this.el.querySelector<HTMLDivElement>("[data-f=error]");
    if (el) el.textContent = msg;
  }

  unmount() {}
}

function templateWidth(template: string): number {
  return template.split("\n")[0]?.length ?? 0;
}
function templateHeight(template: string): number {
  return template.replace(/^\n+/, "").replace(/\n+$/, "").split("\n").length;
}

function relativeTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

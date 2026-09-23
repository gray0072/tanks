// The one map list in the game — specs/level-editor.md §5. Two modes over the
// same screen: `pick` (opened from Create Room, primary action Select) and
// `manage` (opened from the main menu's Level Editor, primary action Edit).
// Management actions live in both, so "this map but with more cover" doesn't
// mean backing out to the menu first.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryRoute, Navigate } from "../routes";
import { listMaps, listCustomMapEntries, type CustomMapEntry, type MapDef } from "../../world/maps/loader";
import { mapSizeLabel } from "../../world/maps/mapFormat";
import { MAP_SOURCES, mapBlurb } from "../../world/maps/mapSources";
import {
  copyMapInto,
  deleteCustomMap,
  createCustomMap,
  MapStorageError,
  uniqueMapName,
} from "../../world/maps/customMaps";
import { hasErrors, validateMapTemplate } from "../../world/maps/validateMap";
import { drawMapPreview } from "../../render/preview";
import { useModal } from "../hooks/useModal";
import { forgetRoomSetup, loadLastMapId, saveLastMapId } from "../../game/settings";

type Filter = "all" | "builtin" | "custom";

export function MapLibrary({ go, route }: { go: Navigate; route: LibraryRoute }) {
  const pick = route.mode === "pick";
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState(
    () => route.selectedMapId ?? loadLastMapId() ?? listMaps()[0]?.id ?? "classic",
  );
  const [error, setError] = useState("");
  /** The custom library is read straight from localStorage; this forces a
   *  fresh read after a copy, an import or a delete. */
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  const { show, node: modal } = useModal();

  const builtins = listMaps();
  const customs = useMemo(() => listCustomMapEntries(), [revision]);

  const back = () => {
    if (pick) go({ k: "create", mapId: selected });
    else go({ k: "menu" });
  };

  const choose = (mapId: string) => {
    setSelected(mapId);
    saveLastMapId(mapId);
    if (pick) go({ k: "create", mapId });
  };

  const openEditor = (mapId: string | null) =>
    go({ k: "editor", mapId, from: { ...route, selectedMapId: selected } });

  /** What a click on the card body does. In `manage` mode that's Edit — a
   *  built-in can't be edited, so it says why instead of doing nothing. */
  const activate = (mapId: string) => {
    const entry = customs.find((e) => e.record.id === mapId);
    if (route.mode === "manage") {
      if (!entry) {
        setError("Built-in maps can't be edited — use Copy to make one yours.");
        return;
      }
      openEditor(mapId);
      return;
    }
    if (entry && !entry.map) {
      setError("That map has problems to fix before it can be played — open it with Edit.");
      return;
    }
    choose(mapId);
  };

  /** Name + template for any map id, built-in or custom — the only thing copy
   *  and export need, and the one place the two kinds are unified. */
  const sourceOf = (id: string) => {
    const builtin = MAP_SOURCES.find((m) => m.id === id);
    if (builtin) return { id, name: builtin.name, template: builtin.template, builtin: true };
    const record = customs.find((e) => e.record.id === id)?.record;
    return record ? { id, name: record.name, template: record.template, builtin: false } : null;
  };

  const showStorageError = (e: unknown) =>
    setError(e instanceof MapStorageError ? e.message : "Something went wrong saving the map.");

  const copy = (id: string) => {
    const source = sourceOf(id);
    if (!source) return;
    try {
      const made = copyMapInto(source, source.builtin);
      setSelected(made.id);
      refresh();
    } catch (e) {
      showStorageError(e);
    }
  };

  const remove = async (id: string) => {
    const record = customs.find((e) => e.record.id === id)?.record;
    if (!record) return;
    const ok = await show({
      title: 'Delete "' + record.name + '"?',
      message: "This can't be undone — the map is only stored in this browser.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok === null) return;
    deleteCustomMap(id);
    forgetRoomSetup(id);
    if (selected === id) {
      const fallback = listMaps()[0]?.id ?? "classic";
      setSelected(fallback);
      if (loadLastMapId() === id) saveLastMapId(fallback);
    }
    refresh();
  };

  const exportMap = async (id: string) => {
    const source = sourceOf(id);
    if (!source) return;
    // The `# name` header is a comment the importer strips; parseMap never
    // sees it (specs/level-editor.md §8).
    const text = "# " + source.name + "\n" + source.template;
    const result = await show({
      title: 'Export "' + source.name + '"',
      message: "Copy this text to move the map to another browser.",
      text,
      readOnlyText: true,
      confirmLabel: "Copy to clipboard",
    });
    if (result !== null) navigator.clipboard?.writeText(text).catch(() => {});
  };

  const importMap = async () => {
    const text = await show({
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
      setError(
        "That map can't be imported: " +
          problems
            .filter((p) => p.severity === "error")
            .map((p) => p.message)
            .join(" "),
      );
      return;
    }
    try {
      const created = createCustomMap({ name: uniqueMapName(name), template, origin: { kind: "import" } });
      setSelected(created.id);
      setError("");
      refresh();
    } catch (e) {
      showStorageError(e);
    }
  };

  return (
    <div className="screen">
      <div className="title" style={{ fontSize: "1.6rem" }}>
        {pick ? "Choose a map" : "Level Editor"}
      </div>
      <div className="panel panel-wide">
        <div className="row between wrap">
          <div className="row wrap">
            {(["all", "builtin", "custom"] as Filter[]).map((f) => (
              <button
                key={f}
                className={"chip " + (filter === f ? "active" : "")}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "builtin" ? "Built-in" : "Custom"}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <button onClick={() => void importMap()}>Import…</button>
            <button className={pick ? "" : "primary"} onClick={() => openEditor(null)}>
              + New map
            </button>
          </div>
        </div>
        <div className="error">{error}</div>
        <div className="row wrap map-grid">
          {filter !== "custom"
            ? builtins.map((map) => (
                <BuiltinCard
                  key={map.id}
                  map={map}
                  selected={map.id === selected}
                  pick={pick}
                  onActivate={() => activate(map.id)}
                  onSelect={() => choose(map.id)}
                  onCopy={() => copy(map.id)}
                  onExport={() => void exportMap(map.id)}
                />
              ))
            : null}
          {filter !== "builtin" && customs.length === 0 ? (
            <div className="hint">
              No maps of your own yet — copy a built-in one, or start from a blank grid.
            </div>
          ) : null}
          {filter !== "builtin"
            ? customs.map((entry) => (
                <CustomCard
                  key={entry.record.id}
                  entry={entry}
                  selected={entry.record.id === selected}
                  pick={pick}
                  onActivate={() => activate(entry.record.id)}
                  onSelect={() => choose(entry.record.id)}
                  onEdit={() => openEditor(entry.record.id)}
                  onCopy={() => copy(entry.record.id)}
                  onExport={() => void exportMap(entry.record.id)}
                  onDelete={() => void remove(entry.record.id)}
                />
              ))
            : null}
        </div>
        <div className="row between">
          <button onClick={back}>Back</button>
          {pick ? (
            <button className="primary" onClick={() => choose(selected)}>
              Continue
            </button>
          ) : null}
        </div>
      </div>
      {modal}
    </div>
  );
}

/** The card itself is the primary action — Edit in the editor's own list,
 *  Select when a room is being set up. The buttons inside it stop the click so
 *  a Copy or a Delete doesn't also open the map. */
function CardAction({ label, className, onClick, disabled, title }: {
  label: string;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={"small " + (className ?? "")}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {label}
    </button>
  );
}

function MapThumb({ map }: { map: MapDef | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    if (map) drawMapPreview(canvas.current, map);
    else canvas.current.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
  }, [map]);
  return <canvas ref={canvas} width={160} height={100} />;
}

function BuiltinCard({
  map,
  selected,
  pick,
  onActivate,
  onSelect,
  onCopy,
  onExport,
}: {
  map: MapDef;
  selected: boolean;
  pick: boolean;
  onActivate: () => void;
  onSelect: () => void;
  onCopy: () => void;
  onExport: () => void;
}) {
  return (
    <div className={"map-card clickable " + (selected ? "selected" : "")} onClick={onActivate}>
      <MapThumb map={map} />
      <b>{map.name}</b>
      <span className="map-meta">{mapSizeLabel(map)}</span>
      <span className="hint">{mapBlurb(map.id)}</span>
      <span className="map-tag">built-in</span>
      <div className="row wrap map-actions">
        {pick ? <CardAction label="Select" onClick={onSelect} /> : null}
        <CardAction label="Edit" disabled title="Built-in maps can't be edited — copy one to make it yours." />
        <CardAction label="Copy" onClick={onCopy} />
        <CardAction label="Export" onClick={onExport} />
      </div>
    </div>
  );
}

function CustomCard({
  entry,
  selected,
  pick,
  onActivate,
  onSelect,
  onEdit,
  onCopy,
  onExport,
  onDelete,
}: {
  entry: CustomMapEntry;
  selected: boolean;
  pick: boolean;
  onActivate: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { record, map, problems } = entry;
  const errors = problems.filter((p) => p.severity === "error").length;
  const size = map
    ? mapSizeLabel(map)
    : templateWidth(record.template) + "×" + templateHeight(record.template) + " · —";
  return (
    <div className={"map-card clickable " + (selected ? "selected" : "")} onClick={onActivate}>
      <MapThumb map={map ?? null} />
      <b>{record.name}</b>
      <span className="map-meta">{size}</span>
      <span className="hint">edited {relativeTime(record.updatedAt)}</span>
      <span className="map-tag">
        custom
        {errors ? (
          <>
            {" · "}
            <span className="map-problem">
              ⚠ {errors} problem{errors > 1 ? "s" : ""}
            </span>
          </>
        ) : null}
      </span>
      <div className="row wrap map-actions">
        {pick ? <CardAction label="Select" onClick={onSelect} disabled={!map} /> : null}
        <CardAction label="Edit" onClick={onEdit} />
        <CardAction label="Copy" onClick={onCopy} />
        <CardAction label="Export" onClick={onExport} />
        <CardAction label="Delete" className="danger" onClick={onDelete} />
      </div>
    </div>
  );
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
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

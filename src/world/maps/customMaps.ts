// Player-authored maps in localStorage — specs/level-editor.md §2.
//
// Deliberately not routed through util/storage.ts: that wrapper swallows every
// failure, which is right for a volume slider and wrong for a map — a save
// that silently did nothing loses work. Reads stay forgiving (a corrupt entry
// is dropped, never thrown at the UI), writes throw MapStorageError so the
// editor can say so and stay dirty.
//
// No DOM beyond localStorage itself, which is looked up off globalThis, so the
// headless tests can stub it.

import { EDITOR_MAX_NAME } from "../../game/config";

export type CustomMapOrigin =
  | { kind: "blank" }
  | { kind: "builtin"; id: string }
  | { kind: "custom"; id: string }
  | { kind: "import" };

export type CustomMap = {
  id: string;
  name: string;
  template: string;
  createdAt: number;
  updatedAt: number;
  origin: CustomMapOrigin;
};

export type CustomMapDraft = {
  /** The stored map this draft belongs to, or null for a never-saved one. */
  mapId: string | null;
  name: string;
  template: string;
  savedAt: number;
};

export class MapStorageError extends Error {}

const STORE_KEY = "tanks.customMaps";
const DRAFT_KEY = "tanks.editorDraft";
const SCHEMA = 1;
const ID_PREFIX = "custom-";

export function isCustomMapId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    // Blocked storage (some privacy modes) throws on access, not on use.
    return null;
  }
}

function readRaw(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  const s = storage();
  if (!s) throw new MapStorageError("Browser storage isn't available, so the map can't be saved.");
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    throw new MapStorageError("Couldn't save — browser storage is full or blocked.");
  }
}

function isValidRecord(v: unknown): v is CustomMap {
  const r = v as Partial<CustomMap> | null;
  return (
    !!r &&
    typeof r.id === "string" &&
    isCustomMapId(r.id) &&
    typeof r.name === "string" &&
    typeof r.template === "string" &&
    typeof r.createdAt === "number" &&
    typeof r.updatedAt === "number" &&
    !!r.origin &&
    typeof (r.origin as CustomMapOrigin).kind === "string"
  );
}

/** Every stored map, newest-edited first. Entries that fail the shape check
 *  are dropped individually — a single bad record never takes the library
 *  down with it. Invalid *maps* (ones that wouldn't parse) are kept: that's
 *  how a broken map can be reopened and fixed (§2.2). */
export function listCustomMaps(): CustomMap[] {
  const data = readRaw(STORE_KEY) as { v?: number; maps?: unknown[] } | null;
  if (!data || data.v !== SCHEMA || !Array.isArray(data.maps)) return [];
  const kept = data.maps.filter(isValidRecord);
  if (kept.length !== data.maps.length) {
    console.warn(`custom maps: dropped ${data.maps.length - kept.length} unreadable entr(ies)`);
  }
  return kept.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCustomMap(id: string): CustomMap | null {
  return listCustomMaps().find((m) => m.id === id) ?? null;
}

function writeAll(maps: CustomMap[]) {
  writeRaw(STORE_KEY, { v: SCHEMA, maps });
}

function newId(): string {
  const bytes = new Uint8Array(4);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return ID_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "<base>", then "<base> 2", "<base> 3", … — the auto-suffixing used by copy
 *  and import (§5.4). `excludeId` keeps a map from colliding with itself. */
export function uniqueMapName(base: string, excludeId?: string): string {
  const taken = new Set(
    listCustomMaps()
      .filter((m) => m.id !== excludeId)
      .map((m) => m.name.trim().toLowerCase()),
  );
  const trimmed = base.trim().slice(0, EDITOR_MAX_NAME) || "Map";
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const candidate = trimmed.slice(0, EDITOR_MAX_NAME - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return trimmed;
}

export function createCustomMap(input: { name: string; template: string; origin: CustomMapOrigin }): CustomMap {
  const now = Date.now();
  const record: CustomMap = {
    id: newId(),
    name: input.name.trim().slice(0, EDITOR_MAX_NAME),
    template: input.template,
    createdAt: now,
    updatedAt: now,
    origin: input.origin,
  };
  writeAll([record, ...listCustomMaps()]);
  return record;
}

export function updateCustomMap(id: string, patch: { name?: string; template?: string }): CustomMap {
  const maps = listCustomMaps();
  const found = maps.find((m) => m.id === id);
  if (!found) throw new MapStorageError("That map is no longer in your library.");
  if (patch.name !== undefined) found.name = patch.name.trim().slice(0, EDITOR_MAX_NAME);
  if (patch.template !== undefined) found.template = patch.template;
  found.updatedAt = Date.now();
  writeAll(maps);
  return found;
}

export function deleteCustomMap(id: string): void {
  writeAll(listCustomMaps().filter((m) => m.id !== id));
}

/** A copy of any map, built-in or custom — the only way to get an editable
 *  version of a built-in (§5.3). */
export function copyMapInto(source: { id: string; name: string; template: string }, builtin: boolean): CustomMap {
  return createCustomMap({
    name: uniqueMapName(`${source.name} copy`),
    template: source.template,
    origin: builtin ? { kind: "builtin", id: source.id } : { kind: "custom", id: source.id },
  });
}

// --- Editor draft (§6.8) ----------------------------------------------------

export function loadEditorDraft(): CustomMapDraft | null {
  const d = readRaw(DRAFT_KEY) as { v?: number } & Partial<CustomMapDraft> | null;
  if (!d || d.v !== SCHEMA || typeof d.template !== "string" || typeof d.savedAt !== "number") return null;
  return {
    mapId: typeof d.mapId === "string" ? d.mapId : null,
    name: typeof d.name === "string" ? d.name : "",
    template: d.template,
    savedAt: d.savedAt,
  };
}

export function saveEditorDraft(draft: CustomMapDraft): void {
  try {
    writeRaw(DRAFT_KEY, { v: SCHEMA, ...draft });
  } catch {
    // The draft is a convenience, not the save path — a full quota here must
    // not interrupt painting. The real Save still reports its own failure.
  }
}

export function clearEditorDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

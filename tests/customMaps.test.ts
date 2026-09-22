// The custom-map library's storage layer (specs/level-editor.md §2) against a
// stubbed localStorage: copy naming, delete, tolerance of a corrupt entry, and
// the schema-version gate. Writes must *fail loudly* — a save that silently
// did nothing loses the player's map.

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private data = new Map<string, string>();
  full = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

const store = new MemoryStorage();
(globalThis as { localStorage?: Storage }).localStorage = store as unknown as Storage;

// Imported after the stub is installed; the module reads localStorage lazily,
// but this keeps the dependency obvious.
const {
  createCustomMap,
  deleteCustomMap,
  getCustomMap,
  isCustomMapId,
  listCustomMaps,
  loadEditorDraft,
  saveEditorDraft,
  clearEditorDraft,
  MapStorageError,
  uniqueMapName,
  updateCustomMap,
  copyMapInto,
} = await import("../src/world/maps/customMaps");

const TEMPLATE = "Rb......\n........\n........\n........\n........\n........\n........\nr......B";

test.beforeEach(() => {
  store.clear();
  store.full = false;
});

test("a created map comes back with a custom id", () => {
  const map = createCustomMap({ name: "Fortress", template: TEMPLATE, origin: { kind: "blank" } });
  assert.ok(isCustomMapId(map.id));
  assert.equal(listCustomMaps().length, 1);
  assert.equal(getCustomMap(map.id)?.name, "Fortress");
});

test("copying suffixes the name instead of colliding", () => {
  const source = { id: "classic", name: "Classic", template: TEMPLATE };
  const first = copyMapInto(source, true);
  const second = copyMapInto(source, true);
  assert.equal(first.name, "Classic copy");
  assert.equal(second.name, "Classic copy 2");
  assert.deepEqual(first.origin, { kind: "builtin", id: "classic" });
  assert.notEqual(first.id, second.id);
});

test("uniqueMapName ignores the map it is renaming", () => {
  const map = createCustomMap({ name: "Swamp", template: TEMPLATE, origin: { kind: "blank" } });
  assert.equal(uniqueMapName("Swamp", map.id), "Swamp");
  assert.equal(uniqueMapName("Swamp"), "Swamp 2");
});

test("an update touches only the named fields and bumps updatedAt", async () => {
  const map = createCustomMap({ name: "Iceworks", template: TEMPLATE, origin: { kind: "blank" } });
  await new Promise((r) => setTimeout(r, 2));
  const next = updateCustomMap(map.id, { template: TEMPLATE + "\n........" });
  assert.equal(next.name, "Iceworks");
  assert.ok(next.updatedAt > map.createdAt);
  assert.equal(getCustomMap(map.id)?.template, TEMPLATE + "\n........");
});

test("delete removes just that map", () => {
  const a = createCustomMap({ name: "A", template: TEMPLATE, origin: { kind: "blank" } });
  const b = createCustomMap({ name: "B", template: TEMPLATE, origin: { kind: "blank" } });
  deleteCustomMap(a.id);
  assert.equal(getCustomMap(a.id), null);
  assert.equal(getCustomMap(b.id)?.name, "B");
});

test("a corrupt entry is dropped, the rest of the library survives", () => {
  const good = createCustomMap({ name: "Good", template: TEMPLATE, origin: { kind: "blank" } });
  const raw = JSON.parse(store.getItem("tanks.customMaps")!);
  raw.maps.push({ id: "custom-broken" }); // missing everything else
  store.setItem("tanks.customMaps", JSON.stringify(raw));
  const maps = listCustomMaps();
  assert.equal(maps.length, 1);
  assert.equal(maps[0].id, good.id);
});

test("a library written by a future schema is ignored rather than misread", () => {
  store.setItem("tanks.customMaps", JSON.stringify({ v: 99, maps: [{ id: "custom-x" }] }));
  assert.deepEqual(listCustomMaps(), []);
});

test("a full quota fails the save loudly", () => {
  store.full = true;
  assert.throws(
    () => createCustomMap({ name: "Nope", template: TEMPLATE, origin: { kind: "blank" } }),
    MapStorageError,
  );
});

test("the editor draft round-trips and clears", () => {
  saveEditorDraft({ mapId: null, name: "Work in progress", template: TEMPLATE, savedAt: 123 });
  assert.equal(loadEditorDraft()?.name, "Work in progress");
  clearEditorDraft();
  assert.equal(loadEditorDraft(), null);
});

test("a full quota never breaks painting — the draft save is best effort", () => {
  store.full = true;
  assert.doesNotThrow(() => saveEditorDraft({ mapId: null, name: "x", template: TEMPLATE, savedAt: 1 }));
});

// Cloud sync of the custom-map library (SPEC §6.4, src/cloud/mapSync.ts), against an
// in-memory "cloud" shared by two simulated devices. Each device has its own stubbed
// localStorage; switching `current` switches which device's storage the library reads.

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

const devices = { a: new MemoryStorage(), b: new MemoryStorage() };
function on(device: keyof typeof devices) {
  (globalThis as { localStorage?: Storage }).localStorage = devices[device] as unknown as Storage;
}
on("a");

const { createCustomMap, deleteCustomMap, listCustomMaps, updateCustomMap, onCustomMapsChanged } = await import(
  "../src/world/maps/customMaps"
);
const { mergeLibrary, syncMapsOnce, CLOUD_MAX_TEMPLATE } = await import("../src/cloud/mapSync");
type RemoteMapRow = import("../src/cloud/mapSync").RemoteMapRow;

class FakeCloud {
  rows = new Map<string, RemoteMapRow>();
  failFetch = false;
  pushes = 0;
  async fetchAll() {
    if (this.failFetch) throw new Error("network down");
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
  async upsert(rows: RemoteMapRow[]) {
    this.pushes++;
    for (const r of rows) this.rows.set(r.id, { ...r });
  }
}

const TEMPLATE = "@@@@\n@Bb@\n@rR@\n@@@@";
let clock = 1_000_000;
const realNow = Date.now;
Date.now = () => (clock += 1000);

function reset() {
  devices.a.clear();
  devices.b.clear();
  on("a");
}

test("a map made on one device shows up on the other", async () => {
  reset();
  const cloud = new FakeCloud();
  const made = createCustomMap({ name: "Dvor", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  on("b");
  await syncMapsOnce(cloud);
  assert.deepEqual(listCustomMaps().map((m) => m.id), [made.id]);
  assert.equal(listCustomMaps()[0].name, "Dvor");
});

test("a delete travels too, instead of the map being pulled back down", async () => {
  reset();
  const cloud = new FakeCloud();
  const made = createCustomMap({ name: "Gone", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  on("b");
  await syncMapsOnce(cloud);
  on("a");
  deleteCustomMap(made.id);
  await syncMapsOnce(cloud);
  assert.equal(listCustomMaps().length, 0, "the next sync must not resurrect it here");
  on("b");
  await syncMapsOnce(cloud);
  assert.equal(listCustomMaps().length, 0, "and it is gone on the other device as well");
});

test("the later edit of the same map wins, on both devices", async () => {
  reset();
  const cloud = new FakeCloud();
  const made = createCustomMap({ name: "Arena", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  on("b");
  await syncMapsOnce(cloud);
  on("a");
  updateCustomMap(made.id, { name: "Arena old" });
  on("b");
  updateCustomMap(made.id, { name: "Arena new" }); // later clock
  await syncMapsOnce(cloud);
  on("a");
  await syncMapsOnce(cloud);
  assert.equal(listCustomMaps()[0].name, "Arena new");
  on("b");
  await syncMapsOnce(cloud);
  assert.equal(listCustomMaps()[0].name, "Arena new");
});

test("different maps edited on two devices both survive", async () => {
  reset();
  const cloud = new FakeCloud();
  createCustomMap({ name: "From A", template: TEMPLATE, origin: { kind: "blank" } });
  on("b");
  createCustomMap({ name: "From B", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  on("a");
  await syncMapsOnce(cloud);
  assert.deepEqual(listCustomMaps().map((m) => m.name).sort(), ["From A", "From B"]);
});

test("a failed pull changes nothing locally and throws", async () => {
  reset();
  const cloud = new FakeCloud();
  createCustomMap({ name: "Keep me", template: TEMPLATE, origin: { kind: "blank" } });
  cloud.failFetch = true;
  await assert.rejects(syncMapsOnce(cloud));
  assert.equal(listCustomMaps().length, 1);
  assert.equal(cloud.rows.size, 0, "nothing may be pushed on a failed pull");
});

test("a sync that changes nothing pushes nothing", async () => {
  reset();
  const cloud = new FakeCloud();
  createCustomMap({ name: "Still", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  const before = cloud.pushes;
  await syncMapsOnce(cloud);
  assert.equal(cloud.pushes, before);
});

test("a sync's own write is reported as 'sync', a user's edit as 'local'", async () => {
  reset();
  const cloud = new FakeCloud();
  on("b");
  createCustomMap({ name: "Elsewhere", template: TEMPLATE, origin: { kind: "blank" } });
  await syncMapsOnce(cloud);
  on("a");
  const seen: string[] = [];
  const off = onCustomMapsChanged((s) => seen.push(s));
  await syncMapsOnce(cloud);
  createCustomMap({ name: "Here", template: TEMPLATE, origin: { kind: "blank" } });
  off();
  assert.deepEqual(seen, ["sync", "local"]);
});

test("malformed cloud rows are ignored, and an oversized map stays local", () => {
  const big = { id: "custom-big", name: "Big", template: "x".repeat(CLOUD_MAX_TEMPLATE + 1), origin: { kind: "blank" as const }, createdAt: 1, updatedAt: 2 };
  const r = mergeLibrary([big], [], [{ id: "not-custom", name: "x" } as unknown as RemoteMapRow]);
  assert.deepEqual(r.maps.map((m) => m.id), ["custom-big"]);
  assert.equal(r.push.length, 0);
});

test.after(() => {
  Date.now = realNow;
});

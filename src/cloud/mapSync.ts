// Syncing the custom-map library with the cloud (SPEC §6.4). One row per map, keyed by the
// map's own id, so two devices editing *different* maps never conflict at all; for the same
// map the later edit wins. Deletes travel as tombstones — without them a map deleted on one
// device would simply be pulled back down from the cloud by the next sync.
//
// No Supabase and no DOM here: the remote is an interface, so tests drive the whole sync
// against an in-memory fake (tests/mapSync.test.ts).

import {
  isCustomMapId,
  listCustomMaps,
  listTombstones,
  replaceLibrary,
  type CustomMap,
  type CustomMapOrigin,
  type MapTombstone,
} from "../world/maps/customMaps";

/** A map as stored in the cloud. `updated_at` is the map's own edit time (ms), or the
 *  deletion time for a tombstone, in which case name and template are empty. */
export type RemoteMapRow = {
  id: string;
  name: string;
  template: string;
  origin: CustomMapOrigin;
  created_at: number;
  updated_at: number;
  deleted: boolean;
};

/** The cloud table's own limit on a template (supabase/schema.sql). A map past it stays
 *  local-only rather than failing every push it rides along in. A 128x128 map, the largest
 *  the format allows, is ~16.5k. */
export const CLOUD_MAX_TEMPLATE = 65536;

export interface MapsRemote {
  /** Every row of the signed-in user. Must *throw* on failure: an error read as "no maps in
   *  the cloud" would look like a first sync and be answered by pushing over real data. */
  fetchAll(): Promise<RemoteMapRow[]>;
  upsert(rows: RemoteMapRow[]): Promise<void>;
}

function isValidRow(r: unknown): r is RemoteMapRow {
  const x = r as Partial<RemoteMapRow> | null;
  return (
    !!x &&
    typeof x.id === "string" &&
    isCustomMapId(x.id) &&
    typeof x.name === "string" &&
    typeof x.template === "string" &&
    typeof x.updated_at === "number" &&
    typeof x.created_at === "number" &&
    typeof x.deleted === "boolean" &&
    !!x.origin &&
    typeof x.origin.kind === "string"
  );
}

function toRow(m: CustomMap): RemoteMapRow {
  return {
    id: m.id,
    name: m.name,
    template: m.template,
    origin: m.origin,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    deleted: false,
  };
}

function tombstoneRow(t: MapTombstone): RemoteMapRow {
  return { id: t.id, name: "", template: "", origin: { kind: "blank" }, created_at: t.deletedAt, updated_at: t.deletedAt, deleted: true };
}

export type MergeResult = {
  maps: CustomMap[];
  tombstones: MapTombstone[];
  /** Rows the cloud is behind on. */
  push: RemoteMapRow[];
};

/** Per map id, whichever of the local copy, the local tombstone and the cloud row is newest
 *  wins; on a tie a deletion wins (deleting is the deliberate act). */
export function mergeLibrary(local: CustomMap[], tombstones: MapTombstone[], remote: RemoteMapRow[]): MergeResult {
  const localById = new Map(local.map((m) => [m.id, m]));
  const tombById = new Map(tombstones.map((t) => [t.id, t]));
  const remoteById = new Map(remote.filter(isValidRow).map((r) => [r.id, r]));
  const ids = new Set([...localById.keys(), ...tombById.keys(), ...remoteById.keys()]);

  const maps: CustomMap[] = [];
  const outTombs: MapTombstone[] = [];
  const push: RemoteMapRow[] = [];

  for (const id of ids) {
    const l = localById.get(id);
    const t = tombById.get(id);
    const r = remoteById.get(id);
    type Candidate = { at: number; deleted: boolean; row: RemoteMapRow };
    const candidates: Candidate[] = [];
    if (l) candidates.push({ at: l.updatedAt, deleted: false, row: toRow(l) });
    if (t) candidates.push({ at: t.deletedAt, deleted: true, row: tombstoneRow(t) });
    if (r) candidates.push({ at: r.updated_at, deleted: r.deleted, row: r });
    candidates.sort((a, b) => b.at - a.at || Number(b.deleted) - Number(a.deleted));
    const win = candidates[0];

    if (win.deleted) outTombs.push({ id, deletedAt: win.at });
    else
      maps.push({
        id,
        name: win.row.name,
        template: win.row.template,
        origin: win.row.origin,
        createdAt: win.row.created_at,
        updatedAt: win.row.updated_at,
      });

    const behind = !r || r.updated_at < win.at || r.deleted !== win.deleted;
    if (behind && win.row.template.length <= CLOUD_MAX_TEMPLATE) push.push(win.row);
  }
  maps.sort((a, b) => b.updatedAt - a.updatedAt);
  return { maps, tombstones: outTombs, push };
}

function sameLibrary(a: CustomMap[], b: CustomMap[], ta: MapTombstone[], tb: MapTombstone[]): boolean {
  const key = (maps: CustomMap[], tombs: MapTombstone[]) =>
    JSON.stringify([
      [...maps].sort((x, y) => x.id.localeCompare(y.id)).map((m) => [m.id, m.updatedAt, m.name, m.template]),
      [...tombs].sort((x, y) => x.id.localeCompare(y.id)).map((t) => [t.id, t.deletedAt]),
    ]);
  return key(a, ta) === key(b, tb);
}

/** One full round trip: pull, merge into the local library, push what the cloud lacks.
 *  Throws on any remote failure, leaving the local library as it was if the pull failed. */
export async function syncMapsOnce(remote: MapsRemote): Promise<void> {
  const rows = await remote.fetchAll();
  const local = listCustomMaps();
  const tombs = listTombstones();
  const merged = mergeLibrary(local, tombs, rows);
  if (!sameLibrary(local, merged.maps, tombs, merged.tombstones)) replaceLibrary(merged.maps, merged.tombstones);
  if (merged.push.length > 0) await remote.upsert(merged.push);
}

// Google sign-in and the background map sync (SPEC §6.4). Started once from main.tsx;
// screens only read the status (useCloudStatus) and call signIn/signOut.
//
// When sync runs: on sign-in (which supabase-js also reports on load for an existing
// session), a few seconds after any local library edit, and whenever the tab comes back to
// the foreground — the last one is what picks up a map made on the phone while this tab sat
// in the background.

import { useSyncExternalStore } from "react";
import { supabase } from "./supabaseClient";
import { syncMapsOnce, type MapsRemote, type RemoteMapRow } from "./mapSync";
import { onCustomMapsChanged } from "../world/maps/customMaps";

export type CloudStatus = "unavailable" | "signedOut" | "syncing" | "synced" | "error";
export type CloudUser = { id: string; email: string | null };
type CloudState = { status: CloudStatus; user: CloudUser | null };

/** Local edits collapse into one push after this long. */
const PUSH_DEBOUNCE_MS = 3000;
/** A tab coming back sooner than this after the last sync doesn't sync again. */
const FOCUS_RESYNC_MIN_MS = 15_000;
const TABLE = "custom_maps";

let state: CloudState = { status: supabase ? "signedOut" : "unavailable", user: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

export function isCloudAvailable(): boolean {
  return supabase !== null;
}

/** The current status and user, re-rendering on change. */
export function useCloudStatus(): CloudState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export async function signIn(): Promise<void> {
  if (!supabase) return;
  // Back to this same page without any query: an invite link's ?room= is spent by now.
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) setState({ status: "error" });
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

function remoteFor(userId: string): MapsRemote {
  const client = supabase!;
  return {
    async fetchAll() {
      const { data, error } = await client
        .from(TABLE)
        .select("id, name, template, origin, created_at, updated_at, deleted")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as RemoteMapRow[];
    },
    async upsert(rows) {
      // supabase-js resolves with { error } rather than rejecting, so a failed write has to
      // be turned into a throw here or it would read as "synced".
      const { error } = await client
        .from(TABLE)
        .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: "user_id,id" });
      if (error) throw error;
    },
  };
}

let running: Promise<void> | null = null;
let again = false;
let lastSyncAt = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Runs a sync now, or once more right after the one in flight — never two at once. */
function requestSync() {
  const user = state.user;
  if (!supabase || !user) return;
  if (running) {
    again = true;
    return;
  }
  setState({ status: "syncing" });
  running = syncMapsOnce(remoteFor(user.id))
    .then(
      () => {
        if (state.user?.id === user.id) setState({ status: "synced" });
      },
      (e: unknown) => {
        console.warn("cloud sync failed", e);
        if (state.user?.id === user.id) setState({ status: "error" });
      },
    )
    .finally(() => {
      running = null;
      lastSyncAt = Date.now();
      if (again) {
        again = false;
        requestSync();
      }
    });
}

let started = false;

export function startCloudSync(): void {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session ? { id: session.user.id, email: session.user.email ?? null } : null;
    const changed = user?.id !== state.user?.id;
    setState({ user, status: user ? state.status : "signedOut" });
    if (user && changed) requestSync();
    // The OAuth round trip lands here with ?code=…; once the session exists it is spent.
    if (user && new URLSearchParams(location.search).has("code")) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
  });

  onCustomMapsChanged((source) => {
    if (source !== "local" || !state.user) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(requestSync, PUSH_DEBOUNCE_MS);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSyncAt > FOCUS_RESYNC_MIN_MS) requestSync();
  });
  // A pending push must not be lost to closing the tab a second after saving a map.
  addEventListener("pagehide", () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      requestSync();
    }
  });
}

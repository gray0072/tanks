// Optional cloud layer (SPEC §6.4). The game is fully playable without it: with no
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time (a fork, a local checkout without
// .env.local) this is null, the Settings section is hidden and every cloud call is a no-op.
//
// PKCE, not the implicit flow: implicit hands the session back in the URL hash, PKCE as a
// `?code=` query parameter that supabase-js exchanges on load. Nothing else in the app reads
// `code` (an invite link is `?room=`), and cloudSync.ts strips it once the session is in.
//
// The Supabase project is shared with other apps on the same origin (`/swedish/` keeps its session
// under the library's default `sb-<project-ref>-auth-token`), so this app's session lives under its
// own `tanks.` key; the PKCE code verifier goes next to it (`tanks.auth-code-verifier`).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { flowType: "pkce", storageKey: "tanks.auth" } }) : null;

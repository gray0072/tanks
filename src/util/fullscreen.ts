// Fullscreen and orientation-lock helpers (SPEC §5.4).
//
// Wrapped rather than called directly at the call sites because every one of
// these APIs is still vendor-prefixed somewhere that matters (older WebKit,
// iPadOS) and every one of them rejects for reasons that are *not* errors
// here: no user gesture, the browser simply not supporting element
// fullscreen (iPhone Safari), or an orientation lock refused on desktop.
// Callers want "did it work?", not an exception to guard.

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

const doc = () => document as FsDocument;
const target = () => document.documentElement as FsElement;

export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = target();
  return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = doc();
  return !!(d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement);
}

/** Requests fullscreen on the document root. Resolves to whether we ended up
 *  fullscreen — `false` (never a throw) when the browser refuses, which it
 *  does whenever the call isn't inside a user gesture. */
export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = target();
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen ?? el.msRequestFullscreen;
  if (!req) return false;
  try {
    await req.call(el, { navigationUI: "hide" } as FullscreenOptions);
  } catch {
    return false;
  }
  return isFullscreen();
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = doc();
  const exit = d.exitFullscreen ?? d.webkitExitFullscreen ?? d.msExitFullscreen;
  if (!exit) return;
  try {
    await exit.call(d);
  } catch {
    /* already gone, or the browser dropped us out on its own */
  }
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    unlockOrientation();
    await exitFullscreen();
    return false;
  }
  const ok = await enterFullscreen();
  if (ok) void lockLandscape();
  return ok;
}

/** Pins the device to landscape. Only works while fullscreen and only on
 *  browsers that implement the lock (Android Chrome does, iOS does not) —
 *  which is why the portrait "rotate your device" notice still exists. */
export async function lockLandscape(): Promise<boolean> {
  const o = screen?.orientation as LockableOrientation | undefined;
  if (!o?.lock) return false;
  try {
    await o.lock("landscape");
    return true;
  } catch {
    return false;
  }
}

export function unlockOrientation() {
  try {
    screen?.orientation?.unlock?.();
  } catch {
    /* not supported — nothing was locked either */
  }
}

/** Subscribes to fullscreen enter/exit, including the ones we didn't ask for
 *  (Esc, the Android back gesture). Returns an unsubscribe. */
export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}

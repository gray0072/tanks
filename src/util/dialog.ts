// Menu/dialog screens are plain DOM (SPEC §6), so "Enter submits the form"
// has to be wired by hand — there are no real <form> elements to rely on.

/**
 * Binds Enter to a screen's primary action for as long as the returned
 * disposer hasn't been called. Screens call this in `mount()` and dispose in
 * `unmount()`; overlays bind on open and dispose on close.
 *
 * Enter is left alone when the focused element already does something with
 * it (a button, a select, a textarea) so keyboard navigation keeps working.
 */
export function bindEnter(action: () => void): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "A") return;
    e.preventDefault();
    action();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

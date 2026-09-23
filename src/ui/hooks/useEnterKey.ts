import { useEffect, useRef } from "react";

/**
 * Enter triggers a screen's primary action. Menu screens are not real
 * <form>s (SPEC §6), so this is wired by hand — and it's a hook rather than
 * a subscribe/dispose pair so the binding follows the component's lifetime
 * on its own.
 *
 * Enter is left alone when the focused element already does something with
 * it (a button, a select, a textarea, or anything acting as a button — the
 * Create Room map card is a focusable div that opens the map picker) so
 * keyboard navigation keeps working.
 * Pass `enabled: false` while an overlay owns Enter for itself.
 */
export function useEnterKey(action: () => void, enabled = true) {
  const latest = useRef(action);
  latest.current = action;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "A") return;
      if (el?.getAttribute("role") === "button") return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

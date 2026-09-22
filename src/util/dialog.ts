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

/**
 * A modal over the current screen — the level editor's confirmations, its
 * import/export text boxes and the library's delete guard (specs/level-editor.md
 * §5.3/§8). Built out of the same `.hud-scoreboard.modal-center` +
 * `.modal-body` pair the How to Play overlay uses, so there's one modal look.
 *
 * Resolves with the entered text (or "" for a plain confirm) when confirmed
 * and `null` when dismissed. Enter is deliberately *not* bound here: the
 * confirm button takes focus, and bindEnter above already leaves a focused
 * BUTTON alone, so the browser's own activation does the right thing without
 * two Enter handlers racing.
 */
export function showModal(
  host: HTMLElement,
  opts: {
    title: string;
    message?: string;
    /** Renders a textarea seeded with this text; omit for a plain confirm. */
    text?: string;
    readOnlyText?: boolean;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "hud-scoreboard modal-center";
    overlay.style.pointerEvents = "auto";
    overlay.innerHTML = `
      <div class="modal-body${opts.text !== undefined ? " modal-body-text" : ""}">
        <h3>${escapeHtml(opts.title)}</h3>
        ${opts.message ? `<p>${escapeHtml(opts.message)}</p>` : ""}
        ${opts.text !== undefined ? `<textarea class="modal-text" spellcheck="false" ${opts.readOnlyText ? "readonly" : ""}>${escapeHtml(opts.text)}</textarea>` : ""}
        <div class="row between" style="margin-top:12px">
          <button data-a="cancel">${escapeHtml(opts.cancelLabel ?? "Cancel")}</button>
          <button class="${opts.danger ? "danger" : "primary"}" data-a="ok">${escapeHtml(opts.confirmLabel ?? "OK")}</button>
        </div>
      </div>
    `;
    host.appendChild(overlay);

    const area = overlay.querySelector<HTMLTextAreaElement>(".modal-text");
    const done = (value: string | null) => {
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      done(null);
    };
    window.addEventListener("keydown", onKey, true);

    overlay.querySelector<HTMLButtonElement>("[data-a=cancel]")!.onclick = () => done(null);
    overlay.querySelector<HTMLButtonElement>("[data-a=ok]")!.onclick = () => done(area?.value ?? "");
    const focusTarget = area && !opts.readOnlyText ? area : overlay.querySelector<HTMLButtonElement>("[data-a=ok]")!;
    focusTarget.focus({ preventScroll: true });
    if (area && opts.readOnlyText) area.select();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// A modal over the current screen — the level editor's confirmations, its
// import/export text boxes and the library's delete guard
// (specs/level-editor.md §5.3/§8). Built out of the same
// `.hud-scoreboard.modal-center` + `.modal-body` pair the How to Play overlay
// uses, so there's one modal look.

import { useEffect, useRef } from "react";

export type ModalOptions = {
  title: string;
  message?: string;
  /** Renders a textarea seeded with this text; omit for a plain confirm. */
  text?: string;
  readOnlyText?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export function Modal({ opts, onDone }: { opts: ModalOptions; onDone: (value: string | null) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onDone(null);
    };
    // Capture phase so the editor's own Escape handler doesn't also fire.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  useEffect(() => {
    // Enter is deliberately not bound: the confirm button takes focus, and
    // useEnterKey already leaves a focused BUTTON alone, so the browser's own
    // activation does the right thing without two Enter handlers racing.
    const editable = area.current && !opts.readOnlyText;
    (editable ? area.current : ok.current)?.focus({ preventScroll: true });
    if (area.current && opts.readOnlyText) area.current.select();
  }, [opts.readOnlyText]);

  return (
    <div className="hud-scoreboard modal-center" style={{ pointerEvents: "auto" }}>
      <div className={`modal-body${opts.text !== undefined ? " modal-body-text" : ""}`}>
        <h3>{opts.title}</h3>
        {opts.message ? <p>{opts.message}</p> : null}
        {opts.text !== undefined ? (
          <textarea
            ref={area}
            className="modal-text"
            spellCheck={false}
            readOnly={opts.readOnlyText}
            defaultValue={opts.text}
          />
        ) : null}
        <div className="row between" style={{ marginTop: 12 }}>
          <button onClick={() => onDone(null)}>{opts.cancelLabel ?? "Cancel"}</button>
          <button
            ref={ok}
            className={opts.danger ? "danger" : "primary"}
            onClick={() => onDone(area.current?.value ?? "")}
          >
            {opts.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useState } from "react";
import { Modal, type ModalOptions } from "../components/Modal";

type Pending = { opts: ModalOptions; resolve: (value: string | null) => void };

/**
 * The promise-shaped modal the editor and the map library are written
 * against: `const text = await show({ ... })`, resolving with the entered
 * text (or "" for a plain confirm) and `null` when dismissed. Render the
 * returned node somewhere inside the screen — it positions itself.
 */
export function useModal(): { show: (opts: ModalOptions) => Promise<string | null>; node: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const show = useCallback(
    (opts: ModalOptions) =>
      new Promise<string | null>((resolve) => {
        setPending((prev) => {
          // Only one modal at a time; an older one loses, exactly as the
          // single overlay element used to.
          prev?.resolve(null);
          return { opts, resolve };
        });
      }),
    [],
  );

  const done = useCallback((value: string | null) => {
    setPending((prev) => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  return { show, node: pending ? <Modal opts={pending.opts} onDone={done} /> : null };
}

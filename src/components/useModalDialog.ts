import { useEffect, useRef, useState, type RefObject } from 'react';

export function useModalDialog(
  open = true,
  initialFocus?: RefObject<HTMLElement | null>,
  returnFocus?: HTMLElement | null,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  // React commits autoFocus before effects run, so remember the launcher during render.
  const [mountedOrigin] = useState(() => document.activeElement);

  useEffect(() => {
    if (!open) return;
    const origin = returnFocus ?? mountedOrigin;
    dialog.current?.showModal();
    initialFocus?.current?.focus();

    return () => {
      const closingDialog = dialog.current;
      closingDialog?.close();
      requestAnimationFrame(() => {
        if (!(origin instanceof HTMLElement) || !origin.isConnected) return;
        const nextDialog = document.querySelector('dialog[open]');
        if (nextDialog && !nextDialog.contains(origin)) return;
        const active = document.activeElement;
        // A user can already have clicked or tabbed elsewhere before this frame.
        // Restore abandoned focus, never override that newer choice.
        if (
          active &&
          active !== document.body &&
          active !== document.documentElement &&
          active !== origin &&
          !closingDialog?.contains(active)
        )
          return;
        origin.focus();
      });
    };
  }, [open, initialFocus, returnFocus, mountedOrigin]);

  return dialog;
}

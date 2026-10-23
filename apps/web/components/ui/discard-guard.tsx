"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";

/**
 * "Discard what you typed?" for a Modal holding work in progress. Pass the guard's `requestClose` as the Modal's `onClose`
 * (Escape and the close button) and to the Cancel button, and render `prompt` in place of the footer while it is set:
 * with nothing typed it closes at once; otherwise the footer asks first. The question lives inside the same dialog, so the
 * Modal's focus trap and Escape handling stay as they are (Escape while asking = keep editing). A save that succeeds
 * calls the real `onClose` directly.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void, message = "Discard what you've entered?") {
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);

  const requestClose = useCallback(() => {
    if (asking) setAsking(false);
    else if (dirty) setAsking(true);
    else onClose();
  }, [asking, dirty, onClose]);

  const prompt: ReactNode = asking ? (
    <div role="group" aria-labelledby={messageId} className="flex w-full flex-wrap items-center justify-end gap-2" data-testid="discard-prompt">
      <p id={messageId} role="status" className="mr-auto self-center text-sm font-medium text-fg">
        {message}
      </p>
      <Button ref={keepRef} type="button" variant="outline" onClick={() => setAsking(false)}>
        Keep editing
      </Button>
      <Button type="button" variant="destructive" onClick={onClose} data-testid="discard-confirm">
        Discard
      </Button>
    </div>
  ) : null;

  return { requestClose, prompt, asking };
}

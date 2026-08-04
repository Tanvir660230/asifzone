"use client";

import { useCallback, useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
}

/** Promise-based replacement for the browser's blocking `confirm()` — `await confirm(message)` resolves to whether the user confirmed, and `dialog` renders the styled modal (mount it once in the page's JSX). */
export function useConfirmDialog() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((message: string, confirmLabel = "Delete") => {
    return new Promise<boolean>((resolve) => setRequest({ message, confirmLabel, resolve }));
  }, []);

  function settle(value: boolean) {
    request?.resolve(value);
    setRequest(null);
  }

  const dialog = (
    <Modal open={Boolean(request)} onClose={() => settle(false)} title="Please confirm" widthClassName="max-w-sm">
      <p className="text-sm text-ink-700">{request?.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => settle(false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={() => settle(true)}>
          {request?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );

  return { confirm, dialog };
}

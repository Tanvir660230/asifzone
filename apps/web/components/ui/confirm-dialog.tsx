"use client";

import { useCallback, useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";

interface ConfirmOptions {
  confirmLabel?: string;
  /** When set, the confirm button stays disabled until the admin types this text exactly —
   * reserved for irreversible actions on financial/audit records (e.g. permanently deleting an order). */
  requireText?: string;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  requireText?: string;
}

/** Promise-based replacement for the browser's blocking `confirm()` — `await confirm(message)` resolves to whether the user confirmed, and `dialog` renders the styled modal (mount it once in the page's JSX). */
export function useConfirmDialog() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (v: boolean) => void }) | null>(null);
  const [typedText, setTypedText] = useState("");

  const confirm = useCallback((message: string, options: string | ConfirmOptions = {}) => {
    const opts: ConfirmOptions = typeof options === "string" ? { confirmLabel: options } : options;
    setTypedText("");
    return new Promise<boolean>((resolve) =>
      setRequest({ message, confirmLabel: opts.confirmLabel ?? "Delete", requireText: opts.requireText, resolve }),
    );
  }, []);

  function settle(value: boolean) {
    request?.resolve(value);
    setRequest(null);
  }

  const isLocked = Boolean(request?.requireText) && typedText !== request?.requireText;

  const dialog = (
    <Modal open={Boolean(request)} onClose={() => settle(false)} title="Please confirm" widthClassName="max-w-sm">
      <p className="text-sm text-ink-700">{request?.message}</p>
      {request?.requireText && (
        <div className="mt-3">
          <label className="mb-1 block text-xs text-ink-500">
            Type <span className="font-medium text-ink-800">{request.requireText}</span> to confirm
          </label>
          <Input value={typedText} onChange={(e) => setTypedText(e.target.value)} autoFocus />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => settle(false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={isLocked} onClick={() => settle(true)}>
          {request?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );

  return { confirm, dialog };
}

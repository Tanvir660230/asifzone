"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";

interface ConfirmOptions {
  confirmLabel?: string;
  /** When set, the confirm button stays disabled until the admin types this text exactly —
   * reserved for irreversible actions on financial/audit records (e.g. permanently deleting an order). */
  requireText?: string;
  /** "danger" (default) for destructive or irreversible actions; "default" for routine confirmations (book a courier,
   * restore), so a red button keeps meaning "this destroys something". */
  tone?: "danger" | "default";
  /** Dialog heading; defaults to "Please confirm". */
  title?: string;
  /** Extra context under the message — e.g. what the action will change. */
  details?: ReactNode;
}

interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  requireText?: string;
  tone: "danger" | "default";
  title: string;
  details?: ReactNode;
}

/** Promise-based replacement for the browser's blocking `confirm()` — `await confirm(message)` resolves to whether the user confirmed, and `dialog` renders the styled modal (mount it once in the page's JSX). */
export function useConfirmDialog() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (v: boolean) => void }) | null>(null);
  const [typedText, setTypedText] = useState("");

  const confirm = useCallback((message: string, options: string | ConfirmOptions = {}) => {
    const opts: ConfirmOptions = typeof options === "string" ? { confirmLabel: options } : options;
    setTypedText("");
    return new Promise<boolean>((resolve) =>
      setRequest({
        message,
        confirmLabel: opts.confirmLabel ?? "Delete",
        requireText: opts.requireText,
        tone: opts.tone ?? "danger",
        title: opts.title ?? "Please confirm",
        details: opts.details,
        resolve,
      }),
    );
  }, []);

  function settle(value: boolean) {
    request?.resolve(value);
    setRequest(null);
  }

  const isLocked = Boolean(request?.requireText) && typedText !== request?.requireText;

  const dialog = (
    <Modal open={Boolean(request)} onClose={() => settle(false)} title={request?.title ?? "Please confirm"} widthClassName={request?.details ? "max-w-md" : "max-w-sm"}>
      <p className="text-sm text-ink-700">{request?.message}</p>
      {request?.details && <div className="mt-3">{request.details}</div>}
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
        <Button variant={request?.tone === "default" ? "primary" : "destructive"} size="sm" disabled={isLocked} onClick={() => settle(true)}>
          {request?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );

  return { confirm, dialog };
}

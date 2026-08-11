"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/lib/api/feedback";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_FORM = { name: "", email: "", phone: "", subject: "", message: "" };

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  function handleClose() {
    onClose();
    // Wait out the modal's close transition before resetting, so the form doesn't visibly
    // flash back to blank while it's still fading out.
    setTimeout(() => {
      setForm(EMPTY_FORM);
      setStatus("idle");
    }, 200);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      await submitFeedback({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        subject: form.subject,
        message: form.message,
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Send feedback" widthClassName="max-w-md">
      {status === "done" ? (
        <div className="py-4 text-center">
          <p className="text-sm text-ink-700">Thanks — we&rsquo;ve received your message and will get back to you soon.</p>
          <Button type="button" variant="outline" size="sm" className="mt-5" onClick={handleClose}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="feedback-name">Name</Label>
            <Input
              id="feedback-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="feedback-email">Email (optional)</Label>
              <Input
                id="feedback-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="feedback-phone">Phone (optional)</Label>
              <Input
                id="feedback-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="feedback-subject">Subject</Label>
            <Input
              id="feedback-subject"
              required
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              required
              rows={4}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            />
          </div>
          {status === "error" && <p className="text-xs text-danger-600">Something went wrong — please try again.</p>}
          <Button type="submit" className="w-full" disabled={status === "loading"}>
            {status === "loading" ? "Sending…" : "Send message"}
          </Button>
        </form>
      )}
    </Modal>
  );
}

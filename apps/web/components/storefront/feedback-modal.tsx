"use client";

import { Modal } from "@/components/ui/modal";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useFeedbackForm } from "@/hooks/use-feedback-form";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { form, setField, status, setStatus, submit, resetForm } = useFeedbackForm();

  function handleClose() {
    onClose();
    // Wait out the modal's close transition before resetting, so the form doesn't visibly
    // flash back to blank while it's still fading out.
    setTimeout(() => {
      resetForm();
      setStatus("idle");
    }, 200);
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
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="feedback-name">Name</Label>
            <Input id="feedback-name" required value={form.name} onChange={(e) => setField("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="feedback-email">Email (optional)</Label>
              <Input id="feedback-email" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="feedback-phone">Phone (optional)</Label>
              <Input id="feedback-phone" type="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="feedback-subject">Subject</Label>
            <Input id="feedback-subject" required value={form.subject} onChange={(e) => setField("subject", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              required
              rows={4}
              value={form.message}
              onChange={(e) => setField("message", e.target.value)}
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

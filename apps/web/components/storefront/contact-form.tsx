"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/lib/api/feedback";

const EMPTY_FORM = { name: "", email: "", phone: "", subject: "", message: "" };

/** Inline (non-modal) version of the same message-us form the floating contact widget offers —
 * embedded directly on the Contact page so a visitor who lands here from search/a footer link
 * doesn't have to go hunting for the floating bubble to actually reach someone. */
export function ContactForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

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
      setForm(EMPTY_FORM);
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-ink-100 bg-cream-50 p-10 text-center">
        <span className="glossy mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brass-100 text-brass-600">
          <CheckCircle2 size={24} />
        </span>
        <h3 className="font-display text-lg text-ink-900">Message sent</h3>
        <p className="mt-2 max-w-xs text-sm text-ink-500">
          Thanks for reaching out — we&rsquo;ll get back to you within one business day.
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-6" onClick={() => setStatus("idle")}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-ink-100 bg-cream-50 p-6 sm:p-8">
      <h2 className="mb-1 font-display text-xl text-ink-900">Send us a message</h2>
      <p className="mb-6 text-sm text-ink-500">Fill this out and we&rsquo;ll follow up by email or phone.</p>
      <div className="space-y-4">
        <div>
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="contact-email">Email (optional)</Label>
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="contact-phone">Phone (optional)</Label>
            <Input
              id="contact-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="contact-subject">Subject</Label>
          <Input
            id="contact-subject"
            required
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="contact-message">Message</Label>
          <Textarea
            id="contact-message"
            required
            rows={5}
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          />
        </div>
        {status === "error" && <p className="text-xs text-danger-600">Something went wrong — please try again.</p>}
        <Button type="submit" variant="brass" className="w-full" disabled={status === "loading"}>
          {status === "loading" ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}

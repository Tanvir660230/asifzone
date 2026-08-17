"use client";

import { useState, type FormEvent } from "react";
import { submitFeedback } from "@/lib/api/feedback";

const EMPTY_FORM = { name: "", email: "", phone: "", subject: "", message: "" };

export type FeedbackFormStatus = "idle" | "loading" | "done" | "error";
export type FeedbackFormField = keyof typeof EMPTY_FORM;

/** The name/email/phone/subject/message state and submit-to-submitFeedback logic shared by
 * ContactForm (inline, on the Contact page) and FeedbackModal (the floating widget's popup) — same
 * five fields, same API call, previously duplicated in both. Each caller keeps its own chrome
 * (card vs. modal) and decides when to clear the form (immediately on success vs. deferred until a
 * close transition finishes), since that timing genuinely differs between the two. */
export function useFeedbackForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<FeedbackFormStatus>("idle");

  function setField(field: FeedbackFormField, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  async function submit(e: FormEvent, onSuccess?: () => void) {
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
      onSuccess?.();
    } catch {
      setStatus("error");
    }
  }

  return { form, setField, status, setStatus, submit, resetForm };
}

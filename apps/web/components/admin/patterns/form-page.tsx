"use client";

import { useEffect, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormPageProps {
  title: string;
  description?: ReactNode;
  /** A secondary header action (rare — the form's own action is Save, in the save bar). */
  action?: ReactNode;
  /** Draw the group's tab row (`ModuleTabs`). Default true. */
  tabs?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Something changed since the last save: the bar says so, Save turns on, and leaving the page asks first. */
  dirty: boolean;
  saving?: boolean;
  /** "Save settings". Default "Save". */
  saveLabel?: string;
  /** Turns Save off for a reason other than "nothing changed" (an invalid field). */
  saveDisabled?: boolean;
  /** Left side of the save bar when nothing is waiting (e.g. "Saved 2 min ago"). */
  status?: ReactNode;
  /** FormSections. */
  children: ReactNode;
  className?: string;
}

/**
 * The form page anatomy of DESIGN_SYSTEM §6: header → the group's tabs → titled sections in one column of at most
 * 720 px → a save bar that stays at the bottom of the screen while the form scrolls (above the phone's bottom bar, which
 * sits outside the scrolling area). Leaving with unsaved changes asks first.
 */
export function FormPage({ title, description, action, tabs = true, onSubmit, dirty, saving, saveLabel = "Save", saveDisabled, status, children, className }: FormPageProps) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div data-pattern="form-page" className={className}>
      <PageHeader title={title} description={description} action={action} />
      {tabs && <ModuleTabs />}
      <form onSubmit={onSubmit} className="max-w-form">
        <div className="space-y-6">{children}</div>
        <div
          data-form-save-bar=""
          className={cn(
            "sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-end gap-3 border-t border-line-subtle bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0",
          )}
        >
          <p className="mr-auto text-xs text-fg-muted" role="status">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : status}
          </p>
          <Button type="submit" variant="brass" disabled={!dirty || saving || saveDisabled} loading={saving}>
            {saveLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

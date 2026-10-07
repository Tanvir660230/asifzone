"use client";

import { useRef, useState, type FormEvent } from "react";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** "Save view": names the list's current filters as a view (DR-18), optionally shared with the team. */
export function SaveViewButton({ onSave, saving, className }: { onSave: (label: string, shared: boolean) => Promise<unknown>; saving: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [shared, setShared] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      await onSave(label.trim(), shared);
      toast.success(shared ? "View saved and shared with the team" : "View saved");
      setOpen(false);
      setLabel("");
      setShared(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't save the view"));
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-accent transition-colors duration-fast ease-smooth hover:bg-accent/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          className,
        )}
      >
        <BookmarkPlus size={14} aria-hidden="true" /> Save view
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end" className="w-[min(92vw,320px)] p-4">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name this view" htmlFor="save-view-name">
            <Input id="save-view-name" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="e.g. Dhaka COD, unpaid" autoFocus />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-fg">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with the team
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!label.trim() || saving}>
              Save
            </Button>
          </div>
        </form>
      </Popover>
    </>
  );
}

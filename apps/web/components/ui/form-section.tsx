import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormSectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Groups related fields under a heading; consecutive sections are separated by a hairline. */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn("space-y-4 border-t border-line-subtle pt-6 first:border-t-0 first:pt-0", className)}>
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

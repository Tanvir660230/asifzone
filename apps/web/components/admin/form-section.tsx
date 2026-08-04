import type { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <div className="space-y-4 border-t border-ink-100 pt-6 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-medium text-ink-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

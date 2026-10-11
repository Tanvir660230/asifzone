import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

interface FieldProps {
  /** id of the control — links the label, hint and error to it. */
  htmlFor: string;
  label?: ReactNode;
  required?: boolean;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Validation message; when set the control is marked `aria-invalid`. */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The form-field layout: label → control → hint → error, with the accessibility wiring done once.
 * When `children` is a single element (Input, Select, Textarea, a register()-spread control…), it
 * receives `aria-describedby` (hint + error ids) and `aria-invalid` automatically.
 *
 *   <Field htmlFor="name" label="Name" required error={errors.name?.message}>
 *     <Input id="name" {...register("name")} />
 *   </Field>
 */
export function Field({ htmlFor, label, required, hint, error, className, children }: FieldProps) {
  const hintId = hint && !error ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const control = only
    ? cloneElement(only, {
        "aria-describedby": [only.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : only.props["aria-invalid"],
      })
    : children;

  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {control}
      {hintId && (
        <p id={hintId} className="ui-field-hint">
          {hint}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/** A validation message on its own (when a control isn't wrapped in <Field>). */
export function FieldError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn("ui-field-error flex items-start gap-1", className)}>
      <AlertCircle size={13} className="mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

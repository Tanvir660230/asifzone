interface AuthModeToggleProps {
  mode: "email" | "phone";
  onChange: (mode: "email" | "phone") => void;
}

/** Shared by login and register — was duplicated markup between the two pages. */
export function AuthModeToggle({ mode, onChange }: AuthModeToggleProps) {
  return (
    <div className="mb-4 flex gap-2 text-sm">
      <button
        type="button"
        onClick={() => onChange("email")}
        className={mode === "email" ? "font-medium text-ink-900 underline" : "text-ink-500 hover:text-ink-700"}
      >
        Email
      </button>
      <span className="text-ink-300">·</span>
      <button
        type="button"
        onClick={() => onChange("phone")}
        className={mode === "phone" ? "font-medium text-ink-900 underline" : "text-ink-500 hover:text-ink-700"}
      >
        Phone
      </button>
    </div>
  );
}

import { SegmentedControl } from "@/components/ui/tabs";

interface AuthModeToggleProps {
  mode: "email" | "phone";
  onChange: (mode: "email" | "phone") => void;
}

const OPTIONS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
] as const;

/** Shared by login and register: choose the sign-in method. */
export function AuthModeToggle({ mode, onChange }: AuthModeToggleProps) {
  return <SegmentedControl aria-label="Sign-in method" options={OPTIONS} value={mode} onChange={onChange} className="mb-4" />;
}

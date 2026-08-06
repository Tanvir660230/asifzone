"use client";

import { cn } from "@/lib/utils";

type Strength = 0 | 1 | 2 | 3;

/** Simple rule-based scoring (not entropy math) — length plus a mix of character classes. Good
 * enough to nudge users toward a stronger password without a new dependency for something this small. */
function scorePassword(password: string): Strength {
  if (!password) return 0;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++;

  return Math.min(score, 3) as Strength;
}

const LABELS: Record<Strength, string> = { 0: "Too short", 1: "Weak", 2: "Fair", 3: "Strong" };
const COLORS: Record<Strength, string> = {
  0: "bg-ink-200",
  1: "bg-danger-500",
  2: "bg-warning-500",
  3: "bg-success-500",
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = scorePassword(password);

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3].map((bar) => (
          <div
            key={bar}
            className={cn("h-1 flex-1 rounded-full transition-colors duration-200 ease-smooth", bar <= strength ? COLORS[strength] : "bg-ink-200")}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-500">{LABELS[strength]}</p>
    </div>
  );
}

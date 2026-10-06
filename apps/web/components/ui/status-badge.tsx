import { Badge } from "@/components/ui/badge";
import { statusOf, TONE_BADGE_VARIANT, type StatusDomain } from "@/lib/status";

/**
 * A status as a badge, straight from the status registry (lib/status.ts): its words, its tone, its meaning as the hover
 * title, and (with `icon`) its glyph — so the state never depends on colour alone and never drifts between screens.
 */
export function StatusBadge({
  domain,
  value,
  short = false,
  icon = false,
  dot = false,
  className,
}: {
  domain: StatusDomain;
  value: string;
  short?: boolean;
  icon?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const entry = statusOf(domain, value);
  const Icon = icon ? entry.icon : undefined;
  return (
    <Badge variant={TONE_BADGE_VARIANT[entry.tone]} dot={dot} title={entry.meaning} className={className}>
      {Icon && <Icon size={12} className="shrink-0" aria-hidden />}
      {short ? (entry.short ?? entry.label) : entry.label}
    </Badge>
  );
}

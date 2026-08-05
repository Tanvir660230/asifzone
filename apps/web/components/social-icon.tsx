import { Facebook, Instagram, Youtube, Linkedin, X, MessageCircle, Globe, type LucideIcon } from "lucide-react";
import type { SocialPlatform } from "@clothing-brand/shared";

/** Lucide ships no official TikTok mark — inlined at the same stroke weight as the rest of the set. */
function TikTokIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.6 5.82c-1.02-.88-1.66-2.18-1.66-3.62h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.6c.19 0 .38.02.56.05V8.96a5.7 5.7 0 0 0-.56-.03A5.69 5.69 0 0 0 3.57 14.6a5.69 5.69 0 0 0 5.69 5.7 5.69 5.69 0 0 0 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.28 4.28 0 0 1-2.65-1.48z" />
    </svg>
  );
}

interface PlatformMeta {
  label: string;
  Icon: LucideIcon | typeof TikTokIcon;
  /** Tailwind classes applied on hover, matching each platform's brand color. */
  hoverClass: string;
}

export const SOCIAL_PLATFORM_META: Record<SocialPlatform, PlatformMeta> = {
  FACEBOOK: { label: "Facebook", Icon: Facebook, hoverClass: "hover:border-[#1877F2] hover:bg-[#1877F2] hover:text-white" },
  INSTAGRAM: {
    label: "Instagram",
    Icon: Instagram,
    hoverClass:
      "hover:border-transparent hover:bg-gradient-to-tr hover:from-[#F58529] hover:via-[#DD2A7B] hover:to-[#8134AF] hover:text-white",
  },
  YOUTUBE: { label: "YouTube", Icon: Youtube, hoverClass: "hover:border-[#FF0000] hover:bg-[#FF0000] hover:text-white" },
  TIKTOK: { label: "TikTok", Icon: TikTokIcon, hoverClass: "hover:border-ink-900 hover:bg-ink-900 hover:text-white" },
  LINKEDIN: { label: "LinkedIn", Icon: Linkedin, hoverClass: "hover:border-[#0A66C2] hover:bg-[#0A66C2] hover:text-white" },
  X: { label: "X (Twitter)", Icon: X, hoverClass: "hover:border-ink-900 hover:bg-ink-900 hover:text-white" },
  WHATSAPP: { label: "WhatsApp", Icon: MessageCircle, hoverClass: "hover:border-[#25D366] hover:bg-[#25D366] hover:text-white" },
  OTHER: { label: "Other", Icon: Globe, hoverClass: "hover:border-brass-400 hover:bg-brass-400 hover:text-ink-900" },
};

export function SocialIcon({ platform, size = 18, className }: { platform: SocialPlatform; size?: number; className?: string }) {
  const { Icon } = SOCIAL_PLATFORM_META[platform];
  return <Icon size={size} className={className} />;
}

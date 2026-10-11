import {
  Boxes,
  ClipboardList,
  CreditCard,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  MessageSquare,
  Settings,
  ShieldCheck,
  Shirt,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIconName } from "@/lib/admin/navigation";

/** Icon for each navigation icon name (the manifest stays pure data — lib/admin/navigation.ts). */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  home: LayoutDashboard,
  orders: ClipboardList,
  products: Shirt,
  inventory: Boxes,
  customers: Users,
  messages: MessageSquare,
  marketing: Megaphone,
  storefront: LayoutTemplate,
  finance: CreditCard,
  analytics: Gauge,
  settings: Settings,
  administration: ShieldCheck,
};

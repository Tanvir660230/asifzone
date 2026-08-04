import Link from "next/link";
import { PackageSearch, Search, User } from "lucide-react";
import type { Banner } from "@clothing-brand/shared";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { siteConfig } from "@/lib/site-config";
import { MegaMenu } from "./mega-menu";
import { MobileNav } from "./mobile-nav";
import { CartIcon } from "./cart-icon";
import { AnnouncementBar } from "./announcement-bar";

export function Header({ categories, announcements = [] }: { categories: CategoryTreeNode[]; announcements?: Banner[] }) {
  return (
    <header className="sticky top-0 z-30">
      <AnnouncementBar announcements={announcements} />
      <div className="border-b border-ink-100 bg-cream-50/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <MobileNav categories={categories} />

          <Link href="/" className="font-display text-xl tracking-widest text-ink-900">
            {siteConfig.name.toUpperCase()}
          </Link>

          <MegaMenu categories={categories} />

          <div className="flex items-center gap-5">
            <Link href="/search" aria-label="Search" className="text-ink-700 hover:text-brass-500">
              <Search size={20} />
            </Link>
            <Link href="/track-order" aria-label="Track your order" className="hidden text-ink-700 hover:text-brass-500 sm:block">
              <PackageSearch size={20} />
            </Link>
            <Link href="/account" aria-label="Your account" className="text-ink-700 hover:text-brass-500">
              <User size={20} />
            </Link>
            <CartIcon />
          </div>
        </div>
      </div>
    </header>
  );
}

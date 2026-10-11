"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { ACCOUNT_SECTIONS, resolveAccountLocation } from "@/lib/account";
import { logoutCustomer } from "@/lib/customer-auth";
import { transitions } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The account's navigation: one row of section tabs (Home, Orders, Wallet, Saved, Settings) and, for sections with more
 * than one page, a row of sub-page pills. Persistent across every /account page so moving around never feels like
 * leaving — the underline slides to the new section instead of the page reloading. */
export function AccountTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { section, page } = resolveAccountLocation(pathname);

  async function handleLogout() {
    await logoutCustomer();
    queryClient.clear();
    router.replace("/account/login");
  }

  return (
    <div>
      <div className="-mx-4 flex items-end justify-between gap-4 border-b border-line px-1 sm:mx-0 sm:px-0">
        <nav aria-label="Account" className="-mb-px flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ACCOUNT_SECTIONS.map((s) => {
            const active = s.id === section.id;
            return (
              <Link
                key={s.id}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative shrink-0 px-2.5 py-3.5 text-[15px] transition-colors duration-fast ease-smooth sm:px-4",
                  active ? "font-medium text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {s.label}
                {active && (
                  <motion.span
                    layoutId="account-tab-underline"
                    transition={transitions.smooth}
                    className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent sm:inset-x-4"
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={handleLogout}
          className="mb-1.5 hidden shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-900/[0.05] hover:text-fg sm:flex"
        >
          <LogOut size={15} aria-hidden="true" />
          Log out
        </button>
      </div>

      {section.pages.length > 1 && (
        <nav aria-label={`${section.label} pages`} className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {section.pages.map((p) => {
            const active = p.href === page?.href;
            return (
              <Link
                key={p.href}
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-sm transition-colors duration-fast ease-smooth",
                  active ? "bg-accent text-accent-fg" : "bg-surface text-fg-muted ring-1 ring-inset ring-line-subtle hover:text-fg",
                )}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/** Foot of every account page: who is signed in, and Log out on small screens (the tab row has no room for it there).
 * Also the shell's session check — useCurrentCustomer sends a signed-out visitor to the login page. */
export function AccountFooter() {
  const { data } = useCurrentCustomer();
  const email = data?.customer.email ?? data?.customer.phone;
  const router = useRouter();
  const queryClient = useQueryClient();

  async function handleLogout() {
    await logoutCustomer();
    queryClient.clear();
    router.replace("/account/login");
  }

  return (
    <div className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-fg-muted">
      <span className="min-w-0 truncate">{email ? `Signed in as ${email}` : " "}</span>
      <button type="button" onClick={handleLogout} className="rounded-full px-3 py-2 hover:bg-ink-900/[0.05] hover:text-fg sm:hidden">
        Log out
      </button>
    </div>
  );
}

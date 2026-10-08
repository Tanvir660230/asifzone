"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { formatPrice, formatCount } from "@/lib/format";
import { transitions } from "@/lib/motion";
import { useAccountShell } from "./account-shell-context";

interface MemberCardProps {
  name: string;
  memberSince: string;
  storeBalance: number;
  rewardPoints: number;
  couponCount: number;
}

/** The account's signature element: a matte card in the brand's inverse surface carrying the customer's name and what
 * they can spend — store balance, points, coupons. Opens the Wallet. The one moment of motion on the home page: it
 * settles into place on load (skipped under reduced motion). */
export function MemberCard({ name, memberSince, storeBalance, rewardPoints, couponCount }: MemberCardProps) {
  const { storeName } = useAccountShell();
  const since = new Date(memberSince).getFullYear();
  const monogram = storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toLowerCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, rotateX: 10 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ ...transitions.page, delay: 0.08 }}
      style={{ transformPerspective: 900 }}
    >
      <Link
        href="/account/store-balance"
        aria-label={`Wallet: ${formatPrice(storeBalance)} store balance, ${formatCount(rewardPoints)} points, ${couponCount} coupons`}
        data-testid="member-card"
        className="group relative block min-h-[13.5rem] overflow-hidden rounded-[22px] bg-surface-inverse p-6 text-cream-50 shadow-floatLg ring-1 ring-inset ring-white/[0.08] transition-transform duration-slow ease-smooth hover:-translate-y-0.5 sm:aspect-[1.586] sm:min-h-0 sm:p-7"
      >
        {monogram && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -right-3 select-none font-display text-[13rem] leading-none tracking-[-0.06em] text-white/[0.045] transition-transform duration-slower ease-smooth group-hover:-translate-x-1"
          >
            {monogram}
          </span>
        )}
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 text-xs">
            <span className="font-semibold uppercase tracking-[0.08em]">{storeName}</span>
            <span className="text-ink-400">Member since {since}</span>
          </div>

          <div className="mt-auto pt-8">
            <p className="text-xs text-ink-400">Store balance</p>
            <p className="font-display text-[2.75rem] leading-[1.1] tracking-tight tabular-nums">{formatPrice(storeBalance)}</p>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4 text-sm">
            <p className="min-w-0 truncate font-medium">{name}</p>
            <div className="flex shrink-0 gap-5">
              <span>
                <span className="font-semibold tabular-nums">{formatCount(rewardPoints)}</span> <span className="text-ink-400">points</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums">{couponCount}</span>{" "}
                <span className="text-ink-400">{couponCount === 1 ? "coupon" : "coupons"}</span>
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

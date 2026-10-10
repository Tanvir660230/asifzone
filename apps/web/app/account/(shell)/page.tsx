"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, MapPin, Smartphone } from "lucide-react";
import type { AccountSummary, Customer } from "@clothing-brand/shared";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { ACCOUNT_SUMMARY_KEY, getMyAccountSummary } from "@/lib/api/customers";
import { listWishlist } from "@/lib/api/wishlist";
import { resendVerificationEmail } from "@/lib/customer-auth";
import { firstName, orderHeadline, partOfDay } from "@/lib/account";
import { formatPrice, formatStoreDate, orderStatusLabel } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { ErrorState } from "@/components/ui/empty-state";
import { ProductCard } from "@/components/storefront/product-card";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { AccountHomeSkeleton } from "@/components/account/account-skeleton";
import { MemberCard } from "@/components/account/member-card";
import { ActiveOrder, FirstOrderWelcome } from "@/components/account/active-order";
import { GroupedList, ListRow, OrderThumb, RowIcon, SectionHeading } from "@/components/account/account-ui";

/** The account home (docs/ACCOUNT_HOME.md): a greeting that says what's happening, the order on its way, the member card,
 * anything left to set up, recent orders, saved items and the delivery address — everything at a glance, from one
 * summary request. Editing lives in Settings; this page is for looking. */
export default function AccountHomePage() {
  const { data: me } = useCurrentCustomer();
  // staleTime 0: shows the cached summary instantly, then refreshes it — orders, addresses and balance change elsewhere.
  const summaryQuery = useQuery({ queryKey: ACCOUNT_SUMMARY_KEY, queryFn: getMyAccountSummary, staleTime: 0 });
  // The greeting reads the viewer's clock — only after mount, so the server and client render the same first paint.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => setGreeting(`Good ${partOfDay()}`), []);

  const customer = me?.customer;
  if (!customer || summaryQuery.isPending) return <AccountHomeSkeleton />;

  if (summaryQuery.isError) {
    return (
      <div>
        <Greeting greeting={greeting} name={customer.name} line={null} />
        <ErrorState
          variant="bordered"
          className="mt-10"
          title="Your account summary didn't load"
          description="Your orders and balance are safe. Try again, or open a section from the tabs above."
          onRetry={() => summaryQuery.refetch()}
        />
      </div>
    );
  }

  const summary = summaryQuery.data.summary;

  return (
    <div>
      <Greeting greeting={greeting} name={customer.name} line={storyLine(summary)} />

      <div className="mt-10 grid gap-x-8 gap-y-10 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        {/* Member card first on small screens: what you can spend is the most-used thing after the order. */}
        <div className="lg:order-2">
          <MemberCard
            name={customer.name}
            memberSince={summary.memberSince}
            storeBalance={summary.storeBalance}
            rewardPoints={summary.rewardPoints}
            couponCount={summary.couponCount}
          />
        </div>

        <div className="min-w-0 space-y-10 lg:order-1 lg:row-span-3">
          {summary.activeOrder ? <ActiveOrder order={summary.activeOrder} /> : summary.orderCount === 0 && <FirstOrderWelcome />}
          <RecentOrders summary={summary} />
          <SavedForLater />
        </div>

        <div className="space-y-10 lg:order-3">
          <SetupList customer={customer} />
          <DeliveringTo summary={summary} />
        </div>
      </div>
    </div>
  );
}

function Greeting({ greeting, name, line }: { greeting: string | null; name: string; line: string | null }) {
  return (
    <header className="max-w-3xl">
      <h1 className="text-balance font-display text-[2.5rem] leading-[1.05] tracking-[-0.025em] text-fg sm:text-[3.25rem] lg:text-[3.75rem]">
        {/* "Hello" until the clock is read on the client, so the first paint never flips between greetings. */}
        {greeting ?? "Hello"}, {firstName(name)}.
      </h1>
      {line && <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-ink-600 sm:text-lg">{line}</p>}
    </header>
  );
}

/** One sentence about what matters right now, written from the summary. */
function storyLine(s: AccountSummary): string {
  const balance = s.storeBalance > 0 ? ` You have ${formatPrice(s.storeBalance)} in store balance for your next order.` : "";
  if (s.activeOrder) {
    const status = s.activeOrder.status;
    const where =
      status === "SHIPPED"
        ? "is on its way to you"
        : status === "PACKED"
          ? "is packed and goes to the courier next"
          : status === "PENDING"
            ? "is waiting for confirmation"
            : `is ${orderHeadline(status).title.toLowerCase()}`;
    return `Your order ${s.activeOrder.orderNumber} ${where}.${balance}`;
  }
  if (s.orderCount === 0) return "Everything you order, save and earn will live here.";
  if (balance) return balance.trim();
  if (s.wishlistCount > 0) return `You have ${s.wishlistCount} ${s.wishlistCount === 1 ? "item" : "items"} saved for later.`;
  return "Your orders, wallet and saved items, all in one place.";
}

function RecentOrders({ summary }: { summary: AccountSummary }) {
  if (summary.recentOrders.length === 0) return null;
  return (
    <section aria-labelledby="recent-orders-title">
      <SectionHeading id="recent-orders-title" title="Recent orders" action={{ href: "/account/orders", label: "All orders" }} />
      <GroupedList data-testid="recent-orders">
        {summary.recentOrders.map((order) => (
          <ListRow
            key={order.id}
            href={`/account/orders/${order.id}`}
            leading={<OrderThumb imageUrl={order.imageUrl} alt="" className="h-12 w-12 rounded-xl sm:h-14 sm:w-14" />}
            title={order.firstItemName ? (order.lineCount > 1 ? `${order.firstItemName} and ${order.lineCount - 1} more` : order.firstItemName) : order.orderNumber}
            subtitle={`${orderStatusLabel(order.status)}, ${formatStoreDate(order.createdAt, { day: "numeric", month: "short" })}`}
            trailing={<span className="tabular-nums text-fg">{formatPrice(order.total)}</span>}
          />
        ))}
      </GroupedList>
    </section>
  );
}

/** Wishlist preview; falls back to recently viewed products so the page never ends on an empty block. */
function SavedForLater() {
  const { data, isPending, isError } = useQuery({ queryKey: ["wishlist"], queryFn: listWishlist });
  const products = data?.items.map((i) => i.product).slice(0, 4) ?? [];

  if (isPending) return null;
  if (isError || products.length === 0) {
    return <RecentlyViewedCarousel title="Recently viewed" />;
  }

  return (
    <section aria-labelledby="saved-title">
      <SectionHeading id="saved-title" title="Saved for later" action={{ href: "/account/saved", label: "All saved items" }} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

/** Account setup still to do — replaces the old warning banner with a calm checklist that disappears when done. */
function SetupList({ customer }: { customer: Customer }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const needsEmail = Boolean(customer.email) && !customer.emailVerifiedAt;
  const needsPhone = !customer.phoneVerifiedAt;
  if (!needsEmail && !needsPhone) return null;

  async function resend() {
    setSending(true);
    try {
      await resendVerificationEmail();
      setSent(true);
      toast.success("Verification email sent — check your inbox");
    } catch {
      toast.error("Couldn't send the email. Try again in a minute.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="setup-title">
      <SectionHeading id="setup-title" title="Finish setting up" />
      <GroupedList>
        {needsEmail && (
          <ListRow
            onClick={sent || sending ? undefined : resend}
            leading={
              <RowIcon tone="attention">
                <Mail size={17} />
              </RowIcon>
            }
            title="Verify your email"
            subtitle={sent ? `Sent to ${customer.email}. Open the link to finish.` : sending ? "Sending…" : "We'll send a link to confirm it's you."}
            plain={sent}
          />
        )}
        {needsPhone && (
          <ListRow
            href="/account/settings#phone"
            leading={
              <RowIcon>
                <Smartphone size={17} />
              </RowIcon>
            }
            title={customer.phone ? "Verify your phone" : "Add your phone"}
            subtitle="Sign in with a code, no password needed."
          />
        )}
      </GroupedList>
    </section>
  );
}

function DeliveringTo({ summary }: { summary: AccountSummary }) {
  const address = summary.defaultAddress;
  return (
    <section aria-labelledby="address-title">
      <SectionHeading id="address-title" title="Delivering to" action={address ? { href: "/account/addresses", label: "Manage addresses" } : undefined} />
      <GroupedList>
        {address ? (
          <ListRow
            href="/account/addresses"
            title={address.label || address.fullName}
            subtitle={
              <span className="block whitespace-normal leading-relaxed">
                {address.addressLine}, {address.area}, {address.district}
                <br />
                {address.phone}
              </span>
            }
          />
        ) : (
          <ListRow
            href="/account/addresses"
            leading={
              <RowIcon>
                <MapPin size={17} />
              </RowIcon>
            }
            title="Add a delivery address"
            subtitle="Check out faster next time."
          />
        )}
      </GroupedList>
    </section>
  );
}

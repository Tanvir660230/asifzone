import { Banknote, RotateCcw, Truck, type LucideIcon } from "lucide-react";
import type { StorePolicy, StoreSettings } from "@clothing-brand/shared";

/* Copy a landing page builds from the store's own settings and policy — shared by the product's automatic page and the
   campaign pages, so neither promises anything the store hasn't set. */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bn = (value: number | string) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
export const bnRange = ([a, b]: readonly [number, number]) => (a === b ? bn(a) : `${bn(a)}-${bn(b)}`);

export function landingPromises(policy: StorePolicy): { icon: LucideIcon; title: string; text: string }[] {
  const { insideDhaka, outsideDhaka } = policy.deliveryDays;
  return [
    { icon: Truck, title: "সারা দেশে হোম ডেলিভারি", text: `${bnRange([Math.min(insideDhaka[0], outsideDhaka[0]), Math.max(insideDhaka[1], outsideDhaka[1])])} দিনে পৌঁছে যাবে` },
    { icon: Banknote, title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে দাম দিন" },
    ...(policy.returns ? [{ icon: RotateCcw, title: `${bn(policy.returns.days)} দিনের সহজ রিটার্ন`, text: "পছন্দ না হলে বদলে নিন" }] : []),
  ];
}

export function standardLandingFaqs(settings: Pick<StoreSettings, "shippingFeeDhaka" | "shippingFeeOutsideDhaka">, policy: StorePolicy, money: (v: string | number) => string) {
  const { insideDhaka, outsideDhaka } = policy.deliveryDays;
  return [
    { q: "অর্ডার করলে কত দিনে হাতে পাব?", a: `ঢাকার ভেতরে ${bnRange(insideDhaka)} দিনে, ঢাকার বাইরে ${bnRange(outsideDhaka)} দিনে।` },
    {
      q: "ডেলিভারি চার্জ কত?",
      a: `ঢাকার ভেতরে ${money(settings.shippingFeeDhaka)}, ঢাকার বাইরে ${money(settings.shippingFeeOutsideDhaka)}। অর্ডার ফর্মে জেলা দিলেই ডেলিভারিসহ মোট দাম দেখতে পাবেন।`,
    },
    { q: "আগে টাকা দিতে হবে কি?", a: "না। অর্ডার করতে কোনো অগ্রিম টাকা লাগবে না। ডেলিভারিম্যানের কাছ থেকে পণ্য হাতে পেয়ে তারপর মূল্য পরিশোধ করবেন।" },
    ...(policy.returns
      ? [
          {
            q: "পণ্য পছন্দ না হলে বা সাইজ না মিললে?",
            a: `ডেলিভারির ${bn(policy.returns.days)} দিনের মধ্যে রিটার্ন বা সাইজ বদল করতে পারবেন।${policy.returns.conditions ? ` শর্ত: ${policy.returns.conditions}।` : ""}`,
          },
        ]
      : []),
    { q: "অর্ডার করার পর কী হবে?", a: "অর্ডার পাওয়ার পর আমাদের প্রতিনিধি আপনার নম্বরে ফোন করে সাইজ ও ঠিকানা নিশ্চিত করবেন, তারপর পণ্যটি পাঠিয়ে দেওয়া হবে।" },
  ];
}

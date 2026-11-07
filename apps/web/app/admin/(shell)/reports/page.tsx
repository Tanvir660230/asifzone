import { redirect } from "next/navigation";

/** "Reports" is a sidebar group, not a page: a typed /admin/reports opens its first report (Profit). */
export default function Page() {
  redirect("/admin/finance/profit");
}

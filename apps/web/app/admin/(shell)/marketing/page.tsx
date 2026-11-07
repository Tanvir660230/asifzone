import { redirect } from "next/navigation";

/** A typed or bookmarked /admin/marketing had no page (404). It opens the module's first page instead. */
export default function Page() {
  redirect("/admin/marketing/landing-pages");
}

import { redirect } from "next/navigation";

/** Orders › Ready to ship (blueprint P1.5): the All orders list on its "Ready to book" queue (Order Operations) — confirmed, being prepared or packed, not yet booked with the courier. */
export default function ReadyToShipPage() {
  redirect("/admin/orders?queue=readyToBook");
}

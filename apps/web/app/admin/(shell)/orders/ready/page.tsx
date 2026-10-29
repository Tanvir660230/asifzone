import { redirect } from "next/navigation";

/** Orders › Ready to ship (blueprint P1.5): the All orders list on its "Ready to ship" queue — packed, waiting for the courier. */
export default function ReadyToShipPage() {
  redirect("/admin/orders?queue=readyToShip");
}

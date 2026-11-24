/** How long a courier booking claim (Order.courierBookingStartedAt) holds before another booking may try again. Its own
 * module so code the courier service depends on (the order hold) can read it without an import cycle. */
export const COURIER_BOOKING_LEASE_MS = 10 * 60_000;

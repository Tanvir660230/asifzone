import { Prisma } from "@prisma/client";
import type { SubscribeNewsletterInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/** Idempotent: resubscribing with an already-registered email is a silent success, not an error — avoids leaking whether an address is on the list. */
export async function subscribe(input: SubscribeNewsletterInput) {
  try {
    await prisma.newsletterSubscriber.create({ data: { email: input.email.toLowerCase() } });
  } catch (err) {
    const isDuplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!isDuplicate) throw err;
  }
}

import { prisma } from "../config/prisma";

interface CreateNotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** Fire-and-forget — a failed notification write should never block the action that triggered it. */
export function notify(input: CreateNotificationInput): void {
  prisma.notification
    .create({ data: { type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null } })
    .catch((err) => console.error("[notify] failed to record", input.type, err));
}

import type { CreateFeedbackInput } from "@clothing-brand/shared";
import { openWebConversation } from "../inbox/inbox.service";

/** The storefront contact form. Since Inbox R2 a message opens a WEB_FORM conversation (Messages › Inbox); the old
 * Feedback table keeps only the messages from before (backfilled into conversations) and is no longer written. */
export async function createFeedback(input: CreateFeedbackInput) {
  return openWebConversation(input);
}

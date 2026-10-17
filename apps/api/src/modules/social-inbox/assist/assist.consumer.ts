import type { ConsumerResult } from "../../../domain/outbox/consumers";

/** Outbox consumer `conversation-assist`. Filled in by the AI assist service. */
export async function assistInboundMessage(_messageId: string): Promise<ConsumerResult> {
  return "disabled";
}

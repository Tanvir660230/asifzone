import { ZodError } from "zod";
import type { AiChatInput, AiChatResponse, AiResultCard, AiProposalView } from "@clothing-brand/shared";
import { AppError } from "../../lib/app-error";
import type { AdminIdentity } from "../auth/authorization";
import { proposeAction } from "./proposals.service";
import { toolsFor } from "./tools";

/**
 * The assistant's loop (Blueprint V2 §T): the model sees only the tools this admin may use. Read tools run and their
 * (minimised) results go back to the model; an execute tool becomes a proposal and the loop tells the model it is
 * waiting for the admin — it is never run here.
 */

export type ModelBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
export type ModelMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: ModelBlock[] }
  | { role: "user"; content: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> };

/** The model call, abstracted so tests can drive the loop without the network. */
export interface AiModel {
  create(params: { system: string; messages: ModelMessage[]; tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> }): Promise<{
    content: ModelBlock[];
    stop_reason: string | null;
  }>;
}

const MAX_STEPS = 6;

function systemPrompt(storeName: string, today: string) {
  return [
    `You are the Store Console assistant for ${storeName}, an online store in Bangladesh. Today is ${today} (store time).`,
    "Answer from the tools only; never guess numbers. Keep answers short and plain. Amounts are in the store currency.",
    "Changes (cancelling an order, adjusting stock) are only ever PROPOSED: after you call such a tool, say what will happen and that it waits for the admin's confirmation. Never say a change is done.",
    "Phone numbers in tool results are masked on purpose; don't try to reveal them.",
  ].join("\n");
}

function toolError(err: unknown): string {
  if (err instanceof ZodError) return `Invalid input: ${err.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`;
  if (err instanceof AppError) return err.message;
  return "The tool failed";
}

export async function runAssistant(identity: AdminIdentity, input: AiChatInput, model: AiModel, ctx: { storeName: string; today: string }): Promise<AiChatResponse> {
  const tools = toolsFor(identity);
  const spec = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const messages: ModelMessage[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
  const cards: AiResultCard[] = [];
  const proposals: AiProposalView[] = [];
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await model.create({ system: systemPrompt(ctx.storeName, ctx.today), messages, tools: spec });
    const text = res.content.filter((b): b is Extract<ModelBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) reply = text;
    const calls = res.content.filter((b): b is Extract<ModelBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || calls.length === 0) break;

    messages.push({ role: "assistant", content: res.content });
    const results: Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "That tool isn't available to this admin.", is_error: true });
        continue;
      }
      try {
        if (tool.kind === "read") {
          const card = await tool.run(identity, tool.schema.parse(call.input));
          cards.push(card);
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ title: card.title, rows: card.rows }) });
        } else {
          const proposal = await proposeAction(identity, tool.name, call.input);
          proposals.push(proposal);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify({ proposed: true, waitingForConfirmation: true, title: proposal.title, effects: proposal.effects }),
          });
        }
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: toolError(err), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) reply = proposals.length ? "I've prepared this for you to confirm." : cards.length ? "Here's what I found." : "I couldn't answer that.";
  return { reply, cards, proposals };
}

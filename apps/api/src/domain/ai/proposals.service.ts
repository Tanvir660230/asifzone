import type { Prisma } from "@prisma/client";
import { AI_PROPOSAL_TTL_MS, type AiProposalView } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { can, type AdminIdentity } from "../auth/authorization";
import { aiTool, previewHash, type ExecuteTool } from "./tools";

/**
 * AI proposals (Blueprint V2 §T, DR-23: propose + explicit confirm for every write). The assistant can only create one;
 * confirming re-validates everything a human command would — permission, freshness, and that the facts the preview was
 * built on haven't changed — and then runs the same domain command a person uses. Every step is audited (source "ai").
 */

type ProposalRow = Prisma.AiProposalGetPayload<object>;

export function toProposalView(p: ProposalRow, now = new Date()): AiProposalView {
  const expired = p.status === "PENDING" && p.expiresAt <= now;
  return {
    id: p.id,
    tool: p.tool,
    title: p.title,
    effects: p.effects as string[],
    status: expired ? "EXPIRED" : p.status,
    expiresAt: p.expiresAt.toISOString(),
    href: (p.result as { href?: string } | null)?.href ?? (p.input as { href?: string } | null)?.href,
  };
}

function executeToolFor(identity: AdminIdentity, name: string): ExecuteTool {
  const tool = aiTool(name);
  if (!tool || tool.kind !== "execute") throw AppError.badRequest(`Unknown action ${name}`);
  if (!can(identity, tool.permission)) throw AppError.forbidden();
  return tool;
}

/** Called by the chat loop when the model asks for a change: validates, previews and stores it — runs nothing. */
export async function proposeAction(identity: AdminIdentity, toolName: string, rawInput: unknown): Promise<AiProposalView> {
  const tool = executeToolFor(identity, toolName);
  if (!can(identity, "ai.execute")) throw AppError.forbidden();
  const input = tool.schema.parse(rawInput);
  const preview = await tool.preview(identity, input);
  const proposal = await prisma.aiProposal.create({
    data: {
      adminId: identity.adminId,
      tool: tool.name,
      input: { ...input, ...(preview.href ? { href: preview.href } : {}) } as Prisma.InputJsonValue,
      title: preview.title,
      effects: preview.effects,
      previewHash: previewHash(preview.basis),
      expiresAt: new Date(Date.now() + AI_PROPOSAL_TTL_MS),
    },
  });
  recordAudit({ adminId: identity.adminId, action: "ai.propose", entityType: "ai", entityId: proposal.id, metadata: { source: "ai", tool: tool.name, input, title: preview.title } });
  return toProposalView(proposal);
}

async function claim(identity: AdminIdentity, id: string) {
  const p = await prisma.aiProposal.findUnique({ where: { id } });
  // Only the admin who asked can confirm or cancel their assistant's proposal.
  if (!p || p.adminId !== identity.adminId) throw AppError.notFound("Proposal not found");
  return p;
}

/** Confirm (ai.execute): idempotent — a second confirm of an executed proposal returns it unchanged. */
export async function executeProposal(identity: AdminIdentity, id: string): Promise<AiProposalView & { message?: string }> {
  const p = await claim(identity, id);
  if (p.status === "EXECUTED") return { ...toProposalView(p), message: (p.result as { message?: string } | null)?.message };
  if (p.status !== "PENDING") throw AppError.conflict(`This proposal was ${p.status.toLowerCase()}`);
  if (p.expiresAt <= new Date()) throw AppError.conflict("This proposal expired — ask the assistant again");

  const tool = executeToolFor(identity, p.tool);
  if (!can(identity, "ai.execute")) throw AppError.forbidden();
  const { href: _href, ...rawInput } = p.input as Record<string, unknown>;
  const input = tool.schema.parse(rawInput);

  // The world may have moved since the preview (the order shipped, stock changed): refuse rather than act on stale facts.
  let fresh;
  try {
    fresh = await tool.preview(identity, input);
  } catch (err) {
    await prisma.aiProposal.update({ where: { id }, data: { status: "FAILED", decidedAt: new Date(), result: { error: err instanceof Error ? err.message : String(err) } } });
    recordAudit({ adminId: identity.adminId, action: "ai.refuse", entityType: "ai", entityId: id, metadata: { source: "ai", tool: p.tool, reason: "preview failed" } });
    throw err;
  }
  if (previewHash(fresh.basis) !== p.previewHash) {
    recordAudit({ adminId: identity.adminId, action: "ai.refuse", entityType: "ai", entityId: id, metadata: { source: "ai", tool: p.tool, reason: "changed since proposed" } });
    throw new AppError(409, "Things changed since this was proposed — ask the assistant again", { code: "AI_PROPOSAL_STALE" });
  }

  // Claim the proposal before acting, so two confirms can't both run the command.
  const { count } = await prisma.aiProposal.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXECUTED", decidedAt: new Date() } });
  if (count === 0) return { ...toProposalView(await claim(identity, id)) };
  try {
    const result = await tool.execute(identity, input);
    const done = await prisma.aiProposal.update({ where: { id }, data: { result } });
    recordAudit({ adminId: identity.adminId, action: "ai.execute", entityType: "ai", entityId: id, metadata: { source: "ai", proposalId: id, tool: p.tool, input } });
    return { ...toProposalView(done), message: result.message };
  } catch (err) {
    await prisma.aiProposal.update({ where: { id }, data: { status: "FAILED", result: { error: err instanceof Error ? err.message : String(err) } } });
    recordAudit({ adminId: identity.adminId, action: "ai.refuse", entityType: "ai", entityId: id, metadata: { source: "ai", tool: p.tool, reason: "command refused" } });
    throw err;
  }
}

export async function cancelProposal(identity: AdminIdentity, id: string): Promise<AiProposalView> {
  const p = await claim(identity, id);
  if (p.status !== "PENDING") return toProposalView(p);
  const done = await prisma.aiProposal.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  recordAudit({ adminId: identity.adminId, action: "ai.cancel", entityType: "ai", entityId: id, metadata: { source: "ai", tool: p.tool } });
  return toProposalView(done);
}

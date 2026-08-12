import type { CreateSmsTemplateInput, UpdateSmsTemplateInput } from "@clothing-brand/shared";
import { DEFAULT_MARKETING_SMS_TEMPLATES } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

/** Lazily seeds the six starter templates the first time this table is read empty — same "create
 * on first use" spirit as sms-settings' singleton, just for a table instead of one row. Admins are
 * free to edit or delete every one of them afterward; this only ever fires once. */
export async function listSmsTemplates() {
  const count = await prisma.smsTemplate.count();
  if (count === 0) {
    await prisma.smsTemplate.createMany({ data: DEFAULT_MARKETING_SMS_TEMPLATES });
  }
  return prisma.smsTemplate.findMany({ orderBy: { createdAt: "asc" } });
}

export async function createSmsTemplate(input: CreateSmsTemplateInput) {
  return prisma.smsTemplate.create({ data: input });
}

export async function updateSmsTemplate(id: string, input: UpdateSmsTemplateInput) {
  const exists = await prisma.smsTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Template not found");
  return prisma.smsTemplate.update({ where: { id }, data: input });
}

export async function deleteSmsTemplate(id: string) {
  const exists = await prisma.smsTemplate.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw AppError.notFound("Template not found");
  await prisma.smsTemplate.delete({ where: { id } });
}

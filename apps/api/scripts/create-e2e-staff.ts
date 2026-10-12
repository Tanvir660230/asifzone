/**
 * Creates (or resets) the STAFF admin the browser tests sign in as to check staff permissions
 * (apps/web/e2e/product-builder-matrix.spec.ts). CI runs it after seeding; locally, point it at a
 * database you don't mind a test account in, and delete the account afterwards.
 *   E2E_STAFF_EMAIL=... E2E_STAFF_PASSWORD=... tsx scripts/create-e2e-staff.ts
 * With QA_APPROVER_EMAIL / QA_APPROVER_PASSWORD also set, it creates the second OWNER the finance browser QA signs in as to
 * approve what the first owner proposed (apps/web/e2e/admin-finance-treasury.spec.ts).
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const email = process.env.E2E_STAFF_EMAIL;
const password = process.env.E2E_STAFF_PASSWORD;

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to create a test staff account with NODE_ENV=production.");
  process.exit(1);
}
if (!email || !password) {
  console.error("Set E2E_STAFF_EMAIL and E2E_STAFF_PASSWORD.");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password!, 12);
  await prisma.adminUser.upsert({
    where: { email: email! },
    create: { name: "E2E Staff", email: email!, passwordHash, role: "STAFF" },
    update: { passwordHash, role: "STAFF" },
  });
  console.log(`Staff test account ready: ${email}`);

  const approverEmail = process.env.QA_APPROVER_EMAIL;
  const approverPassword = process.env.QA_APPROVER_PASSWORD;
  if (approverEmail && approverPassword) {
    const approverHash = await bcrypt.hash(approverPassword, 12);
    await prisma.adminUser.upsert({
      where: { email: approverEmail },
      create: { name: "E2E Approver", email: approverEmail, passwordHash: approverHash, role: "OWNER" },
      update: { passwordHash: approverHash, role: "OWNER" },
    });
    console.log(`Second owner (approver) test account ready: ${approverEmail}`);
  }
}

main().finally(() => prisma.$disconnect());

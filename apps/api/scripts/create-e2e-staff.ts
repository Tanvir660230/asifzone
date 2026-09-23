/**
 * Creates (or resets) the STAFF admin the browser tests sign in as to check staff permissions
 * (apps/web/e2e/product-builder-matrix.spec.ts). CI runs it after seeding; locally, point it at a
 * database you don't mind a test account in, and delete the account afterwards.
 *   E2E_STAFF_EMAIL=... E2E_STAFF_PASSWORD=... tsx scripts/create-e2e-staff.ts
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
}

main().finally(() => prisma.$disconnect());

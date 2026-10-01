import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Claim links are emailed: capture outgoing mail so a test can follow the link (the only way to learn the token).
const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string }>);
vi.mock("../../lib/mailer", () => ({ sendMail: async (m: { to: string; subject: string; html: string }) => void sent.push(m) }));

import bcrypt from "bcryptjs";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { hashToken } from "../../lib/token-hash";
import { signCustomerAccessToken } from "../../lib/customer-jwt";
import { CUSTOMER_ACCESS_COOKIE } from "../../lib/cookies";
import { cleanupFixtures, createStockedProduct, checkout, trackOrder, RUN } from "../../test-fixtures";
import { createOrder } from "../../modules/orders/order.service";
import {
  confirmEmailClaim,
  confirmPhoneVerification,
  findOrCreateGuestCustomer,
  registerCustomer,
  requestPasswordReset,
  signInWithGoogleIdentity,
  updateCustomerProfile,
  verifyOtp,
  loginCustomer,
} from "../../modules/customers/customer.service";
import { signInAdminWithGoogleIdentity } from "../../modules/auth/auth.service";

// Phase 11 (docs/PHASE_11_IMPLEMENTATION_CONTRACT.md §0, §5.1, §9): unverified contact data never grants access.

const CODE = "246810";
const made = { customers: new Set<string>(), phones: new Set<string>(), admins: [] as string[] };
const phone = () => {
  const p = `019${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  made.phones.add(p);
  return p;
};
const mail = () => `p11-${RUN}-${Math.random().toString(36).slice(2, 9)}@example.com`;
const track = <T extends { id: string }>(c: T) => (made.customers.add(c.id), c);

/** A known OTP for `phone` (as if the SMS arrived). */
async function seedOtp(p: string, code = CODE) {
  await prisma.phoneOtp.create({ data: { phone: p, codeHash: hashToken(code), expiresAt: new Date(Date.now() + 5 * 60_000) } });
}
async function otpLogin(p: string, profile?: { name: string; email: string }) {
  await seedOtp(p);
  const res = await verifyOtp({ phone: p, code: CODE, ...(profile ?? {}) });
  made.customers.add(res.customer.id);
  return res;
}
async function placeholderWithOrder(p: string, email: string | null) {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const order = await createOrder(checkout([{ variantId: variants[0]!.id, quantity: 1 }], { customerPhone: p, customerEmail: email ?? undefined }));
  trackOrder(order.id);
  made.customers.add(order.customerId!);
  return order;
}
function lastClaimToken(to: string) {
  const m = [...sent].reverse().find((x) => x.to === to && x.subject === "Confirm your account");
  return m ? decodeURIComponent(m.html.match(/claim\?token=([a-f0-9]+)/)![1]!) : null;
}
const meOrders = (customerId: string) =>
  request(app).get("/api/customers/me/orders").set("Cookie", [`${CUSTOMER_ACCESS_COOKIE}=${signCustomerAccessToken({ customerId })}`]);

beforeAll(() => {
  sent.length = 0;
});

afterAll(async () => {
  await cleanupFixtures();
  const ids = [...made.customers];
  await prisma.auditLog.deleteMany({ where: { entityType: "customers", entityId: { in: ids } } });
  await prisma.phoneOtp.deleteMany({ where: { phone: { in: [...made.phones] } } });
  for (const id of ids) await prisma.customer.deleteMany({ where: { id, orders: { none: {} } } });
  if (made.admins.length) await prisma.adminUser.deleteMany({ where: { id: { in: made.admins } } });
  await prisma.$disconnect();
});

describe("phone identity (BD-11.1)", () => {
  it("an attacker who puts the victim's phone on their profile never receives the victim's OTP sign-in", async () => {
    const victimPhone = phone();
    const attacker = await registerCustomer({ name: "Attacker", email: mail(), password: "Attacker123!", phone: null });
    if (attacker.claimPending) throw new Error("unexpected");
    track(attacker.customer);
    await updateCustomerProfile(attacker.customer.id, { phone: victimPhone });

    const victim = await otpLogin(victimPhone, { name: "Victim", email: mail() });
    expect(victim.customer.id).not.toBe(attacker.customer.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: attacker.customer.id } })).phoneVerifiedAt).toBeNull();

    // And a victim's later guest order doesn't land in the attacker's account either.
    const order = await placeholderWithOrder(victimPhone, null);
    expect(order.customerId).toBe(victim.customer.id); // verified owner
    const attackerOrders = (await meOrders(attacker.customer.id)).body.items.map((o: { id: string }) => o.id);
    expect(attackerOrders).not.toContain(order.id);
  });

  it("an unverified phone can't sign in; once verified it can; duplicates are fine only while unverified", async () => {
    const p = phone();
    const a = await registerCustomer({ name: "A", email: mail(), password: "Password123!", phone: p });
    const b = await registerCustomer({ name: "B", email: mail(), password: "Password123!", phone: p });
    if (a.claimPending || b.claimPending) throw new Error("unexpected");
    track(a.customer);
    track(b.customer);

    await seedOtp(p);
    await expect(verifyOtp({ phone: p, code: CODE })).rejects.toMatchObject({ statusCode: 422 }); // never signs in A or B

    await seedOtp(p);
    const verifiedA = await confirmPhoneVerification(a.customer.id, p, CODE);
    expect(verifiedA.phoneVerifiedAt).not.toBeNull();
    expect((await otpLogin(p)).customer.id).toBe(a.customer.id);

    // B can't verify the same phone: the partial unique index refuses a second verified owner.
    await seedOtp(p);
    await expect(confirmPhoneVerification(b.customer.id, p, CODE)).rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.customer.update({ where: { id: b.customer.id }, data: { phoneVerifiedAt: new Date() } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("a verified login phone changes only through OTP; the old one keeps working until then", async () => {
    const oldPhone = phone();
    const newPhone = phone();
    const me = await otpLogin(oldPhone, { name: "Changer", email: mail() });
    await expect(updateCustomerProfile(me.customer.id, { phone: newPhone })).rejects.toMatchObject({ statusCode: 409 });
    expect((await otpLogin(oldPhone)).customer.id).toBe(me.customer.id);

    await seedOtp(newPhone);
    await confirmPhoneVerification(me.customer.id, newPhone, CODE);
    expect((await otpLogin(newPhone)).customer.id).toBe(me.customer.id);
    await seedOtp(oldPhone);
    await expect(verifyOtp({ phone: oldPhone, code: CODE })).rejects.toMatchObject({ statusCode: 422 }); // old phone no longer a login
  });

  it("OTP sign-up verifies the phone but not the email (F-26)", async () => {
    const res = await otpLogin(phone(), { name: "New", email: mail() });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: res.customer.id } });
    expect(row.phoneVerifiedAt).not.toBeNull();
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("a wrong guess that raced past stale pre-checks still can't push a code past its cap (atomic attempts)", async () => {
    const p = phone();
    await seedOtp(p);
    const otp = await prisma.phoneOtp.findFirstOrThrow({ where: { phone: p } });
    await prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: 5 } }); // the cap is already spent…
    // …but this request read the OTP and the phone budget before the other guesses landed (the race window).
    const findSpy = vi.spyOn(prisma.phoneOtp, "findFirst").mockResolvedValueOnce({ ...otp, attempts: 0 });
    const aggSpy = vi.spyOn(prisma.phoneOtp, "aggregate").mockResolvedValueOnce({ _sum: { attempts: 0 } } as never);
    try {
      await expect(verifyOtp({ phone: p, code: "000000" })).rejects.toMatchObject({ statusCode: 400, message: "Too many incorrect attempts — request a new code" });
    } finally {
      findSpy.mockRestore();
      aggSpy.mockRestore();
    }
    expect((await prisma.phoneOtp.findUniqueOrThrow({ where: { id: otp.id } })).attempts).toBe(5); // never past the cap
  });

  it("concurrent wrong OTP guesses can't exceed the per-code cap (atomic attempts)", async () => {
    const p = phone();
    await seedOtp(p);
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => verifyOtp({ phone: p, code: "000000" })));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    const otp = await prisma.phoneOtp.findFirstOrThrow({ where: { phone: p }, orderBy: { createdAt: "desc" } });
    expect(otp.attempts).toBeLessThanOrEqual(5);
    // …and the right code is refused once the budget is spent.
    await expect(verifyOtp({ phone: p, code: CODE })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("claiming an existing passwordless record (BD-11.6 a)", () => {
  it("registration never takes over: an email match emails a claim link, and only the link attaches the password", async () => {
    const email = mail();
    const order = await placeholderWithOrder(phone(), email);
    const placeholderId = order.customerId!;

    const result = await registerCustomer({ name: "Claimer", email, password: "Claimer123!", phone: null });
    expect(result.claimPending).toBe(true);
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: placeholderId } });
    expect(before.passwordHash).toBeNull(); // nothing attached yet
    expect(before.emailVerifiedAt).toBeNull();

    const token = lastClaimToken(email);
    expect(token).toBeTruthy();
    const claimed = await confirmEmailClaim(token!);
    expect(claimed.customer.id).toBe(placeholderId);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: placeholderId } });
    expect(after.passwordHash).not.toBeNull();
    expect(after.emailVerifiedAt).not.toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(placeholderId); // history stays
    expect((await meOrders(placeholderId)).body.items.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(await prisma.auditLog.count({ where: { action: "customers.claim", entityId: placeholderId } })).toBe(1);
    await expect(confirmEmailClaim(token!)).rejects.toMatchObject({ statusCode: 400 }); // single use
  });

  it("a phone match is claimed only with an OTP to that phone — registration with the phone creates a separate account", async () => {
    const p = phone();
    const order = await placeholderWithOrder(p, null);
    const placeholderId = order.customerId!;

    const reg = await registerCustomer({ name: "Reg", email: mail(), password: "Password123!", phone: p });
    if (reg.claimPending) throw new Error("unexpected");
    track(reg.customer);
    expect(reg.customer.id).not.toBe(placeholderId);
    expect((await meOrders(reg.customer.id)).body.items.map((o: { id: string }) => o.id)).not.toContain(order.id);

    const otp = await otpLogin(p, { name: "Owner", email: mail() });
    expect(otp.customer.id).toBe(placeholderId); // proof of the phone claims the placeholder
    expect((await meOrders(placeholderId)).body.items.map((o: { id: string }) => o.id)).toContain(order.id);
  });

  it("an OTP for a different phone can't claim a record matched only by email", async () => {
    const email = mail();
    const order = await placeholderWithOrder(phone(), email);
    const otherPhone = phone();
    await seedOtp(otherPhone);
    await expect(verifyOtp({ phone: otherPhone, code: CODE, name: "Imposter", email })).rejects.toMatchObject({ statusCode: 409 });
    const placeholder = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId! } });
    expect(placeholder.phoneVerifiedAt).toBeNull();
    expect(placeholder.phone).not.toBe(otherPhone);
  });

  it("concurrent claims: two links for one record, or one link twice — exactly one wins", async () => {
    const email = mail();
    const order = await placeholderWithOrder(phone(), email);
    await registerCustomer({ name: "One", email, password: "Password123!", phone: null });
    const first = lastClaimToken(email)!;
    await registerCustomer({ name: "Two", email, password: "Password456!", phone: null });
    const second = lastClaimToken(email)!;
    expect(first).not.toBe(second);
    const results = await Promise.allSettled([confirmEmailClaim(first), confirmEmailClaim(second), confirmEmailClaim(first)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(order.customerId);
  });

  it("an OTP account (verified phone, no password) can't be taken over by registering its email, nor reset through that unproven email", async () => {
    const email = mail();
    const owner = await otpLogin(phone(), { name: "Phone owner", email });
    await expect(registerCustomer({ name: "Taker", email, password: "Password123!", phone: null })).rejects.toMatchObject({ statusCode: 409 });
    const tokensBefore = await prisma.passwordResetToken.count({ where: { customerId: owner.customer.id } });
    await requestPasswordReset(email);
    expect(await prisma.passwordResetToken.count({ where: { customerId: owner.customer.id } })).toBe(tokensBefore);
  });
});

describe("guest checkout attachment (BD-11.7 a)", () => {
  it("attaches through a verified phone or a verified email only", async () => {
    const p = phone();
    const owner = await otpLogin(p, { name: "Verified phone", email: mail() });
    expect(await findOrCreateGuestCustomer("Guest", null, p)).toBe(owner.customer.id);

    const email = mail();
    const reg = await registerCustomer({ name: "Verified email", email, password: "Password123!", phone: null });
    if (reg.claimPending) throw new Error("unexpected");
    track(reg.customer);
    await prisma.customer.update({ where: { id: reg.customer.id }, data: { emailVerifiedAt: new Date() } });
    expect(await findOrCreateGuestCustomer("Guest", email, phone())).toBe(reg.customer.id);
  });

  it("never attaches through an unverified phone or email — a separate guest placeholder is used", async () => {
    const p = phone();
    const email = mail();
    const account = await registerCustomer({ name: "Unverified", email, password: "Password123!", phone: p });
    if (account.claimPending) throw new Error("unexpected");
    track(account.customer);
    const byPhone = await findOrCreateGuestCustomer("Guest", null, p);
    const byEmail = await findOrCreateGuestCustomer("Guest", email, phone());
    made.customers.add(byPhone);
    made.customers.add(byEmail);
    expect(byPhone).not.toBe(account.customer.id);
    expect(byEmail).not.toBe(account.customer.id);
    const placeholder = await prisma.customer.findUniqueOrThrow({ where: { id: byEmail } });
    expect(placeholder.email).toBeNull(); // the email belongs to someone else: not used as a key
    expect(placeholder.passwordHash).toBeNull();
    // A repeat guest with the same phone reuses their placeholder.
    expect(await findOrCreateGuestCustomer("Guest", null, p)).toBe(byPhone);
  });
});

describe("Google sign-in requires email_verified (F-27)", () => {
  it("customer: verified creates/claims/links; unverified is refused and links nothing", async () => {
    const fresh = mail();
    const created = await signInWithGoogleIdentity({ sub: `g-${RUN}-1`, email: fresh, emailVerified: true, name: "G" });
    track(created.customer);
    expect(created.customer.email).toBe(fresh);

    await expect(signInWithGoogleIdentity({ sub: `g-${RUN}-2`, email: mail(), emailVerified: false })).rejects.toMatchObject({ statusCode: 401 });
    await expect(signInWithGoogleIdentity({ sub: `g-${RUN}-3`, email: mail() })).rejects.toMatchObject({ statusCode: 401 });

    // A password account whose email nobody proved is not linked by Google.
    const email = mail();
    const pw = await registerCustomer({ name: "Pw", email, password: "Password123!", phone: null });
    if (pw.claimPending) throw new Error("unexpected");
    track(pw.customer);
    await expect(signInWithGoogleIdentity({ sub: `g-${RUN}-4`, email, emailVerified: true })).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: pw.customer.id } })).googleId).toBeNull();

    // An unclaimed placeholder is claimed by a verified Google email (proof) — audited.
    const phEmail = mail();
    const order = await placeholderWithOrder(phone(), phEmail);
    const claimed = await signInWithGoogleIdentity({ sub: `g-${RUN}-5`, email: phEmail, emailVerified: true });
    expect(claimed.customer.id).toBe(order.customerId);
    expect(await prisma.auditLog.count({ where: { action: "customers.claim", entityId: order.customerId! } })).toBe(1);
  });

  it("admin: verified Google email signs in an invited admin; unverified is refused and links nothing", async () => {
    const email = mail();
    const admin = await prisma.adminUser.create({ data: { name: "P11 admin", email, passwordHash: await bcrypt.hash("x", 4), role: "STAFF" } });
    made.admins.push(admin.id);
    await expect(signInAdminWithGoogleIdentity({ sub: `ga-${RUN}-1`, email, emailVerified: false })).rejects.toMatchObject({ statusCode: 401 });
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).googleId).toBeNull();
    const ok = await signInAdminWithGoogleIdentity({ sub: `ga-${RUN}-1`, email, emailVerified: true });
    expect(ok.admin.id).toBe(admin.id);
    await prisma.refreshToken.deleteMany({ where: { adminId: admin.id } });
  });
});

describe("unchanged meanings", () => {
  it("isBlocked stays a CRM flag: a blocked customer still signs in", async () => {
    const email = mail();
    const reg = await registerCustomer({ name: "Blocked", email, password: "Password123!", phone: null });
    if (reg.claimPending) throw new Error("unexpected");
    track(reg.customer);
    await prisma.customer.update({ where: { id: reg.customer.id }, data: { isBlocked: true } });
    expect((await loginCustomer({ email, password: "Password123!" })).customer.id).toBe(reg.customer.id);
  });
});

import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, RUN } from "../../test-fixtures";
import { getProviders } from "../../providers/registry";
import { MailProviderError } from "../../providers/errors";

// Inviting an admin must not fail with a 500 when the invite email can't be sent (e.g. the mail provider is still in its
// testing mode and only delivers to the account owner): the invite is created and its link is handed to the inviter.

const emails: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.adminInvite.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

describe("admin invite email", () => {
  it("creates the invite and returns its link when the email is rejected by the provider", async () => {
    vi.spyOn(getProviders().email, "send").mockRejectedValue(new MailProviderError("[mailer] Resend send failed: You can only send testing emails to your own email address", false));
    const email = `vt-invite-fail-${RUN}@example.com`;
    emails.push(email);

    const res = await (await asOwner()).post("/api/auth/admin-invites", { email, name: "Invite Fail", role: "STAFF" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.acceptUrl).toMatch(/\/admin\/accept-invite\?token=[0-9a-f]{64}$/);
    expect(await prisma.adminInvite.count({ where: { email, acceptedAt: null } })).toBe(1);
  });

  it("says the email went out, and still returns the link, when sending works", async () => {
    vi.spyOn(getProviders().email, "send").mockResolvedValue(undefined);
    const email = `vt-invite-ok-${RUN}@example.com`;
    emails.push(email);

    const res = await (await asOwner()).post("/api/auth/admin-invites", { email, name: "Invite Ok", role: "STAFF" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.acceptUrl).toMatch(/\/admin\/accept-invite\?token=/);
  });

  it("still fails loudly for an unexpected error (not a mail provider rejection)", async () => {
    vi.spyOn(getProviders().email, "send").mockRejectedValue(new Error("boom"));
    const email = `vt-invite-boom-${RUN}@example.com`;
    emails.push(email);

    const res = await (await asOwner()).post("/api/auth/admin-invites", { email, name: "Invite Boom", role: "STAFF" });
    expect(res.status).toBe(500);
  });
});

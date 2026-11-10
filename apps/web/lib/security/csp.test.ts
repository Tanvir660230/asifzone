import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? [];

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy({ nonce: "abc", apiOrigin: "https://tahafi.com", isDev: false });

  it("lets the Meta pixel reach its Conversions API Gateway and the AWS fallback", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://capig.datah04.com");
    expect(connect).toContain("https://c3-8e86efd19c8c4086ae8a47d63bd9492e.ecs.us-east-1.on.aws");
  });

  it("lets Asif Zone's pixel reach its own gateway pair (blocked on live 2026-11-10)", () => {
    const connect = directive(csp, "connect-src");
    expect(connect).toContain("https://demo-1.conversionsapigateway.com");
    expect(connect).toContain("https://xd-f1cf3d4fdb19408ea770fc6f80817dcb.ecs.us-east-1.on.aws");
  });

  it("lets the pixel post large events to /tr, and no other outside form target", () => {
    expect(directive(csp, "form-action")).toEqual(["'self'", "https://www.facebook.com/tr/"]);
  });

  it("does not open connect-src to every AWS-hosted app", () => {
    expect(directive(csp, "connect-src").some((h) => h.includes("*.on.aws") || h.includes("*.datah04.com"))).toBe(false);
  });

  it("keeps scripts nonce-only in production", () => {
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
  });
});

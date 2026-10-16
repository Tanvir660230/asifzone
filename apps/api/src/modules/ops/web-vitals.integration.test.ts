import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { rateVital } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner } from "../../test-fixtures";
import { purgeOldSiteHealthData } from "./web-vitals.service";

// Samples here use pageKind "search" + device "desktop" and are wiped first, so p75 assertions only see this file's rows.
const KIND = "search";
const DEVICE = "desktop";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36";

async function wipe() {
  await prisma.webVitalSample.deleteMany({ where: { pageKind: KIND, device: DEVICE } });
}

beforeAll(wipe);
afterAll(wipe);

const post = (body: object, ua = UA) => request(app).post("/api/v1/vitals").set("User-Agent", ua).send(body);

describe("rateVital", () => {
  it("uses Google's good / poor boundaries", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 4001)).toBe("poor");
    expect(rateVital("CLS", 0.15)).toBe("needs-improvement");
    expect(rateVital("INP", 200)).toBe("good");
  });
});

describe("POST /api/v1/vitals", () => {
  it("stores a batch of samples", async () => {
    const res = await post({
      samples: [
        { metric: "LCP", value: 1000, pageKind: KIND, device: DEVICE },
        { metric: "LCP", value: 2000, pageKind: KIND, device: DEVICE },
        { metric: "LCP", value: 3000, pageKind: KIND, device: DEVICE },
        { metric: "LCP", value: 4000, pageKind: KIND, device: DEVICE },
        { metric: "CLS", value: 0.02, pageKind: KIND, device: DEVICE },
      ],
    });
    expect(res.status).toBe(204);
    expect(await prisma.webVitalSample.count({ where: { pageKind: KIND, device: DEVICE } })).toBe(5);
  });

  it("refuses junk", async () => {
    const one = { metric: "LCP", value: 1000, pageKind: KIND, device: DEVICE };
    expect((await post({ samples: Array(11).fill(one) })).status).toBe(400);
    expect((await post({ samples: [] })).status).toBe(400);
    expect((await post({ samples: [{ ...one, value: -1 }] })).status).toBe(400);
    expect((await post({ samples: [{ ...one, value: 60_001 }] })).status).toBe(400);
    expect((await post({ samples: [{ ...one, metric: "CLS", value: 50 }] })).status).toBe(400);
    expect((await post({ samples: [{ ...one, pageKind: "admin" }] })).status).toBe(400);
    expect((await post({ samples: [{ ...one, metric: "FID" }] })).status).toBe(400);
  });

  it("ignores bots and lab tools without telling them", async () => {
    const before = await prisma.webVitalSample.count({ where: { pageKind: KIND, device: DEVICE } });
    for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "Mozilla/5.0 HeadlessChrome/128", "Chrome-Lighthouse"]) {
      expect((await post({ samples: [{ metric: "LCP", value: 9000, pageKind: KIND, device: DEVICE }] }, ua)).status).toBe(204);
    }
    expect(await prisma.webVitalSample.count({ where: { pageKind: KIND, device: DEVICE } })).toBe(before);
  });
});

describe("GET /api/v1/ops/vitals", () => {
  it("summarises the 75th percentile per metric, page kind and device", async () => {
    const res = await (await asOwner()).get("/api/v1/ops/vitals?days=7");
    expect(res.status).toBe(200);
    const lcp = res.body.rows.find((r: { metric: string; pageKind: string; device: string }) => r.metric === "LCP" && r.pageKind === KIND && r.device === DEVICE);
    expect(lcp).toEqual({ metric: "LCP", pageKind: KIND, device: DEVICE, p75: 3250, samples: 4, rating: "needs-improvement" });
  });

  it("needs ops.read and a sane window", async () => {
    expect((await request(app).get("/api/v1/ops/vitals")).status).toBe(401);
    expect((await (await asOwner()).get("/api/v1/ops/vitals?days=0")).status).toBe(400);
    expect((await (await asOwner()).get("/api/v1/ops/vitals?days=31")).status).toBe(400);
  });
});

describe("site health retention", () => {
  it("deletes samples older than 30 days and errors untouched for 90 days", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = await prisma.webVitalSample.create({ data: { metric: "LCP", value: 1, pageKind: KIND, device: DEVICE, createdAt: new Date(Date.now() - 31 * day) } });
    const recent = await prisma.webVitalSample.create({ data: { metric: "LCP", value: 1, pageKind: KIND, device: DEVICE, createdAt: new Date(Date.now() - 29 * day) } });
    const stale = await prisma.errorGroup.create({ data: { fingerprint: `retention-stale-${Date.now()}`, source: "api", errorClass: "unexpected", title: "stale", lastSeenAt: new Date(Date.now() - 91 * day) } });
    const live = await prisma.errorGroup.create({ data: { fingerprint: `retention-live-${Date.now()}`, source: "api", errorClass: "unexpected", title: "live", lastSeenAt: new Date(Date.now() - 89 * day) } });

    await purgeOldSiteHealthData();

    expect(await prisma.webVitalSample.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.webVitalSample.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await prisma.errorGroup.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await prisma.errorGroup.findUnique({ where: { id: live.id } })).not.toBeNull();
    await prisma.errorGroup.delete({ where: { id: live.id } });
  });
});

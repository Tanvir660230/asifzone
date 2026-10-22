import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { env } from "../../config/env";
import { getProviders } from "../../providers/registry";

// POST /api/analytics/meta-event: the browser Pixel's server copy. The Meta sink is replaced so nothing leaves the
// machine; what it would have been handed is the behaviour under test.

const sink = getProviders().serverEvents;
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(sink, "enabled").mockReturnValue(true);
  send = vi.spyOn(sink, "send").mockResolvedValue({ eventsReceived: 1 });
});

const body = {
  eventName: "AddToCart",
  eventId: "ev_abc",
  eventSourceUrl: `${env.webOrigin}/products/panjabi`,
  customData: { currency: "BDT", value: 1500, content_type: "product", content_ids: ["v1"] },
  customer: { phone: "01712345678" },
};

describe("POST /api/analytics/meta-event", () => {
  it("forwards the event under the browser's event_id, with the Pixel cookies exactly as written", async () => {
    const fbc = "fb.1.1760000000000.IwZXh0bgNhZW0BMABhZGlkAasT_aem_AbCdEf-123";
    const res = await request(app)
      .post("/api/analytics/meta-event")
      .set("Cookie", [`_fbp=fb.1.1760000000000.42`, `_fbc=${fbc}`])
      .set("User-Agent", "Vitest")
      .send(body);

    expect(res.status).toBe(204);
    expect(send).toHaveBeenCalledTimes(1);
    const event = send.mock.calls[0]![0] as { event_name: string; event_id: string; user_data: Record<string, unknown> };
    expect(event.event_name).toBe("AddToCart");
    expect(event.event_id).toBe("ev_abc");
    expect(event.user_data.fbc).toBe(fbc);
    expect(event.user_data.fbp).toBe("fb.1.1760000000000.42");
    expect(event.user_data.client_user_agent).toBe("Vitest");
    expect(event.user_data.ph).toHaveLength(1);
  });

  it("refuses Purchase and other stores' pages, and sends nothing when Meta isn't configured", async () => {
    expect((await request(app).post("/api/analytics/meta-event").send({ ...body, eventName: "Purchase" })).status).toBe(400);

    await request(app).post("/api/analytics/meta-event").send({ ...body, eventSourceUrl: "https://evil.example/x" }).expect(204);
    expect(send).not.toHaveBeenCalled();

    vi.spyOn(sink, "enabled").mockReturnValue(false);
    await request(app).post("/api/analytics/meta-event").send(body).expect(204);
    expect(send).not.toHaveBeenCalled();
  });
});

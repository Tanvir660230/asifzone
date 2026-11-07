import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const minuteOf = (pattern: string) => Number(pattern.split(" ")[0]);

describe("daily job schedules", () => {
  it("never start on a minute the 1/5/15-minute jobs use, nor on the same minute as each other", () => {
    const minutes = Object.values(DAILY_SCHEDULES).map((s) => minuteOf(s.pattern));
    for (const m of minutes) {
      expect(Number.isInteger(m)).toBe(true);
      expect(m % 5).not.toBe(0);
    }
    expect(new Set(minutes).size).toBe(minutes.length);
  });

  it("runs store-time schedules in the store's timezone and keeps UTC ones as they were", () => {
    expect(repeatFor(DAILY_SCHEDULES.dailyBrief, "Asia/Dhaka")).toEqual({ pattern: "7 9 * * *", tz: "Asia/Dhaka" });
    expect(repeatFor(DAILY_SCHEDULES.financeAutopilot, "Asia/Dhaka")).toEqual({ pattern: "11 6,18 * * *" });
  });

  it("is where every daily cron takes its time from (no inline daily pattern left in jobs/)", () => {
    const dir = __dirname;
    const inline = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "daily-schedules.ts")
      .filter((f) => /pattern: "\d+ [\d,]+ \* \* \*"/.test(readFileSync(join(dir, f), "utf8")));
    expect(inline).toEqual([]);
  });
});

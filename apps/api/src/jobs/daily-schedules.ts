/**
 * When the once-a-day jobs run, kept in one place so they don't all start together.
 *
 * Every-minute, every-5-minute and every-15-minute jobs (flash sales, finance commerce sync, payment reconciliation,
 * courier status, the storefront read-model rebuild) all fire on minutes that are a multiple of 5. Daily jobs that ran on
 * :00 or :30 too (the morning brief at 09:00, outbox cleanup at 03:00 UTC = 09:00 Dhaka, the courier check at 08:30) piled
 * on top of them, exhausted the database connection pool, and the brief failed on most mornings (live error log,
 * 2026-10-18 → 11-04). So each daily job gets its own minute, never a multiple of 5 (guard test: daily-schedules.test.ts).
 *
 * `tz: "store"` runs in the store's timezone (storeContext); `tz: "utc"` keeps the container clock the job always used.
 */
export interface DailySchedule {
  /** Cron pattern: minute hour * * * */
  pattern: string;
  tz: "store" | "utc";
}

export const DAILY_SCHEDULES = {
  /** 08:23 store time — the courier check, before the brief so the brief's queues are fresh. */
  courierAutomation: { pattern: "23 8 * * *", tz: "store" },
  /** 09:07 store time — yesterday's brief in the bell. */
  dailyBrief: { pattern: "7 9 * * *", tz: "store" },
  /** 03:41 store time — processed outbox rows and expired customer sessions (was 03:00 UTC = 09:00 Dhaka). */
  outboxCleanup: { pattern: "41 3 * * *", tz: "store" },
  /** 03:52 store time — the books' reconciliation checks, at night as its comment always said (was 03:30 UTC = 09:30 Dhaka). */
  financeReconciliation: { pattern: "52 3 * * *", tz: "store" },
  /** 06:11 and 18:11 UTC — unchanged hours, off the :00 tick. */
  financeAutopilot: { pattern: "11 6,18 * * *", tz: "utc" },
  /** 04:28 and 04:46 store time — night-time purges (were 22:30 / 22:45 UTC). */
  storageTrashPurge: { pattern: "28 4 * * *", tz: "store" },
  siteHealthRetention: { pattern: "46 4 * * *", tz: "store" },
} as const satisfies Record<string, DailySchedule>;

/** Retry for a daily job whose run is safe to repeat: a busy minute shouldn't cost the whole day's run. */
export const DAILY_RETRY = { attempts: 3, backoff: { type: "exponential" as const, delay: 2 * 60_000 } };

/** The `upsertJobScheduler` repeat options for a daily schedule. */
export function repeatFor(schedule: DailySchedule, storeTimezone: string): { pattern: string; tz?: string } {
  return schedule.tz === "store" ? { pattern: schedule.pattern, tz: storeTimezone } : { pattern: schedule.pattern };
}

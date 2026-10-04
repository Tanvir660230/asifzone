import { PrismaClient, type OrderItem } from "@prisma/client";
import { env } from "./env";

export const prisma = new PrismaClient({
  log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
  // Recorded cost is internal (docs/PHASE_6_AUDIT.md G6): customer paths read order lines with `include: { items: true }`,
  // so the column is omitted from every read by default. Only the metrics fact loader selects it explicitly.
  omit: { orderItem: { unitCostSnapshot: true } },
});

/** The app's client and its interactive-transaction client (typed with the global `omit` above). */
export type AppPrismaClient = typeof prisma;
export type AppTransactionClient = Parameters<Parameters<AppPrismaClient["$transaction"]>[0]>[0];
/** Either — for helpers that run inside or outside a transaction. */
export type Db = AppPrismaClient | AppTransactionClient;
/** An order line as the app reads it by default (recorded cost omitted). */
export type OrderItemRow = Omit<OrderItem, "unitCostSnapshot">;

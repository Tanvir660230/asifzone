import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import { awsCredentialsProvider } from "@vercel/functions/oidc";
import { env } from "./env";

const port = Number(process.env.PGPORT ?? 5432);

/** Aurora PostgreSQL on Vercel authenticates with a short-lived AWS IAM auth token (generated via
 * OIDC federation), not a static password. The `pg` Pool asks the signer for a fresh token on each
 * new connection; tokens are valid for 15 minutes, which pg caches implicitly per connection.
 * If a plain DATABASE_URL is provided instead (e.g. a local Postgres), fall back to that. */
function createPool(): Pool {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }

  const signer = new Signer({
    credentials: awsCredentialsProvider({
      roleArn: process.env.AWS_ROLE_ARN,
      clientConfig: { region: process.env.AWS_REGION },
    }),
    region: process.env.AWS_REGION,
    hostname: process.env.PGHOST,
    username: process.env.PGUSER || "postgres",
    port,
  });

  return new Pool({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE || "postgres",
    port,
    user: process.env.PGUSER || "postgres",
    password: () => signer.getAuthToken(),
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

const pool = createPool();
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
});

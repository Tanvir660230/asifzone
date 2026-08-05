FROM node:20-alpine AS base
# Alpine doesn't ship the `openssl` CLI by default — Prisma shells out to it (both at `generate`
# time and at runtime) to detect the actual OpenSSL version. Without it, detection fails and
# Prisma silently falls back to a guessed (and here, wrong) engine binary.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --filter api...

FROM deps AS build
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @clothing-brand/shared build
RUN pnpm --filter api prisma:generate
RUN pnpm --filter api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/packages ./packages
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]

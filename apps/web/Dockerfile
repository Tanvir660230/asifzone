FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
RUN pnpm install --frozen-lockfile --filter web...

FROM deps AS build
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @clothing-brand/shared build
# Phase 1A: no build arguments — the image carries no installation configuration. Site URL, API URL, media base, pixel
# ids, Google client id and the VAPID public key are read at runtime (apps/web/lib/runtime-config.ts), so one image is
# deployed unchanged to every installation.
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["node", "server.js"]

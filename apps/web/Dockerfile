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
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Baked in at build time — canonical URLs, og:url, sitemap.xml, and robots.txt all derive from
# this (see lib/seo.ts's getSiteUrl()); it must be the real public domain, never left unset.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# All optional — each feature (heatmap, live chat) stays inert until its vars are set.
ARG NEXT_PUBLIC_CLARITY_ID
ENV NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID
ARG NEXT_PUBLIC_TAWKTO_PROPERTY_ID
ENV NEXT_PUBLIC_TAWKTO_PROPERTY_ID=$NEXT_PUBLIC_TAWKTO_PROPERTY_ID
ARG NEXT_PUBLIC_TAWKTO_WIDGET_ID
ENV NEXT_PUBLIC_TAWKTO_WIDGET_ID=$NEXT_PUBLIC_TAWKTO_WIDGET_ID
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["node", "server.js"]

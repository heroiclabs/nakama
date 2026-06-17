# Self-building image for the Nakama admin console.
#
# IMPORTANT: the build context MUST be the web/ workspace root (NOT this
# directory), because the admin package depends on the @nakama/shared
# workspace package and pnpm needs the whole workspace to install/build:
#
#   docker build -f web/packages/admin/Dockerfile -t <image> web
#
# The CI (buildspec.yml) builds it exactly like that on every master push
# that touches web/, so console changes ship automatically — no local
# `pnpm build` or manual `dist` copy required.

# ── Builder: compile the React app from source ─────────────────────────────
FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app

# Match the pnpm version that produced pnpm-lock.yaml so --frozen-lockfile
# stays valid.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# The admin bundle (Monaco editor + recharts + world map) is heavy enough to
# blow past Node's default old-space limit during `vite build`, so give it
# plenty of headroom — otherwise the build OOMs with "Reached heap limit".
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nakama/admin build

# ── Runtime: tiny static/proxy server serving the built dist ───────────────
FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV ADMIN_DASHBOARD_BASE_PATH=/admin-dashboard
ENV ADMIN_DASHBOARD_DIST_DIR=/app/dist
ENV ADMIN_DASHBOARD_PORT=8080

COPY --from=builder /app/packages/admin/dist ./dist
COPY --from=builder /app/packages/admin/server ./server

EXPOSE 8080

CMD ["node", "server/admin-dashboard-server.mjs"]

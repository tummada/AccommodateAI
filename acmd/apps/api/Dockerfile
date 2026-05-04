# T-071 AC-7 — base image pinned by digest (CIS 4.2 / SEC-003).
# Digest captured 2026-04-29; review quarterly (next: 2026-Q3) and refresh
# alongside an SBOM/Renovate workflow when one lands. Refresh recipe:
#   docker pull node:22-alpine && \
#     docker inspect node:22-alpine --format '{{index .RepoDigests 0}}'
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/crypto/package.json ./packages/crypto/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/api/ ./apps/api/
COPY packages/db/ ./packages/db/
COPY packages/auth/ ./packages/auth/
COPY packages/crypto/ ./packages/crypto/

# Build packages then api
RUN pnpm --filter @acmd/db run build
RUN pnpm --filter @acmd/auth run build
RUN pnpm --filter @acmd/crypto run build
RUN pnpm --filter @acmd/api run build

# --- Production image ---
# T-071 AC-7 — same digest as builder stage (pinned).
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/crypto/package.json ./packages/crypto/

RUN pnpm install --frozen-lockfile --prod

# T-071 AC-1 — install tsx globally so the deploy pipeline can run the
# @acmd/db migration runner inside this same image (one-shot container,
# `tsx migrations/run-migrations.ts up`). tsx is normally a devDependency
# (apps/api/package.json:34) so `pnpm install --prod` would skip it; we
# add it here explicitly because production migration runs need it.
# Size impact ~5 MB; acceptable trade-off vs maintaining a second image.
RUN npm install -g tsx@4.21.0

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/crypto/dist ./packages/crypto/dist

# T-071 AC-1 — copy migration runner + .sql files so the deploy pipeline
# can `docker compose run --rm acmd-api sh -c "cd /app/packages/db && tsx
# migrations/run-migrations.ts up"`. Source migrations are required (the
# runner reads .sql files at runtime) — they are NOT included by the
# packages/db dist build above (tsc emits .js only, not raw .sql).
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations

WORKDIR /app/apps/api

USER node

ENV NODE_ENV=production
ENV PORT=3101

EXPOSE 3101

CMD ["node", "dist/index.js"]

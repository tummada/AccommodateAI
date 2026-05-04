# T-071 AC-7 — base image pinned by digest (CIS 4.2 / SEC-003).
# Refresh quarterly (next: 2026-Q3). Refresh recipe:
#   docker pull node:22-alpine && \
#     docker inspect node:22-alpine --format '{{index .RepoDigests 0}}'
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files (monorepo-root context)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/web/ ./apps/web/

# Vite bakes VITE_* env vars into the bundle at build time — must be set BEFORE build
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# T-061 — production build wiring. Defaults point at the production hosts so
# an unset CI variable can never silently land a bundle that talks to localhost.
# Local dev overrides these via docker-compose.yml ARGs.
ARG VITE_API_BASE_URL=https://accommodate-api.vollos.ai
ARG VITE_VOLLOS_AUTH_URL=https://auth.vollos.ai
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_VOLLOS_AUTH_URL=$VITE_VOLLOS_AUTH_URL

# VITE_MODE defaults to "production" so CI/prod builds enforce SEC-002 https guard.
# docker-compose.yml for local dev overrides this to "development".
# NODE_ENV is what actually flips `import.meta.env.PROD` in `vite build` (Vite 6);
# --mode alone only controls .env.{mode} file loading, not PROD/DEV replacement.
ARG VITE_MODE=production
ENV NODE_ENV=$VITE_MODE

# Build web — typecheck first, then vite build with --mode (split so --mode
# reaches vite — `pnpm run build -- --mode X` gets eaten by the script's `--`
# end-of-options marker, never arriving at vite).
RUN pnpm --filter @acmd/web run typecheck \
 && pnpm --filter @acmd/web exec vite build --mode $VITE_MODE

# --- Serve with nginx (unprivileged variant) ---
# T-071 AC-7 + AC-8 + DOCKER-001 — pin digest + run as non-root.
# nginxinc/nginx-unprivileged:alpine listens on 8080 by default, runs the
# master process as user 101 (nginx), and removes the `setcap cap_net_bind`
# requirement. The bundled nginx.conf (apps/web/nginx.conf) currently
# declares `listen 80;` for backward-compatibility with the original
# nginx:alpine image; we rewrite it to 8080 here so DevOps does not need
# Frontend to touch nginx.conf.
# Refresh quarterly (next: 2026-Q3). Recipe:
#   docker pull nginxinc/nginx-unprivileged:alpine && \
#     docker inspect nginxinc/nginx-unprivileged:alpine --format '{{index .RepoDigests 0}}'
FROM nginxinc/nginx-unprivileged:alpine@sha256:f35982400455b4f359083ba9d1ef573fbbe4221a6a8a194dc7a14beb4e2cd3dc AS runner

# Switch to root briefly to write files into /usr/share/nginx/html and
# /etc/nginx/conf.d (the nginx-unprivileged image runs as user 101 by
# default; COPY honours the active USER, which would 13/EACCES on these
# paths). We drop back to the nginx user before CMD.
USER root

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Rewrite `listen 80` / `listen [::]:80` to 8080 so the unprivileged user
# (uid 101) can bind without CAP_NET_BIND_SERVICE. Caddy upstream in
# vollos-core/infra/Caddyfile MUST point at acmd-web:8080 (cross-repo
# handshake required — see infra/PROD_RUNBOOK.md §1).
RUN sed -i -E 's/listen[[:space:]]+80;/listen 8080;/g; s/listen[[:space:]]+\[::\]:80;/listen [::]:8080;/g' /etc/nginx/conf.d/default.conf \
 && grep -q 'listen 8080;' /etc/nginx/conf.d/default.conf

# Drop privileges before CMD. EXPOSE documents the new port for any
# tooling that introspects the image.
USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

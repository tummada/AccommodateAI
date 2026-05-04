# T-071 AC-7 — base image pinned by digest (CIS 4.2 / SEC-003).
# Refresh quarterly (next: 2026-Q3). Refresh recipe:
#   docker pull node:22-alpine && \
#     docker inspect node:22-alpine --format '{{index .RepoDigests 0}}'
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace manifests first so the dependency install layer caches
# independently of source-code edits (rebuilds skip pnpm install when only
# .tsx files changed).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/landing/package.json ./apps/landing/

RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/landing/ ./apps/landing/

# Vite bakes VITE_* env vars into the bundle at build time — must be set
# BEFORE build. Defaults point at the production hosts so an unset CI
# variable never silently lands a bundle that talks to localhost.
ARG VITE_API_URL=https://accommodate-api.vollos.ai
ARG VITE_WEB_URL=https://accommodate-app.vollos.ai
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WEB_URL=$VITE_WEB_URL

RUN pnpm --filter @acmd/landing run typecheck \
 && pnpm --filter @acmd/landing exec vite build

# --- Serve with nginx (unprivileged variant) ---
# T-071 AC-7 + AC-8 + DOCKER-001 — pin digest + run as non-root.
# Same pattern as apps/web/Dockerfile — see that file's runner-stage
# comment block for the full rationale (port 8080 + USER nginx + Caddy
# upstream coordination with vollos-core/infra/Caddyfile).
# Refresh quarterly (next: 2026-Q3).
FROM nginxinc/nginx-unprivileged:alpine@sha256:f35982400455b4f359083ba9d1ef573fbbe4221a6a8a194dc7a14beb4e2cd3dc AS runner

# Briefly elevate to write into /usr/share/nginx/html + /etc/nginx/conf.d.
USER root

COPY --from=builder /app/apps/landing/dist /usr/share/nginx/html
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf

# Rewrite `listen 80` to 8080 so uid 101 can bind without CAP_NET_BIND.
RUN sed -i -E 's/listen[[:space:]]+80;/listen 8080;/g; s/listen[[:space:]]+\[::\]:80;/listen [::]:8080;/g' /etc/nginx/conf.d/default.conf \
 && grep -q 'listen 8080;' /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/auth-service/package.json ./apps/auth-service/
COPY packages/auth/package.json ./packages/auth/
COPY packages/auth-db/package.json ./packages/auth-db/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/auth-service/ ./apps/auth-service/
COPY packages/auth/ ./packages/auth/
COPY packages/auth-db/ ./packages/auth-db/

# Build packages then service
RUN pnpm --filter @vollos/auth run build
RUN pnpm --filter @vollos/auth-db run build
RUN pnpm --filter @vollos/auth-service run build

# --- Production image ---
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/auth-service/package.json ./apps/auth-service/
COPY packages/auth/package.json ./packages/auth/
COPY packages/auth-db/package.json ./packages/auth-db/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/auth-db/dist ./packages/auth-db/dist

WORKDIR /app/apps/auth-service

USER node

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "dist/index.js"]

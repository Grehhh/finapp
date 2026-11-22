FROM node:24-bookworm-slim

RUN corepack enable \
  && corepack prepare pnpm@12.21.0 --activate \
  && mkdir -p /app \
  && chown node:node /app

WORKDIR /app
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

RUN pnpm --filter api exec prisma generate --config prisma7.config.ts \
  && pnpm --filter api build

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "api", "start:prod"]

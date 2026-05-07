FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL=file:/tmp/build.db
ENV NEXTAUTH_SECRET=build-placeholder
ENV NEXTAUTH_URL=http://localhost:3000
ENV AUTH_GOOGLE_ID=placeholder
ENV AUTH_GOOGLE_SECRET=placeholder
ENV AUTH_GITHUB_ID=placeholder
ENV AUTH_GITHUB_SECRET=placeholder
ENV ENIGMA_SERVER_URL=http://localhost:8080
ENV ENIGMA_LOG_PATH=/data/enigma.log
ENV ENIGMA_ADMIN_TOKEN=

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Standalone Next.js output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Full node_modules needed for prisma migrate deploy at startup
COPY --from=builder /app/node_modules ./node_modules

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /data

# Azure App Service uses port 80 by default — WEBSITES_PORT can override but is unreliable
EXPOSE 80
ENV PORT=80
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/data/web.db

ENTRYPOINT ["/entrypoint.sh"]

# syntax=docker/dockerfile:1

# ── Dependencies (production only, reproducible from the lockfile) ──────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Root-owned, read-only app files; the process runs as the unprivileged
# `node` user and cannot modify its own code. Explicit modes so restrictive
# host permissions (e.g. 600) don't leave the files unreadable to `node`.
COPY --from=deps /app/node_modules ./node_modules
COPY --chmod=0444 package.json index.js ./
COPY --chmod=0555 src ./src

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Run node directly (not via npm) so SIGTERM reaches the app for a graceful
# shutdown.
CMD ["node", "index.js"]

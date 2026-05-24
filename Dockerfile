FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
# Build-args default to placeholders. The release workflow always passes these.
# Local dev builds (npm run dev / docker compose build) can override with real
# values, in which case the entrypoint replacement is a no-op.
ARG NEXT_PUBLIC_SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=__SUPABASE_ANON_KEY_PLACEHOLDER__
ARG NEXT_PUBLIC_APP_URL=__APP_URL_PLACEHOLDER__
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# HOSTNAME=0.0.0.0 — Next.js standalone binds process.env.HOSTNAME. Docker auto-sets
# HOSTNAME to the container ID, so without this the server binds the container IP only
# and the in-container healthcheck (wget localhost:3000) fails permanently.
ENV HOSTNAME=0.0.0.0
# docker-entrypoint.sh defaults STANDALONE_DIR to /app/.next/standalone, but the
# runner stage flattens the standalone output into /app/ (so node runs server.js
# at /app/server.js). The entrypoint operates on $STANDALONE_DIR/.next, so point
# it at /app for this image layout.
ENV STANDALONE_DIR=/app
# postgresql-client provides pg_dump for the /api/backup/full route.
RUN apk add --no-cache postgresql-client \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Overlay full production node_modules. Next.js standalone bundles a subset of
# node_modules via output-file tracing — sufficient for serving the app, but
# misses packages like @supabase/supabase-js that the migrator scripts need.
# Adds ~200MB but unblocks `npm run deploy:init`.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
# Schema + migrator scripts. Used by the `migrator` service in
# deploy/dockge/compose.yaml (command: npm run deploy:init). Overwrite the
# stripped package.json that Next.js standalone generated so `npm run
# deploy:init` resolves to the script defined in the project's real package.json.
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/database ./database
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]

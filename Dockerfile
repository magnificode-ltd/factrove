# Production images for the API and the web app.
# One Dockerfile, two targets, so the pnpm workspace is installed and built once.
#   docker build --target api --tag factrove-api .
#   docker build --target web --tag factrove-web .
# Node 24.16.0 matches .nvmrc. pnpm 11.25.0 matches packageManager in package.json.
# The digest is the official multi-arch index for node:24.16.0-bookworm-slim.

ARG NODE_IMAGE=node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203

FROM ${NODE_IMAGE} AS build
# Prisma selects its query engine from the openssl CLI. bookworm-slim does not ship it,
# and Prisma would otherwise download the OpenSSL 1.1 engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /src
# .dockerignore excludes ee/, so this context is the open-source core.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @factrove/api... build
RUN pnpm --filter @factrove/web... build
# --legacy keeps the committed lockfile. That resolution also links workspace peers
# such as Next.js, which the API process does not import. Remove them after generate.
RUN pnpm --filter @factrove/api deploy --prod --legacy /prod/api \
  && test -f /prod/api/dist/main.js \
  && test -f /prod/api/prisma/schema.prisma \
  && test -d /prod/api/prisma/migrations \
  && test -f /prod/api/node_modules/prisma/build/index.js \
  && cd /prod/api && node node_modules/prisma/build/index.js generate \
  && node --input-type=module -e 'import { rmSync, readdirSync } from "node:fs"; const prefixes = ["next@", "@next+", "happy-dom@", "sharp@", "@img+sharp", "lightningcss", "@esbuild+", "esbuild@", "typescript@", "caniuse-lite@", "@babel+", "react@", "react-dom@", "vite@", "vitest@", "rollup@", "postcss@", "tailwindcss@", "@tailwindcss+", "tsx@", "playwright@"]; const root = "node_modules/.pnpm"; for (const name of readdirSync(root)) { if (prefixes.some((prefix) => name.startsWith(prefix))) rmSync(root + "/" + name, { recursive: true, force: true }); }'

FROM ${NODE_IMAGE} AS api
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
COPY --chown=node:node docker/api-entrypoint.sh /usr/local/bin/factrove-api
RUN chmod 755 /usr/local/bin/factrove-api
USER node
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["tini", "--", "/usr/local/bin/factrove-api"]
CMD ["serve"]

FROM ${NODE_IMAGE} AS web
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
RUN if [ ! -f apps/web/server.js ]; then find . -name server.js | head -20; exit 1; fi
USER node
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]

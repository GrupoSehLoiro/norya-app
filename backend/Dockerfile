# =============================================================================
# Multi-stage Dockerfile para SEHLORO/SLMOD backend
# Alvo de deploy inicial: Vercel (serverless) continua servindo o SLMOD-api
# legado; este container é para a nova API Nest (apps/api) em containers
# (Discloud / VM / Fly.io / etc.).
#
# Runtime: usamos `tsx` (esbuild-based TS runner) por simplicidade no M1.
# Em sprints seguintes trocamos para `tsc + tsc-alias` + `node dist/main.js`
# quando quisermos o overhead zero de transpilação em cold start.
# =============================================================================

FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

# Copia manifests primeiro para aproveitar cache de layer
COPY pnpm-workspace.yaml package.json ./
COPY pnpm-lock.yaml* ./
COPY tsconfig.base.json nest-cli.json ./

# Copia os projetos
COPY apps ./apps
COPY libs ./libs
# Scripts utilitários (migrate-clickhouse.ts, etc) — referenciados por
# alguns specs de integração e podem ser executados via tsx em runtime.
COPY scripts ./scripts

# Instala deps (libs + apps) e builda tudo (libs primeiro via pnpm -r)
RUN pnpm install --frozen-lockfile
RUN pnpm -r build

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@9 \
  && addgroup -S sehloro \
  && adduser -S sehloro -G sehloro

# Copia artefatos buildados + node_modules hoisted (api + worker)
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=builder /app/libs ./libs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/tsconfig.base.json ./
COPY --from=builder /app/scripts ./scripts

USER sehloro
EXPOSE 3000

# Healthcheck básico contra o ping de identity
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://localhost:${API_PORT:-3000}/api/identity/ping" || exit 1

# Executa o JS compilado — tsc-alias já reescreveu `@sehloro/*` para paths
# relativos, então node consegue resolver sem loader adicional.
CMD ["node", "apps/api/dist/main.js"]

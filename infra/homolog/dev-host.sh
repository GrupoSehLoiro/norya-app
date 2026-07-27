#!/usr/bin/env bash
# =============================================================================
# dev-host.sh — sobe a stack SEM build de imagem Docker:
#   - infra em containers: mongo, redis, clickhouse (+ migrações) e mailpit
#     (catcher de email — os códigos de verificação do signup aparecem na UI)
#   - nest-api NO HOST: `pnpm -r build` (tsc incremental, segundos) + node dist
#     (`tsx watch` NÃO funciona: decorators do @nestjs/mongoose quebram nas
#     libs fora do tsconfig do app — por isso o build leve é obrigatório)
#   - console NO HOST: `next dev` (hot reload de verdade)
#
#   ./dev-host.sh                # sobe tudo e faz tail dos logs (Ctrl+C = para
#                                # api+front; infra continua no ar)
#   ./dev-host.sh --skip-build   # não re-builda o backend (dist já existe)
#   ./dev-host.sh --worker       # também sobe o worker (EventSub) no host
#   ./dev-host.sh seed           # popula contas/dados demo (idempotente)
#   ./dev-host.sh stop           # para api/front/worker do host
#   ./dev-host.sh down           # stop + derruba containers (mantém volumes)
#   ./dev-host.sh down -v        # idem, APAGANDO volumes (mongo/ch/redis)
#   ./dev-host.sh status         # estado de containers + processos do host
#
# Portas (override por env): API_PORT=3100 FRONT_PORT=3000 MONGO_PORT=27017
#   DEV_REDIS_PORT=6381 DEV_CH_PORT=8124 DEV_SMTP_PORT=1025 DEV_MAILPIT_PORT=8025
# Requer: docker compose >= 2.24, pnpm, node >= 20 e o .env desta pasta.
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

ROOT="$(readlink -f ../..)"
BACKEND="$ROOT/backend"
FRONT="$ROOT/norya-front"
RUN_DIR="$PWD/.dev-host"          # pidfiles + logs dos processos do host
mkdir -p "$RUN_DIR"

# Infra somente — nest-api/worker/console/caddy do compose ficam de fora.
DC=(docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.dev-host.yml)
INFRA_SERVICES=(mongo redis clickhouse clickhouse-migrate mailpit)

API_PORT="${API_PORT:-3100}"
FRONT_PORT="${FRONT_PORT:-3000}"
MONGO_PORT="${MONGO_PORT:-27017}"
export DEV_REDIS_PORT="${DEV_REDIS_PORT:-6381}"
export DEV_CH_PORT="${DEV_CH_PORT:-8124}"
export DEV_SMTP_PORT="${DEV_SMTP_PORT:-1025}"
export DEV_MAILPIT_PORT="${DEV_MAILPIT_PORT:-8025}"

# --- .env: parser seguro (o arquivo tem valores sem aspas, ex. MAIL_FROM com
#     `<...>`, que explodem num `source` — por isso NÃO usar source). ---------
load_env() {
  [[ -f .env ]] || { echo "ERRO: .env não encontrado em $PWD (copie de .env.example)." >&2; exit 1; }
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" == *=* ]] || continue
    local key="${line%%=*}" val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$val"
  done < .env
}

# --- env dos processos do host (API/worker): conexões apontando pro loopback -
host_env() {
  load_env
  export NODE_ENV=development
  export TZ=UTC   # ClickHouse DateTime64 sem sufixo — parse correto só em UTC
  export API_PORT
  export MONGODB_URI="mongodb://${MONGO_INITDB_ROOT_USERNAME}:${MONGO_INITDB_ROOT_PASSWORD}@127.0.0.1:${MONGO_PORT}/sehloirostudios?authSource=admin"
  export REDIS_URL="redis://127.0.0.1:${DEV_REDIS_PORT}"
  export CLICKHOUSE_URL="http://127.0.0.1:${DEV_CH_PORT}"
  export CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
  export CLICKHOUSE_DB="${CLICKHOUSE_DB:-sehloro}"
  export RECONCILER_ENABLED=false   # senão forka 1 worker/canal e duplica ingestão
  export PUBLIC_API_URL="http://localhost:${API_PORT}"
  export CONSOLE_URL="http://localhost:${FRONT_PORT}"
  export CORS_ORIGIN="http://localhost:${FRONT_PORT}"
  # Email → mailpit local (UI em http://localhost:${DEV_MAILPIT_PORT})
  export EMAIL_DRIVER=smtp
  export SMTP_HOST=127.0.0.1 SMTP_PORT="$DEV_SMTP_PORT" SMTP_SECURE=false
  export SMTP_USER="" SMTP_PASS=""
  export MAIL_FROM="${MAIL_FROM:-Norya <no-reply@norya.local>}"
}

port_busy() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

pid_of() { [[ -f "$RUN_DIR/$1.pid" ]] && cat "$RUN_DIR/$1.pid" 2>/dev/null || true; }

alive() { local p; p="$(pid_of "$1")"; [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; }

stop_proc() { # $1=nome
  local p; p="$(pid_of "$1")"
  if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
    kill "$p" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    kill -9 "$p" 2>/dev/null || true
    echo "==> $1 (pid $p) parado."
  fi
  rm -f "$RUN_DIR/$1.pid"
}

stop_all_host() { stop_proc api; stop_proc front; stop_proc worker; }

# --- subcomandos -------------------------------------------------------------
case "${1:-}" in
  stop)   stop_all_host; exit 0 ;;
  down)   shift; stop_all_host; echo "==> derrubando infra ${*:+($*)}..."; "${DC[@]}" down "$@"; exit 0 ;;
  status)
    "${DC[@]}" ps "${INFRA_SERVICES[@]}" 2>/dev/null || true
    for n in api front worker; do
      if alive "$n"; then echo "host/$n: rodando (pid $(pid_of "$n"))"; else echo "host/$n: parado"; fi
    done
    exit 0 ;;
  seed)
    host_env
    echo "==> seed (contas @norya.com, senha ${SEED_PASSWORD:-norya12345})..."
    ( cd "$BACKEND" && SEED_PASSWORD="${SEED_PASSWORD:-norya12345}" node scripts/seed-homolog.js )
    exit 0 ;;
esac

SKIP_BUILD=0; WITH_WORKER=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --worker)     WITH_WORKER=1 ;;
    *) echo "ERRO: argumento desconhecido: $arg" >&2; exit 1 ;;
  esac
done

# --- pré-checagens -----------------------------------------------------------
docker info >/dev/null 2>&1 || { echo "ERRO: daemon do Docker inacessível." >&2; exit 1; }
command -v pnpm >/dev/null || { echo "ERRO: pnpm não encontrado." >&2; exit 1; }
load_env
[[ -d "$BACKEND/node_modules" ]] || { echo "ERRO: rode 'pnpm install' em $BACKEND primeiro." >&2; exit 1; }
[[ -d "$FRONT/node_modules"   ]] || { echo "ERRO: rode 'npm install' em $FRONT primeiro." >&2; exit 1; }
# (checagem de portas fica DEPOIS do stop dos nossos processos — um restart
# não pode abortar porque a nossa própria api/front anterior segura a porta)

# --- infra (docker) ----------------------------------------------------------
echo "==> subindo infra: ${INFRA_SERVICES[*]} ..."
"${DC[@]}" up -d --remove-orphans "${INFRA_SERVICES[@]}"

echo "==> aguardando migração do ClickHouse (one-shot)..."
"${DC[@]}" logs -f clickhouse-migrate 2>/dev/null || true

echo "==> aguardando mongo/clickhouse responderem no host..."
for _ in $(seq 1 30); do
  ok=1
  curl -s "http://127.0.0.1:${DEV_CH_PORT}/ping" >/dev/null 2>&1 || ok=0
  (exec 3<>"/dev/tcp/127.0.0.1/${MONGO_PORT}") 2>/dev/null || ok=0
  [[ $ok -eq 1 ]] && break
  sleep 2
done

# --- backend build leve (tsc incremental) + api no host ----------------------
if [[ $SKIP_BUILD -eq 0 ]]; then
  echo "==> build do backend (tsc incremental — sem imagem Docker)..."
  ( cd "$BACKEND" && pnpm -r build )
fi

host_env
stop_proc api
if port_busy "$API_PORT"; then
  echo "ERRO: porta $API_PORT (API) ocupada por processo alheio — API_PORT=<outra> ./dev-host.sh" >&2
  exit 1
fi
echo "==> iniciando nest-api no host (porta $API_PORT)..."
( cd "$BACKEND" && exec node apps/api/dist/main.js ) > "$RUN_DIR/api.log" 2>&1 &
echo $! > "$RUN_DIR/api.pid"

if [[ $WITH_WORKER -eq 1 ]]; then
  stop_proc worker
  echo "==> iniciando worker no host..."
  ( cd "$BACKEND" && exec node apps/worker/dist/main.js ) > "$RUN_DIR/worker.log" 2>&1 &
  echo $! > "$RUN_DIR/worker.pid"
fi

# --- front no host (next dev, hot reload) ------------------------------------
stop_proc front
# Instâncias soltas de `next dev` NESTE projeto compartilham o .next e o
# corrompem (sintoma: navegação trava com request _rsc pendente). Só pode
# haver UMA — aborta e lista as que sobraram.
stray=""
for p in $(pgrep -f 'next dev|next-server' 2>/dev/null); do
  [[ "$(readlink "/proc/$p/cwd" 2>/dev/null)" == "$FRONT" ]] && stray="$stray $p"
done
if [[ -n "$stray" ]]; then
  echo "ERRO: já existe next dev deste projeto rodando (pids:$stray)." >&2
  echo "      Múltiplas instâncias corrompem o .next — mate-as: kill$stray" >&2
  echo "      (e se a navegação estiver travada: rm -rf $FRONT/.next)" >&2
  exit 1
fi
if port_busy "$FRONT_PORT"; then
  for cand in 3001 3002 3003 3004; do
    if ! port_busy "$cand"; then echo "AVISO: porta $FRONT_PORT ocupada — front vai para $cand."; FRONT_PORT="$cand"; break; fi
  done
  port_busy "$FRONT_PORT" && { echo "ERRO: nenhuma porta livre para o front (3000-3004)." >&2; exit 1; }
  # URLs públicas acompanham a porta final do front.
  export CONSOLE_URL="http://localhost:${FRONT_PORT}"
  export CORS_ORIGIN="http://localhost:${FRONT_PORT}"
fi
echo "==> iniciando console no host (next dev, porta $FRONT_PORT)..."
( cd "$FRONT" && exec env SEHLORO_API_URL="http://127.0.0.1:${API_PORT}" npx next dev -p "$FRONT_PORT" ) \
  > "$RUN_DIR/front.log" 2>&1 &
echo $! > "$RUN_DIR/front.pid"

# --- espera a API responder --------------------------------------------------
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:${API_PORT}/api/identity/ping" 2>/dev/null && break
  alive api || { echo "ERRO: nest-api morreu no boot — veja $RUN_DIR/api.log:"; tail -20 "$RUN_DIR/api.log"; exit 1; }
  sleep 1
done

cat <<EOF

------------------------------------------------------------------------------
 Tudo no ar (apps no host, infra no Docker):
   Console:    http://localhost:${FRONT_PORT}
   API:        http://localhost:${API_PORT}/api/identity/ping
   Mailpit:    http://localhost:${DEV_MAILPIT_PORT}   (emails de verificação)
   Mongo:      mongodb://127.0.0.1:${MONGO_PORT}  (root do .env, db sehloirostudios)
   Redis:      redis://127.0.0.1:${DEV_REDIS_PORT}
   ClickHouse: http://127.0.0.1:${DEV_CH_PORT}

 Contas demo:  ./dev-host.sh seed   (…@norya.com / norya12345)
 Logs:   tail -f $RUN_DIR/{api,front}.log
 Editou backend?  ./dev-host.sh --skip-build nunca; rode ./dev-host.sh de novo
                  (tsc incremental + restart em segundos). Front tem hot reload.
 Parar apps: ./dev-host.sh stop     Derrubar tudo: ./dev-host.sh down [-v]
------------------------------------------------------------------------------
 Ctrl+C abaixo NÃO derruba nada (só para o follow dos logs).
EOF

exec tail -n +1 -f "$RUN_DIR/api.log" "$RUN_DIR/front.log"

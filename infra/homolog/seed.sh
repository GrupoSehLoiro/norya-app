#!/usr/bin/env bash
# =============================================================================
# seed.sh — popula HOMOLOG (Mongo + ClickHouse) com contas login-áveis e dados
# mockados de ponta a ponta (insights/mood, tópicos, métricas, batches, marcas,
# sessões, moderação, AD).
#
#   cd infra/homolog && ./seed.sh
#   SEED_PASSWORD=outrasenha ./seed.sh     # senha customizada (default norya12345)
#
# Roda backend/scripts/seed-homolog.js DENTRO da imagem do nest-api (que já tem
# bcrypt/mongoose e alcança mongo/clickhouse), via bind mount — SEM rebuild.
# Idempotente: pode rodar várias vezes. Requer a stack no ar.
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

SCRIPT="$(readlink -f ../../backend/scripts/seed-homolog.js)"
if [[ ! -f "$SCRIPT" ]]; then
  echo "seed: não encontrei $SCRIPT — rodou 'git pull'?" >&2
  exit 1
fi

echo "seed: executando dentro do container nest-api..."
docker compose run --rm --no-deps \
  -e SEED_PASSWORD="${SEED_PASSWORD:-norya12345}" \
  -v "$SCRIPT:/seed/seed-homolog.js:ro" \
  nest-api node /seed/seed-homolog.js

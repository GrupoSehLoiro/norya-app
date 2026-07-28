#!/usr/bin/env bash
# =============================================================================
# seed-demo.sh — cria a conta de DEMONSTRAÇÃO (demo@norya.com) e popula todos
# os dados do produto: pauta mais comentada, clima, marcas, palavras-chave,
# gráfico, feed (histórico), assuntos do chat, mensagens, bans, timeouts,
# mensagens removidas, enquetes, predictions e emojis.
#
#   cd infra/homolog && ./seed-demo.sh
#   SEED_PASSWORD=outrasenha ./seed-demo.sh    # senha custom (default norya12345)
#   DEMO_EMAIL=outro@mail.com ./seed-demo.sh   # e-mail custom
#   DEMO_CHANNEL=outro_canal ./seed-demo.sh    # nome de canal custom
#
# Roda backend/scripts/seed-demo.js DENTRO da imagem do nest-api (que já tem
# bcrypt/mongoose e alcança mongo/clickhouse), via bind mount — SEM rebuild.
# Idempotente: pode rodar várias vezes; só mexe nos dados da conta demo.
# Requer a stack no ar.
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

SCRIPT="$(readlink -f ../../backend/scripts/seed-demo.js)"
if [[ ! -f "$SCRIPT" ]]; then
  echo "seed-demo: não encontrei $SCRIPT — rodou 'git pull'?" >&2
  exit 1
fi

echo "seed-demo: executando dentro do container nest-api..."
docker compose run --rm --no-deps \
  -e SEED_PASSWORD="${SEED_PASSWORD:-norya12345}" \
  -e DEMO_EMAIL="${DEMO_EMAIL:-demo@norya.com}" \
  -e DEMO_CHANNEL="${DEMO_CHANNEL:-norya_demo}" \
  -v "$SCRIPT:/seed/seed-demo.js:ro" \
  nest-api node /seed/seed-demo.js

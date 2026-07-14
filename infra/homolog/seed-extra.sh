#!/usr/bin/env bash
# =============================================================================
# seed-extra.sh — ADICIONA 3 contas de homolog (guilherme, geeo, roger) com
# dados mockados, SEM tocar nas 5 contas do seed.sh.
#
#   cd infra/homolog && ./seed-extra.sh
#   SEED_PASSWORD=outrasenha ./seed-extra.sh
#
# Roda backend/scripts/seed-homolog-extra.js dentro da imagem do nest-api via
# bind mount — sem rebuild. Idempotente. Requer a stack no ar.
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

SCRIPT="$(readlink -f ../../backend/scripts/seed-homolog-extra.js)"
if [[ ! -f "$SCRIPT" ]]; then
  echo "seed: não encontrei $SCRIPT — rodou 'git pull'?" >&2
  exit 1
fi

echo "seed: executando dentro do container nest-api..."
docker compose run --rm --no-deps \
  -e SEED_PASSWORD="${SEED_PASSWORD:-norya12345}" \
  -v "$SCRIPT:/seed/seed-homolog-extra.js:ro" \
  nest-api node /seed/seed-homolog-extra.js

#!/usr/bin/env bash
# =============================================================================
# codigo.sh — mostra o ÚLTIMO código de verificação de email do sign-up local.
#
#   ./codigo.sh          # imprime o código mais recente que saiu no log
#   ./codigo.sh -w       # fica esperando: assim que um novo código sair, mostra
#
# Só funciona com EMAIL_DRIVER=log (default local). O código é lido do log do
# container nest-api (o LogEmailSender escreve "código de verificação é: NNNNNN").
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

DC=(docker compose -f docker-compose.yml -f docker-compose.local.yml)
RE='verificação é: ([0-9]{6})'

if [[ "${1:-}" == "-w" || "${1:-}" == "--watch" ]]; then
  echo "aguardando um novo código... (crie/reenvie o cadastro; Ctrl+C sai)"
  "${DC[@]}" logs -f --tail=0 nest-api 2>/dev/null \
    | grep --line-buffered -oE "$RE" \
    | grep --line-buffered -oE '[0-9]{6}' \
    | while read -r code; do
        echo "código: $code"
      done
  exit 0
fi

code="$("${DC[@]}" logs --tail=2000 nest-api 2>/dev/null \
  | grep -oE "$RE" | grep -oE '[0-9]{6}' | tail -1 || true)"

if [[ -n "$code" ]]; then
  echo "$code"
else
  echo "nenhum código encontrado no log." >&2
  echo "verifique se a stack está no ar e se EMAIL_DRIVER=log no .env." >&2
  exit 1
fi

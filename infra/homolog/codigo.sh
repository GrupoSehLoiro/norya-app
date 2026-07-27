#!/usr/bin/env bash
# =============================================================================
# codigo.sh — mostra o ÚLTIMO código de verificação de email do sign-up local.
#
#   ./codigo.sh          # imprime o código mais recente
#   ./codigo.sh -w       # fica esperando: assim que um novo código sair, mostra
#
# Funciona nos dois cenários:
#   1) dev-host.sh (EMAIL_DRIVER=smtp): lê do Mailpit (API http://127.0.0.1:8025)
#      — também cobre o log do host (.dev-host/api.log) se EMAIL_DRIVER=log.
#   2) stack em containers (EMAIL_DRIVER=log): lê o log do container nest-api,
#      onde o LogEmailSender escreve "código de verificação é: NNNNNN".
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

DC=(docker compose -f docker-compose.yml -f docker-compose.local.yml)
RE='verificação é: ([0-9]{6})'
MAILPIT="http://127.0.0.1:${DEV_MAILPIT_PORT:-8025}"

mailpit_up() { curl -sf -o /dev/null "$MAILPIT/api/v1/info" 2>/dev/null; }

# id + código do email mais recente no Mailpit ("id código", vazio se não houver)
mailpit_last() {
  local id
  id="$(curl -sf "$MAILPIT/api/v1/messages?limit=1" 2>/dev/null \
    | grep -oE '"ID":"[^"]+"' | head -1 | cut -d'"' -f4)" || true
  [[ -z "$id" ]] && return 0
  local code
  code="$(curl -sf "$MAILPIT/api/v1/message/$id" 2>/dev/null \
    | grep -oE "$RE" | grep -oE '[0-9]{6}' | head -1)" || true
  [[ -n "$code" ]] && echo "$id $code"
}

# último código nos logs (container nest-api e/ou api do host), o que existir
logs_last() {
  {
    "${DC[@]}" logs --tail=2000 nest-api 2>/dev/null || true
    tail -n 2000 .dev-host/api.log 2>/dev/null || true
  } | grep -oE "$RE" | grep -oE '[0-9]{6}' | tail -1
}

if [[ "${1:-}" == "-w" || "${1:-}" == "--watch" ]]; then
  echo "aguardando um novo código... (crie/reenvie o cadastro; Ctrl+C sai)"
  if mailpit_up; then
    seen="$(mailpit_last | cut -d' ' -f1 || true)"
    while sleep 2; do
      last="$(mailpit_last)"
      [[ -z "$last" ]] && continue
      id="${last%% *}"
      if [[ "$id" != "$seen" ]]; then
        seen="$id"
        echo "código: ${last##* }"
      fi
    done
    exit 0
  fi
  "${DC[@]}" logs -f --tail=0 nest-api 2>/dev/null \
    | grep --line-buffered -oE "$RE" \
    | grep --line-buffered -oE '[0-9]{6}' \
    | while read -r code; do
        echo "código: $code"
      done
  exit 0
fi

code=""
if mailpit_up; then
  code="$(mailpit_last | cut -d' ' -f2- || true)"
fi
[[ -z "$code" ]] && code="$(logs_last || true)"

if [[ -n "$code" ]]; then
  echo "$code"
else
  echo "nenhum código encontrado." >&2
  echo "dev-host: veja a UI do Mailpit em $MAILPIT (emails do signup caem lá)." >&2
  echo "stack em containers: exige EMAIL_DRIVER=log no .env." >&2
  exit 1
fi

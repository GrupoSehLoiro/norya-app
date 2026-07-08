#!/usr/bin/env bash
# =============================================================================
# run-local.sh — sobe a stack de homolog LOCAL (mesmo padrão da VPS) e abre
# dois terminais de log: um pro nest-api, outro pro worker.
#
#   ./run-local.sh              # build + up -d + abre os 2 terminais de log
#   ./run-local.sh --no-build   # pula o build (sobe imagens já existentes)
#   ./run-local.sh logs         # SÓ abre os 2 terminais de log (stack já no ar)
#   ./run-local.sh down         # derruba a stack (mantém volumes)
#   ./run-local.sh down -v      # derruba e APAGA os volumes (mongo/ch/redis)
#
# Difere da VPS só no overlay docker-compose.local.yml (CH sem porta no host,
# reconciler off, nomes de container auto). Requer Docker Compose v2 e um .env
# preenchido nesta pasta.
# =============================================================================
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

DC=(docker compose -f docker-compose.yml -f docker-compose.local.yml)

# --- abre 1 terminal gráfico rodando um comando -----------------------------
open_term() { # $1=título  $2=comando
  local title="$1" cmd="$2"
  if [[ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]] && command -v gnome-terminal >/dev/null; then
    gnome-terminal --title="$title" -- bash -lc "$cmd" &
  elif [[ -n "${DISPLAY:-}" ]] && command -v x-terminal-emulator >/dev/null; then
    x-terminal-emulator -T "$title" -e bash -lc "$cmd" &
  elif [[ -n "${DISPLAY:-}" ]] && command -v xterm >/dev/null; then
    xterm -T "$title" -e bash -lc "$cmd" &
  else
    return 1
  fi
}

# --- abre os DOIS terminais de log (nest-api + worker) ----------------------
open_log_terminals() {
  local here; here="$(pwd)"
  local api_cmd="cd '$here'; echo '=== LOGS: nest-api (Ctrl+C fecha o follow) ==='; ${DC[*]} logs -f --tail=100 nest-api; exec bash"
  local wrk_cmd="cd '$here'; echo '=== LOGS: worker  (Ctrl+C fecha o follow) ==='; ${DC[*]} logs -f --tail=100 worker;   exec bash"
  echo "==> abrindo terminais de log..."
  if open_term "SEHLORO • nest-api" "$api_cmd" && open_term "SEHLORO • worker" "$wrk_cmd"; then
    echo "OK. Dois terminais abertos (nest-api e worker)."
  else
    echo "Sem terminal gráfico detectado — acompanhe os dois logs aqui:"
    echo "  ${DC[*]} logs -f nest-api worker"
  fi
}

# --- subcomando: down -------------------------------------------------------
if [[ "${1:-}" == "down" ]]; then
  shift
  echo "==> derrubando a stack ${*:+($*)}..."
  "${DC[@]}" down "$@"
  exit 0
fi

# --- subcomando: logs (só abre as janelas) ----------------------------------
if [[ "${1:-}" == "logs" ]]; then
  open_log_terminals
  exit 0
fi

# --- pré-checagens ----------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "ERRO: o daemon do Docker não está acessível para este usuário." >&2
  echo "      Tente: sudo usermod -aG docker \$USER && relogar   (ou rode com sudo)." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "ERRO: .env não encontrado em $(pwd). Copie de .env.example e preencha." >&2
  exit 1
fi

BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

# --- sobe a stack -----------------------------------------------------------
if [[ $BUILD -eq 1 ]]; then
  echo "==> build (pode levar ~5-10 min na 1ª vez)..."
  "${DC[@]}" build
fi
echo "==> subindo containers (-d)..."
# --remove-orphans limpa containers de runs antigas deste projeto (ex.: nomes
# sehloro-h-* do mirror antigo) que sobraram e atrapalhariam.
"${DC[@]}" up -d --remove-orphans

echo "==> aguardando a migração do ClickHouse terminar..."
"${DC[@]}" logs -f clickhouse-migrate 2>/dev/null || true

echo "==> estado atual:"
"${DC[@]}" ps

echo
open_log_terminals

cat <<EOF

------------------------------------------------------------------------------
 Acesso local (tudo pela borda Caddy):
   Console:  https://localhost         (aceite o aviso de cert do Caddy local)
   API:      https://localhost/api/identity/ping
   Mongo:    mongodb://root:root@localhost:27017/?authSource=admin
   Admin:    victorcordeiro.contact@gmail.com / admin12345local
 Logs:  ./run-local.sh logs     Parar: ./run-local.sh down     Zerar: down -v
------------------------------------------------------------------------------
EOF

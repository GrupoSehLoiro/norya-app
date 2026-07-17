#!/usr/bin/env bash
# =============================================================================
# diagnostico.sh — checagem manual da ingestão Twitch (worker + api) na homolog.
#
#   ./diagnostico.sh
#
# Percorre a cadeia EventSub → worker → Redis → ClickHouse e imprime um
# veredito por elo, com a ação sugerida quando algo está quebrado. Feito para
# os sintomas "canal não fica online" / "chat não chega na plataforma".
# Só leitura — não altera nada.
# =============================================================================
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"

DC=(docker compose)
OK="✅"; WARN="⚠️ "; FAIL="❌"
PROBLEMS=0

section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()      { printf '%s %s\n' "$OK" "$1"; }
warn()    { printf '%s %s\n' "$WARN" "$1"; PROBLEMS=$((PROBLEMS+1)); }
fail()    { printf '%s %s\n' "$FAIL" "$1"; PROBLEMS=$((PROBLEMS+1)); }
hint()    { printf '   ↳ %s\n' "$1"; }

# ── 1. containers ────────────────────────────────────────────────────────────
section "1/7 Containers"
for svc in nest-api worker mongo redis clickhouse; do
  state=$("${DC[@]}" ps --format '{{.State}}' "$svc" 2>/dev/null | head -1)
  if [[ "$state" == "running" ]]; then
    ok "$svc: running"
  else
    fail "$svc: ${state:-não encontrado}"
    hint "docker compose up -d $svc"
  fi
done

# ── 2. worker: shard EventSub WS ─────────────────────────────────────────────
section "2/7 Worker — shard EventSub"
WLOG=$("${DC[@]}" logs --since 15m worker 2>&1 || true)
LAST_WELCOME=$(grep -o 'session_welcome recebido[^"]*' <<<"$WLOG" | tail -1)
N_4007=$(grep -c 'invalid reconnect attempt' <<<"$WLOG" || true)
N_CLOSE=$(grep -c 'WS fechou' <<<"$WLOG" || true)

if [[ "$N_4007" -gt 3 ]]; then
  fail "loop de reconexão 4007 (${N_4007}x em 15min) — shard NUNCA conecta; nenhum evento chega"
  hint "imediato: docker compose restart worker"
  hint "definitivo: deploy com o fix do twitch-eventsub-ws.client (retry volta pra URL base)"
elif [[ -n "$LAST_WELCOME" ]]; then
  ok "shard conectado ($LAST_WELCOME)"
elif [[ "$N_CLOSE" -gt 0 ]]; then
  warn "sem session_welcome nos últimos 15min e ${N_CLOSE} 'WS fechou' — conexão instável"
  hint "docker compose logs --tail=100 worker | grep -E 'WS|session'"
else
  warn "nenhuma atividade de WS nos últimos 15min (worker recém-iniciado? logs rotacionados?)"
  hint "docker compose logs --tail=200 worker | grep -E 'Conduit ativo|session_welcome'"
fi

# ── 3. api: bot user id (chat) ───────────────────────────────────────────────
section "3/7 API — TWITCH_BOT_USER_ID (necessário pro chat)"
BOT_ID=$("${DC[@]}" exec -T nest-api printenv TWITCH_BOT_USER_ID 2>/dev/null | tr -d '\r\n')
if [[ -n "$BOT_ID" ]]; then
  ok "TWITCH_BOT_USER_ID=$BOT_ID"
else
  fail "TWITCH_BOT_USER_ID vazio — channel.chat.message NÃO é assinado (logs mostram 'chat=off')"
  hint "1) autorize a conta-bot no OAuth do app (escopo user:bot) e pegue o user id dela"
  hint "2) adicione TWITCH_BOT_USER_ID=<id> no .env e: docker compose up -d nest-api"
  hint "3) desconecte e reconecte o canal em /integrations/twitch (recria as subs com chat)"
fi

# ── 4. mongo: canais, subscriptions, conduit ─────────────────────────────────
section "4/7 Mongo — canais reais e subscriptions"
URI=$("${DC[@]}" exec -T nest-api printenv MONGODB_URI | tr -d '\r')
MONGO_OUT=$("${DC[@]}" exec -T mongo mongosh "${URI/mongo:/localhost:}" --quiet --eval '
const reais = db.channels.find({externalId:{$exists:true}, _id:{$not:/^chan-/}}, {channel:1,externalId:1,active:1,creatorId:1}).toArray();
print("CHANNELS=" + JSON.stringify(reais.map(c=>({id:c._id,ch:c.channel,ext:c.externalId,active:c.active,linked:!!c.creatorId}))));
const subs = db.twitch_eventsub_subscriptions.find({},{type:1,status:1,channelId:1,_id:0}).toArray();
print("SUBS=" + JSON.stringify(subs));
const cond = db.twitch_conduit_state.findOne({});
print("CONDUIT=" + (cond ? cond.conduitId : "null"));' 2>/dev/null)

CHANNELS_JSON=$(grep -o 'CHANNELS=.*' <<<"$MONGO_OUT" | cut -d= -f2-)
SUBS_JSON=$(grep -o 'SUBS=.*' <<<"$MONGO_OUT" | cut -d= -f2-)
CONDUIT_ID=$(grep -o 'CONDUIT=.*' <<<"$MONGO_OUT" | cut -d= -f2-)

echo "canais reais (não-seed):"
echo "$CHANNELS_JSON" | jq -r '.[] | "   \(.ch)  id=\(.id)  ext=\(.ext)  active=\(.active)  vinculado=\(.linked)"' 2>/dev/null || echo "   $CHANNELS_JSON"
[[ -n "$CONDUIT_ID" && "$CONDUIT_ID" != "null" ]] && ok "conduit: $CONDUIT_ID" || fail "sem conduit registrado no Mongo"

N_CHAT_SUBS=$(echo "$SUBS_JSON" | jq '[.[] | select(.type=="channel.chat.message")] | length' 2>/dev/null || echo 0)
if [[ "${N_CHAT_SUBS:-0}" -gt 0 ]]; then
  ok "$N_CHAT_SUBS subscription(s) channel.chat.message no Mongo"
else
  fail "NENHUMA subscription channel.chat.message no Mongo — chat nunca vai chegar"
  hint "causa típica: TWITCH_BOT_USER_ID vazio na hora do OAuth (ver seção 3)"
fi

# ── 5. twitch helix: status real das subs + shards do conduit ────────────────
section "5/7 Twitch (Helix) — status real"
CID=$("${DC[@]}" exec -T nest-api printenv TWITCH_CLIENT_ID | tr -d '\r')
SEC=$("${DC[@]}" exec -T nest-api printenv TWITCH_CLIENT_SECRET | tr -d '\r')
TOKEN=$(curl -s -X POST "https://id.twitch.tv/oauth2/token?client_id=$CID&client_secret=$SEC&grant_type=client_credentials" | jq -r '.access_token // empty')
if [[ -z "$TOKEN" ]]; then
  fail "não consegui app token (TWITCH_CLIENT_ID/SECRET errados?)"
else
  SUBS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Client-Id: $CID" "https://api.twitch.tv/helix/eventsub/subscriptions")
  TOTAL=$(jq -r '.total // 0' <<<"$SUBS")
  N_ENABLED=$(jq '[.data[] | select(.status=="enabled")] | length' <<<"$SUBS")
  echo "subscriptions na Twitch: total=$TOTAL enabled=$N_ENABLED"
  jq -r '.data[] | select(.status!="enabled") | "   \(.type) broadcaster=\(.condition.broadcaster_user_id // "-") status=\(.status)"' <<<"$SUBS" | head -10
  [[ "$TOTAL" -gt 0 && "$TOTAL" == "$N_ENABLED" ]] && ok "todas enabled" || { [[ "$TOTAL" -eq 0 ]] && fail "ZERO subscriptions na Twitch" || warn "há subscriptions não-enabled (acima)"; }

  if [[ -n "$CONDUIT_ID" && "$CONDUIT_ID" != "null" ]]; then
    SHARDS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Client-Id: $CID" "https://api.twitch.tv/helix/eventsub/conduits/shards?conduit_id=$CONDUIT_ID")
    SHARD_STATUS=$(jq -r '.data[0].status // "sem shard"' <<<"$SHARDS")
    [[ "$SHARD_STATUS" == "enabled" ]] && ok "shard do conduit: enabled" || { fail "shard do conduit: $SHARD_STATUS"; hint "worker não está segurando o WS — ver seção 2"; }
  fi
fi

# ── 6. redis: buffer ao vivo ─────────────────────────────────────────────────
section "6/7 Redis — buffer de chat ao vivo"
BUFFERS=$("${DC[@]}" exec -T redis redis-cli --scan --pattern 'chat:buffer:*' 2>/dev/null)
if [[ -n "$BUFFERS" ]]; then
  while read -r key; do
    len=$("${DC[@]}" exec -T redis redis-cli LLEN "$key" | tr -d '\r')
    echo "   $key → $len msg(s)"
  done <<<"$BUFFERS"
  ok "buffer(s) presentes"
else
  warn "nenhum chat:buffer:* no Redis (normal se não há live com chat AGORA; ruim se há)"
fi

# ── 7. clickhouse: dados reais chegando ──────────────────────────────────────
section "7/7 ClickHouse — mensagens/batches reais (exclui seed chan-*)"
CHPASS=$("${DC[@]}" exec -T clickhouse printenv CLICKHOUSE_PASSWORD | tr -d '\r')
CH() { "${DC[@]}" exec -T clickhouse clickhouse-client --user default --password "$CHPASS" -d sehloro -q "$1" 2>/dev/null; }
MSGS_1H=$(CH "SELECT count() FROM chat_messages WHERE channel_id NOT LIKE 'chan-%' AND received_at > now() - INTERVAL 1 HOUR")
MSGS_TOTAL=$(CH "SELECT count() FROM chat_messages WHERE channel_id NOT LIKE 'chan-%'")
BATCH_1H=$(CH "SELECT count() FROM batch_analysis WHERE channel_id NOT LIKE 'chan-%' AND window_end > now() - INTERVAL 1 HOUR")
echo "   chat_messages reais: total=${MSGS_TOTAL:-?} última hora=${MSGS_1H:-?}"
echo "   batch_analysis reais na última hora: ${BATCH_1H:-?}"
if [[ "${MSGS_TOTAL:-0}" -eq 0 ]]; then
  fail "nunca entrou mensagem real no ClickHouse — problema está nas seções 2/3/5"
elif [[ "${MSGS_1H:-0}" -gt 0 && "${BATCH_1H:-0}" -eq 0 ]]; then
  warn "mensagens chegam mas sem batch na última hora — orchestrator/flag ai.socialListening.enabled"
  hint "confira a flag em /feature-flags e: docker compose logs nest-api | grep -i orchestrator"
else
  ok "dados reais fluindo"
fi

# ── resumo ───────────────────────────────────────────────────────────────────
section "RESUMO"
if [[ "$PROBLEMS" -eq 0 ]]; then
  echo "$OK Nenhum problema detectado na cadeia de ingestão."
else
  echo "$FAIL/$WARN $PROBLEMS problema(s) — siga as dicas ↳ de cada seção, de cima para baixo:"
  echo "   a ordem importa: shard (2) → bot id (3) → subs (4/5) → buffer (6) → pipeline (7)."
fi

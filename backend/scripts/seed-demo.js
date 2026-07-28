#!/usr/bin/env node
/* eslint-disable */
/**
 * seed-demo.js — cria UMA conta de demonstração completa e popula TODOS os
 * dados do produto: pauta mais comentada, clima, marcas, palavras-chave,
 * gráfico de atividade, feed ao vivo (histórico), assuntos do chat, mensagens
 * do chat, bans, timeouts, mensagens removidas, enquetes, predictions e
 * emojis.
 *
 * Escreve nas coleções/tabelas que o backend NOVO (/api/v2) e as páginas
 * legadas (/legacy/*) realmente leem:
 *   Mongo:      users, workspaces, memberships, creators, creator_profiles,
 *               channels, batch_messages, channel_brands, live_sessions,
 *               ad_segments, bans, timeouts, messagedeleteds, polls,
 *               predictions, emojis
 *   ClickHouse: batch_analysis, chat_messages, ad_segments
 *
 * Como rodar (na droplet): `cd infra/homolog && ./seed-demo.sh`
 *   O wrapper monta este arquivo dentro da imagem do nest-api (que já tem
 *   bcrypt/mongoose e alcança mongo/clickhouse) e executa — sem rebuild.
 *
 * Idempotente: pode rodar várias vezes. Limpa e reinsere APENAS os dados da
 * conta/canal demo (não toca dados reais de outros canais).
 *
 * Env consumidas (já presentes no container nest-api):
 *   MONGODB_URI, CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD,
 *   CLICKHOUSE_DB. Opcionais: SEED_PASSWORD (default "norya12345"),
 *   DEMO_EMAIL (default "demo@norya.com"), DEMO_CHANNEL (default "norya_demo").
 *
 * Observação sobre o feed AO VIVO em tempo real (SSE): o backfill vem do
 * Redis (`chat:buffer:<channelId>`, TTL 60s) alimentado pelo worker de
 * ingestão — não faz sentido semear algo que expira em 60s. O histórico do
 * feed (GET /messages/search) vem de `batch_messages`, que este seed popula.
 */

// Resolve bcrypt/mongoose exatamente como o app resolve (independe de onde
// este arquivo esteja montado). Âncora: dentro da imagem é /app; no host
// (dev-host.sh) é o repo local.
const { createRequire } = require('module');
const path = require('path');
const anchor = require('fs').existsSync('/app/apps/api/dist/main.js')
  ? '/app/apps/api/dist/main.js'
  : path.join(__dirname, '..', 'apps', 'api', 'dist', 'main.js');
const appRequire = createRequire(anchor);
const bcrypt = appRequire('bcrypt');
const mongoose = appRequire('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || 'default';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || '';
const CH_DB = process.env.CLICKHOUSE_DB || 'sehloro';
const PASSWORD = process.env.SEED_PASSWORD || 'norya12345';
const EMAIL = process.env.DEMO_EMAIL || 'demo@norya.com';
const CHANNEL_NAME = process.env.DEMO_CHANNEL || 'norya_demo';

if (!MONGODB_URI) {
  console.error('[seed-demo] ERRO: MONGODB_URI ausente no ambiente.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Identidade da conta demo
// ---------------------------------------------------------------------------
const DEMO = {
  email: EMAIL,
  display: 'Norya Demo',
  userId: 'usr-demo',
  workspaceId: 'ws-demo',
  membershipId: 'mem-demo',
  creatorId: 'cr-demo',
  profileId: 'crp-demo',
  channelId: 'chan-demo',
  channelName: CHANNEL_NAME,
  externalId: '900000042',
};

// ---------------------------------------------------------------------------
// Dicionários pt-BR
// ---------------------------------------------------------------------------
// Slugs conhecidos de backend/apps/api/src/social-listening/category-labels.ts
// para o card "Pauta mais comentada" e "Assuntos do chat" renderizarem rótulos
// bonitos ("Elogios ao gameplay", "Hype", ...). NUNCA usar 'other' (vira "—").
const CATEGORIES = [
  { id: 'gameplay-positive', ctx: 'Chat elogiando as jogadas e o clutch da ranked' },
  { id: 'gameplay-negative', ctx: 'Chat criticando a derrota e o lag da partida' },
  { id: 'hype', ctx: 'Chat hypando a sequência de vitórias' },
  { id: 'question', ctx: 'Perguntas sobre setup, sensibilidade e horário da live' },
  { id: 'meta-stream', ctx: 'Comentários sobre qualidade da stream e overlay novo' },
  { id: 'off-topic', ctx: 'Conversa paralela sobre o campeonato do fim de semana' },
  { id: 'greeting', ctx: 'Galera chegando e dando bom dia no chat' },
  { id: 'brand-mention', ctx: 'Chat comentando o sorteio patrocinado' },
];

// Marcas do card "Palavras-chave": precisam APARECER nos textos das mensagens
// (BrandCountsService varre batch_messages.messages[].text pelo nome/alias).
const BRANDS = ['Red Bull', 'Logitech', 'Nubank', 'KaBuM!', 'Coca-Cola'];

const TOXIC = ['rage_kid', 'toxic_zzz', 'hater88', 'mimimi_br'];
const NICE = ['fan_number1', 'sempre_junto', 'positiva_br', 'vibe_boa'];
const MODS = ['mod_carla', 'mod_diego', 'mod_yuri'];
const CHATTERS = [
  'joao_gamer', 'maria99', 'pedrinho', 'lulzz', 'ana_flow', 'gabomaster', 'tvzin',
  'clip_lord', 'zeh', 'bimelol', 'duda_plays', 'rafa_tt', 'nina_gg', 'theo_br', 'carol',
];
const TOKENS = ['clutch', 'gg', 'valorant', 'kkkk', 'insano', 'sub', 'música', 'ranked', 'clipa', 'aim', 'meta', 'sorteio'];
const TEXTS = [
  'que clutch insano!', 'kkkkk chorei', 'vai perder assim mano', 'GG demais',
  'esse main ta voando', 'pede a música dj', 'ranqueada agora?', 'streamer cracudo demais',
  'n acredito nessa jogada', 'clipa isso aí', '+1 sub aqui', 'bom demais a live hj',
  'aim absurdo', 'toma esse ace', 'que lag foi esse', 'primeiro no chat pai',
  // Com emotes (códigos globais Twitch/BTTV/7TV — o front renderiza a imagem)
  'LUL LUL que jogada', 'clutch demais PogChamp', 'monkaS essa ronda hein',
  'EZ Clap', 'peepoHappy live boa demais', 'FeelsDankMan perdeu de novo',
  'Kappa sei', 'PepePls PepePls PepePls', 'KEKW essa queda', 'catJAM catJAM',
  // Com emoji unicode
  'que play 🔥🔥', 'chorando de rir 😂', 'gg 💯', 'essa doeu 💀', 'olha isso 👀',
  // Com MARCAS (alimentam o card Palavras-chave via channel_brands)
  'esse mouse da Logitech é surreal', 'ganhei o sorteio da Red Bull??',
  'paguei o pix pelo Nubank rapidinho', 'comprei meu headset na KaBuM!',
  'Coca-Cola gelada e live boa', 'setup Logitech completo é outro nível',
  'Red Bull te dá asas pro clutch', 'cupom da KaBuM! ainda vale?',
];
const DELETED_MSGS = [
  'olha o cheater no time', 'esse stream ta horrivel kkk', 'segue meu canal',
  'da look no meu /w', 'noob detected', 'muta esse cara', 'link suspeito removido',
  'esse jogo e pago pra perder', 'vai jogar ranked sai daqui', 'cringe demais essa play',
];
const REASONS_BAN = [
  'spam reincidente', 'discurso de ódio', 'ameaça a outros viewers',
  'divulgação de cheat', 'flood persistente', 'comportamento tóxico após avisos',
];
const REASONS_TO = [
  'caps lock excessivo', 'spam de emote', 'link não autorizado', 'flood',
  'discussão acalorada', 'ofensa a outro viewer',
];
const TO_DURATIONS = [60, 300, 600, 1800, 3600, 86400];
const POLLS = [
  { title: 'Qual mapa jogar agora?', choices: ['Ascent', 'Bind', 'Haven', 'Split'] },
  { title: 'Próxima ranked ou casual?', choices: ['Ranked', 'Casual', 'Custom'] },
  { title: 'Faz pausa de 10min?', choices: ['Sim', 'Não'] },
  { title: 'Qual agente escolher?', choices: ['Jett', 'Reyna', 'Phoenix', 'Sage'] },
  { title: 'Joga até que horas?', choices: ['22h', '23h', '00h', 'até cair'] },
  { title: 'Que jogo amanhã?', choices: ['Valorant', 'CS2', 'LoL', 'variedade'] },
];
const PRED_TITLES = [
  'Vai vencer a primeira partida?', 'Mais de 15 kills no Valorant?',
  'Termina a live antes das 22h?', 'Ace na próxima ranked?',
  'Vence sem morrer na lane?', 'Chega ao Imortal essa semana?',
];
const PRED_OUTCOMES = [['Sim', 'Não'], ['Win', 'Loss'], ['Acima', 'Abaixo']];
const EMOJIS_TWITCH = ['Kappa', 'PogChamp', 'KEKW', 'LULW', 'OMEGALUL', 'Sadge', 'monkaS', 'EZ', 'catJAM'];
const EMOJIS_UNICODE = ['🔥', '😂', '😭', '💀', '🎉', '👏', '🤔', '😱', '💯', '👀'];
const EMOJI_MSG_TEMPLATES = [
  'que play {e}', 'tava esperando isso {e}{e}', '{e} clipa essa', 'ai sim {e}',
  'sem chance {e}', 'gg {e}', 'no clutch {e}', 'ranked diff {e}', 'pog {e}',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const now = new Date();
const minsAgo = (m) => new Date(now.getTime() - m * 60000);
const daysAgo = (d) => new Date(now.getTime() - d * 86400000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const round = (n, d = 3) => Number(n.toFixed(d));
const randId = () => Math.random().toString(36).slice(2, 12);
const randPastDays = (d) => new Date(now.getTime() - Math.random() * d * 86400000);
// DateTime64(3,'UTC') no formato que o app escreve: "YYYY-MM-DD HH:mm:ss.SSS"
const chDate = (d) => d.toISOString().replace('T', ' ').replace('Z', '');

async function chQuery(sql) {
  const res = await fetch(`${CH_URL}/`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': CH_USER, 'X-ClickHouse-Key': CH_PASS },
    body: sql,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${body}`);
  return body;
}

async function chInsert(table, rows) {
  if (!rows.length) return;
  const payload =
    `INSERT INTO ${CH_DB}.${table} FORMAT JSONEachRow\n` +
    rows.map((r) => JSON.stringify(r)).join('\n');
  await chQuery(payload);
}

// ---------------------------------------------------------------------------
// Geradores — ClickHouse
// ---------------------------------------------------------------------------
// batch_analysis alimenta: pauta mais comentada, clima geral, gráfico de
// atividade, assuntos do chat, marcas (fallback via history) e o relatório.
// 7 dias de janelas de 30min (~336 rows), com volume maior à noite pra dar
// forma real ao gráfico. created_at = window_start (o card "Assuntos" filtra
// por created_at, não por window_start).
function buildBatchAnalysis() {
  const rows = [];
  const WINDOWS = 7 * 48; // 7 dias, 30 em 30 min; i=0 => ~2min atrás
  for (let i = 0; i < WINDOWS; i++) {
    const windowStart = minsAgo(i * 30 + 2);
    const windowEnd = new Date(windowStart.getTime() + 15000);
    // Volume por hora do dia: madrugada fraca, noite forte.
    const hour = windowStart.getUTCHours();
    const heat = hour >= 22 || hour < 3 ? 1.0 : hour >= 18 ? 0.8 : hour >= 12 ? 0.45 : 0.2;
    const msgCount = Math.max(8, Math.round((40 + Math.random() * 180) * heat));
    const pos = 0.35 + Math.random() * 0.4; // 35–75%
    const neg = 0.05 + Math.random() * 0.2; // 5–25%
    const neu = Math.max(0.05, 1 - pos - neg);
    const cat = pick(CATEGORIES);
    const tier = pick([2, 2, 2, 1, 0]);
    const toxic = pick(TOXIC);
    const nice = pick(NICE);
    const hasBrand = Math.random() < 0.55;
    const adActive = i === 0; // AD ativo só na janela mais recente (demo do card)

    rows.push({
      channel_id: DEMO.channelId,
      session_id: null,
      batch_id: crypto.randomUUID(),
      window_start: chDate(windowStart),
      window_end: chDate(windowEnd),
      message_count: msgCount,
      message_count_weighted: msgCount + randInt(0, 25),
      unique_users: Math.floor(msgCount * 0.6),
      is_subscriber_ratio: round(0.2 + Math.random() * 0.5),
      sentiment_pos: Math.round(pos * 1000), // ratio × 1000 (o reader divide)
      sentiment_neu: Math.round(neu * 1000),
      sentiment_neg: Math.round(neg * 1000),
      top_categories_json: JSON.stringify([
        { category: cat.id, count: Math.floor(msgCount * 0.4), context: cat.ctx },
        { category: 'greeting', count: Math.floor(msgCount * 0.1) },
      ]),
      dominant_category: cat.id,
      least_category: 'off-topic',
      least_category_count: randInt(1, 5),
      top_toxic_users_json: JSON.stringify([
        { username: toxic, ratio: 0.8, msg_count: 12, neg_count: 10 },
      ]),
      most_toxic_username: toxic,
      most_toxic_ratio: round(0.6 + Math.random() * 0.3, 2),
      most_toxic_msg_count: randInt(8, 18),
      least_toxic_username: nice,
      least_toxic_ratio: round(0.7 + Math.random() * 0.25, 2),
      least_toxic_msg_count: randInt(10, 25),
      ad_active: adActive ? 1 : 0,
      ad_source: adActive ? 'manual' : '',
      ad_sentiment_pos: adActive ? randInt(10, 30) : 0,
      ad_sentiment_neu: adActive ? randInt(5, 15) : 0,
      ad_sentiment_neg: adActive ? randInt(2, 10) : 0,
      ad_sample_size: adActive ? randInt(20, 50) : 0,
      mentioned_brands_json: hasBrand
        ? JSON.stringify([{ brand: pick(BRANDS), count: randInt(2, 10), sample: ['m1', 'm2'] }])
        : '[]',
      top_tokens: [pick(TOKENS), pick(TOKENS), pick(TOKENS), pick(TOKENS)],
      llm_tier: tier,
      llm_model: tier === 2 ? 'claude-haiku-4-5' : tier === 1 ? 'heuristic' : 'fallback',
      llm_cost_usd: tier === 2 ? round(0.0002 + Math.random() * 0.0008, 6) : 0,
      llm_latency_ms: tier === 2 ? randInt(300, 1200) : randInt(5, 30),
      llm_cache_hit_rate: round(Math.random() * 0.6),
      llm_confidence: round(0.6 + Math.random() * 0.35),
      insight_text: '',
      created_at: chDate(windowStart),
      creator_id: DEMO.creatorId,
    });
  }
  return rows;
}

function buildChatMessagesCH() {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const t = minsAgo(randInt(0, 360));
    rows.push({
      channel_id: DEMO.channelId,
      platform: 'twitch',
      message_id: crypto.randomUUID(),
      username: pick(CHATTERS),
      is_subscriber: Math.random() < 0.4 ? 1 : 0,
      is_mod: Math.random() < 0.1 ? 1 : 0,
      text: pick(TEXTS),
      emotes: [],
      sentiment_heuristic: pick(['positive', 'neutral', 'neutral', 'negative']),
      category_heuristic: '',
      session_id: null,
      received_at: chDate(t),
      creator_id: DEMO.creatorId,
    });
  }
  return rows;
}

function buildAdSegmentsCH() {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const started = minsAgo(i * 240 + 30);
    const dur = randInt(90, 240);
    rows.push({
      channel_id: DEMO.channelId,
      session_id: null,
      source: pick(['twitch', 'manual']),
      started_at: chDate(started),
      ended_at: chDate(new Date(started.getTime() + dur * 1000)),
      duration_seconds: dur,
      is_automatic: Math.random() < 0.5 ? 1 : 0,
      raw_json: '',
      created_at: chDate(started),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Geradores — Mongo (dados do canal, chave = channelId UUID)
// ---------------------------------------------------------------------------
// batch_messages alimenta o histórico do feed (GET /messages/search) e a
// contagem de palavras-chave (GET /brands/counts varre messages[].text).
// ⚠️ TTL de 7 dias em createdAt — manter createdAt recente.
function buildBatchMessages() {
  const docs = [];
  // 36h de batches de 15min (~144 docs), bem dentro do TTL.
  for (let i = 0; i < 144; i++) {
    const windowStart = minsAgo(i * 15 + 3);
    const windowEnd = new Date(windowStart.getTime() + 15000);
    const n = randInt(6, 14);
    const messages = [];
    const users = new Set();
    for (let j = 0; j < n; j++) {
      const u = pick(CHATTERS);
      users.add(u);
      messages.push({
        id: crypto.randomUUID(),
        username: u,
        displayName: u,
        isSubscriber: Math.random() < 0.4,
        isMod: Math.random() < 0.1,
        text: pick(TEXTS),
        receivedAt: new Date(windowStart.getTime() + j * 900),
        sentimentHint: pick(['positive', 'neutral', 'negative']),
        emotes: [],
      });
    }
    docs.push({
      batchId: crypto.randomUUID(),
      channelId: DEMO.channelId,
      windowStart,
      windowEnd,
      messages,
      messageCount: n,
      uniqueUsers: users.size,
      createdAt: windowStart, // recente => não expira pelo TTL de 7d
    });
  }
  return docs;
}

// Allowlist de marcas do CRIADOR — sem isso o card Palavras-chave fica vazio.
function buildChannelBrands() {
  return BRANDS.map((b) => ({
    creatorId: DEMO.creatorId,
    channelId: DEMO.channelId,
    name: b,
    aliases: [b.toLowerCase()],
    regex: null,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildLiveSessions() {
  const docs = [];
  // 1 ACTIVE (banner "ao vivo")
  docs.push({
    _id: 'sess-demo-live',
    channelId: DEMO.channelId,
    platform: 'twitch',
    state: 'ACTIVE',
    title: `${DEMO.display} jogando ranqueada`,
    startedAt: minsAgo(120),
    endedAt: null,
    peakViewerCount: randInt(800, 3000),
    avgViewerCount: randInt(400, 1500),
    totalMessages: randInt(2000, 8000),
    summary: null,
    autoStarted: false,
    lastEventAt: now,
    createdAt: minsAgo(120),
  });
  for (let i = 1; i <= 6; i++) {
    const started = minsAgo(i * 1440 + 60);
    const ended = new Date(started.getTime() + randInt(90, 240) * 60000);
    docs.push({
      _id: `sess-demo-${i}`,
      channelId: DEMO.channelId,
      platform: 'twitch',
      state: 'ENDED',
      title: `${DEMO.display} live #${i}`,
      startedAt: started,
      endedAt: ended,
      peakViewerCount: randInt(500, 2500),
      avgViewerCount: randInt(300, 1200),
      totalMessages: randInt(1500, 6000),
      summary: 'Sessão encerrada automaticamente.',
      autoStarted: true,
      lastEventAt: ended,
      createdAt: started,
    });
  }
  return docs;
}

function buildAdSegmentsMongo() {
  const docs = [];
  for (let i = 0; i < 3; i++) {
    const started = minsAgo(i * 240 + 30);
    const dur = randInt(90, 240);
    docs.push({
      channelId: DEMO.channelId,
      sessionId: null,
      source: pick(['twitch', 'manual']),
      startedAt: started,
      endedAt: new Date(started.getTime() + dur * 1000),
      durationSeconds: dur,
      isAutomatic: Math.random() < 0.5,
      rawPayload: {},
      createdAt: started,
      updatedAt: started,
    });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Geradores — Mongo legado (chave = NOME do canal, últimos 30 dias)
// Alimentam as páginas /legacy/bans, /legacy/timeouts, /legacy/removed,
// /legacy/polls, /legacy/predictions, /legacy/emojis.
// ---------------------------------------------------------------------------
function buildBans() {
  return Array.from({ length: 25 }, () => ({
    channel: DEMO.channelName,
    userName: pick(TOXIC) + randInt(1, 99),
    reason: pick(REASONS_BAN),
    modName: pick(MODS),
    timestamp: randPastDays(30),
  }));
}

function buildTimeouts() {
  return Array.from({ length: 60 }, () => ({
    channel: DEMO.channelName,
    userName: pick(TOXIC) + randInt(1, 99),
    reason: pick(REASONS_TO),
    tempoDeTO: pick(TO_DURATIONS), // segundos (nome pt-BR é o campo real)
    modName: pick(MODS),
    timestamp: randPastDays(30),
  }));
}

function buildRemovedMessages() {
  return Array.from({ length: 90 }, () => ({
    channel: DEMO.channelName,
    username: pick([...TOXIC, ...CHATTERS]),
    deletedMessage: pick(DELETED_MSGS),
    timestamp: randPastDays(30),
  }));
}

function buildPolls() {
  return Array.from({ length: 12 }, () => {
    const spec = pick(POLLS);
    const created = randPastDays(30);
    const duration = pick([60, 120, 300, 600]);
    return {
      pollId: randId(),
      channel: DEMO.channelName,
      title: spec.title,
      created_at: created,
      ended_at: new Date(created.getTime() + duration * 1000),
      duration,
      choices: spec.choices.map((title) => ({
        id: randId(),
        title,
        votes: randInt(20, 500),
        channel_points_votes: randInt(0, 200),
        bits_votes: randInt(0, 50),
      })),
      bits_voting_enabled: Math.random() > 0.5,
      bits_per_vote: 10,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 100,
    };
  });
}

function buildPredictions() {
  return Array.from({ length: 10 }, () => {
    const created = randPastDays(30);
    const ended = new Date(created.getTime() + randInt(5, 30) * 60000);
    const outcomes = pick(PRED_OUTCOMES);
    // A UI encontra a vencedora por option.id === winningOutcome.
    const options = outcomes.map((title) => ({
      id: randId(),
      title,
      totalBetAmount: randInt(1000, 50000),
      users: randInt(10, 200),
      topBetters: Array.from({ length: 3 }, () => ({
        userName: 'better_' + randId().slice(0, 6),
        amount: randInt(100, 5000),
      })),
    }));
    return {
      predictionId: randId(),
      channel: DEMO.channelName,
      title: pick(PRED_TITLES),
      winningOutcome: pick(options).id,
      created_at: created,
      locked_at: new Date(created.getTime() + 60000),
      ended_at: ended,
      prediction_window: Math.floor((ended.getTime() - created.getTime()) / 1000),
      options,
    };
  });
}

function buildEmojis() {
  return Array.from({ length: 250 }, () => {
    const e = Math.random() > 0.4 ? pick(EMOJIS_TWITCH) : pick(EMOJIS_UNICODE);
    return {
      channel: DEMO.channelName,
      username: pick(CHATTERS),
      message: pick(EMOJI_MSG_TEMPLATES).replaceAll('{e}', e),
      emoji: e,
      timestamp: randPastDays(7),
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('[seed-demo] conta: %s | senha: %s | canal: %s', EMAIL, PASSWORD, DEMO.channelName);
  console.log('[seed-demo] conectando ao Mongo...');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // ---- Limpeza idempotente: remove QUALQUER resquício da conta demo (por
  //      e-mail, _id fixo, slug ou nome de canal) antes de reinserir, evitando
  //      colisões de índice único. Não toca dados de outras contas. ----------
  const existingUsers = await db
    .collection('users')
    .find({ $or: [{ email: EMAIL }, { _id: DEMO.userId }] })
    .project({ _id: 1 })
    .toArray();
  const existingUserIds = existingUsers.map((u) => u._id);

  const existingWs = await db
    .collection('workspaces')
    .find({
      $or: [
        { ownerUserId: { $in: existingUserIds } },
        { slug: 'demo' },
        { _id: DEMO.workspaceId },
      ],
    })
    .project({ _id: 1 })
    .toArray();
  const existingWsIds = existingWs.map((w) => w._id);
  const allWsIds = [DEMO.workspaceId, ...existingWsIds];

  await db.collection('memberships').deleteMany({
    $or: [{ userId: { $in: existingUserIds } }, { workspaceId: { $in: allWsIds } }],
  });
  await db.collection('workspaces').deleteMany({ _id: { $in: allWsIds } });
  await db.collection('users').deleteMany({ $or: [{ email: EMAIL }, { _id: DEMO.userId }] });
  await db.collection('channels').deleteMany({
    $or: [
      { _id: DEMO.channelId },
      { channel: DEMO.channelName },
      { ownerId: { $in: existingUserIds } },
    ],
  });
  const existingCreators = await db
    .collection('creators')
    .find({ $or: [{ workspaceId: { $in: allWsIds } }, { _id: DEMO.creatorId }] })
    .project({ _id: 1 })
    .toArray();
  const creatorIds = [DEMO.creatorId, ...existingCreators.map((c) => c._id)];
  await db.collection('creators').deleteMany({ _id: { $in: creatorIds } });
  await db.collection('creator_profiles').deleteMany({ creatorId: { $in: creatorIds } });
  await db.collection('channel_brands').deleteMany({ creatorId: { $in: creatorIds } });

  // ---- Identidade: user + workspace + membership + creator + canal --------
  await db.collection('users').insertOne({
    _id: DEMO.userId,
    username: EMAIL,
    email: EMAIL,
    password: passwordHash,
    role: 'admin',
    status: 'active',
    emailVerifiedAt: now,
    onboardingCompletedAt: now, // sem isso o OnboardingGuard bloqueia o dashboard
    displayName: DEMO.display,
    avatarUrl: null,
    locale: 'pt-BR',
  });
  await db.collection('workspaces').insertOne({
    _id: DEMO.workspaceId,
    name: DEMO.display,
    slug: 'demo',
    type: 'creator',
    ownerUserId: DEMO.userId,
    planKey: 'free',
    subscriptionStatus: 'active',
    subscriptionStartedAt: now,
    document: null,
    documentType: null,
    createdAt: now,
  });
  await db.collection('memberships').insertOne({
    _id: DEMO.membershipId,
    workspaceId: DEMO.workspaceId,
    userId: DEMO.userId,
    role: 'owner',
    status: 'active',
    invitedEmail: null,
    createdAt: now,
  });
  await db.collection('creators').insertOne({
    _id: DEMO.creatorId,
    workspaceId: DEMO.workspaceId,
    name: DEMO.display,
    slug: DEMO.channelName,
    status: 'active',
    createdAt: now,
  });
  await db.collection('creator_profiles').insertOne({
    _id: DEMO.profileId,
    creatorId: DEMO.creatorId,
    niche: 'games',
    category: 'FPS competitivo',
    subcategory: 'Valorant',
    genre: 'gameplay',
    audience: { ageRange: '18-24', mainCountry: 'BR' },
    tags: ['valorant', 'ranked', 'clutch'],
    completedAt: now,
    updatedAt: now,
  });
  await db.collection('channels').insertOne({
    _id: DEMO.channelId,
    channel: DEMO.channelName,
    channelWithPrefix: `#${DEMO.channelName}`,
    created_at: now,
    active: true,
    platform: 'twitch',
    externalId: DEMO.externalId,
    displayName: DEMO.display,
    ownerId: DEMO.userId,
    creatorId: DEMO.creatorId, // sem isso, Palavras-chave retorna []
    workspaceId: DEMO.workspaceId, // sem isso, o canal some do ChannelPicker
    flags: {},
    metadata: {},
    updatedAt: now,
  });
  console.log('[seed-demo] identidade criada (limpeza de %d conta(s) antiga(s))', existingUserIds.length);

  // ---- Mongo: dados do canal (chave channelId) ----------------------------
  const byChannelId = {
    batch_messages: buildBatchMessages(),
    channel_brands: buildChannelBrands(),
    live_sessions: buildLiveSessions(),
    ad_segments: buildAdSegmentsMongo(),
  };
  for (const [coll, docs] of Object.entries(byChannelId)) {
    await db.collection(coll).deleteMany({ channelId: DEMO.channelId });
    if (docs.length) await db.collection(coll).insertMany(docs);
    console.log(`[seed-demo] mongo ${coll}: ${docs.length} inseridos`);
  }

  // ---- Mongo: coleções legadas (chave = nome do canal) --------------------
  const byChannelName = {
    bans: buildBans(),
    timeouts: buildTimeouts(),
    messagedeleteds: buildRemovedMessages(),
    polls: buildPolls(),
    predictions: buildPredictions(),
    emojis: buildEmojis(),
  };
  for (const [coll, docs] of Object.entries(byChannelName)) {
    await db.collection(coll).deleteMany({ channel: DEMO.channelName });
    if (docs.length) await db.collection(coll).insertMany(docs);
    console.log(`[seed-demo] mongo ${coll}: ${docs.length} inseridos`);
  }

  // ---- ClickHouse ---------------------------------------------------------
  for (const table of ['batch_analysis', 'chat_messages', 'ad_segments']) {
    await chQuery(
      `ALTER TABLE ${CH_DB}.${table} DELETE WHERE channel_id = '${DEMO.channelId}' SETTINGS mutations_sync = 2`,
    );
  }
  const batchRows = buildBatchAnalysis();
  await chInsert('batch_analysis', batchRows);
  console.log(`[seed-demo] clickhouse batch_analysis: ${batchRows.length} inseridos`);
  const chatRows = buildChatMessagesCH();
  await chInsert('chat_messages', chatRows);
  console.log(`[seed-demo] clickhouse chat_messages: ${chatRows.length} inseridos`);
  const adRows = buildAdSegmentsCH();
  await chInsert('ad_segments', adRows);
  console.log(`[seed-demo] clickhouse ad_segments: ${adRows.length} inseridos`);

  await mongoose.disconnect();
  console.log('\n[seed-demo] CONCLUÍDO.');
  console.log('   login:  %s', EMAIL);
  console.log('   senha:  %s', PASSWORD);
  console.log('   canal:  %s (%s)', DEMO.channelName, DEMO.channelId);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[seed-demo] FALHOU:', err && err.message ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

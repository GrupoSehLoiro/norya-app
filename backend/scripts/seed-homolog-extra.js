#!/usr/bin/env node
/* eslint-disable */
/**
 * seed-homolog-extra.js — ADICIONA 3 contas de homolog (guilherme, geeo, roger)
 * com dados mockados de ponta a ponta, SEM tocar nas 5 contas do
 * seed-homolog.js. Escopado só a estas 3 identidades (limpa/insere apenas elas).
 *
 * Como rodar (na droplet): `cd infra/homolog && ./seed-extra.sh`
 *
 * Idempotente: pode rodar várias vezes. Mesma mecânica do seed-homolog.js.
 *
 * Env: MONGODB_URI, CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD,
 *      CLICKHOUSE_DB. Opcional: SEED_PASSWORD (default "norya12345").
 */

const { createRequire } = require('module');
const appRequire = createRequire('/app/apps/api/dist/main.js');
const bcrypt = appRequire('bcrypt');
const mongoose = appRequire('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const CH_URL = (process.env.CLICKHOUSE_URL || 'http://clickhouse:8123').replace(/\/$/, '');
const CH_USER = process.env.CLICKHOUSE_USER || 'default';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || '';
const CH_DB = process.env.CLICKHOUSE_DB || 'sehloro';
const PASSWORD = process.env.SEED_PASSWORD || 'norya12345';

if (!MONGODB_URI) {
  console.error('[seed] ERRO: MONGODB_URI ausente no ambiente.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Contas / canais demo EXTRAS (não sobrepõem as do seed-homolog.js).
// ---------------------------------------------------------------------------
const ACCOUNTS = [
  { local: 'guilherme', display: 'Guilherme', channelName: 'guilherme_live', externalId: '900000006' },
  { local: 'geeo',      display: 'Geeo',      channelName: 'geeo_tv',        externalId: '900000007' },
  { local: 'roger',     display: 'Roger',     channelName: 'roger_plays',    externalId: '900000008' },
].map((a) => ({
  ...a,
  email: `${a.local}@norya.com`,
  userId: `usr-${a.local}`,
  workspaceId: `ws-${a.local}`,
  membershipId: `mem-${a.local}`,
  channelId: `chan-${a.local}`,
}));

const CH_IDS = ACCOUNTS.map((a) => a.channelId);

// ---------------------------------------------------------------------------
// Dicionários pt-BR
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { id: 'jogabilidade', ctx: 'Chat comentando as jogadas da partida' },
  { id: 'humor', ctx: 'Chat brincando e mandando piada' },
  { id: 'elogio', ctx: 'Chat elogiando o streamer' },
  { id: 'reclamacao', ctx: 'Chat reclamando de lag/derrota' },
  { id: 'musica', ctx: 'Pedidos de música e reação ao beat' },
  { id: 'competitivo', ctx: 'Discussão sobre ranqueada e meta' },
  { id: 'interacao', ctx: 'Chat interagindo e fazendo perguntas' },
];
const BRANDS = ['Red Bull', 'Monster', 'Logitech', 'Razer', 'Coca-Cola', 'Nubank', 'KaBuM!', 'Amstel'];
const TOXIC = ['rage_kid', 'toxic_zzz', 'hater88', 'mimimi_br'];
const NICE = ['fan_number1', 'sempre_junto', 'positiva_br', 'vibe_boa'];
const CHATTERS = [
  'joao_gamer', 'maria99', 'pedrinho', 'lulzz', 'ana_flow', 'gabomaster', 'tvzin',
  'clip_lord', 'zeh', 'bimelol', 'duda_plays', 'rafa_tt', 'nina_gg', 'theo_br', 'carol',
];
const TOKENS = ['clutch', 'gg', 'valorant', 'kkkk', 'insano', 'sub', 'música', 'ranked', 'clipa', 'aim', 'meta', 'lag'];
const TEXTS = [
  'que clutch insano!', 'kkkkk chorei', 'vai perder assim mano', 'GG demais',
  'esse main ta voando', 'pede a música dj', 'ranqueada agora?', 'streamer cracudo demais',
  'n acredito nessa jogada', 'clipa isso aí', '+1 sub aqui', 'bom demais a live hj',
  'aim absurdo', 'toma esse ace', 'que lag foi esse', 'primeiro no chat pai',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const now = new Date();
const minsAgo = (m) => new Date(now.getTime() - m * 60000);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const round = (n, d = 3) => Number(n.toFixed(d));
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
// Geradores de dados
// ---------------------------------------------------------------------------
function buildBatchAnalysis(account) {
  const rows = [];
  for (let i = 0; i < 48; i++) {
    const windowStart = minsAgo(i * 30 + 2);
    const windowEnd = new Date(windowStart.getTime() + 15000);
    const pos = 0.35 + Math.random() * 0.4;
    const neg = 0.05 + Math.random() * 0.2;
    const neu = Math.max(0.05, 1 - pos - neg);
    const msgCount = randInt(40, 200);
    const cat = pick(CATEGORIES);
    const tier = pick([2, 2, 2, 1, 0]);
    const toxic = pick(TOXIC);
    const nice = pick(NICE);
    const hasBrand = Math.random() < 0.55;
    // AD ativo só na row mais recente do canal do "roger" (demo do card de AD).
    const adActive = account.local === 'roger' && i === 0;

    rows.push({
      channel_id: account.channelId,
      session_id: null,
      batch_id: crypto.randomUUID(),
      window_start: chDate(windowStart),
      window_end: chDate(windowEnd),
      message_count: msgCount,
      message_count_weighted: msgCount + randInt(0, 25),
      unique_users: Math.floor(msgCount * 0.6),
      is_subscriber_ratio: round(0.2 + Math.random() * 0.5),
      sentiment_pos: Math.round(pos * 1000),
      sentiment_neu: Math.round(neu * 1000),
      sentiment_neg: Math.round(neg * 1000),
      top_categories_json: JSON.stringify([
        { category: cat.id, count: Math.floor(msgCount * 0.4), context: cat.ctx },
        { category: 'interacao', count: Math.floor(msgCount * 0.12) },
      ]),
      dominant_category: cat.id,
      least_category: 'suporte',
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
      creator_id: '',
    });
  }
  return rows;
}

function buildChatMessages(account) {
  const rows = [];
  for (let i = 0; i < 50; i++) {
    const t = minsAgo(randInt(0, 60));
    rows.push({
      channel_id: account.channelId,
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
      creator_id: '',
    });
  }
  return rows;
}

function buildAdSegmentsCH(account) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const started = minsAgo(i * 240 + 30);
    const dur = randInt(90, 240);
    rows.push({
      channel_id: account.channelId,
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

function buildBatchMessages(account) {
  const docs = [];
  for (let i = 0; i < 12; i++) {
    const windowStart = minsAgo(i * 20 + 3);
    const windowEnd = new Date(windowStart.getTime() + 15000);
    const n = randInt(6, 12);
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
      channelId: account.channelId,
      windowStart,
      windowEnd,
      messages,
      messageCount: n,
      uniqueUsers: users.size,
      createdAt: windowStart,
    });
  }
  return docs;
}

function buildLiveSessions(account) {
  const docs = [];
  docs.push({
    _id: `sess-${account.local}-live`,
    channelId: account.channelId,
    platform: 'twitch',
    state: 'ACTIVE',
    title: `${account.display} jogando ranqueada`,
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
  for (let i = 1; i <= 4; i++) {
    const started = minsAgo(i * 1440 + 60);
    const ended = new Date(started.getTime() + randInt(90, 240) * 60000);
    docs.push({
      _id: `sess-${account.local}-${i}`,
      channelId: account.channelId,
      platform: 'twitch',
      state: 'ENDED',
      title: `${account.display} live #${i}`,
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

function buildChannelBrands(account) {
  return BRANDS.slice(0, 5).map((b) => ({
    channelId: account.channelId,
    creatorId: null,
    name: b,
    aliases: [b.toLowerCase()],
    regex: null,
    createdAt: now,
    updatedAt: now,
  }));
}

function buildAdSegmentsMongo(account) {
  const docs = [];
  for (let i = 0; i < 3; i++) {
    const started = minsAgo(i * 240 + 30);
    const dur = randInt(90, 240);
    docs.push({
      channelId: account.channelId,
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
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('[seed-extra] senha das contas:', PASSWORD);
  console.log('[seed-extra] conectando ao Mongo...');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Limpa QUALQUER conta pré-existente com estes e-mails/slugs/ids.
  const emails = ACCOUNTS.map((a) => a.email);
  const slugs = ACCOUNTS.map((a) => a.local);
  const userIds = ACCOUNTS.map((a) => a.userId);
  const wsIds = ACCOUNTS.map((a) => a.workspaceId);

  const existingUsers = await db
    .collection('users')
    .find({ $or: [{ email: { $in: emails } }, { _id: { $in: userIds } }] })
    .project({ _id: 1 })
    .toArray();
  const existingUserIds = existingUsers.map((u) => u._id);

  const existingWs = await db
    .collection('workspaces')
    .find({
      $or: [
        { ownerUserId: { $in: existingUserIds } },
        { slug: { $in: slugs } },
        { _id: { $in: wsIds } },
      ],
    })
    .project({ _id: 1 })
    .toArray();
  const existingWsIds = existingWs.map((w) => w._id);

  await db.collection('memberships').deleteMany({
    $or: [
      { userId: { $in: existingUserIds } },
      { workspaceId: { $in: [...wsIds, ...existingWsIds] } },
    ],
  });
  await db.collection('workspaces').deleteMany({ _id: { $in: [...wsIds, ...existingWsIds] } });
  await db.collection('users').deleteMany({
    $or: [{ email: { $in: emails } }, { _id: { $in: userIds } }],
  });
  await db.collection('channels').deleteMany({
    $or: [{ _id: { $in: CH_IDS } }, { ownerId: { $in: existingUserIds } }],
  });

  // Cria as contas fresh.
  const userDocs = [];
  const wsDocs = [];
  const memDocs = [];
  const chanDocs = [];
  for (const a of ACCOUNTS) {
    userDocs.push({
      _id: a.userId,
      username: a.email,
      email: a.email,
      password: passwordHash,
      role: 'admin',
      status: 'active',
      emailVerifiedAt: now,
      onboardingCompletedAt: now,
      displayName: a.display,
      avatarUrl: null,
      locale: 'pt-BR',
    });
    wsDocs.push({
      _id: a.workspaceId,
      name: a.display,
      slug: a.local,
      type: 'creator',
      ownerUserId: a.userId,
      planKey: 'free',
      subscriptionStatus: 'active',
      subscriptionStartedAt: now,
      document: null,
      documentType: null,
      createdAt: now,
    });
    memDocs.push({
      _id: a.membershipId,
      workspaceId: a.workspaceId,
      userId: a.userId,
      role: 'owner',
      status: 'active',
      invitedEmail: null,
      createdAt: now,
    });
    chanDocs.push({
      _id: a.channelId,
      channel: a.channelName,
      channelWithPrefix: `#${a.channelName}`,
      created_at: now,
      active: true,
      platform: 'twitch',
      externalId: a.externalId,
      displayName: a.display,
      ownerId: a.userId,
      creatorId: null,
      workspaceId: a.workspaceId,
      flags: {},
      metadata: {},
      updatedAt: now,
    });
  }
  await db.collection('users').insertMany(userDocs);
  await db.collection('workspaces').insertMany(wsDocs);
  await db.collection('memberships').insertMany(memDocs);
  await db.collection('channels').insertMany(chanDocs);
  console.log(`[seed-extra] contas/canais: ${ACCOUNTS.length} criados (limpeza de ${existingUserIds.length} conta(s) antiga(s))`);

  // Mongo: limpa dados-demo antigos destes canais e reinsere.
  const mongoData = {
    batch_messages: [],
    live_sessions: [],
    channel_brands: [],
    ad_segments: [],
  };
  for (const a of ACCOUNTS) {
    mongoData.batch_messages.push(...buildBatchMessages(a));
    mongoData.live_sessions.push(...buildLiveSessions(a));
    mongoData.channel_brands.push(...buildChannelBrands(a));
    mongoData.ad_segments.push(...buildAdSegmentsMongo(a));
  }
  for (const [coll, docs] of Object.entries(mongoData)) {
    await db.collection(coll).deleteMany({ channelId: { $in: CH_IDS } });
    if (docs.length) await db.collection(coll).insertMany(docs);
    console.log(`[seed-extra] mongo ${coll}: ${docs.length} inseridos`);
  }

  // ClickHouse: limpa dados-demo antigos e reinsere.
  const idList = CH_IDS.map((c) => `'${c}'`).join(',');
  for (const table of ['batch_analysis', 'chat_messages', 'ad_segments']) {
    await chQuery(
      `ALTER TABLE ${CH_DB}.${table} DELETE WHERE channel_id IN (${idList}) SETTINGS mutations_sync = 2`,
    );
  }

  const batchRows = [];
  const chatRows = [];
  const adRows = [];
  for (const a of ACCOUNTS) {
    batchRows.push(...buildBatchAnalysis(a));
    chatRows.push(...buildChatMessages(a));
    adRows.push(...buildAdSegmentsCH(a));
  }
  await chInsert('batch_analysis', batchRows);
  console.log(`[seed-extra] clickhouse batch_analysis: ${batchRows.length} inseridos`);
  await chInsert('chat_messages', chatRows);
  console.log(`[seed-extra] clickhouse chat_messages: ${chatRows.length} inseridos`);
  await chInsert('ad_segments', adRows);
  console.log(`[seed-extra] clickhouse ad_segments: ${adRows.length} inseridos`);

  await mongoose.disconnect();
  console.log('\n[seed-extra] CONCLUÍDO. Contas (senha "%s"):', PASSWORD);
  for (const a of ACCOUNTS) console.log(`   - ${a.email}  (canal ${a.channelName})`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[seed-extra] FALHOU:', err && err.message ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

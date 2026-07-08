// Seed de eventos de moderacao: bans, timeouts, mensagens deletadas.
// Distribui aleatoriamente entre os 5 canais semeados, ultimos 30 dias.

const { Ban, Timeout, MessageDeleted } = require('./_models');
const { CANAIS } = require('./seed-channels');

const MODS = ['mod_carla', 'mod_diego', 'mod_yuri', 'admin_sehloiro'];
const USERS_PROBLEMA = [
  'troll_anonimo', 'spam_bot42', 'haterxx', 'cheaterDetect', 'discordia',
  'rage_quit', 'tilted_one', 'badmood', 'ghostuser', 'leaver_fc'
];
const REASONS_BAN = [
  'spam reincidente', 'discurso de odio', 'ameaca a outros viewers',
  'divulgacao de cheat', 'flood persistente', 'leak de informacao pessoal',
  'comportamento toxico apos avisos', 'evasao de timeout anterior'
];
const REASONS_TO = [
  'caps lock excessivo', 'palavrao em portugues', 'palavrao em ingles',
  'spam de emote', 'link nao autorizado', 'flood', 'discussao acalorada',
  'ofensa a outro viewer'
];
const TO_DURATIONS = [60, 300, 600, 1800, 3600, 86400]; // 1min, 5min, 10min, 30min, 1h, 1d
const DELETED_MSGS = [
  'olha o cheater no time', 'esse stream ta horrivel kkk',
  'segue meu canal', 'da look no meu /w', 'noob detected',
  'muta esse cara', 'aiaiai que jogada feia', 'esse jogo e pago pra perder',
  'vai jogar ranked sai daqui', 'cringe demais essa play'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomTimestampLast30d() {
  const now = Date.now();
  const past = now - 30 * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

async function seedModeration() {
  await Promise.all([
    Ban.deleteMany({}),
    Timeout.deleteMany({}),
    MessageDeleted.deleteMany({})
  ]);

  // 60 bans, 200 timeouts, 350 mensagens deletadas
  const bans = Array.from({ length: 60 }, () => ({
    channel: pick(CANAIS),
    userName: pick(USERS_PROBLEMA) + Math.floor(Math.random() * 100),
    reason: pick(REASONS_BAN),
    modName: pick(MODS),
    timestamp: randomTimestampLast30d()
  }));

  const timeouts = Array.from({ length: 200 }, () => ({
    channel: pick(CANAIS),
    userName: pick(USERS_PROBLEMA) + Math.floor(Math.random() * 100),
    reason: pick(REASONS_TO),
    tempoDeTO: pick(TO_DURATIONS),
    modName: pick(MODS),
    timestamp: randomTimestampLast30d()
  }));

  const deleted = Array.from({ length: 350 }, () => ({
    channel: pick(CANAIS),
    username: pick(USERS_PROBLEMA) + Math.floor(Math.random() * 100),
    deletedMessage: pick(DELETED_MSGS),
    timestamp: randomTimestampLast30d()
  }));

  const [b, t, d] = await Promise.all([
    Ban.insertMany(bans),
    Timeout.insertMany(timeouts),
    MessageDeleted.insertMany(deleted)
  ]);

  return { bans: b.length, timeouts: t.length, deleted: d.length };
}

module.exports = seedModeration;

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('[seed] MONGODB_URI ausente'); process.exit(1); }
  (async () => {
    await mongoose.connect(uri);
    const r = await seedModeration();
    console.log('[seed] moderation:', r);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error('[seed] falha moderation:', e.message); process.exit(1); });
}

// Entrypoint dos seeds — roda todos em sequência.
// Uso: `npm start` ou `node seed-all.js` (com MONGODB_URI no env / .env).
// IMPORTANTE: cada seed derruba sua collection antes de inserir (idempotente).

require('dotenv').config();
const mongoose = require('mongoose');

const seedUsers       = require('./seed-users');
const seedChannels    = require('./seed-channels');
const seedSentiment   = require('./seed-sentiment');
const seedCategories  = require('./seed-categories');
const seedChatSample  = require('./seed-chat-sample');
const seedModeration  = require('./seed-moderation');
const seedEngagement  = require('./seed-engagement');
const seedEmojis      = require('./seed-emojis');
const seedLogs        = require('./seed-logs');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[seed] ERRO: variável de ambiente MONGODB_URI não está definida. Configure antes de rodar os seeds.');
    process.exit(1);
  }

  console.log('[seed] conectando ao MongoDB...');
  await mongoose.connect(uri);
  console.log('[seed] conectado.');

  // Ordem: canais antes de chat-sample e sentiment (ambos consomem CANAIS).
  const totalUsers       = await seedUsers();
  console.log(`[seed] users: ${totalUsers} criados`);

  const totalChannels    = await seedChannels();
  console.log(`[seed] channels: ${totalChannels} criados`);

  const totalSentiment   = await seedSentiment();
  console.log(`[seed] sentimentConfiguration: ${totalSentiment} criados`);

  const totalCategories  = await seedCategories();
  console.log(`[seed] categoryConfiguration: ${totalCategories} criados`);

  const totalChatSample  = await seedChatSample();
  console.log(`[seed] chat-sample (socialListening): ${totalChatSample} criados`);

  const moderation       = await seedModeration();
  console.log(`[seed] moderation: ${moderation.bans} bans, ${moderation.timeouts} timeouts, ${moderation.deleted} mensagens deletadas`);

  const engagement       = await seedEngagement();
  console.log(`[seed] engagement: ${engagement.predictions} predictions, ${engagement.polls} polls`);

  const totalEmojis      = await seedEmojis();
  console.log(`[seed] emojis: ${totalEmojis} criados`);

  const logs             = await seedLogs();
  console.log(`[seed] logs: ${logs.systemLogs} sistema, ${logs.modEvents} eventos de mod`);

  await mongoose.disconnect();
  console.log('[seed] desconectado. Seed concluído com sucesso.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[seed] falha geral ao rodar seed-all:', err && err.message ? err.message : err);
  try { await mongoose.disconnect(); } catch (_) { /* noop */ }
  process.exit(1);
});

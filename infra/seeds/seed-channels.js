// Seed de canais — 5 canais fixos.
// Schemas redeclarados inline em _models.js (evita acoplamento com SLMOD-api/node_modules).
// Campos seguem SLMOD-api/api/models/channel.model.js.

const { Channel } = require('./_models');

const CANAIS = ['rogerbatt', 'gabsscheidt', 'valorant', 'valorant_br', 'riotgames'];

async function seedChannels() {
  // Idempotente: só apaga os canais do SEED (legacy ObjectId, fixos),
  // preserva canais criados via OAuth/v2 API (string UUID _id, com
  // externalId / ownerId preenchidos). Senão toda vez que o operador
  // recicla o nest-api, os canais OAuth'd somem.
  await Channel.deleteMany({ channel: { $in: CANAIS }, externalId: { $exists: false } });

  // Insere só os que não existem (idempotente em re-runs).
  const docs = CANAIS.map((nome) => ({
    channel: nome,
    channelWithPrefix: `#${nome}`,
    active: true,
    created_at: new Date()
  }));

  // upsert-mode: cada canal é inserido se não existe; existentes ficam.
  let inseridos = 0;
  for (const doc of docs) {
    const r = await Channel.updateOne(
      { channel: doc.channel, externalId: { $exists: false } },
      { $setOnInsert: doc },
      { upsert: true },
    );
    if (r.upsertedCount) inseridos++;
  }
  return inseridos;
}

module.exports = seedChannels;
module.exports.CANAIS = CANAIS;

// Execução direta via `node seed-channels.js`
if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[seed] ERRO: variável de ambiente MONGODB_URI não está definida. Configure antes de rodar os seeds.');
    process.exit(1);
  }

  (async () => {
    await mongoose.connect(uri);
    const qtd = await seedChannels();
    console.log(`[seed] channels: ${qtd} criados`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] falha ao rodar seed-channels:', err.message);
    process.exit(1);
  });
}

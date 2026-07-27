/**
 * migrate-channel-brands-creator.js (migração 003) — migra a allowlist de
 * marcas do eixo `channelId` para `creatorId`.
 *
 * Motivo: a marca é INDIVIDUAL do criador, não do canal. Como a mesma conta de
 * plataforma pode ser reaproveitada por donos diferentes (o OAuth reusa o mesmo
 * `_id` de canal), escopar por `channelId` vazava as marcas de um usuário para
 * outro. Depois desta migração a listagem/detecção operam por `creatorId`.
 *
 * O que faz (idempotente):
 *   1. Backfill: para cada doc de `channel_brands` sem `creatorId`, resolve o
 *      `creators.workspaceId`→ na verdade o `channels.creatorId` do `channelId`
 *      e carimba em `creatorId`.
 *   2. Índices: derruba o índice único legado `{ channelId, name }` e garante o
 *      novo `{ creatorId, name }` único.
 *   3. Órfãos: reporta (não apaga) docs que ficaram sem `creatorId` — canal sem
 *      creator vinculado. Ficam invisíveis à listagem por creator até serem
 *      recategorizados manualmente.
 *
 * Uso (mesmo padrão dos seeds — dentro da imagem do nest-api):
 *   docker compose run --rm --no-deps \
 *     -v "$PWD/../../backend/scripts/migrate-channel-brands-creator.js:/seed/migrate.js:ro" \
 *     nest-api node /seed/migrate.js
 *
 * Requer: MONGODB_URI no environment.
 */
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI ausente');
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const brands = db.collection('channel_brands');
  const channels = db.collection('channels');

  // 1. Backfill creatorId a partir do channelId ------------------------------
  const pending = await brands
    .find({ $or: [{ creatorId: null }, { creatorId: { $exists: false } }] })
    .toArray();
  console.log(`[003] docs sem creatorId: ${pending.length}`);

  // Cache channelId → creatorId (poucos canais).
  const cache = new Map();
  let stamped = 0;
  let orphans = 0;
  for (const doc of pending) {
    if (!doc.channelId) {
      orphans += 1;
      continue;
    }
    let creatorId = cache.get(doc.channelId);
    if (creatorId === undefined) {
      const ch = await channels.findOne({ _id: doc.channelId });
      creatorId = ch?.creatorId ?? null;
      cache.set(doc.channelId, creatorId);
    }
    if (!creatorId) {
      orphans += 1;
      continue;
    }
    await brands.updateOne({ _id: doc._id }, { $set: { creatorId } });
    stamped += 1;
  }
  console.log(`[003] carimbados: ${stamped}; órfãos (canal sem creator): ${orphans}`);

  // 2. Índices ---------------------------------------------------------------
  const idx = await brands.indexes();
  for (const i of idx) {
    // Índice legado por canal: pode se chamar 'channelId_1_name_1'.
    const keys = Object.keys(i.key || {});
    if (keys.length === 2 && i.key.channelId === 1 && i.key.name === 1) {
      await brands.dropIndex(i.name);
      console.log(`[003] índice legado derrubado: ${i.name}`);
    }
  }
  await brands.createIndex({ creatorId: 1, name: 1 }, { unique: true });
  console.log('[003] índice único garantido: { creatorId, name }');

  console.log('[003] concluído.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[003] erro:', err);
  process.exit(1);
});

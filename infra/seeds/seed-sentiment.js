// Seed de sentimentConfiguration — 3 entradas por canal (positive/negative/neutral).
// Convenção observada no Bot_SocialListening: name = 'positive__<canal>', 'negative__<canal>', 'neutral__<canal>'.
// Schemas redeclarados inline em _models.js. Campos seguem
// SLMOD-api/api/models/sentimentConfiguration.model.js.

const { SentimentConfiguration } = require('./_models');
const { CANAIS } = require('./seed-channels');

const KEYWORDS_POSITIVAS = [
  'pog', 'clutch', 'ace', 'gg', 'ez', 'brabo', 'monstro', 'goat',
  'topzera', 'arrepiei', 'insano', 'cracudo', 'fenomeno', 'show', 'incrivel'
];

const KEYWORDS_NEGATIVAS = [
  'cringe', 'cheater', 'tilt', 'flopou', 'lixo', 'troll', 'noob', 'ruim',
  'horror', 'travou', 'chato', 'fraco', 'toxico', 'odeio', 'pessimo'
];

const KEYWORDS_NEUTRAS = [
  'kkkk', 'hmmm', 'beleza', 'oi', 'cheguei', 'volto', 'pausa', 'alguem',
  'mapa', 'primeira', 'olhando', 'tranquilo', 'normal', 'ok', 'entendi'
];

async function seedSentiment() {
  await SentimentConfiguration.deleteMany({});

  const docs = [];
  for (const canal of CANAIS) {
    docs.push({ name: `positive__${canal}`, keywords: KEYWORDS_POSITIVAS });
    docs.push({ name: `negative__${canal}`, keywords: KEYWORDS_NEGATIVAS });
    docs.push({ name: `neutral__${canal}`,  keywords: KEYWORDS_NEUTRAS  });
  }

  const inseridos = await SentimentConfiguration.insertMany(docs);
  return inseridos.length;
}

module.exports = seedSentiment;

// Execução direta via `node seed-sentiment.js`
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
    const qtd = await seedSentiment();
    console.log(`[seed] sentimentConfiguration: ${qtd} criados`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] falha ao rodar seed-sentiment:', err.message);
    process.exit(1);
  });
}

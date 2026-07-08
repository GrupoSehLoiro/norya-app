// Seed de categoryConfiguration — 5 categorias x 5 canais (sufixo `__<canal>`).
// A SPA (botPage.tsx) filtra categorias por sufixo do nome, entao cada canal
// precisa ter o seu proprio set para aparecer nos cards de configuracao.
// Schemas redeclarados inline em _models.js.

const { CategoryConfig } = require('./_models');
const { CANAIS } = require('./seed-channels');

const CATEGORIAS_BASE = [
  {
    name: 'reclamacao',
    keywords: ['reclamando', 'reclamar', 'problema', 'bug', 'travou', 'lag', 'ping alto', 'servidor ruim']
  },
  {
    name: 'elogio',
    keywords: ['parabens', 'lindo', 'incrivel', 'top', 'brabo', 'monstro', 'goat', 'show']
  },
  {
    name: 'duvida',
    keywords: ['como', 'por que', 'quando', 'onde', 'alguem sabe', 'qual', '?']
  },
  {
    name: 'toxicidade',
    keywords: ['lixo', 'burro', 'idiota', 'bot', 'noob', 'cheater', 'fraude', 'trash']
  },
  {
    name: 'hype',
    keywords: ['vamo', 'bora', 'hype', 'let\'s go', 'pog', 'clutch', 'ace', 'eita']
  }
];

async function seedCategories() {
  await CategoryConfig.deleteMany({});
  // 5 categorias x 5 canais = 25 docs, cada um com sufixo `__<canal>`.
  const docs = CANAIS.flatMap((canal) =>
    CATEGORIAS_BASE.map((cat) => ({
      name: `${cat.name}__${canal}`,
      keywords: cat.keywords
    }))
  );
  const inseridos = await CategoryConfig.insertMany(docs);
  return inseridos.length;
}

module.exports = seedCategories;

// Execução direta via `node seed-categories.js`
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
    const qtd = await seedCategories();
    console.log(`[seed] categoryConfiguration: ${qtd} criados`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] falha ao rodar seed-categories:', err.message);
    process.exit(1);
  });
}

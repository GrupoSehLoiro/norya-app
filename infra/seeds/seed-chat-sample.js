// Seed de amostras de chat em socialListening — 500 linhas distribuídas nos 5 canais.
// Schemas redeclarados inline em _models.js (evita acoplamento com SLMOD-api/node_modules).
// Campos seguem SLMOD-api/api/models/socialListening.model.js EXATAMENTE:
//   channel, username, category, message, sentiment, isSubscriber,
//   palavraCapturada, mensagemSentimento, timestamp.

const { SocialListening } = require('./_models');
const { CANAIS } = require('./seed-channels');

const TOTAL = 500;

// Gírias / expressões pt-BR típicas de chat Twitch brasileiro + emotes globais.
const POSITIVAS = [
  'pog', 'clutch', 'ace', 'gg', 'ez', 'que jogada mano', 'brabo', 'monstro',
  'goat', 'topzera', 'arrepiei', 'que lindo', 'insano', 'cracudo', 'fenomeno'
];
const NEGATIVAS = [
  'cringe', 'cheater', 'tilt', 'flopou', 'lixo', 'mermao pare', 'troll',
  'noob', 'ruim demais', 'que horror', 'travou tudo', 'sem graça',
  'chato', 'fraco', 'toxico'
];
const NEUTRAS = [
  'kkkk', 'hmmm', 'beleza', 'oi pessoal', 'to acompanhando', 'cheguei agora',
  'qual o jogo?', 'boa noite galera', 'vou comer algo', 'ja volto',
  'pausa pra agua', 'alguem sabe o rank?', 'que mapa e esse', 'primeira vez aqui',
  'so olhando'
];
const EMOTES_POSITIVOS = ['Kappa', 'PogChamp', 'EZ Clap'];
const EMOTES_NEGATIVOS = ['LUL', 'OMEGALUL'];
const EMOTES_NEUTROS = ['Kappa'];

const USERS = [
  'zecaxv', 'mariasp', 'tuquinha', 'biel_ttv', 'lipekzera', 'duda_gamer',
  'pedroh2k', 'ana_clip', 'gustavoh', 'fernanda.ttv', 'thiagoz', 'julinha',
  'matheuslol', 'rafinhapog', 'camilaaa', 'leozin_br', 'brunops', 'yasmin_ttv',
  'diegofps', 'clarinhaa', 'renan_rj', 'larissapog', 'viniciusaim', 'carol_gg'
];

const CATEGORIAS = ['reclamacao', 'elogio', 'duvida', 'toxicidade', 'hype'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function montaMensagem(sentimento) {
  let palavra;
  let emote;
  if (sentimento === 'positive') {
    palavra = pick(POSITIVAS);
    emote = pick(EMOTES_POSITIVOS);
  } else if (sentimento === 'negative') {
    palavra = pick(NEGATIVAS);
    emote = pick(EMOTES_NEGATIVOS);
  } else {
    palavra = pick(NEUTRAS);
    emote = pick(EMOTES_NEUTROS);
  }

  // Variação: algumas mensagens tem emote, outras nao.
  const temEmote = Math.random() < 0.55;
  const message = temEmote ? `${palavra} ${emote}` : palavra;

  // "palavraCapturada" = token que disparou a classificação.
  // "mensagemSentimento" = frase formatada que o bot costuma logar.
  const palavraCapturada = palavra.split(' ')[0];
  const mensagemSentimento = `detectado ${sentimento} via "${palavraCapturada}"`;

  return { message, palavraCapturada, mensagemSentimento };
}

function distribuicaoSentimento(i) {
  // ~40% positive, ~40% negative, ~20% neutral
  const m = i % 10;
  if (m < 4) return 'positive';
  if (m < 8) return 'negative';
  return 'neutral';
}

async function seedChatSample() {
  await SocialListening.deleteMany({});

  const agora = Date.now();
  const docs = [];

  for (let i = 0; i < TOTAL; i++) {
    const sentiment = distribuicaoSentimento(i);
    const canal = CANAIS[i % CANAIS.length];
    const { message, palavraCapturada, mensagemSentimento } = montaMensagem(sentiment);

    // timestamps distribuídos nas últimas ~24h
    const offsetMs = Math.floor(Math.random() * 24 * 60 * 60 * 1000);
    const timestamp = new Date(agora - offsetMs);

    docs.push({
      channel: canal,
      username: pick(USERS),
      category: pick(CATEGORIAS),
      message,
      sentiment,
      isSubscriber: Math.random() < 0.3,
      palavraCapturada,
      mensagemSentimento,
      timestamp
    });
  }

  const inseridos = await SocialListening.insertMany(docs);
  return inseridos.length;
}

module.exports = seedChatSample;

// Execução direta via `node seed-chat-sample.js`
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
    const qtd = await seedChatSample();
    console.log(`[seed] chat-sample (socialListening): ${qtd} criados`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] falha ao rodar seed-chat-sample:', err.message);
    process.exit(1);
  });
}

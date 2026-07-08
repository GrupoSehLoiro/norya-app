// Seed de predictions e polls — eventos de engajamento da live.

const { Prediction, Poll } = require('./_models');
const { CANAIS } = require('./seed-channels');

const PRED_TITLES = [
  'Vai vencer a primeira partida?', 'Mais de 15 kills no Valorant?',
  'Termina a live antes das 22h?', 'Ace na proxima ranked?',
  'Vence sem morrer na lane?', 'Chega ao Imortal essa semana?'
];
const PRED_OUTCOMES = [['Sim', 'Nao'], ['Win', 'Loss'], ['Acima', 'Abaixo']];
const POLL_TITLES = [
  'Qual mapa jogar agora?', 'Proxima ranked ou casual?',
  'Faz pausa de 10min?', 'Convida quem pra duo?', 'Joga ate que horas?',
  'Qual agente escolher?'
];
const POLL_CHOICES = [
  ['Ascent', 'Bind', 'Haven', 'Split'],
  ['Ranked', 'Casual', 'Custom'],
  ['5min', '10min', '15min'],
  ['Jett', 'Reyna', 'Phoenix', 'Sage'],
  ['Sim', 'Nao'],
  ['22h', '23h', '00h', 'ate cair']
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randPast30d() {
  const now = Date.now();
  return new Date(now - Math.random() * 30 * 24 * 60 * 60 * 1000);
}
function randId() {
  return Math.random().toString(36).slice(2, 12);
}

async function seedEngagement() {
  await Promise.all([Prediction.deleteMany({}), Poll.deleteMany({})]);

  // 25 predictions
  const predictions = Array.from({ length: 25 }, () => {
    const created = randPast30d();
    const ended = new Date(created.getTime() + (5 + Math.random() * 25) * 60000);
    const outcomes = pick(PRED_OUTCOMES);
    const totalA = Math.floor(Math.random() * 50000) + 1000;
    const totalB = Math.floor(Math.random() * 50000) + 1000;
    // A SPA encontra a vencedora por `option.id === winningOutcome`, entao
    // gere os ids antes e use o id da vencedora em winningOutcome.
    const optionsWithIds = outcomes.map((title, i) => ({
      id: randId(),
      title,
      totalBetAmount: i === 0 ? totalA : totalB,
      users: Math.floor(Math.random() * 200) + 10,
      topBetters: Array.from({ length: 3 }, () => ({
        userName: 'better_' + Math.random().toString(36).slice(2, 8),
        amount: Math.floor(Math.random() * 5000) + 100
      }))
    }));
    const winner = pick(optionsWithIds);
    return {
      predictionId: randId(),
      channel: pick(CANAIS),
      title: pick(PRED_TITLES),
      winningOutcome: winner.id,
      created_at: created,
      locked_at: new Date(created.getTime() + 60000),
      ended_at: ended,
      // Janela em segundos — campo lido pela SPA (prediction.prediction_window).
      prediction_window: Math.floor((ended.getTime() - created.getTime()) / 1000),
      options: optionsWithIds
    };
  });

  // 30 polls
  const polls = Array.from({ length: 30 }, () => {
    const created = randPast30d();
    const duration = pick([60, 120, 300, 600]);
    const choices = pick(POLL_CHOICES);
    return {
      pollId: randId(),
      channel: pick(CANAIS),
      title: pick(POLL_TITLES),
      created_at: created,
      ended_at: new Date(created.getTime() + duration * 1000),
      duration,
      choices: choices.map((title) => ({
        id: randId(),
        title,
        votes: Math.floor(Math.random() * 500),
        channel_points_votes: Math.floor(Math.random() * 200),
        bits_votes: Math.floor(Math.random() * 50)
      })),
      bits_voting_enabled: Math.random() > 0.5,
      bits_per_vote: 10,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 100
    };
  });

  const [p, q] = await Promise.all([
    Prediction.insertMany(predictions),
    Poll.insertMany(polls)
  ]);

  return { predictions: p.length, polls: q.length };
}

module.exports = seedEngagement;

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('[seed] MONGODB_URI ausente'); process.exit(1); }
  (async () => {
    await mongoose.connect(uri);
    const r = await seedEngagement();
    console.log('[seed] engagement:', r);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error('[seed] falha engagement:', e.message); process.exit(1); });
}

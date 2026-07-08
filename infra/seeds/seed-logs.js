// Seed de logs do sistema (Log) e logs de eventos de mod (LogEventMod).

const { Log, LogEventMod } = require('./_models');
const { CANAIS } = require('./seed-channels');

const SYS_LOGS = [
  { type: 'info', title: 'Bot conectado ao canal', description: 'Conexao IRC estabelecida com sucesso.' },
  { type: 'info', title: 'Live iniciada', description: 'Stream ficou online e o bot comecou a monitorar.' },
  { type: 'info', title: 'Live finalizada', description: 'Stream ficou offline. Encerrando coleta.' },
  { type: 'warning', title: 'Reconexao IRC', description: 'Conexao caiu, reconectando automaticamente em 5s.' },
  { type: 'warning', title: 'Quota Helix proxima do limite', description: 'Uso atual em 85% do quota da janela.' },
  { type: 'error', title: 'Falha ao salvar prediction', description: 'Mongo timeout durante insert. Tentativa 1 de 3.' },
  { type: 'error', title: 'Token Twitch invalido', description: 'Refresh token expirou. Streamer precisa reautorizar.' },
  { type: 'debug', title: 'Heartbeat worker', description: 'Worker reportou heartbeat para o orchestrator.' }
];
const MOD_ACTIONS = ['ban', 'timeout', 'unban', 'untimeout', 'message_deleted', 'channel_clear'];
const MODS = ['mod_carla', 'mod_diego', 'mod_yuri', 'admin_sehloiro'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randPast14d() {
  return new Date(Date.now() - Math.random() * 14 * 24 * 60 * 60 * 1000);
}

async function seedLogs() {
  await Promise.all([Log.deleteMany({}), LogEventMod.deleteMany({})]);

  // 80 logs de sistema
  const sys = Array.from({ length: 80 }, () => {
    const tpl = pick(SYS_LOGS);
    return {
      type: tpl.type,
      title: tpl.title,
      description: tpl.description,
      timestamp: randPast14d(),
      emailSent: tpl.type === 'error' ? Math.random() > 0.5 : false,
      source: pick(['API', 'Worker', 'Bot', 'Orchestrator']),
      channel: Math.random() > 0.3 ? pick(CANAIS) : ''
    };
  });

  // 150 eventos de mod
  const modEvents = Array.from({ length: 150 }, () => {
    const action = pick(MOD_ACTIONS);
    const target = 'user_' + Math.floor(Math.random() * 999);
    return {
      user: target,
      action,
      date: randPast14d(),
      mod: pick(MODS),
      messageLog: `${pick(MODS)} aplicou ${action} em ${target}`
    };
  });

  const [a, b] = await Promise.all([Log.insertMany(sys), LogEventMod.insertMany(modEvents)]);
  return { systemLogs: a.length, modEvents: b.length };
}

module.exports = seedLogs;

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('[seed] MONGODB_URI ausente'); process.exit(1); }
  (async () => {
    await mongoose.connect(uri);
    const r = await seedLogs();
    console.log('[seed] logs:', r);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error('[seed] falha logs:', e.message); process.exit(1); });
}

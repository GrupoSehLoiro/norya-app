// Seed de uso de emojis no chat. ~400 amostras.

const { Emoji } = require('./_models');
const { CANAIS } = require('./seed-channels');

const USERS = [
  'viewer_carlos', 'subgirl42', 'rsr_dev', 'jogadorx', 'nina_streams',
  'fabio_lol', 'pati_hype', 'anon_99', 'kappa_lover', 'pog_fan',
  'mario_88', 'subzeroX', 'fabricio_oc', 'helena_z', 'lucas_clip'
];
const EMOJIS_TWITCH = ['Kappa', 'PogChamp', 'KEKW', 'LULW', 'OMEGALUL', 'Sadge', 'monkaS', 'EZ', 'WIDEPEEPOHAPPY', 'catJAM'];
const EMOJIS_UNICODE = ['🔥', '😂', '😭', '💀', '🎉', '👏', '🤔', '😱', '🥶', '💯', '👀', '😎'];
const MSG_TEMPLATES = [
  'que play {emoji}', 'tava esperando isso {emoji}{emoji}', '{emoji} clipa essa',
  'ai sim {emoji}', 'sem chance {emoji}', 'gg {emoji}', 'no clutch {emoji}',
  'ranked diff {emoji}', 'pog {emoji}', 'cringe {emoji}'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randPast7d() {
  return new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000);
}

async function seedEmojis() {
  await Emoji.deleteMany({});

  const docs = Array.from({ length: 400 }, () => {
    const useTwitchEmote = Math.random() > 0.4;
    const emo = useTwitchEmote ? pick(EMOJIS_TWITCH) : pick(EMOJIS_UNICODE);
    const tpl = pick(MSG_TEMPLATES);
    return {
      channel: pick(CANAIS),
      username: pick(USERS),
      message: tpl.replaceAll('{emoji}', emo),
      emoji: emo,
      timestamp: randPast7d()
    };
  });

  const r = await Emoji.insertMany(docs);
  return r.length;
}

module.exports = seedEmojis;

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('[seed] MONGODB_URI ausente'); process.exit(1); }
  (async () => {
    await mongoose.connect(uri);
    const n = await seedEmojis();
    console.log('[seed] emojis:', n);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => { console.error('[seed] falha emojis:', e.message); process.exit(1); });
}

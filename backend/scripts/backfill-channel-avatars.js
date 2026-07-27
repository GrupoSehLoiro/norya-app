/**
 * backfill-channel-avatars.js — preenche `profileImageUrl` nos channels
 * Twitch existentes via Helix (GET /users?login=...), usando App Access Token
 * (client credentials). Canais Kick/sem match ficam sem foto (o console cai
 * no monograma).
 *
 * Uso (mesmo padrão dos seeds — dentro da imagem do nest-api):
 *   docker compose run --rm --no-deps \
 *     -v "$PWD/../../backend/scripts/backfill-channel-avatars.js:/seed/backfill.js:ro" \
 *     nest-api node /seed/backfill.js
 *
 * Requer: MONGODB_URI, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET no environment.
 * Idempotente: só toca canais twitch sem profileImageUrl.
 */
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

async function appToken() {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI ausente');
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('[backfill] TWITCH_CLIENT_ID/SECRET ausentes — nada a fazer.');
    return;
  }
  await mongoose.connect(MONGODB_URI);
  const col = mongoose.connection.db.collection('channels');
  const pending = await col
    .find({ platform: 'twitch', profileImageUrl: { $in: [null, undefined, ''] } })
    .toArray();
  if (pending.length === 0) {
    console.log('[backfill] nenhum canal twitch sem foto.');
    await mongoose.disconnect();
    return;
  }
  const token = await appToken();
  let ok = 0;
  // Helix aceita até 100 logins por request; volume aqui é pequeno — 1 a 1
  // simplifica o tratamento de canal inexistente.
  for (const ch of pending) {
    const login = ch.channel;
    const res = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
      { headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.log(`[backfill] ${login}: HTTP ${res.status} — pulando`);
      continue;
    }
    const user = (await res.json()).data?.[0];
    if (!user?.profile_image_url) {
      console.log(`[backfill] ${login}: sem match na Helix — pulando`);
      continue;
    }
    await col.updateOne({ _id: ch._id }, { $set: { profileImageUrl: user.profile_image_url } });
    ok += 1;
    console.log(`[backfill] ${login}: foto preenchida`);
  }
  console.log(`[backfill] concluído — ${ok}/${pending.length} canais atualizados.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[backfill] erro:', err);
  process.exit(1);
});

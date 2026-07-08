// Seed de usuários — 1 admin + 2 users comuns.
// Schemas redeclarados inline em _models.js para evitar acoplamento com
// SLMOD-api/node_modules. Campos seguem SLMOD-api/api/models/user.model.js.

const bcrypt = require('bcrypt');
const { User } = require('./_models');

const SALT_ROUNDS = 10;

const USUARIOS = [
  {
    username: 'admin_sehloiro',
    email: 'admin@sehloiro.dev',
    password: 'admin123',
    role: 'admin'
  },
  {
    username: 'moderador_ana',
    email: 'ana.moderacao@sehloiro.dev',
    password: 'mod123',
    role: 'user'
  },
  {
    username: 'moderador_joao',
    email: 'joao.moderacao@sehloiro.dev',
    password: 'mod123',
    role: 'user'
  }
];

async function seedUsers() {
  // Idempotente — preserva _id existente do admin pra OAuth'd channels
  // não ficarem "órfãos" toda vez que o compose recicla containers.
  let inseridos = 0;
  for (const u of USUARIOS) {
    const existing = await User.findOne({ email: u.email });
    if (existing) continue;
    const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
    await User.create({
      username: u.username,
      email: u.email,
      password: hash,
      role: u.role,
    });
    inseridos++;
  }
  return inseridos;
}

module.exports = seedUsers;

// Execução direta via `node seed-users.js`
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
    const qtd = await seedUsers();
    console.log(`[seed] users: ${qtd} criados`);
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error('[seed] falha ao rodar seed-users:', err.message);
    process.exit(1);
  });
}

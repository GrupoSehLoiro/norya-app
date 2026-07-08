// Schemas redeclarados inline para manter este diretório desacoplado de
// SLMOD-api/node_modules. Os nomes dos campos e das collections espelham
// EXATAMENTE os models em SLMOD-api/api/models/. Qualquer mudança de schema
// na API deve ser refletida aqui manualmente (o banco é o contrato).

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  role: { type: String, default: 'user' }
});

const ChannelSchema = new mongoose.Schema({
  channel: { type: String, unique: true },
  channelWithPrefix: { type: String },
  created_at: { type: Date, required: true, default: Date.now },
  active: { type: Boolean, default: true },
  // Campos do v2 (OAuth) — seed precisa SABER que existem pra filtrar
  // sem disparar erro de "Path not in schema" em strict + upsert.
  externalId: { type: String },
  ownerId: { type: String },
  displayName: { type: String },
  platform: { type: String },
}, { strict: false });

const SocialListeningSchema = new mongoose.Schema({
  channel: { type: String },
  username: { type: String },
  category: { type: String },
  message: { type: String },
  sentiment: { type: String },
  isSubscriber: { type: Boolean },
  palavraCapturada: { type: String },
  mensagemSentimento: { type: String },
  timestamp: { type: Date }
});

const SentimentConfigurationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  keywords: [{ type: String }]
});

const CategoryConfigurationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  keywords: [{ type: String }]
});

// --- Moderacao ---
const BanSchema = new mongoose.Schema({
  channel: { type: String },
  userName: { type: String, required: true },
  reason: { type: String, required: true },
  modName: { type: String, required: true },
  timestamp: { type: Date, required: true }
});

const TimeoutSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  userName: { type: String, required: true },
  reason: { type: String, required: true },
  tempoDeTO: { type: Number, required: true },
  timestamp: { type: Date, required: true },
  modName: { type: String, required: true }
});

const MessageDeletedSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  username: { type: String, required: true },
  deletedMessage: { type: String, required: true },
  timestamp: { type: Date, required: true }
});

// --- Engajamento (predictions / polls) ---
const PredictionSchema = new mongoose.Schema({
  predictionId: { type: String },
  channel: { type: String },
  title: { type: String },
  winningOutcome: { type: String },
  created_at: { type: Date },
  ended_at: { type: Date },
  locked_at: { type: Date },
  // Nao existe no model da API (prediction.model.js) — mas a SPA legada le e
  // chama `.toLocaleString` direto, entao se vier undefined a pagina crasha.
  // Persistir aqui no seed evita o crash sem precisar mexer na SPA.
  prediction_window: { type: Number },
  options: [{
    title: { type: String },
    totalBetAmount: { type: Number },
    id: { type: String },
    users: { type: Number },
    topBetters: [{ userName: { type: String }, amount: { type: Number } }]
  }]
}, { strict: false });

const PollSchema = new mongoose.Schema({
  pollId: { type: String },
  channel: { type: String },
  title: { type: String },
  created_at: { type: Date },
  ended_at: { type: Date },
  duration: { type: Number },
  choices: [{
    id: { type: String },
    title: { type: String },
    votes: { type: Number },
    channel_points_votes: { type: Number },
    bits_votes: { type: Number }
  }],
  bits_voting_enabled: { type: Boolean },
  bits_per_vote: { type: Number },
  channel_points_voting_enabled: { type: Boolean },
  channel_points_per_vote: { type: Number }
});

// --- Emojis ---
const EmojiSchema = new mongoose.Schema({
  channel: { type: String },
  username: { type: String },
  message: { type: String },
  emoji: { type: String },
  timestamp: { type: Date }
});

// --- Logs ---
const LogEventModSchema = new mongoose.Schema({
  user: { type: String },
  action: { type: String },
  date: { type: Date },
  mod: { type: String },
  messageLog: { type: String }
});

const LogSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['info', 'warning', 'error', 'debug'], default: 'info' },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  timestamp: { type: Date, required: true, default: Date.now },
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  source: { type: String, default: 'API' },
  channel: { type: String, default: '' }
}, { timestamps: true });

// Reutiliza o model se já foi registrado (ao rodar seed-all várias vezes).
function model(name, schema) {
  return mongoose.models[name] || mongoose.model(name, schema);
}

module.exports = {
  User: model('User', UserSchema),
  Channel: model('Channel', ChannelSchema),
  SocialListening: model('SocialListening', SocialListeningSchema),
  SentimentConfiguration: model('SentimentConfiguration', SentimentConfigurationSchema),
  CategoryConfig: model('CategoryConfig', CategoryConfigurationSchema),
  Ban: model('Ban', BanSchema),
  Timeout: model('timeout', TimeoutSchema),
  MessageDeleted: model('MessageDeleted', MessageDeletedSchema),
  Prediction: model('Prediction', PredictionSchema),
  Poll: model('Poll', PollSchema),
  Emoji: model('emoji', EmojiSchema),
  LogEventMod: model('LogPlatform', LogEventModSchema),
  Log: model('Log', LogSchema)
};

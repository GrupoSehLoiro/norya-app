/**
 * Fase 5 · Integração conduit → handlers → collections legadas.
 *
 * Sobe PersistenceModule + InMemoryEventBus (via CacheModule) + LegacyModule
 * num mongodb-memory-server. Publica payloads no bus simulando o que o
 * `TwitchEventSubBridge` (worker) faria, e valida que os handlers da Fase 5.3
 * gravam corretamente nas collections legadas.
 *
 * Não tocamos no worker real — o contrato testado é apenas
 * `bus.publish(<channel>, payload)` → `<collection>.findOne(...)`.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  CHAT_MESSAGE_BUS_CHANNEL,
  EVENT_BUS_TOKEN,
  EventBus,
  RawMessage,
  TWITCH_CHANNEL_BAN_CHANNEL,
  TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL,
  TWITCH_CHANNEL_POLL_END_CHANNEL,
  TWITCH_CHANNEL_PREDICTION_END_CHANNEL,
  TwitchChannelBanPayload,
  TwitchChannelMessageDeletePayload,
  TwitchChannelPollEndPayload,
  TwitchChannelPredictionEndPayload,
} from '@sehloro/domain';
import {
  BanPersistence,
  BanSchemaName,
  CacheModule as InfraCacheModule,
  ChatEmojiPersistence,
  ChatEmojiSchemaName,
  MessageDeletedPersistence,
  MessageDeletedSchemaName,
  PersistenceModule,
  PollPersistence,
  PollSchemaName,
  PredictionPersistence,
  PredictionSchemaName,
  TimeoutPersistence,
  TimeoutSchemaName,
} from '@sehloro/infra';
import { LegacyModule } from '../src/legacy/legacy.module';

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms)`);
}

describe('Legacy conduit feed integration (Fase 5)', () => {
  let mongo: MongoMemoryServer;
  let app: TestingModule;
  let bus: EventBus;

  let banModel: Model<BanPersistence>;
  let timeoutModel: Model<TimeoutPersistence>;
  let removedModel: Model<MessageDeletedPersistence>;
  let pollModel: Model<PollPersistence>;
  let predictionModel: Model<PredictionPersistence>;
  let emojiModel: Model<ChatEmojiPersistence>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.EVENT_BUS_DRIVER = 'memory';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.LOG_LEVEL = 'fatal';

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>('MONGODB_URI'),
            serverSelectionTimeoutMS: 5000,
          }),
        }),
        PersistenceModule,
        InfraCacheModule,
        LegacyModule,
      ],
    }).compile();
    await app.init();

    bus = app.get<EventBus>(EVENT_BUS_TOKEN);
    banModel = app.get(getModelToken(BanSchemaName));
    timeoutModel = app.get(getModelToken(TimeoutSchemaName));
    removedModel = app.get(getModelToken(MessageDeletedSchemaName));
    pollModel = app.get(getModelToken(PollSchemaName));
    predictionModel = app.get(getModelToken(PredictionSchemaName));
    emojiModel = app.get(getModelToken(ChatEmojiSchemaName));
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      banModel.deleteMany({}),
      timeoutModel.deleteMany({}),
      removedModel.deleteMany({}),
      pollModel.deleteMany({}),
      predictionModel.deleteMany({}),
      emojiModel.deleteMany({}),
    ]);
  });

  it('channel.ban permanente → insere em `bans`', async () => {
    const payload: TwitchChannelBanPayload = {
      channelExternalId: '12345',
      broadcasterUserLogin: 'leozeraplay',
      userExternalId: '999',
      userLogin: 'troll1',
      moderatorUserLogin: 'mod_a',
      reason: 'flame',
      isPermanent: true,
      bannedAt: '2026-05-20T10:00:00Z',
      endsAt: null,
    };
    await bus.publish(TWITCH_CHANNEL_BAN_CHANNEL, payload);
    await waitFor(async () => (await banModel.countDocuments()) === 1);

    const ban = await banModel.findOne().lean();
    expect(ban).not.toBeNull();
    expect(ban!.userName).toBe('troll1');
    expect(ban!.modName).toBe('mod_a');
    expect(ban!.channel).toBe('leozeraplay');
    expect(await timeoutModel.countDocuments()).toBe(0);
  });

  it('channel.ban com endsAt → insere em `timeouts` com tempoDeTO em segundos', async () => {
    const banned = '2026-05-20T10:00:00Z';
    const ends = '2026-05-20T10:10:00Z'; // +10 min = 600s
    const payload: TwitchChannelBanPayload = {
      channelExternalId: '12345',
      broadcasterUserLogin: 'leozeraplay',
      userExternalId: '999',
      userLogin: 'troll2',
      moderatorUserLogin: 'mod_b',
      reason: 'spam',
      isPermanent: false,
      bannedAt: banned,
      endsAt: ends,
    };
    await bus.publish(TWITCH_CHANNEL_BAN_CHANNEL, payload);
    await waitFor(async () => (await timeoutModel.countDocuments()) === 1);

    const to = await timeoutModel.findOne().lean();
    expect(to).not.toBeNull();
    expect(to!.tempoDeTO).toBe(600);
    expect(to!.userName).toBe('troll2');
    expect(await banModel.countDocuments()).toBe(0);
  });

  it('channel.chat.message_delete → insere em `messagedeleteds`', async () => {
    const payload: TwitchChannelMessageDeletePayload = {
      channelExternalId: '12345',
      broadcasterUserLogin: 'leozeraplay',
      targetUserLogin: 'spammer1',
      messageId: 'msg-1',
      messageBody: 'link.bait/scam',
      observedAt: '2026-05-20T10:00:00Z',
    };
    await bus.publish(TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL, payload);
    await waitFor(async () => (await removedModel.countDocuments()) === 1);

    const removed = await removedModel.findOne().lean();
    expect(removed!.username).toBe('spammer1');
    expect(removed!.deletedMessage).toBe('link.bait/scam');
  });

  it('channel.poll.end → insere em `polls` com choices preservados', async () => {
    const payload: TwitchChannelPollEndPayload = {
      channelExternalId: '12345',
      broadcasterUserLogin: 'leozeraplay',
      pollId: 'po-1',
      title: 'Próximo jogo?',
      startedAt: '2026-05-20T10:00:00Z',
      endedAt: '2026-05-20T10:05:00Z',
      status: 'completed',
      choices: [
        { id: 'c1', title: 'CS', votes: 100, channelPointsVotes: 20, bitsVotes: 5 },
        { id: 'c2', title: 'Valorant', votes: 80, channelPointsVotes: 50, bitsVotes: 0 },
      ],
      bitsVotingEnabled: true,
      bitsPerVote: 100,
      channelPointsVotingEnabled: true,
      channelPointsPerVote: 500,
    };
    await bus.publish(TWITCH_CHANNEL_POLL_END_CHANNEL, payload);
    await waitFor(async () => (await pollModel.countDocuments()) === 1);

    const poll = await pollModel.findOne().lean();
    expect(poll!.pollId).toBe('po-1');
    expect(poll!.channel).toBe('leozeraplay');
    expect(poll!.duration).toBe(300);
    expect(poll!.choices).toHaveLength(2);
    expect(poll!.choices[0]!.channel_points_votes).toBe(20);
    expect(poll!.bits_per_vote).toBe(100);
  });

  it('channel.prediction.end → insere em `predictions` com options mapeados', async () => {
    const payload: TwitchChannelPredictionEndPayload = {
      channelExternalId: '12345',
      broadcasterUserLogin: 'leozeraplay',
      predictionId: 'p-1',
      title: 'Lula vence?',
      winningOutcomeId: 'opt-yes',
      createdAt: '2026-05-20T10:00:00Z',
      endedAt: '2026-05-20T10:10:00Z',
      lockedAt: '2026-05-20T10:05:00Z',
      outcomes: [
        {
          id: 'opt-yes',
          title: 'Sim',
          totalChannelPoints: 5000,
          users: 42,
          topPredictors: [{ userLogin: 'rich_user', channelPointsUsed: 2000 }],
        },
        { id: 'opt-no', title: 'Não', totalChannelPoints: 3000, users: 28, topPredictors: [] },
      ],
    };
    await bus.publish(TWITCH_CHANNEL_PREDICTION_END_CHANNEL, payload);
    await waitFor(async () => (await predictionModel.countDocuments()) === 1);

    const pred = await predictionModel.findOne().lean();
    expect(pred!.predictionId).toBe('p-1');
    expect(pred!.winningOutcome).toBe('opt-yes');
    expect(pred!.options).toHaveLength(2);
    expect(pred!.options[0]!.totalBetAmount).toBe(5000);
    expect(pred!.options[0]!.topBetters[0]!.userName).toBe('rich_user');
  });

  it('chat.message com emotes → insere uma row por emote em `emojis`', async () => {
    const msg: RawMessage = {
      id: 'msg-1',
      platform: 'twitch',
      channelExternalId: '12345',
      channelName: 'leozeraplay',
      user: {
        externalId: 'u1',
        username: 'fan1',
        displayName: 'Fan',
        isSubscriber: false,
        isMod: false,
        isBroadcaster: false,
        badges: [],
      },
      text: 'KEKW PogChamp',
      emotes: [
        { code: 'KEKW', start: 0, end: 3, provider: 'twitch' },
        { code: 'PogChamp', start: 5, end: 12, provider: 'twitch' },
      ],
      mentions: [],
      rawPayload: {},
      receivedAt: new Date('2026-05-20T10:00:00Z'),
    };
    await bus.publish(CHAT_MESSAGE_BUS_CHANNEL, { channelId: 'uuid-1', message: msg });
    await waitFor(async () => (await emojiModel.countDocuments()) === 2);

    const docs = await emojiModel.find().sort({ emoji: 1 }).lean();
    expect(docs.map((d) => d.emoji)).toEqual(['KEKW', 'PogChamp']);
    expect(docs[0]!.channel).toBe('leozeraplay');
    expect(docs[0]!.username).toBe('fan1');
  });

  it('chat.message sem emotes → não escreve em `emojis`', async () => {
    const msg: RawMessage = {
      id: 'msg-2',
      platform: 'twitch',
      channelExternalId: '12345',
      channelName: 'leozeraplay',
      user: {
        externalId: 'u2',
        username: 'fan2',
        displayName: 'Fan2',
        isSubscriber: false,
        isMod: false,
        isBroadcaster: false,
        badges: [],
      },
      text: 'just text',
      emotes: [],
      mentions: [],
      rawPayload: {},
      receivedAt: new Date('2026-05-20T10:01:00Z'),
    };
    await bus.publish(CHAT_MESSAGE_BUS_CHANNEL, { channelId: 'uuid-1', message: msg });
    await new Promise((r) => setTimeout(r, 100));
    expect(await emojiModel.countDocuments()).toBe(0);
  });
});

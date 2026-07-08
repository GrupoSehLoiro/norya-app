/**
 * E2E "happy path" do orchestrator — versão que monta as deps
 * manualmente (sem CacheModule auto-DI), porque o pickDriver dela
 * decide 'memory' em NODE_ENV=test → ChatBuffer fica null.
 *
 * Aqui construímos:
 *   - Redis real (compose) → ChatBufferService + RedisCopypastaDedup
 *   - RedisEventBus real → PublishInsightService
 *   - ClickHouse real → BatchAnalysisWriter
 *   - Mongo real → AdSegmentService + BrandRepo + ConfigsLoader
 *   - MockLlmClassifier (sem chamar Anthropic)
 */
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  ChatBufferService,
  RedisCopypastaDedupService,
  RedisEventBus,
  AnalyticsModule,
  SocialListeningPersistenceModule,
  LLM_CLASSIFIER_TOKEN,
  MockLlmClassifier,
  ConfigsLoaderService,
} from '@sehloro/infra';
import { COPYPASTA_DEDUP_TOKEN, EVENT_BUS_TOKEN, type RawMessage } from '@sehloro/domain';
import { BatchAnalysisWriter } from '../src/social-listening/batch-analysis.writer';
import { PublishInsightService } from '../src/social-listening/publish-insight.service';
import { AdSegmentService } from '../src/social-listening/ad-segment.service';
import { SocialListeningOrchestrator } from '../src/social-listening/orchestrator.service';
import type { BatchAnalysis } from '../src/social-listening/batch-analysis.types';

const CHANNEL = 'orchestrator-e2e-' + randomUUID().slice(0, 6);

function mkMsg(id: string, user: string, text: string): RawMessage {
  return {
    id,
    platform: 'twitch',
    channelExternalId: CHANNEL,
    channelName: CHANNEL,
    user: {
      externalId: 'u_' + user,
      username: user,
      displayName: user,
      isSubscriber: false,
      isMod: false,
      isBroadcaster: false,
      badges: [],
    },
    text,
    emotes: [],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date(),
  };
}

describe('SocialListeningOrchestrator — flow E2E', () => {
  let app: TestingModule;
  let orchestrator: SocialListeningOrchestrator;
  let chatBuffer: ChatBufferService;
  let bus: RedisEventBus;
  let redis: Redis;

  beforeAll(async () => {
    process.env.SOCIAL_LISTENING_CHANNELS = CHANNEL;
    if (!process.env.CLICKHOUSE_URL) process.env.CLICKHOUSE_URL = 'http://clickhouse:8123';
    if (!process.env.CLICKHOUSE_USER) process.env.CLICKHOUSE_USER = 'default';
    if (!process.env.CLICKHOUSE_PASSWORD) process.env.CLICKHOUSE_PASSWORD = 'devpass';
    if (!process.env.CLICKHOUSE_DB) process.env.CLICKHOUSE_DB = 'sehloro';

    redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    bus = new RedisEventBus(process.env.REDIS_URL!);
    chatBuffer = new ChatBufferService(redis);

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(process.env.MONGODB_URI!),
        SocialListeningPersistenceModule,
        AnalyticsModule.forRootAsync(),
      ],
      providers: [
        { provide: ChatBufferService, useValue: chatBuffer },
        { provide: 'IORedis', useValue: redis },
        {
          provide: COPYPASTA_DEDUP_TOKEN,
          useFactory: () => new RedisCopypastaDedupService(redis),
        },
        { provide: EVENT_BUS_TOKEN, useValue: bus },
        MockLlmClassifier,
        { provide: LLM_CLASSIFIER_TOKEN, useExisting: MockLlmClassifier },
        ConfigsLoaderService,
        BatchAnalysisWriter,
        PublishInsightService,
        AdSegmentService,
        SocialListeningOrchestrator,
      ],
    }).compile();

    orchestrator = app.get(SocialListeningOrchestrator);
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      await bus.dispose();
    } catch {}
    try {
      await redis.quit();
    } catch {}
  });

  it('runOnce produz BatchAnalysis com 7 insights, tier=2 mock', async () => {
    const received: BatchAnalysis[] = [];
    const unsub = await bus.subscribe<BatchAnalysis>('analysis:' + CHANNEL, (b) =>
      received.push(b),
    );

    const msgs = [
      mkMsg('m1', 'alice', 'top demais o lance'),
      mkMsg('m2', 'alice', 'gostei muito'),
      mkMsg('m3', 'bob', 'rage que jogo'),
      mkMsg('m4', 'bob', 'cancela isso'),
      mkMsg('m5', 'bob', 'lixo de jogo'),
      mkMsg('m6', 'mod1', 'pessoal calma'),
      mkMsg('m7', 'eve', 'frase única ' + randomUUID()),
      mkMsg('m8', 'eve', 'outra frase ' + randomUUID()),
    ];
    for (const m of msgs) {
      await chatBuffer.push(CHANNEL, m);
    }

    const out = await orchestrator.runOnce(CHANNEL);
    expect(out).not.toBeNull();
    expect(out!.channelId).toBe(CHANNEL);
    expect(out!.messageCount).toBeGreaterThan(0);
    expect(out!.llmTier).toBe(2);
    expect(out!.llmModel).toBe('mock-haiku-4-5');
    expect(out!.llmCostUsd).toBe(0);

    expect(typeof out!.climaGeral.pos).toBe('number');
    expect(out!).toHaveProperty('pautaMaisComentada');
    expect(out!).toHaveProperty('pautaMenosComentada');
    expect(out!).toHaveProperty('userMaisToxico');
    expect(out!).toHaveProperty('userMenosToxico');
    expect(out!).toHaveProperty('sentimentoAd');
    expect(out!).toHaveProperty('marcasMencionadas');

    await new Promise((r) => setTimeout(r, 250));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]!.batchId).toBe(out!.batchId);
    await unsub();
  });

  it('runOnce em canal vazio retorna null sem publicar', async () => {
    const empty = CHANNEL + '-empty-' + randomUUID().slice(0, 4);
    const out = await orchestrator.runOnce(empty);
    expect(out).toBeNull();
  });
});

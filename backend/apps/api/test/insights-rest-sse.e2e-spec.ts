/**
 * E2E REST + SSE — Fase 7. Reusa o flow do orchestrator-e2e:
 *   1. Sobe módulos com Redis/CH/Mongo reais
 *   2. Dispara `orchestrator.runOnce` → grava CH + publica bus
 *   3. GET /insights/latest retorna o batch
 *   4. SSE subscriber recebe o payload em tempo real
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import {
  ChatBufferService,
  RedisCopypastaDedupService,
  RedisEventBus,
  AnalyticsModule,
  SocialListeningPersistenceModule,
  LLM_CLASSIFIER_TOKEN,
  MockLlmClassifier,
  FallbackLlmClassifier,
  PersistenceModule,
  ReportLlmService,
  TwitchHelixService,
} from '@sehloro/infra';
import { COPYPASTA_DEDUP_TOKEN, EVENT_BUS_TOKEN, type RawMessage } from '@sehloro/domain';
import { ConfigsLoaderService } from '@sehloro/infra';
import { BatchAnalysisWriter } from '../src/social-listening/batch-analysis.writer';
import { PublishInsightService } from '../src/social-listening/publish-insight.service';
import { AdSegmentService } from '../src/social-listening/ad-segment.service';
import { SocialListeningOrchestrator } from '../src/social-listening/orchestrator.service';
import { InsightsService } from '../src/social-listening/insights.service';
import { InsightsController } from '../src/social-listening/insights.controller';
import { InsightsReportService } from '../src/social-listening/insights-report.service';
import { ReportPdfService } from '../src/social-listening/report-pdf.service';
import { HtmlPdfRendererService } from '../src/social-listening/html-pdf-renderer.service';
import { EmotesService } from '../src/social-listening/emotes.service';
import { MessageSearchService } from '../src/social-listening/message-search.service';

const CHANNEL = 'rest-sse-' + randomUUID().slice(0, 6);

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

describe('REST /insights — happy path', () => {
  let app: INestApplication;
  let orchestrator: SocialListeningOrchestrator;
  let chatBuffer: ChatBufferService;
  let redis: Redis;
  let bus: RedisEventBus;

  beforeAll(async () => {
    process.env.SOCIAL_LISTENING_CHANNELS = CHANNEL;
    // Gate de gap-of-silence desligado: o teste empurra msgs e drena na sequência.
    process.env.SOCIAL_LISTENING_IDLE_GAP_MS = '0';
    if (!process.env.CLICKHOUSE_URL) process.env.CLICKHOUSE_URL = 'http://clickhouse:8123';
    if (!process.env.CLICKHOUSE_USER) process.env.CLICKHOUSE_USER = 'default';
    if (!process.env.CLICKHOUSE_PASSWORD) process.env.CLICKHOUSE_PASSWORD = 'devpass';
    if (!process.env.CLICKHOUSE_DB) process.env.CLICKHOUSE_DB = 'sehloro';

    redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true });
    await redis.connect();
    bus = new RedisEventBus(process.env.REDIS_URL!);
    chatBuffer = new ChatBufferService(redis);

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(process.env.MONGODB_URI!),
        PersistenceModule,
        SocialListeningPersistenceModule,
        AnalyticsModule.forRootAsync(),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (cfg: ConfigService) => ({
            secret: cfg.get<string>('JWT_SECRET'),
          }),
        }),
      ],
      controllers: [InsightsController],
      providers: [
        { provide: ChatBufferService, useValue: chatBuffer },
        { provide: COPYPASTA_DEDUP_TOKEN, useFactory: () => new RedisCopypastaDedupService(redis) },
        { provide: EVENT_BUS_TOKEN, useValue: bus },
        MockLlmClassifier,
        { provide: LLM_CLASSIFIER_TOKEN, useExisting: MockLlmClassifier },
        FallbackLlmClassifier,
        ConfigsLoaderService,
        BatchAnalysisWriter,
        PublishInsightService,
        AdSegmentService,
        SocialListeningOrchestrator,
        InsightsService,
        InsightsReportService,
        ReportPdfService,
        HtmlPdfRendererService,
        MessageSearchService,
        ReportLlmService,
        EmotesService,
        {
          provide: TwitchHelixService,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            new TwitchHelixService(
              config.get<string>('TWITCH_CLIENT_ID') ?? '',
              config.get<string>('TWITCH_CLIENT_SECRET') ?? '',
            ),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    orchestrator = moduleRef.get(SocialListeningOrchestrator);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    try {
      await bus.dispose();
    } catch {}
    try {
      await redis.quit();
    } catch {}
  });

  it('GET /insights/latest sem dados → analysis: null', async () => {
    const fresh = CHANNEL + '-empty-' + randomUUID().slice(0, 4);
    const res = await request(app.getHttpServer())
      .get(`/api/v2/social-listening/insights/latest?channelId=${fresh}`)
      .expect(200);
    expect(res.body.analysis).toBeNull();
  });

  it('orchestrator runOnce + GET /insights/latest retorna o batch persistido', async () => {
    for (let i = 0; i < 5; i++) {
      await chatBuffer.push(
        CHANNEL,
        mkMsg('m' + i, 'u' + (i % 2), 'frase única ' + i + ' ' + randomUUID()),
      );
    }
    const ana = await orchestrator.runOnce(CHANNEL);
    expect(ana).not.toBeNull();

    // Pequeno delay para garantir flush async do CH
    await new Promise((r) => setTimeout(r, 300));

    const res = await request(app.getHttpServer())
      .get(`/api/v2/social-listening/insights/latest?channelId=${CHANNEL}`)
      .expect(200);

    expect(res.body.channelId).toBe(CHANNEL);
    expect(res.body.analysis).not.toBeNull();
    expect(res.body.analysis.batchId).toBe(ana!.batchId);
    expect(res.body.analysis.llmTier).toBe(2);
    expect(res.body.analysis.climaGeral.pos).toBeDefined();
    expect(res.body.analysis.climaGeral.neg).toBeDefined();
    expect(res.body.analysis.climaGeral.neu).toBeDefined();
  });

  it('GET /insights/history retorna list ordenada desc', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v2/social-listening/insights/history?channelId=${CHANNEL}&limit=5`)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    if (res.body.items.length >= 2) {
      const a = new Date(res.body.items[0].windowStart).getTime();
      const b = new Date(res.body.items[1].windowStart).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it('GET /insights/latest sem channelId → 400', async () => {
    await request(app.getHttpServer()).get('/api/v2/social-listening/insights/latest').expect(400);
  });
});

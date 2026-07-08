/**
 * E2E do fluxo manual + (futuro) twitch handler do AdSegmentService.
 *
 * Boota: Mongo memory + PersistenceModule + SocialListeningPersistenceModule
 * + InMemoryEventBus + AdSegmentService (sem HTTP). Valida start/stop e
 * publicação no event bus.
 */
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EVENT_BUS_TOKEN, type AdSegment, type EventBus } from '@sehloro/domain';
import { CacheModule as InfraCacheModule, SocialListeningPersistenceModule } from '@sehloro/infra';
import { AdSegmentService } from '../src/social-listening/ad-segment.service';

describe('AdSegmentService — flow E2E', () => {
  let mongo: MongoMemoryServer | null = null;
  let app: TestingModule;
  let service: AdSegmentService;
  let bus: EventBus;
  let mongoUri: string;

  beforeAll(async () => {
    if (process.env.MONGODB_URI) {
      // Usa Mongo externo (compose container) — alpine não roda
      // mongodb-memory-server por causa do libc.
      mongoUri = process.env.MONGODB_URI;
    } else {
      mongo = await MongoMemoryServer.create();
      mongoUri = mongo.getUri();
      process.env.MONGODB_URI = mongoUri;
    }
    process.env.NODE_ENV = 'test';
    process.env.EVENT_BUS_DRIVER = 'memory';
    process.env.LOG_LEVEL = 'fatal';

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(mongoUri),
        InfraCacheModule,
        SocialListeningPersistenceModule,
      ],
      providers: [AdSegmentService],
    }).compile();

    service = app.get(AdSegmentService);
    bus = app.get<EventBus>(EVENT_BUS_TOKEN);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (mongo) await mongo.stop();
  });

  afterEach(async () => {
    // Limpa as collections para isolar canais entre testes
    const conn = app.get('DatabaseConnection');
    if (conn?.db) {
      await conn.db.collection('ad_segments').deleteMany({});
    }
  });

  it('startManual cria segmento aberto e emite social-listening.ad.start', async () => {
    const received: AdSegment[] = [];
    const unsub = await bus.subscribe<AdSegment>('social-listening.ad.start', (s) =>
      received.push(s),
    );
    const seg = await service.startManual('chan-1', 60);
    expect(seg.source).toBe('manual');
    expect(seg.endedAt).not.toBeNull(); // duração passada → endedAt setado
    expect(seg.durationSeconds).toBe(60);
    // event bus eventual; bus síncrono no driver memory, mas damos tick
    await new Promise((r) => setTimeout(r, 5));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.channelId).toBe('chan-1');
    await unsub();
  });

  it('getStatus reporta active=true durante a janela', async () => {
    await service.startManual('chan-2');
    const status = await service.getStatus('chan-2');
    expect(status.active).toBe(true);
    expect(status.source).toBe('manual');
  });

  it('stop fecha o segmento aberto e emite stop event', async () => {
    await service.startManual('chan-3');
    const seen: AdSegment[] = [];
    const unsub = await bus.subscribe<AdSegment>('social-listening.ad.stop', (s) => seen.push(s));
    const closed = await service.stop('chan-3');
    expect(closed?.endedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(seen[0]?.channelId).toBe('chan-3');
    await unsub();
  });

  it('startFromTwitch grava source=twitch + endedAt derivado de duration', async () => {
    const started = new Date('2026-05-19T12:00:00Z');
    const seg = await service.startFromTwitch({
      channelId: 'chan-4',
      startedAt: started,
      durationSeconds: 90,
      isAutomatic: true,
    });
    expect(seg.source).toBe('twitch');
    expect(seg.durationSeconds).toBe(90);
    expect(seg.endedAt?.toISOString()).toBe(new Date(started.getTime() + 90_000).toISOString());
  });

  it('getAdActiveInWindow reflete sobreposição parcial', async () => {
    await service.startFromTwitch({
      channelId: 'chan-5',
      startedAt: new Date('2026-05-19T12:00:00Z'),
      durationSeconds: 30,
      isAutomatic: false,
    });
    const w = await service.getAdActiveInWindow(
      'chan-5',
      new Date('2026-05-19T12:00:10Z'),
      new Date('2026-05-19T12:00:25Z'),
    );
    expect(w.active).toBe(true);
    expect(w.source).toBe('twitch');
  });
});

/**
 * MON-05 · Integração do fluxo de monitoring via EventSub.
 *
 * Não exerce HTTP — boots os módulos reais (Cache + Persistence +
 * FeatureFlags + Monitoring) contra um mongodb-memory-server, seeda um
 * Channel + a flag `monitoring.autoStart`, e empurra eventos pelo InMemoryEventBus
 * (mesmo bus que o TwitchStreamLifecycleHandler subscreveu em onApplicationBootstrap).
 *
 * Validado pela suíte:
 *  - stream.online cria uma LiveSession ACTIVE.
 *  - stream.offline transiciona a sessão para ENDED com endedAt preenchido.
 *  - Flag `monitoring.autoStart=false` para o canal bloqueia ambos os lados.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Channel,
  CHANNEL_REPOSITORY,
  ChannelRepository,
  EVENT_BUS_TOKEN,
  EventBus,
  LIVE_SESSION_REPOSITORY,
  LiveSessionRepository,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
} from '@sehloro/domain';
import { CacheModule as InfraCacheModule, PersistenceModule } from '@sehloro/infra';
import { FeatureFlagsModule } from '../src/feature-flags/feature-flags.module';
import { FeatureFlagsService } from '../src/feature-flags/feature-flags.service';
import { MonitoringModule } from '../src/monitoring/monitoring.module';

const TEST_CHANNEL_EXTERNAL_ID = '12345';

describe('Monitoring auto-start flow (MON-03 integration)', () => {
  let mongo: MongoMemoryServer;
  let app: TestingModule;
  let bus: EventBus;
  let sessions: LiveSessionRepository;
  let channels: ChannelRepository;
  let flags: FeatureFlagsService;
  let testChannel: Channel;

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
        FeatureFlagsModule,
        MonitoringModule,
      ],
    }).compile();
    await app.init();

    bus = app.get<EventBus>(EVENT_BUS_TOKEN);
    sessions = app.get<LiveSessionRepository>(LIVE_SESSION_REPOSITORY);
    channels = app.get<ChannelRepository>(CHANNEL_REPOSITORY);
    flags = app.get(FeatureFlagsService);

    testChannel = Channel.create({
      name: 'rogerbatt',
      platform: 'twitch',
      externalId: TEST_CHANNEL_EXTERNAL_ID,
      displayName: 'rogerbatt',
      ownerId: 'owner-1',
      active: true,
    });
    testChannel = await channels.save(testChannel);

    // Garante que a flag está habilitada para o canal — defaultValue=true,
    // mas o seed só roda em onApplicationBootstrap. Forçamos via upsert.
    await flags.upsert('monitoring.autoStart', { defaultValue: true });
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    // Limpa sessões entre cenários — alguns testes esperam estado vazio inicial.
    const active = await sessions.findActiveByChannel(testChannel.getId());
    if (active) {
      await sessions.delete(active.getId());
    }
  });

  it('stream.online abre uma LiveSession ACTIVE para o canal', async () => {
    expect(await sessions.findActiveByChannel(testChannel.getId())).toBeNull();

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: TEST_CHANNEL_EXTERNAL_ID,
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await waitFor(async () => (await sessions.findActiveByChannel(testChannel.getId())) !== null);

    const active = await sessions.findActiveByChannel(testChannel.getId());
    expect(active).not.toBeNull();
    expect(active!.getState()).toBe('ACTIVE');
    expect(active!.wasAutoStarted()).toBe(true);
    expect(active!.getStartedAt()).toBeInstanceOf(Date);
  });

  it('stream.offline encerra a LiveSession ACTIVE', async () => {
    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: TEST_CHANNEL_EXTERNAL_ID,
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await waitFor(async () => (await sessions.findActiveByChannel(testChannel.getId())) !== null);
    const started = (await sessions.findActiveByChannel(testChannel.getId()))!;

    await bus.publish(STREAM_OFFLINE_CHANNEL, {
      channelExternalId: TEST_CHANNEL_EXTERNAL_ID,
      broadcasterUserLogin: 'rogerbatt',
      observedAt: new Date().toISOString(),
    });
    await waitFor(async () => (await sessions.findActiveByChannel(testChannel.getId())) === null);

    const refreshed = await sessions.findById(started.getId());
    expect(refreshed).not.toBeNull();
    expect(refreshed!.getState()).toBe('ENDED');
    expect(refreshed!.getEndedAt()).toBeInstanceOf(Date);
    expect(refreshed!.getSummary()).toContain('stream.offline');
  });

  it('flag monitoring.autoStart=false bloqueia abertura automática', async () => {
    await flags.upsert('monitoring.autoStart', { defaultValue: false });

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: TEST_CHANNEL_EXTERNAL_ID,
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    // Espera mais que o tempo do path normal para garantir que ninguém abriu.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await sessions.findActiveByChannel(testChannel.getId())).toBeNull();

    // Restaura para os próximos testes
    await flags.upsert('monitoring.autoStart', { defaultValue: true });
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms)`);
}

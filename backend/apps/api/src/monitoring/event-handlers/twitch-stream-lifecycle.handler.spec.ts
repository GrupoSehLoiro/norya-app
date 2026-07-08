import {
  Channel,
  ChannelRepository,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
} from '@sehloro/domain';
import { InMemoryEventBus } from '@sehloro/infra';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { MonitoringService } from '../monitoring.service';
import { TwitchStreamLifecycleHandler } from './twitch-stream-lifecycle.handler';

function makeChannel(props: { id: string; externalId: string }): Channel {
  return Channel.reconstitute({
    id: props.id,
    name: 'rogerbatt',
    platform: 'twitch',
    active: true,
    createdAt: new Date(),
    externalId: props.externalId,
    displayName: 'rogerbatt',
    ownerId: 'owner-1',
    flags: {},
  });
}

describe('TwitchStreamLifecycleHandler', () => {
  let bus: InMemoryEventBus;
  let channels: jest.Mocked<ChannelRepository>;
  let monitoring: jest.Mocked<MonitoringService>;
  let flags: jest.Mocked<FeatureFlagsService>;
  let handler: TwitchStreamLifecycleHandler;

  beforeEach(async () => {
    bus = new InMemoryEventBus();

    channels = {
      findMany: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findAllActive: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ChannelRepository>;

    monitoring = {
      startSession: jest.fn(),
      endActiveByChannel: jest.fn(),
    } as unknown as jest.Mocked<MonitoringService>;

    flags = {
      isEnabled: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    handler = new TwitchStreamLifecycleHandler(bus, channels, monitoring, flags);
    await handler.onApplicationBootstrap();
  });

  afterEach(async () => {
    await handler.onApplicationShutdown();
    await bus.dispose();
  });

  it('abre LiveSession quando recebe stream.online de canal conhecido', async () => {
    const channel = makeChannel({ id: 'chan-1', externalId: '12345' });
    channels.findMany.mockResolvedValueOnce({ channels: [channel], total: 1 });

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    expect(monitoring.startSession).toHaveBeenCalledWith({
      channelId: 'chan-1',
      autoStarted: true,
      source: 'twitch.eventsub',
    });
  });

  it('fecha LiveSession ACTIVE quando recebe stream.offline', async () => {
    const channel = makeChannel({ id: 'chan-1', externalId: '12345' });
    channels.findMany.mockResolvedValueOnce({ channels: [channel], total: 1 });
    monitoring.endActiveByChannel.mockResolvedValueOnce(null);

    await bus.publish(STREAM_OFFLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      observedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    expect(monitoring.endActiveByChannel).toHaveBeenCalledWith(
      'chan-1',
      expect.stringContaining('stream.offline'),
    );
  });

  it('ignora o evento quando a flag monitoring.autoStart está desligada', async () => {
    const channel = makeChannel({ id: 'chan-1', externalId: '12345' });
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });
    flags.isEnabled.mockResolvedValueOnce(false);

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    expect(monitoring.startSession).not.toHaveBeenCalled();
  });

  it('loga e ignora quando o externalId não tem Channel local correspondente', async () => {
    channels.findMany.mockResolvedValueOnce({ channels: [], total: 0 });

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '99999',
      broadcasterUserLogin: 'unknown',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    expect(monitoring.startSession).not.toHaveBeenCalled();
    expect(flags.isEnabled).not.toHaveBeenCalled();
  });

  it('chamadas online duplicadas para mesmo canal não duplicam startSession (idempotência via service)', async () => {
    const channel = makeChannel({ id: 'chan-1', externalId: '12345' });
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    // O service é chamado 2x — a deduplicação acontece DENTRO dele (já retorna a ACTIVE existente).
    // Aqui validamos que o handler não filtra duplicatas — o service é a autoridade.
    expect(monitoring.startSession).toHaveBeenCalledTimes(2);
  });

  it('falha no service não derruba o handler — só registra', async () => {
    const channel = makeChannel({ id: 'chan-1', externalId: '12345' });
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });
    monitoring.startSession.mockRejectedValueOnce(new Error('mongo down'));

    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    // Próximo evento ainda processa normalmente.
    await bus.publish(STREAM_ONLINE_CHANNEL, {
      channelExternalId: '12345',
      broadcasterUserLogin: 'rogerbatt',
      startedAt: new Date().toISOString(),
    });
    await flushMicrotasks();

    expect(monitoring.startSession).toHaveBeenCalledTimes(2);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

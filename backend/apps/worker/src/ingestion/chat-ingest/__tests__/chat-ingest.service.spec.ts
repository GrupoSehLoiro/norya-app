/**
 * Unit do ChatIngestService — prova que msgs publicadas em `chat.message`
 * viram rows batched em `chat_messages` no ClickHouse, decoradas com o
 * hint tier-1, e que o serviço fica inerte sem ClickHouse configurado.
 * Bus real em memória (InMemoryEventBus), ClickHouse e configs mockados.
 */
import { InMemoryEventBus } from '@sehloro/infra';
import { CHAT_MESSAGE_BUS_CHANNEL, emptyConfigs, type RawMessage } from '@sehloro/domain';
import {
  ChatIngestService,
  CHAT_INGEST_MAX_PENDING,
  type ChatMessageBusPayload,
} from '../chat-ingest.service';

function msg(over: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'm1',
    platform: 'twitch',
    channelExternalId: '777',
    channelName: 'streamer',
    user: {
      externalId: '42',
      username: 'fan',
      displayName: 'Fan',
      isSubscriber: true,
      isMod: false,
      isBroadcaster: false,
      badges: ['subscriber/6'],
    },
    text: 'que jogada incrível',
    emotes: [{ code: 'PogChamp', start: 0, end: 7, provider: 'twitch' }],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date('2026-07-06T12:00:00.000Z'),
    ...over,
  };
}

function build(withClickhouse = true) {
  const bus = new InMemoryEventBus();
  const insert = jest.fn().mockResolvedValue(undefined);
  const clickhouse = withClickhouse ? ({ insert } as never) : null;
  const configs = {
    ...emptyConfigs(),
    sentiment: {
      positive: new Set(['incrível']),
      negative: new Set<string>(),
      neutral: new Set<string>(),
    },
  };
  const configsLoader = { load: jest.fn().mockResolvedValue(configs) } as never;
  const service = new ChatIngestService(bus, configsLoader, clickhouse);
  return { bus, insert, service };
}

async function publishAndSettle(bus: InMemoryEventBus, payload: ChatMessageBusPayload) {
  await bus.publish(CHAT_MESSAGE_BUS_CHANNEL, payload);
  // handler enfileira via promise — dá um turn pro microtask queue
  await new Promise((r) => setImmediate(r));
}

describe('ChatIngestService', () => {
  afterEach(() => jest.useRealTimers());

  it('persiste msg do bus como row de chat_messages com hint tier-1', async () => {
    const { bus, insert, service } = build();
    await service.onApplicationBootstrap();

    await publishAndSettle(bus, { channelId: 'ch1', message: msg() });
    await service.flushNow();

    expect(insert).toHaveBeenCalledTimes(1);
    const [table, rows] = insert.mock.calls[0];
    expect(table).toBe('chat_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel_id: 'ch1',
      platform: 'twitch',
      message_id: 'm1',
      username: 'fan',
      is_subscriber: 1,
      is_mod: 0,
      text: 'que jogada incrível',
      emotes: ['PogChamp'],
      sentiment_heuristic: 'positive',
      session_id: null,
      received_at: '2026-07-06 12:00:00.000',
    });
    await service.onModuleDestroy();
  });

  it('persiste msg dropada pelo tier-1 (comando) sem hint', async () => {
    const { bus, insert, service } = build();
    await service.onApplicationBootstrap();

    await publishAndSettle(bus, { channelId: 'ch1', message: msg({ id: 'm2', text: '!uptime' }) });
    await service.flushNow();

    const [, rows] = insert.mock.calls[0];
    expect(rows[0]).toMatchObject({ message_id: 'm2', sentiment_heuristic: '' });
    await service.onModuleDestroy();
  });

  it('reidrata receivedAt string (roundtrip JSON do RedisEventBus)', async () => {
    const { bus, insert, service } = build();
    await service.onApplicationBootstrap();

    const serialized = JSON.parse(JSON.stringify({ channelId: 'ch1', message: msg() }));
    await publishAndSettle(bus, serialized);
    await service.flushNow();

    const [, rows] = insert.mock.calls[0];
    expect(rows[0].received_at).toBe('2026-07-06 12:00:00.000');
    await service.onModuleDestroy();
  });

  it('flusha automaticamente ao atingir MAX_PENDING', async () => {
    const { bus, insert, service } = build();
    await service.onApplicationBootstrap();

    for (let i = 0; i < CHAT_INGEST_MAX_PENDING; i++) {
      await publishAndSettle(bus, { channelId: 'ch1', message: msg({ id: `m${i}` }) });
    }

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][1]).toHaveLength(CHAT_INGEST_MAX_PENDING);
    await service.onModuleDestroy();
  });

  it('fica inerte sem ClickHouse configurado', async () => {
    const { bus, insert, service } = build(false);
    await service.onApplicationBootstrap();

    await publishAndSettle(bus, { channelId: 'ch1', message: msg() });
    await service.flushNow();

    expect(insert).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('não perde buffer quando um insert falha (loga e descarta só o flush)', async () => {
    const { bus, insert, service } = build();
    insert.mockRejectedValueOnce(new Error('CH fora'));
    await service.onApplicationBootstrap();

    await publishAndSettle(bus, { channelId: 'ch1', message: msg({ id: 'a' }) });
    await service.flushNow(); // falha — descarta
    await publishAndSettle(bus, { channelId: 'ch1', message: msg({ id: 'b' }) });
    await service.flushNow(); // sucesso

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[1][1]).toHaveLength(1);
    expect(insert.mock.calls[1][1][0].message_id).toBe('b');
    await service.onModuleDestroy();
  });
});

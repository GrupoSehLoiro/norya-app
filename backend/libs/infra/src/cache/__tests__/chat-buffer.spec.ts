import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { CHAT_BUFFER_MAX_LENGTH, CHAT_BUFFER_TTL_SECONDS, ChatBufferService } from '../chat-buffer';
import type { RawMessage } from '@sehloro/domain';

function makeMsg(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    platform: 'twitch',
    channelExternalId: '12345',
    channelName: 'rogerbatt',
    user: {
      externalId: 'u1',
      username: 'tester',
      displayName: 'Tester',
      isSubscriber: false,
      isMod: false,
      isBroadcaster: false,
      badges: [],
    },
    text: 'hello world',
    emotes: [],
    mentions: [],
    rawPayload: null,
    receivedAt: new Date('2026-05-11T12:00:00.000Z'),
    ...overrides,
  };
}

describe('ChatBufferService', () => {
  let redis: Redis;
  let buffer: ChatBufferService;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    buffer = new ChatBufferService(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('push armazena a mensagem e length reflete o tamanho', async () => {
    await buffer.push('chan-a', makeMsg({ text: 'first' }));
    await buffer.push('chan-a', makeMsg({ text: 'second' }));

    expect(await buffer.length('chan-a')).toBe(2);
  });

  it('peek devolve mensagens com o Date revivido (não string)', async () => {
    const sent = makeMsg({ text: 'date test' });
    await buffer.push('chan-a', sent);

    const peeked = await buffer.peek('chan-a', 1);
    expect(peeked).toHaveLength(1);
    expect(peeked[0]!.receivedAt).toBeInstanceOf(Date);
    expect(peeked[0]!.receivedAt.toISOString()).toBe(sent.receivedAt.toISOString());
    expect(peeked[0]!.text).toBe('date test');
  });

  it('drain devolve em ordem cronológica (mais antiga primeiro) e esvazia', async () => {
    await buffer.push('chan-a', makeMsg({ text: 'first' }));
    await buffer.push('chan-a', makeMsg({ text: 'second' }));
    await buffer.push('chan-a', makeMsg({ text: 'third' }));

    const drained = await buffer.drain('chan-a');

    expect(drained.map((m) => m.text)).toEqual(['first', 'second', 'third']);
    expect(await buffer.length('chan-a')).toBe(0);
  });

  it('respeita o limite máximo de 1000 mensagens (LTRIM)', async () => {
    for (let i = 0; i < CHAT_BUFFER_MAX_LENGTH + 200; i++) {
      await buffer.push('chan-a', makeMsg({ text: `msg-${i}` }));
    }

    expect(await buffer.length('chan-a')).toBe(CHAT_BUFFER_MAX_LENGTH);

    // As 200 primeiras devem ter sido descartadas — as mais novas sobrevivem.
    const drained = await buffer.drain('chan-a');
    const texts = drained.map((m) => m.text);
    expect(texts).toContain(`msg-${CHAT_BUFFER_MAX_LENGTH + 199}`); // a mais nova
    expect(texts).not.toContain('msg-0'); // a mais antiga foi cortada
  });

  it('aplica TTL de 60s no key', async () => {
    await buffer.push('chan-a', makeMsg());
    const ttl = await redis.ttl('chat:buffer:chan-a');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(CHAT_BUFFER_TTL_SECONDS);
  });

  it('isola buffers entre canais', async () => {
    await buffer.push('chan-a', makeMsg({ text: 'A1' }));
    await buffer.push('chan-b', makeMsg({ text: 'B1' }));
    await buffer.push('chan-b', makeMsg({ text: 'B2' }));

    expect(await buffer.length('chan-a')).toBe(1);
    expect(await buffer.length('chan-b')).toBe(2);

    const drainedA = await buffer.drain('chan-a');
    expect(drainedA.map((m) => m.text)).toEqual(['A1']);
    expect(await buffer.length('chan-b')).toBe(2); // canal B intacto
  });

  it('drain em buffer vazio devolve []', async () => {
    expect(await buffer.drain('inexistente')).toEqual([]);
  });

  it('peek com n limita o resultado', async () => {
    for (let i = 0; i < 10; i++) {
      await buffer.push('chan-a', makeMsg({ text: `msg-${i}` }));
    }
    const peeked = await buffer.peek('chan-a', 3);
    expect(peeked).toHaveLength(3);
  });

  it('mensagem corrompida no buffer é ignorada sem derrubar drain', async () => {
    await buffer.push('chan-a', makeMsg({ text: 'good' }));
    // Injeta payload inválido manualmente.
    await redis.lpush('chat:buffer:chan-a', 'not-json{');

    const drained = await buffer.drain('chan-a');
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toBe('good');
  });
});

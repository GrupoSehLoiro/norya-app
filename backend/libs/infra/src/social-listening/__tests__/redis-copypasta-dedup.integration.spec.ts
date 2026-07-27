/**
 * Integration test do RedisCopypastaDedupService — hits Redis REAL do
 * compose (sehloro-redis). Skip com warn se REDIS_URL não estiver acessível.
 */
import { Redis } from 'ioredis';
import type { RawMessage } from '@sehloro/domain';
import { RedisCopypastaDedupService } from '../redis-copypasta-dedup.service';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

function mkMsg(id: string, text: string, username = 'u' + id): RawMessage {
  return {
    id,
    platform: 'twitch',
    channelExternalId: 'ch1',
    channelName: 'c1',
    user: {
      externalId: 'ext_' + username,
      username,
      displayName: username,
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

describe('RedisCopypastaDedupService (integration)', () => {
  let redis: Redis;
  let service: RedisCopypastaDedupService;
  let reachable = false;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
      await redis.ping();
      reachable = true;
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[dedup-integration] Redis em ${REDIS_URL} indisponível — pulando`);
    }
    service = new RedisCopypastaDedupService(redis);
  });

  afterEach(async () => {
    if (!reachable) return;
    const keys = await redis.keys('cp:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    try {
      await redis.quit();
    } catch {}
  });

  it('100 msgs idênticas → unique=1, group count=100', async () => {
    if (!reachable) return;
    const msgs = Array.from({ length: 100 }, (_, i) => mkMsg('m' + i, 'PogChamp letsgooo'));
    const result = await service.process(msgs);
    expect(result.unique.length).toBe(1);
    expect(result.dedupCount).toBe(99);
    const [hash, count] = [...result.groups.entries()][0]!;
    expect(typeof hash).toBe('string');
    expect(count).toBe(100);
  });

  it('50 idênticas + 50 distintas → unique=51', async () => {
    if (!reachable) return;
    const same = Array.from({ length: 50 }, (_, i) => mkMsg('s' + i, 'copy paste viraliza'));
    const distinct = Array.from({ length: 50 }, (_, i) =>
      mkMsg('d' + i, 'frase única numero ' + i),
    );
    const r = await service.process([...same, ...distinct]);
    expect(r.unique.length).toBe(51);
    expect(r.dedupCount).toBe(49);
  });

  it('mesma copypasta em batches diferentes preserva count via Redis TTL', async () => {
    if (!reachable) return;
    const r1 = await service.process([mkMsg('m1', 'mesma frase')]);
    const r2 = await service.process([mkMsg('m2', 'mesma frase')]);
    expect(r1.unique.length).toBe(1);
    expect(r2.unique.length).toBe(0); // já existia no Redis
    const hash = [...r2.groups.keys()][0]!;
    expect(r2.groups.get(hash)).toBe(2); // INCR contou as duas
  });

  it('batch vazio retorna estrutura vazia', async () => {
    if (!reachable) return;
    const r = await service.process([]);
    expect(r.unique).toEqual([]);
    expect(r.dedupCount).toBe(0);
    expect(r.groups.size).toBe(0);
  });

  it('variações de espaçamento/case são consideradas iguais (mesma chave)', async () => {
    if (!reachable) return;
    const r = await service.process([
      mkMsg('a', '  POGchamp letsgoo  '),
      mkMsg('b', 'pogchamp letsgoo'),
    ]);
    expect(r.unique.length).toBe(1);
    expect(r.dedupCount).toBe(1);
  });

  it('variantes de risada (kkk/KKKKKK/hahaha) agrupam no mesmo hash', async () => {
    if (!reachable) return;
    const r = await service.process([
      mkMsg('a', 'kkk'),
      mkMsg('b', 'KKKKKKKKKK'),
      mkMsg('c', 'hahahaha'),
      mkMsg('d', 'rsrsrs'),
    ]);
    expect(r.unique.length).toBe(1);
    expect(r.dedupCount).toBe(3);
  });

  it('countsByMsgId traz o peso por-janela da msg única', async () => {
    if (!reachable) return;
    const same = Array.from({ length: 20 }, (_, i) => mkMsg('s' + i, 'KKKK que jogada'));
    const solo = mkMsg('x1', 'ok entendi tudo');
    const r = await service.process([...same, solo]);
    expect(r.unique.length).toBe(2);
    expect(r.countsByMsgId.get('s0')).toBe(20);
    expect(r.countsByMsgId.get('x1')).toBe(1);
  });
});

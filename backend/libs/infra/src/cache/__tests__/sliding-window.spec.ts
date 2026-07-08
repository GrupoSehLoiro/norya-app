import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import {
  chatRateKey,
  DEFAULT_WINDOW_MS,
  SlidingWindowService,
  WINDOW_KEY_TTL_SECONDS,
  WINDOW_RETENTION_MS,
} from '../sliding-window';

describe('SlidingWindowService', () => {
  let redis: Redis;
  let window: SlidingWindowService;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    window = new SlidingWindowService(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('record + count: 100 eventos em 10s gera rate ~10/s', async () => {
    const now = 1_700_000_000_000;
    const key = chatRateKey('chan-1');

    // 100 eventos espalhados em 10s: um a cada 100ms.
    for (let i = 0; i < 100; i++) {
      await window.record(key, `msg-${i}`, now - 10_000 + i * 100);
    }

    const rate = await window.rate(key, 10_000, now);
    expect(rate).toBeGreaterThan(9.5);
    expect(rate).toBeLessThan(10.5);
  });

  it('count restringe ao intervalo solicitado', async () => {
    const now = 1_700_000_000_000;
    const key = 'span';

    await window.record(key, 'a', now - 25_000); // fora da janela de 10s
    await window.record(key, 'b', now - 5_000); // dentro
    await window.record(key, 'c', now - 1_000); // dentro
    await window.record(key, 'd', now); // dentro

    expect(await window.count(key, 10_000, now)).toBe(3);
    expect(await window.count(key, 30_000, now)).toBe(4);
  });

  it('eventos mais velhos que WINDOW_RETENTION_MS são descartados no próximo record', async () => {
    const now = 1_700_000_000_000;
    const key = 'retention';

    // Velho: deve ser cortado quando o próximo record rodar.
    await window.record(key, 'old', now - WINDOW_RETENTION_MS - 5_000);
    expect(await redis.zcard(key)).toBe(1);

    // Novo: o MULTI dentro do record limpa o velho.
    await window.record(key, 'new', now);
    expect(await redis.zcard(key)).toBe(1); // só o novo restou

    const members = await redis.zrange(key, 0, -1);
    expect(members).toEqual(['new']);
  });

  it('ZADD é idempotente para o mesmo member', async () => {
    const key = 'idempotent';
    await window.record(key, 'same', 1_000);
    await window.record(key, 'same', 2_000);
    await window.record(key, 'same', 3_000);

    expect(await redis.zcard(key)).toBe(1);
    // O score final reflete a última chamada.
    const score = await redis.zscore(key, 'same');
    expect(Number(score)).toBe(3_000);
  });

  it('aplica TTL no key', async () => {
    const key = 'ttl-test';
    await window.record(key, 'a');
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(WINDOW_KEY_TTL_SECONDS);
  });

  it('isola janelas entre keys diferentes', async () => {
    const now = 1_700_000_000_000;
    await window.record('alpha', 'a1', now);
    await window.record('alpha', 'a2', now);
    await window.record('beta', 'b1', now);

    expect(await window.count('alpha', 10_000, now)).toBe(2);
    expect(await window.count('beta', 10_000, now)).toBe(1);
  });

  it('rate capa a janela em WINDOW_RETENTION_MS', async () => {
    const now = 1_700_000_000_000;
    const key = 'cap';

    // Registra 30 eventos nos últimos 30s.
    for (let i = 0; i < 30; i++) {
      await window.record(key, `e${i}`, now - i * 1_000);
    }

    // Pede rate em janela de 5 minutos — deve capar em 60s (retenção).
    const rate = await window.rate(key, 5 * 60_000, now);
    // 30 eventos / 60s = 0.5/s
    expect(rate).toBeCloseTo(0.5, 1);
  });

  it('clear apaga a janela', async () => {
    const key = 'to-clear';
    await window.record(key, 'a');
    await window.record(key, 'b');
    expect(await redis.zcard(key)).toBe(2);

    await window.clear(key);
    expect(await redis.exists(key)).toBe(0);
  });

  it('count default usa DEFAULT_WINDOW_MS', async () => {
    const now = 1_700_000_000_000;
    const key = 'default';

    await window.record(key, 'inside', now - DEFAULT_WINDOW_MS / 2);
    await window.record(key, 'outside', now - DEFAULT_WINDOW_MS - 5_000);

    // outside está fora da janela default mas dentro de WINDOW_RETENTION_MS,
    // então só é cortado por ZREMRANGEBYSCORE depois do próximo record.
    // count com janela default deve contar apenas o de dentro.
    const c = await window.count(key, undefined, now);
    expect(c).toBe(1);
  });
});

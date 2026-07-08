import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { InMemoryNonceStore, RedisNonceStore } from './nonce-store';

describe('InMemoryNonceStore', () => {
  it('primeira chamada retorna true, segunda false', async () => {
    const store = new InMemoryNonceStore();
    expect(await store.setIfAbsent('m1', 60)).toBe(true);
    expect(await store.setIfAbsent('m1', 60)).toBe(false);
  });

  it('keys distintas não colidem', async () => {
    const store = new InMemoryNonceStore();
    expect(await store.setIfAbsent('a', 60)).toBe(true);
    expect(await store.setIfAbsent('b', 60)).toBe(true);
  });
});

describe('RedisNonceStore', () => {
  let redis: Redis;
  let store: RedisNonceStore;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    store = new RedisNonceStore(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('SETNX retorna true na primeira vez e false na repetição', async () => {
    expect(await store.setIfAbsent('m1', 60)).toBe(true);
    expect(await store.setIfAbsent('m1', 60)).toBe(false);
  });

  it('aplica TTL na key', async () => {
    await store.setIfAbsent('m1', 60);
    const ttl = await redis.ttl('nonce:twitch:m1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});

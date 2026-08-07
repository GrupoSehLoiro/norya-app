import { LlmResultCacheService } from './llm-result-cache.service';

/** Redis fake com a superfície mínima que o serviço usa. */
class FakeRedis {
  store = new Map<string, string>();
  failGet = false;
  failSet = false;
  lastSetArgs: unknown[] = [];

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('redis down');
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, mode: string, ttl: number): Promise<unknown> {
    if (this.failSet) throw new Error('redis down');
    this.lastSetArgs = [key, value, mode, ttl];
    this.store.set(key, value);
    return 'OK';
  }
}

describe('LlmResultCacheService — backend Redis', () => {
  it('grava com EX e lê de volta o valor desserializado', async () => {
    const redis = new FakeRedis();
    const svc = new LlmResultCacheService(redis);

    await svc.set('topics:c1', { labels: ['hype'] }, 600);
    expect(redis.lastSetArgs).toEqual(['sl:llmcache:topics:c1', '{"labels":["hype"]}', 'EX', 600]);
    await expect(svc.get('topics:c1')).resolves.toEqual({ labels: ['hype'] });
  });

  it('miss devolve null', async () => {
    const svc = new LlmResultCacheService(new FakeRedis());
    await expect(svc.get('nao-existe')).resolves.toBeNull();
  });

  it('fail-open: erro no get vira miss, não exceção', async () => {
    const redis = new FakeRedis();
    redis.failGet = true;
    const svc = new LlmResultCacheService(redis);
    await expect(svc.get('qualquer')).resolves.toBeNull();
  });

  it('fail-open: erro no set é engolido', async () => {
    const redis = new FakeRedis();
    redis.failSet = true;
    const svc = new LlmResultCacheService(redis);
    await expect(svc.set('k', { a: 1 }, 60)).resolves.toBeUndefined();
  });
});

describe('LlmResultCacheService — fallback em memória (sem Redis)', () => {
  it('grava e lê sem Redis', async () => {
    const svc = new LlmResultCacheService(null);
    await svc.set('k', { v: 42 }, 60);
    await expect(svc.get('k')).resolves.toEqual({ v: 42 });
  });

  it('expira por TTL na leitura', async () => {
    const svc = new LlmResultCacheService(null);
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    await svc.set('k', { v: 1 }, 10);

    nowSpy.mockReturnValue(1_000_000 + 9_000);
    await expect(svc.get('k')).resolves.toEqual({ v: 1 });

    nowSpy.mockReturnValue(1_000_000 + 11_000);
    await expect(svc.get('k')).resolves.toBeNull();
    nowSpy.mockRestore();
  });

  it('não cresce sem limite: poda ao estourar o teto', async () => {
    const svc = new LlmResultCacheService(null);
    for (let i = 0; i < 520; i++) await svc.set(`k${i}`, { i }, 3600);
    // A entrada mais antiga saiu; a mais recente continua.
    await expect(svc.get('k0')).resolves.toBeNull();
    await expect(svc.get('k519')).resolves.toEqual({ i: 519 });
  });
});

describe('ttlForRange', () => {
  const svc = new LlmResultCacheService(null);

  it('período fechado (terminou há >10min) → TTL longo', () => {
    const to = new Date(Date.now() - 60 * 60_000);
    expect(svc.ttlForRange(to)).toBe(6 * 3600);
  });

  it('período aberto/rolante → TTL curto', () => {
    expect(svc.ttlForRange(null)).toBe(600);
    expect(svc.ttlForRange(new Date())).toBe(600);
  });
});

describe('fingerprint', () => {
  const svc = new LlmResultCacheService(null);

  it('sem contexto → chave estável "none"', () => {
    expect(svc.fingerprint(undefined)).toBe('none');
    expect(svc.fingerprint('')).toBe('none');
  });

  it('mesmo texto → mesma chave; texto editado → chave diferente', () => {
    const a = svc.fingerprint('marca X patrocina o canal');
    expect(svc.fingerprint('marca X patrocina o canal')).toBe(a);
    // É isso que faz o resultado antigo parar de ser servido após uma edição
    // no Treinamento IA.
    expect(svc.fingerprint('marca Y patrocina o canal')).not.toBe(a);
  });
});

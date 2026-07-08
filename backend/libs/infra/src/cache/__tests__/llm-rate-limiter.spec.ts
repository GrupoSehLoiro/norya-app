import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import {
  DEFAULT_MONTHLY_TOKEN_BUDGET,
  DEFAULT_TOKENS_PER_MINUTE,
  LlmRateLimitExceededError,
  LlmRateLimiterService,
  MINUTE_KEY_TTL_SECONDS,
  MONTHLY_KEY_TTL_SECONDS,
} from '../llm-rate-limiter';

describe('LlmRateLimiterService', () => {
  let redis: Redis;
  let limiter: LlmRateLimiterService;
  // Tetos pequenos para tornar os testes determinísticos.
  const monthlyBudget = 1_000;
  const tokensPerMinute = 100;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    limiter = new LlmRateLimiterService(redis, { monthlyBudget, tokensPerMinute });
  });

  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('permite acquires dentro dos dois limites e debita corretamente', async () => {
    const now = new Date('2026-05-11T12:00:30Z');
    // 5 chamadas de 20 tokens = 100 tokens totais (bate o limite/min mas não passa).
    for (let i = 0; i < 5; i++) {
      const r = await limiter.tryAcquire('chan-1', 20, now);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeNull();
    }

    const remaining = await limiter.getRemaining('chan-1', now);
    expect(remaining.remainingMonthly).toBe(monthlyBudget - 100);
    expect(remaining.remainingMinute).toBe(0);
  });

  it('bloqueia ao estourar o limite por minuto e identifica reason="minute"', async () => {
    const now = new Date('2026-05-11T12:00:00Z');

    // 100 tokens dentro do minuto → ok
    await limiter.tryAcquire('chan-1', 100, now);
    // mais 1 → estoura o minuto, mas mensal ainda tem espaço
    const r = await limiter.tryAcquire('chan-1', 1, now);

    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('minute');
    expect(r.remainingMinute).toBe(0);
    expect(r.resetAt!.toISOString()).toBe('2026-05-11T12:01:00.000Z'); // próxima virada
  });

  it('bloqueia ao estourar o limite mensal e identifica reason="monthly"', async () => {
    // Mensal = 1000 tokens; gastamos em 10 chamadas de 100 ao longo de minutos
    // diferentes para não esbarrar no limite por minuto.
    for (let m = 0; m < 10; m++) {
      const now = new Date(`2026-05-11T12:${String(m).padStart(2, '0')}:00Z`);
      const r = await limiter.tryAcquire('chan-1', 100, now);
      expect(r.allowed).toBe(true);
    }

    // 11ª chamada de 1 token estoura o mensal.
    const next = new Date('2026-05-11T12:10:30Z');
    const blocked = await limiter.tryAcquire('chan-1', 1, next);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('monthly');
    expect(blocked.remainingMonthly).toBe(0);
    expect(blocked.resetAt!.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('quando bloqueado, NÃO debita — chamadas dentro do limite seguintes ainda passam', async () => {
    const now = new Date('2026-05-11T12:00:00Z');

    await limiter.tryAcquire('chan-1', 90, now); // resta 10 tokens no minuto
    const blocked = await limiter.tryAcquire('chan-1', 20, now); // pediu 20, sobram 10 → bloqueia
    expect(blocked.allowed).toBe(false);

    // O bloqueio não deve ter debitado os 20 — ainda devem caber 10.
    const ok = await limiter.tryAcquire('chan-1', 10, now);
    expect(ok.allowed).toBe(true);
  });

  it('isola contadores entre canais distintos', async () => {
    const now = new Date('2026-05-11T12:00:00Z');
    await limiter.tryAcquire('chan-a', 100, now); // chan-a no limite
    const r = await limiter.tryAcquire('chan-b', 100, now); // chan-b limpo
    expect(r.allowed).toBe(true);
  });

  it('virada de minuto reseta o contador por minuto', async () => {
    const t0 = new Date('2026-05-11T12:00:30Z');
    await limiter.tryAcquire('chan-1', 100, t0);

    const blocked = await limiter.tryAcquire('chan-1', 1, t0);
    expect(blocked.allowed).toBe(false);

    // 35s depois, ainda mesmo minuto-segundo: bloqueado.
    const sameMinute = new Date('2026-05-11T12:00:55Z');
    expect((await limiter.tryAcquire('chan-1', 1, sameMinute)).allowed).toBe(false);

    // 12:01:00 — virada — chave nova, contador zero.
    const nextMinute = new Date('2026-05-11T12:01:00Z');
    const allowed = await limiter.tryAcquire('chan-1', 1, nextMinute);
    expect(allowed.allowed).toBe(true);
  });

  it('virada de mês reseta o contador mensal', async () => {
    // Esgota o mensal em maio.
    for (let m = 0; m < 10; m++) {
      const now = new Date(`2026-05-11T12:${String(m).padStart(2, '0')}:00Z`);
      await limiter.tryAcquire('chan-1', 100, now);
    }
    expect((await limiter.tryAcquire('chan-1', 1, new Date('2026-05-11T13:00:00Z'))).allowed).toBe(
      false,
    );

    // Em junho, chave diferente: cota reabre.
    const inJune = new Date('2026-06-01T00:00:00Z');
    const r = await limiter.tryAcquire('chan-1', 50, inJune);
    expect(r.allowed).toBe(true);
  });

  it('acquire (variante throwing) lança LlmRateLimitExceededError quando bloqueado', async () => {
    const now = new Date('2026-05-11T12:00:00Z');
    await limiter.acquire('chan-1', 100, now);

    await expect(limiter.acquire('chan-1', 1, now)).rejects.toBeInstanceOf(
      LlmRateLimitExceededError,
    );
  });

  it('cost <= 0 lança imediatamente', async () => {
    await expect(limiter.tryAcquire('chan-1', 0)).rejects.toThrow('cost must be > 0');
    await expect(limiter.tryAcquire('chan-1', -10)).rejects.toThrow();
  });

  it('aplica TTL nas duas chaves', async () => {
    const now = new Date('2026-05-11T12:00:00Z');
    await limiter.tryAcquire('chan-1', 1, now);

    const monthlyTtl = await redis.ttl('llmbudget:chan-1:202605');
    const minuteTtl = await redis.ttl(`llmrate:chan-1:${Math.floor(now.getTime() / 60_000)}`);

    expect(monthlyTtl).toBeGreaterThan(0);
    expect(monthlyTtl).toBeLessThanOrEqual(MONTHLY_KEY_TTL_SECONDS);
    expect(minuteTtl).toBeGreaterThan(0);
    expect(minuteTtl).toBeLessThanOrEqual(MINUTE_KEY_TTL_SECONDS);
  });

  it('defaults expostos batem com a documentação', () => {
    expect(DEFAULT_MONTHLY_TOKEN_BUDGET).toBe(5_000_000);
    expect(DEFAULT_TOKENS_PER_MINUTE).toBe(200);
  });
});

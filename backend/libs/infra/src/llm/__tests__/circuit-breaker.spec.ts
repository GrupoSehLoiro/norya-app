import { CircuitBreaker } from '../circuit-breaker';

describe('CircuitBreaker', () => {
  it('inicia em CLOSED e permite chamadas', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.allow()).toBe(true);
  });

  it('5 falhas consecutivas → OPEN', () => {
    const cb = new CircuitBreaker({ maxFailures: 5 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.allow()).toBe(false);
  });

  it('taxa de erro >50% em 10+ chamadas → OPEN', () => {
    const cb = new CircuitBreaker({ maxFailures: 100, minSampleSize: 10, errorRateThreshold: 0.5 });
    for (let i = 0; i < 5; i++) cb.recordSuccess();
    for (let i = 0; i < 5; i++) cb.recordFailure();
    // Mas a janela "consecutiva" reseta failures ao receber sucesso após windowMs;
    // aqui sucessos e falhas dentro do mesmo window — failures=5, successes=5 → 50% gatilho.
    expect(cb.getState()).toBe('OPEN');
  });

  it('após cooldown vai para HALF_OPEN', () => {
    const cb = new CircuitBreaker({ maxFailures: 1, cooldownMs: 5 });
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    return new Promise<void>((r) =>
      setTimeout(() => {
        expect(cb.getState()).toBe('HALF_OPEN');
        cb.recordSuccess();
        expect(cb.getState()).toBe('CLOSED');
        r();
      }, 10),
    );
  });

  it('HALF_OPEN + falha → volta para OPEN', () => {
    const cb = new CircuitBreaker({ maxFailures: 1, cooldownMs: 5 });
    cb.recordFailure();
    return new Promise<void>((r) =>
      setTimeout(() => {
        expect(cb.getState()).toBe('HALF_OPEN');
        cb.recordFailure();
        expect(cb.getState()).toBe('OPEN');
        r();
      }, 10),
    );
  });
});

/**
 * Circuit breaker mínimo — M4 LLM-06.
 *
 * Estados:
 *   CLOSED      → chamadas passam, conta falhas.
 *   OPEN        → chamadas falham instantaneamente (fast-fail).
 *   HALF_OPEN   → 1 chamada teste; se ok → CLOSED, se falha → OPEN.
 *
 * Política:
 *   - 5 falhas consecutivas dentro de `windowMs` (10s) → abre por `cooldownMs` (30s)
 *   - taxa de erro >= 50% num lote de >=10 chamadas → também abre
 *
 * Simples, sem libs (opossum etc) — basta pro MVP.
 */
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
  windowMs?: number; // janela para "consecutiva" (default 10_000)
  cooldownMs?: number; // tempo em OPEN antes do half-open (default 30_000)
  maxFailures?: number; // consecutivas para abrir (default 5)
  minSampleSize?: number; // chamadas mínimas para avaliar taxa (default 10)
  errorRateThreshold?: number; // 0..1 (default 0.5)
}

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureAt = 0;
  private openedAt = 0;
  private readonly opts: Required<BreakerOptions>;

  constructor(opts?: BreakerOptions) {
    this.opts = {
      windowMs: opts?.windowMs ?? 10_000,
      cooldownMs: opts?.cooldownMs ?? 30_000,
      maxFailures: opts?.maxFailures ?? 5,
      minSampleSize: opts?.minSampleSize ?? 10,
      errorRateThreshold: opts?.errorRateThreshold ?? 0.5,
    };
  }

  getState(): BreakerState {
    this._maybeTransitionToHalfOpen();
    return this.state;
  }

  allow(): boolean {
    return this.getState() !== 'OPEN';
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failures = 0;
      this.successes = 0;
      return;
    }
    this.successes++;
    if (Date.now() - this.lastFailureAt > this.opts.windowMs) {
      this.failures = 0;
    }
  }

  recordFailure(): void {
    const now = Date.now();
    if (now - this.lastFailureAt > this.opts.windowMs) {
      this.failures = 0;
    }
    this.failures++;
    this.lastFailureAt = now;
    if (this.state === 'HALF_OPEN') {
      this._open();
      return;
    }
    if (this.failures >= this.opts.maxFailures) {
      this._open();
      return;
    }
    const total = this.failures + this.successes;
    if (total >= this.opts.minSampleSize && this.failures / total >= this.opts.errorRateThreshold) {
      this._open();
    }
  }

  private _open(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
  }

  private _maybeTransitionToHalfOpen(): void {
    if (this.state === 'OPEN' && Date.now() - this.openedAt > this.opts.cooldownMs) {
      this.state = 'HALF_OPEN';
    }
  }
}

/**
 * RED-03 · LlmRateLimiterService — rate limit por streamer para a cascade LLM.
 *
 * Dois limites independentes em camada (M4 LLM-06 depende):
 *  - mensal por canal: budget global de tokens dentro de um mês calendário
 *    (default 5_000_000 — sobrescritível via env `LLM_BUDGET_TOKENS_MONTHLY`)
 *  - por minuto por canal: protege contra burst (default 200 tokens/min — env
 *    `LLM_RATE_TOKENS_PER_MINUTE`)
 *
 * Estrutura no Redis:
 *   llmbudget:<channelId>:YYYYMM  (INCR, TTL ~40 dias)
 *   llmrate:<channelId>:<minuto>  (INCR, TTL 60s)
 *
 * `tryAcquire` é atômico via Lua: checa AMBOS os limites primeiro e só
 * incrementa se ambos passarem. Sem isso, um canal poderia "atravessar" o
 * teto mensal entre o GET e o INCRBY em concorrência alta.
 *
 * O método não-lança retorna o motivo (`'monthly' | 'minute' | null`) para
 * o caller decidir entre fail-fast, fallback de keyword matching, ou downgrade
 * para uma camada mais barata da cascade.
 *
 * `acquire` é sugar que lança `LlmRateLimitExceededError` se não passar —
 * útil em paths que tratam o limite como erro irrecuperável.
 */
import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

export const DEFAULT_MONTHLY_TOKEN_BUDGET = 5_000_000;
export const DEFAULT_TOKENS_PER_MINUTE = 200;
export const MONTHLY_KEY_TTL_SECONDS = 40 * 24 * 60 * 60; // 40 dias
export const MINUTE_KEY_TTL_SECONDS = 60;

export type RateLimitReason = 'monthly' | 'minute' | null;

export interface AcquireResult {
  allowed: boolean;
  /** Motivo da rejeição. Null quando `allowed=true`. */
  reason: RateLimitReason;
  /** Tokens restantes na cota mensal (após o débito quando allowed=true). */
  remainingMonthly: number;
  /** Tokens restantes na janela do minuto corrente. */
  remainingMinute: number;
  /** Início do próximo período do limite que rejeitou (ou null se permitido). */
  resetAt: Date | null;
}

export interface LlmRateLimiterOptions {
  monthlyBudget?: number;
  tokensPerMinute?: number;
}

export class LlmRateLimitExceededError extends Error {
  constructor(public readonly result: AcquireResult) {
    super(`LLM rate limit exceeded: ${result.reason}`);
    this.name = 'LlmRateLimitExceededError';
  }
}

/**
 * Script Lua que checa os dois limites e só incrementa se ambos passarem.
 * Retorna [allowed (0|1), remainingMonthly, remainingMinute, reason ('','monthly','minute')].
 */
const ACQUIRE_SCRIPT = `
local monthlyKey = KEYS[1]
local minuteKey = KEYS[2]
local cost = tonumber(ARGV[1])
local monthlyLimit = tonumber(ARGV[2])
local minuteLimit = tonumber(ARGV[3])
local monthlyTtl = tonumber(ARGV[4])
local minuteTtl = tonumber(ARGV[5])

local monthly = tonumber(redis.call('GET', monthlyKey) or '0')
if monthly + cost > monthlyLimit then
  return {0, monthlyLimit - monthly, -1, 'monthly'}
end

local minute = tonumber(redis.call('GET', minuteKey) or '0')
if minute + cost > minuteLimit then
  return {0, monthlyLimit - monthly, minuteLimit - minute, 'minute'}
end

redis.call('INCRBY', monthlyKey, cost)
redis.call('EXPIRE', monthlyKey, monthlyTtl)
redis.call('INCRBY', minuteKey, cost)
redis.call('EXPIRE', minuteKey, minuteTtl)

return {1, monthlyLimit - monthly - cost, minuteLimit - minute - cost, ''}
`;

@Injectable()
export class LlmRateLimiterService {
  private readonly logger = new Logger(LlmRateLimiterService.name);
  private readonly monthlyBudget: number;
  private readonly tokensPerMinute: number;

  constructor(
    private readonly redis: Redis,
    options: LlmRateLimiterOptions = {},
  ) {
    this.monthlyBudget = options.monthlyBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET;
    this.tokensPerMinute = options.tokensPerMinute ?? DEFAULT_TOKENS_PER_MINUTE;
  }

  /**
   * Tenta debitar `cost` tokens para `channelId`. Atômico contra os dois limites.
   * Nunca lança — devolve o motivo via `result.reason`.
   */
  async tryAcquire(
    channelId: string,
    cost: number,
    now: Date = new Date(),
  ): Promise<AcquireResult> {
    if (cost <= 0) {
      throw new Error('cost must be > 0');
    }

    const monthlyKey = this._monthlyKey(channelId, now);
    const minuteKey = this._minuteKey(channelId, now);

    const raw = (await this.redis.eval(
      ACQUIRE_SCRIPT,
      2,
      monthlyKey,
      minuteKey,
      String(cost),
      String(this.monthlyBudget),
      String(this.tokensPerMinute),
      String(MONTHLY_KEY_TTL_SECONDS),
      String(MINUTE_KEY_TTL_SECONDS),
    )) as [number, number, number, string];

    const allowed = raw[0] === 1;
    const remainingMonthly = raw[1];
    const remainingMinute = raw[2] === -1 ? this.tokensPerMinute : raw[2];
    const reason = (raw[3] || null) as RateLimitReason;

    return {
      allowed,
      reason,
      remainingMonthly,
      remainingMinute,
      resetAt: allowed ? null : this._resetFor(reason, now),
    };
  }

  /** Sugar de `tryAcquire` que lança quando bloqueado. */
  async acquire(channelId: string, cost: number, now: Date = new Date()): Promise<AcquireResult> {
    const result = await this.tryAcquire(channelId, cost, now);
    if (!result.allowed) throw new LlmRateLimitExceededError(result);
    return result;
  }

  /**
   * Quanto sobra de cota para o canal, sem debitar. Útil em painel admin
   * e em telemetria. Devolve ambos os limites do estado corrente.
   */
  async getRemaining(
    channelId: string,
    now: Date = new Date(),
  ): Promise<{
    remainingMonthly: number;
    remainingMinute: number;
  }> {
    const monthlyKey = this._monthlyKey(channelId, now);
    const minuteKey = this._minuteKey(channelId, now);

    const [monthlyRaw, minuteRaw] = await Promise.all([
      this.redis.get(monthlyKey),
      this.redis.get(minuteKey),
    ]);

    return {
      remainingMonthly: this.monthlyBudget - Number(monthlyRaw ?? 0),
      remainingMinute: this.tokensPerMinute - Number(minuteRaw ?? 0),
    };
  }

  private _monthlyKey(channelId: string, now: Date): string {
    const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `llmbudget:${channelId}:${yyyymm}`;
  }

  private _minuteKey(channelId: string, now: Date): string {
    const minute = Math.floor(now.getTime() / 60_000);
    return `llmrate:${channelId}:${minute}`;
  }

  private _resetFor(reason: RateLimitReason, now: Date): Date {
    if (reason === 'monthly') {
      // Primeiro dia do mês seguinte às 00:00 UTC
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    }
    if (reason === 'minute') {
      // Próxima virada de minuto — `floor + 60_000` evita o caso degenerado
      // em que `now` já está exatamente no início de um minuto (ceil(x)===x).
      return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + 60_000);
    }
    return now;
  }
}

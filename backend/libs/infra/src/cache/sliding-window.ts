/**
 * RED-02 · SlidingWindowService — janela rolante de eventos para detecção de pico.
 *
 * Estrutura: sorted set por chave (`<scope>:<id>`), com score = timestamp em ms
 * e member = ID único do evento (msgId, eventId, etc.). O sorted set permite:
 *  - inserção O(log N) via ZADD
 *  - corte do passado via ZREMRANGEBYSCORE -inf <cutoff>
 *  - contagem dentro de janela arbitrária via ZCOUNT
 *
 * Detecção de spike (EVT-01) e viewer swing (EVT-02) do M4 consomem `count`
 * e `rate` para gatilhar a cascade de LLM. Por isso a janela máxima retida é
 * 60s (configurável via WINDOW_RETENTION_MS) — janelas maiores fazem o sorted
 * set crescer e ficam caras de cortar.
 *
 * Atomicidade: ZADD + ZREMRANGEBYSCORE + EXPIRE são feitos via MULTI/EXEC
 * para garantir que o cleanup do passado nunca rode sem o ZADD correspondente.
 *
 * TTL de 120s no key protege contra leak — se nenhum produtor escrever por
 * mais que isso, a chave some inteira.
 */
import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/** Janela máxima retida em Redis (cutoff do ZREMRANGEBYSCORE). */
export const WINDOW_RETENTION_MS = 60_000;
/** TTL do key — duas vezes a retenção para tolerar produtor inativo. */
export const WINDOW_KEY_TTL_SECONDS = 120;
/** Janela padrão para `count` e `rate` quando o caller não especifica. */
export const DEFAULT_WINDOW_MS = 30_000;

@Injectable()
export class SlidingWindowService {
  private readonly logger = new Logger(SlidingWindowService.name);

  constructor(private readonly redis: Redis) {}

  /**
   * Registra um evento na janela. `score` default = now; `value` deve ser
   * único dentro da janela (msgId, eventId, etc.) — se repetir, ZADD apenas
   * atualiza o score do member existente em vez de criar entrada nova.
   */
  async record(key: string, value: string, score: number = Date.now()): Promise<void> {
    const cutoff = score - WINDOW_RETENTION_MS;

    const result = await this.redis
      .multi()
      .zadd(key, score, value)
      .zremrangebyscore(key, '-inf', cutoff)
      .expire(key, WINDOW_KEY_TTL_SECONDS)
      .exec();

    if (!result) {
      this.logger.warn(`record abortado em "${key}" (MULTI retornou null)`);
    }
  }

  /**
   * Conta eventos dentro de `windowMs` a partir de `now` (default = agora).
   * Inclui ambos os extremos do intervalo `[now-windowMs, now]`.
   */
  async count(
    key: string,
    windowMs: number = DEFAULT_WINDOW_MS,
    now: number = Date.now(),
  ): Promise<number> {
    const start = now - windowMs;
    return this.redis.zcount(key, start, now);
  }

  /**
   * Taxa em eventos por segundo dentro da janela. Conveniência sobre `count`.
   * Janela maior do que `WINDOW_RETENTION_MS` é capada — não há dados antes disso.
   */
  async rate(
    key: string,
    windowMs: number = DEFAULT_WINDOW_MS,
    now: number = Date.now(),
  ): Promise<number> {
    const effective = Math.min(windowMs, WINDOW_RETENTION_MS);
    const c = await this.count(key, effective, now);
    return c / (effective / 1000);
  }

  /** Apaga a janela inteira do canal — útil em testes ou em reset de sessão. */
  async clear(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/** Helper de naming consistente para chaves de chat rate. */
export function chatRateKey(channelId: string): string {
  return `chatrate:${channelId}`;
}

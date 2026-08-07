/**
 * LlmResultCacheService — cache de RESULTADOS de chamadas de IA sob demanda
 * (/insights): topics, narrativa do relatório, insight do pico.
 *
 * Motivação de custo: esses endpoints são disparados por clique/visita e o
 * mesmo período costuma ser consultado várias vezes (re-render, outro viewer,
 * re-download do PDF). Sem cache, cada repetição paga o LLM inteiro de novo.
 *
 * Backend: Redis quando disponível (mesma instância do pipeline, TTL nativo);
 * fallback em memória (Map com expiração) quando não há Redis — dev/test
 * continuam funcionando sem infra. Valores serializados em JSON.
 *
 * Fail-open: qualquer erro de cache vira miss — nunca derruba a request.
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_TOKEN } from '@sehloro/infra';

/** Superfície mínima do ioredis usada aqui. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
}

const KEY_PREFIX = 'sl:llmcache:';
/** Teto de entradas do fallback em memória (evita crescer sem limite). */
const MEM_MAX_ENTRIES = 500;

@Injectable()
export class LlmResultCacheService {
  private readonly logger = new Logger(LlmResultCacheService.name);
  private readonly mem = new Map<string, { expiresAt: number; json: string }>();

  constructor(
    @Optional()
    @Inject(REDIS_TOKEN)
    private readonly redis: RedisLike | null,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const full = KEY_PREFIX + key;
    try {
      if (this.redis) {
        const raw = await this.redis.get(full);
        return raw ? (JSON.parse(raw) as T) : null;
      }
    } catch (err) {
      this.logger.warn(`cache get falhou (${full}): ${(err as Error).message} — miss`);
      return null;
    }
    const hit = this.mem.get(full);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.mem.delete(full);
      return null;
    }
    return JSON.parse(hit.json) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const full = KEY_PREFIX + key;
    const json = JSON.stringify(value);
    try {
      if (this.redis) {
        await this.redis.set(full, json, 'EX', ttlSeconds);
        return;
      }
    } catch (err) {
      this.logger.warn(`cache set falhou (${full}): ${(err as Error).message} — ignorando`);
      return;
    }
    // Fallback memória: expira por leitura + poda simples quando estoura.
    if (this.mem.size >= MEM_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.mem) {
        if (now > v.expiresAt) this.mem.delete(k);
      }
      // Ainda cheio (nada expirado): descarta o mais antigo (ordem de inserção).
      if (this.mem.size >= MEM_MAX_ENTRIES) {
        const oldest = this.mem.keys().next().value;
        if (oldest) this.mem.delete(oldest);
      }
    }
    this.mem.set(full, { expiresAt: Date.now() + ttlSeconds * 1000, json });
  }

  /**
   * TTL padrão por tipo de período: intervalo FECHADO (terminou há >10min)
   * não muda mais → cache longo; período aberto/rolante muda a cada batch
   * novo → cache curto (economiza rajadas de cliques, não congela a UI).
   */
  ttlForRange(to: Date | null, opts?: { closedTtl?: number; openTtl?: number }): number {
    const closed = to !== null && to.getTime() < Date.now() - 10 * 60_000;
    return closed ? (opts?.closedTtl ?? 6 * 3600) : (opts?.openTtl ?? 600);
  }

  /**
   * Pedaço de chave que representa uma entrada VARIÁVEL do prompt (hoje: o
   * bloco de Treinamento IA do canal). Sem isso, editar o treinamento não
   * invalidava nada e o canal continuava servindo o texto antigo por até 6h
   * em período fechado. `undefined` → 'none' (chave estável para "sem contexto").
   */
  fingerprint(input?: string): string {
    if (!input) return 'none';
    return createHash('sha256').update(input).digest('hex').slice(0, 12);
  }
}

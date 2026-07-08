/**
 * RED-01 · ChatBufferService — buffer rotativo de mensagens de chat por canal.
 *
 * Pipeline IA (M4) precisa de uma janela curta de mensagens recentes
 * agrupadas por canal antes de processar (dedup, sentimento, triggers).
 * Em vez de manter isso em memória do worker (perde tudo em crash), guardamos
 * em Redis com TTL curto.
 *
 * Estrutura: `chat:buffer:<channelId>` é uma LIST do Redis.
 * - `push(channelId, msg)` faz LPUSH + LTRIM 0 999 + EXPIRE 60 dentro de
 *   um MULTI/EXEC — atômico para que LTRIM nunca rode sem o LPUSH correspondente.
 * - `drain(channelId)` faz LRANGE 0 -1 + DEL atomicamente — quem dreno consome
 *   a janela inteira e a próxima janela começa do zero.
 * - `peek(channelId, n)` é não-destrutivo — útil para debug/monitoring.
 *
 * Limite de 1000 msgs por canal (LTRIM 0 999) protege contra canais virais.
 * TTL de 60s evita leak quando o worker morre sem chamar drain.
 *
 * Serialização: JSON. O campo `receivedAt: Date` é serializado como ISO string
 * pelo JSON.stringify e revivido por _revive na deserialização — para o consumer
 * receber novamente um `Date` real, não uma string.
 */
import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { RawMessage } from '@sehloro/domain';

export const CHAT_BUFFER_MAX_LENGTH = 1000;
export const CHAT_BUFFER_TTL_SECONDS = 60;

@Injectable()
export class ChatBufferService {
  private readonly logger = new Logger(ChatBufferService.name);

  constructor(private readonly redis: Redis) {}

  /**
   * Acrescenta uma mensagem ao buffer do canal. O LPUSH coloca no início,
   * de modo que LRANGE 0 -1 devolve da mais recente para a mais antiga.
   */
  async push(channelId: string, msg: RawMessage): Promise<void> {
    const key = this._key(channelId);
    const serialized = JSON.stringify(msg);

    const result = await this.redis
      .multi()
      .lpush(key, serialized)
      .ltrim(key, 0, CHAT_BUFFER_MAX_LENGTH - 1)
      .expire(key, CHAT_BUFFER_TTL_SECONDS)
      .exec();

    if (!result) {
      this.logger.warn(`push abortado em "${key}" (MULTI retornou null)`);
    }
  }

  /**
   * Consome o buffer inteiro do canal — LRANGE seguido de DEL, atômicos.
   * Devolve as mensagens da mais antiga para a mais recente (ordem cronológica)
   * para facilitar o pipeline downstream.
   */
  async drain(channelId: string): Promise<RawMessage[]> {
    const key = this._key(channelId);
    const result = await this.redis.multi().lrange(key, 0, -1).del(key).exec();

    if (!result) return [];

    // Primeiro comando da pipeline; índice [0] é [error, value].
    const [err, raw] = result[0] ?? [null, []];
    if (err) {
      this.logger.error(`drain falhou em "${key}"`, err);
      return [];
    }

    const items = raw as string[];
    // LRANGE devolve do mais recente para o mais antigo (porque usamos LPUSH).
    // Inverter pra entregar em ordem cronológica.
    return items
      .reverse()
      .map((s) => this._parse(s))
      .filter((m): m is RawMessage => m !== null);
  }

  /**
   * Inspeção não-destrutiva. Devolve até `n` mensagens mais recentes
   * (ordem cronológica decrescente — mais nova primeiro).
   */
  async peek(channelId: string, n = 100): Promise<RawMessage[]> {
    const key = this._key(channelId);
    const items = await this.redis.lrange(key, 0, n - 1);
    return items.map((s) => this._parse(s)).filter((m): m is RawMessage => m !== null);
  }

  /** Tamanho atual do buffer — útil para métricas/healthcheck. */
  async length(channelId: string): Promise<number> {
    return this.redis.llen(this._key(channelId));
  }

  /**
   * Inspeção barata dos extremos sem drenar. Usado pelo orchestrator
   * para decidir se a "rajada" do canal terminou (gap de silêncio).
   *
   * `newest` = msg mais recente (head; LPUSH coloca no índice 0).
   * `oldest` = msg mais antiga (tail).
   * Retorna `null` se o buffer está vazio.
   */
  async peekBoundaries(
    channelId: string,
  ): Promise<{ newest: RawMessage; oldest: RawMessage } | null> {
    const key = this._key(channelId);
    const [headRaw, tailRaw] = await Promise.all([
      this.redis.lindex(key, 0),
      this.redis.lindex(key, -1),
    ]);
    if (!headRaw || !tailRaw) return null;
    const newest = this._parse(headRaw);
    const oldest = this._parse(tailRaw);
    if (!newest || !oldest) return null;
    return { newest, oldest };
  }

  private _key(channelId: string): string {
    return `chat:buffer:${channelId}`;
  }

  private _parse(s: string): RawMessage | null {
    try {
      const parsed = JSON.parse(s) as RawMessage;
      // JSON.stringify converte Date para ISO string; reviver de volta.
      if (typeof parsed.receivedAt === 'string') {
        parsed.receivedAt = new Date(parsed.receivedAt);
      }
      return parsed;
    } catch (err) {
      this.logger.error(`falha ao deserializar mensagem do buffer: ${s.slice(0, 80)}...`, err);
      return null;
    }
  }
}

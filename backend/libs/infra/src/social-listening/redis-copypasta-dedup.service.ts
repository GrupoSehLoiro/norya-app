/**
 * RedisCopypastaDedupService — adapter Redis do port `CopypastaDedup`
 * (M4 / PIPE-01). SHA-256 do texto normalizado, primeiros 16 bytes (32 hex
 * chars) como key. SETNX em 'cp:hash:<hash>' marca "primeira ocorrência";
 * INCR em 'cp:count:<hash>' contabiliza ocorrências reais dentro do TTL.
 *
 * Custo Redis por msg: 2 round-trips (SETNX + INCR) ~ 0.5ms p/ Redis local.
 * Para 20k msgs/min/canal isso é desprezível.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import {
  type CopypastaDedup,
  type RawMessage,
  type DedupResult,
  copypastaKey,
} from '@sehloro/domain';
import { REDIS_TOKEN } from '../cache/cache.module';

const HASH_KEY_PREFIX = 'cp:hash:';
const COUNT_KEY_PREFIX = 'cp:count:';
const TTL_SECONDS = 600; // 10 minutos

@Injectable()
export class RedisCopypastaDedupService implements CopypastaDedup {
  private readonly logger = new Logger(RedisCopypastaDedupService.name);

  constructor(@Inject(REDIS_TOKEN) private readonly redis: Redis) {}

  async process(msgs: ReadonlyArray<RawMessage>): Promise<DedupResult> {
    const unique: RawMessage[] = [];
    const groups = new Map<string, number>();
    const countsByMsgId = new Map<string, number>();
    if (msgs.length === 0) {
      return { unique, groups, countsByMsgId, dedupCount: 0 };
    }

    // Hash determinístico em paralelo + Redis pipeline.
    const hashes = msgs.map((m) =>
      createHash('sha256').update(copypastaKey(m.text)).digest('hex').slice(0, 32),
    );

    const seenInBatch = new Set<string>();
    const pipe = this.redis.pipeline();
    for (let i = 0; i < msgs.length; i++) {
      const h = hashes[i]!;
      pipe.set(HASH_KEY_PREFIX + h, '1', 'EX', TTL_SECONDS, 'NX');
      pipe.incr(COUNT_KEY_PREFIX + h);
      pipe.expire(COUNT_KEY_PREFIX + h, TTL_SECONDS);
    }
    const replies = await pipe.exec();
    // replies vem com [err, value] por comando, 3 por msg.
    if (!replies) {
      throw new Error('RedisCopypastaDedup: pipeline retornou null');
    }

    // Contagem LOCAL do batch (peso por-janela) + hash da msg única do grupo.
    const batchCounts = new Map<string, number>();
    const uniqueHashByMsgId = new Map<string, string>();

    for (let i = 0; i < msgs.length; i++) {
      const h = hashes[i]!;
      const setReply = replies[i * 3];
      const incrReply = replies[i * 3 + 1];
      if (setReply?.[0]) {
        this.logger.warn(`SETNX falhou hash=${h}: ${setReply[0].message}`);
      }
      const isFirstEver = setReply?.[1] === 'OK'; // SET NX retorna 'OK' se setou
      const count = (incrReply?.[1] as number) ?? 1;
      groups.set(h, count);
      batchCounts.set(h, (batchCounts.get(h) ?? 0) + 1);

      // Primeira ocorrência: dentro do TTL OU dentro do batch (defesa)
      if (isFirstEver && !seenInBatch.has(h)) {
        unique.push(msgs[i]!);
        seenInBatch.add(h);
        uniqueHashByMsgId.set(msgs[i]!.id, h);
      } else if (!seenInBatch.has(h)) {
        // segunda+ aparição: NÃO entra em unique
      }
    }

    // Peso por-janela da msg única = quantas vezes o grupo apareceu NESTE batch.
    for (const [msgId, h] of uniqueHashByMsgId) {
      countsByMsgId.set(msgId, batchCounts.get(h) ?? 1);
    }

    return {
      unique,
      groups,
      countsByMsgId,
      dedupCount: msgs.length - unique.length,
    };
  }
}

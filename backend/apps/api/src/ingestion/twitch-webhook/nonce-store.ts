/**
 * NonceStore — abstração de SETNX-com-TTL.
 *
 * RedisNonceStore: usa SET key value NX EX ttl. Disponível quando
 * EVENT_BUS_DRIVER=redis (REDIS_TOKEN injetável).
 *
 * InMemoryNonceStore: Map em memória com varredura preguiçosa de expirados.
 * Não cobre múltiplos processos (não dedupliça entre instâncias paralelas),
 * mas é suficiente para dev e para o caso em que webhook não é o transport
 * principal — o WS shard receiver não duplica notifications no mesmo modo.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_TOKEN } from '@sehloro/infra';

export const NONCE_STORE_TOKEN = Symbol('NonceStore');

export interface NonceStore {
  /** Retorna true se a chave foi criada (nonce inédito), false se já existia. */
  setIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
}

@Injectable()
export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    this._sweep(now);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + ttlSeconds * 1000);
    return true;
  }

  private _sweep(now: number): void {
    if (this.seen.size < 1024) return; // sweep só quando cresce
    for (const [k, expiresAt] of this.seen) {
      if (expiresAt < now) this.seen.delete(k);
    }
  }
}

@Injectable()
export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: Redis) {}

  async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(`nonce:twitch:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

/**
 * Factory provider: usa Redis quando disponível, fallback in-memory caso contrário.
 * Usado pelo TwitchWebhookModule.
 */
@Injectable()
export class NonceStoreFactory {
  constructor(@Optional() @Inject(REDIS_TOKEN) private readonly redis: Redis | null) {}

  build(): NonceStore {
    return this.redis ? new RedisNonceStore(this.redis) : new InMemoryNonceStore();
  }
}

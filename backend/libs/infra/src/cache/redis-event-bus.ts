/**
 * RED-04 · RedisEventBus — implementação via ioredis pub/sub.
 *
 * Usa dois clients separados (publisher + subscriber) conforme exigido
 * pelo Redis: um client em modo SUBSCRIBE não pode enviar outros comandos.
 *
 * Serialização: JSON (MessagePack em RED-01 — por ora JSON é suficiente).
 * Suporte a pattern matching: se channel contém '*' usa PSUBSCRIBE.
 *
 * dispose() encerra ambos os clients e limpa handlers.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { EventBus, Unsubscribe } from '@sehloro/domain';

@Injectable()
export class RedisEventBus implements EventBus, OnModuleDestroy {
  private readonly logger = new Logger(RedisEventBus.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();
  private ready = false;

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: true });
    this.sub = new Redis(redisUrl, { lazyConnect: true });

    this.sub.on('message', (ch: string, msg: string) => this._dispatch(ch, msg));
    this.sub.on('pmessage', (_pattern: string, ch: string, msg: string) => this._dispatch(ch, msg));
    this.sub.on('error', (err: Error) => this.logger.error('Redis sub error', err));
    this.pub.on('error', (err: Error) => this.logger.error('Redis pub error', err));
  }

  async publish<T>(channel: string, payload: T): Promise<void> {
    await this._ensureConnected();
    await this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T>(channel: string, handler: (payload: T) => void): Promise<Unsubscribe> {
    await this._ensureConnected();

    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, []);
      if (channel.includes('*')) {
        await this.sub.psubscribe(channel);
      } else {
        await this.sub.subscribe(channel);
      }
    }

    const typedHandler = handler as (payload: unknown) => void;
    this.handlers.get(channel)!.push(typedHandler);

    return async () => {
      const list = this.handlers.get(channel);
      if (!list) return;
      const idx = list.indexOf(typedHandler);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) {
        this.handlers.delete(channel);
        if (channel.includes('*')) {
          await this.sub.punsubscribe(channel);
        } else {
          await this.sub.unsubscribe(channel);
        }
      }
    };
  }

  async dispose(): Promise<void> {
    this.handlers.clear();
    await Promise.all([this.pub.quit(), this.sub.quit()]);
    this.ready = false;
  }

  async onModuleDestroy(): Promise<void> {
    await this.dispose();
  }

  private async _ensureConnected(): Promise<void> {
    if (this.ready) return;
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.ready = true;
  }

  private _dispatch(channel: string, msg: string): void {
    const handlers = this.handlers.get(channel) ?? [];
    let payload: unknown;
    try {
      payload = JSON.parse(msg);
    } catch {
      this.logger.error(`Falha ao parsear msg no canal "${channel}": ${msg}`);
      return;
    }
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (err) {
        this.logger.error(`Handler error no canal "${channel}"`, err);
      }
    }
  }
}

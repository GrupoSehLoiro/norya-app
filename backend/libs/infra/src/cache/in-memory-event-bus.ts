/**
 * RED-04 · InMemoryEventBus — implementação para testes e dev sem Redis.
 *
 * FIFO por canal; handler isolado em try/catch para não derrubar loop.
 * dispose() limpa todos os subscribers.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { EventBus, Unsubscribe } from '@sehloro/domain';

@Injectable()
export class InMemoryEventBus implements EventBus {
  private readonly logger = new Logger(InMemoryEventBus.name);
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>();

  async publish<T>(channel: string, payload: T): Promise<void> {
    const subscribers = this.handlers.get(channel) ?? [];
    for (const handler of [...subscribers]) {
      try {
        handler(payload);
      } catch (err) {
        this.logger.error(`Handler error on channel "${channel}"`, err);
      }
    }
  }

  async subscribe<T>(channel: string, handler: (payload: T) => void): Promise<Unsubscribe> {
    if (!this.handlers.has(channel)) this.handlers.set(channel, []);
    const list = this.handlers.get(channel)!;
    const typedHandler = handler as (payload: unknown) => void;
    list.push(typedHandler);

    return () => {
      const idx = list.indexOf(typedHandler);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  async dispose(): Promise<void> {
    this.handlers.clear();
  }
}

/**
 * RED-04 · EventBus — contract do barramento de eventos assíncrono.
 *
 * Usado para desacoplar publishers (pipeline IA, EventSub handler) dos
 * subscribers (SSE endpoint do dashboard, monitoring handlers).
 *
 * Implementações:
 *  - RedisEventBus (infra) — produção, via ioredis pub/sub
 *  - InMemoryEventBus (infra) — testes e dev sem Redis
 */
export type Unsubscribe = () => void;

export interface EventBus {
  publish<T>(channel: string, payload: T): Promise<void>;
  subscribe<T>(channel: string, handler: (payload: T) => void): Promise<Unsubscribe>;
  dispose(): Promise<void>;
}

export const EVENT_BUS_TOKEN = Symbol('EventBus');

/**
 * CacheModule — provê EVENT_BUS_TOKEN, REDIS_TOKEN e serviços Redis.
 *
 * Driver selecionado por `EVENT_BUS_DRIVER` env (default 'memory' em test,
 * 'redis' caso contrário). REDIS_URL obrigatório quando driver='redis'.
 *
 * REDIS_TOKEN provê um cliente ioredis compartilhado entre ChatBufferService
 * e SlidingWindowService. Em modo 'memory' (test sem Redis) o módulo não
 * registra os serviços de buffer/janela — quem precisar consome diretamente.
 */
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EVENT_BUS_TOKEN } from '@sehloro/domain';
import { InMemoryEventBus } from './in-memory-event-bus';
import { RedisEventBus } from './redis-event-bus';
import { ChatBufferService } from './chat-buffer';
import { SlidingWindowService } from './sliding-window';
import { LlmRateLimiterService } from './llm-rate-limiter';

export const REDIS_TOKEN = Symbol('REDIS_TOKEN');

function pickDriver(config: ConfigService): 'memory' | 'redis' {
  const explicit = config.get<string>('EVENT_BUS_DRIVER');
  if (explicit === 'memory' || explicit === 'redis') return explicit;
  return process.env['NODE_ENV'] === 'test' ? 'memory' : 'redis';
}

@Global()
@Module({
  providers: [
    InMemoryEventBus,
    {
      provide: REDIS_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (pickDriver(config) !== 'redis') return null;
        const url = config.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL obrigatório quando driver=redis');
        return new Redis(url, { lazyConnect: true });
      },
    },
    {
      provide: ChatBufferService,
      inject: [REDIS_TOKEN],
      useFactory: (redis: Redis | null) => (redis ? new ChatBufferService(redis) : null),
    },
    {
      provide: SlidingWindowService,
      inject: [REDIS_TOKEN],
      useFactory: (redis: Redis | null) => (redis ? new SlidingWindowService(redis) : null),
    },
    {
      provide: LlmRateLimiterService,
      inject: [REDIS_TOKEN, ConfigService],
      useFactory: (redis: Redis | null, config: ConfigService) => {
        if (!redis) return null;
        const monthlyBudget = config.get<number>('LLM_BUDGET_TOKENS_MONTHLY');
        const tokensPerMinute = config.get<number>('LLM_RATE_TOKENS_PER_MINUTE');
        return new LlmRateLimiterService(redis, {
          monthlyBudget: monthlyBudget ? Number(monthlyBudget) : undefined,
          tokensPerMinute: tokensPerMinute ? Number(tokensPerMinute) : undefined,
        });
      },
    },
    {
      provide: EVENT_BUS_TOKEN,
      inject: [ConfigService, InMemoryEventBus],
      useFactory: (config: ConfigService, inMemory: InMemoryEventBus) => {
        if (pickDriver(config) !== 'redis') return inMemory;
        const url = config.get<string>('REDIS_URL');
        if (!url) throw new Error('REDIS_URL obrigatório quando EVENT_BUS_DRIVER=redis');
        return new RedisEventBus(url);
      },
    },
  ],
  exports: [
    EVENT_BUS_TOKEN,
    InMemoryEventBus,
    ChatBufferService,
    SlidingWindowService,
    LlmRateLimiterService,
    REDIS_TOKEN,
  ],
})
export class CacheModule {}

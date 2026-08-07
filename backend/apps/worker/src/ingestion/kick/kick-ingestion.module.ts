/**
 * Wiring da ingestão Kick no worker.
 *
 * Importa PersistenceModule (CHANNEL_REPOSITORY) e o CacheModule do infra
 * (ChatBufferService + EVENT_BUS_TOKEN, ambos Redis em produção). Provê o
 * KickRestClient e o creator default que monta um KickPusherProvider real
 * (assina a chatroom pública via Pusher). Em testes, sobrescreva
 * KICK_PROVIDER_CREATOR por um mock.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CacheModule as InfraCacheModule,
  KickPusherProvider,
  KickRestClient,
  PersistenceModule,
  REDIS_TOKEN,
  makeRedisChatroomIdStore,
  parseStaticChatroomIds,
  type RedisChatroomStoreClient,
} from '@sehloro/infra';
import { KickIngestionService } from './kick-ingestion.service';
import { KICK_PROVIDER_CREATOR, type KickProviderCreator } from './kick-ingestion.tokens';

@Module({
  imports: [PersistenceModule, InfraCacheModule],
  providers: [
    {
      provide: KickRestClient,
      inject: [ConfigService, REDIS_TOKEN],
      useFactory: (config: ConfigService, redis: RedisChatroomStoreClient | null) =>
        new KickRestClient({
          clientId: config.get<string>('KICK_CLIENT_ID'),
          clientSecret: config.get<string>('KICK_CLIENT_SECRET'),
          chatroomProxy: config.get<string>('KICK_CHATROOM_PROXY'),
          // Overrides do operador (destrava imediato) + store persistente:
          // o proxy só é necessário 1× na vida de cada canal.
          staticChatroomIds: parseStaticChatroomIds(config.get<string>('KICK_CHATROOM_IDS')),
          store: redis ? makeRedisChatroomIdStore(redis) : undefined,
        }),
    },
    {
      provide: KICK_PROVIDER_CREATOR,
      inject: [KickRestClient],
      useFactory: (rest: KickRestClient): KickProviderCreator => {
        return (channel, chatroomId) =>
          new KickPusherProvider(channel, { chatroomId }, undefined, undefined, rest);
      },
    },
    KickIngestionService,
  ],
  exports: [KickIngestionService],
})
export class KickIngestionModule {}

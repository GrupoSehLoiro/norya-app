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
import {
  CacheModule as InfraCacheModule,
  KickPusherProvider,
  KickRestClient,
  PersistenceModule,
} from '@sehloro/infra';
import { KickIngestionService } from './kick-ingestion.service';
import { KICK_PROVIDER_CREATOR, type KickProviderCreator } from './kick-ingestion.tokens';

@Module({
  imports: [PersistenceModule, InfraCacheModule],
  providers: [
    {
      provide: KickRestClient,
      useFactory: () => new KickRestClient(),
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

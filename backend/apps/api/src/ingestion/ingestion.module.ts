import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PersistenceModule,
  TwitchHelixService,
  KickRestClient,
  WorkerStateSchema,
  WorkerStateSchemaName,
  REDIS_TOKEN,
  makeRedisChatroomIdStore,
  parseStaticChatroomIds,
  type RedisChatroomStoreClient,
} from '@sehloro/infra';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ReconcilerService } from './orchestrator/reconciler.service';
import { ChannelsController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';

/**
 * IngestionModule (M2).
 *
 * Bounded context de ingestão: canais, workers, orquestração.
 *
 * Registra WorkerStateSchema localmente para que o OrchestratorService
 * injete o Model diretamente sem precisar de símbolo no domain layer.
 */
@Module({
  imports: [
    PersistenceModule,
    MongooseModule.forFeature([{ name: WorkerStateSchemaName, schema: WorkerStateSchema }]),
  ],
  controllers: [IngestionController, ChannelsController],
  providers: [
    IngestionService,
    {
      // TwitchHelixService recebe clientId/clientSecret no construtor. Em vez
      // de @Inject() por token, montamos via factory lendo ConfigService.
      // Valores vazios sao aceitos em dev (chamadas ao Helix simplesmente falham).
      provide: TwitchHelixService,
      useFactory: (config: ConfigService) =>
        new TwitchHelixService(
          config.get<string>('TWITCH_CLIENT_ID') ?? '',
          config.get<string>('TWITCH_CLIENT_SECRET') ?? '',
        ),
      inject: [ConfigService],
    },
    {
      // Mesmo padrão do Helix acima: credenciais via ConfigService habilitam o
      // fallback pela API oficial quando o endpoint não-oficial está bloqueado.
      // Cadeia de resolução do chatroomId: override estático → store Redis
      // (persistente) → direto → proxies (Jina sempre por último).
      provide: KickRestClient,
      useFactory: (config: ConfigService, redis: RedisChatroomStoreClient | null) =>
        new KickRestClient({
          clientId: config.get<string>('KICK_CLIENT_ID'),
          clientSecret: config.get<string>('KICK_CLIENT_SECRET'),
          chatroomProxy: config.get<string>('KICK_CHATROOM_PROXY'),
          staticChatroomIds: parseStaticChatroomIds(config.get<string>('KICK_CHATROOM_IDS')),
          store: redis ? makeRedisChatroomIdStore(redis) : undefined,
        }),
      inject: [ConfigService, REDIS_TOKEN],
    },
    OrchestratorService,
    ReconcilerService,
    ChannelsService,
  ],
  exports: [IngestionService, OrchestratorService],
})
export class IngestionModule {}

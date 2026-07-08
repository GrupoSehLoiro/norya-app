import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PersistenceModule,
  TwitchHelixService,
  KickRestClient,
  WorkerStateSchema,
  WorkerStateSchemaName,
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
    KickRestClient,
    OrchestratorService,
    ReconcilerService,
    ChannelsService,
  ],
  exports: [IngestionService, OrchestratorService],
})
export class IngestionModule {}

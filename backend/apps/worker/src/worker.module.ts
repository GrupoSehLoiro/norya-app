import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { zodValidate } from '@sehloro/infra';
import { TwitchConduitWorkerModule } from './ingestion/twitch-conduit/twitch-conduit.module';
import { KickIngestionModule } from './ingestion/kick/kick-ingestion.module';
import { ChatIngestModule } from './ingestion/chat-ingest/chat-ingest.module';
import { WorkerLoggerModule } from './logger/logger.module';

/**
 * Módulo raiz do worker.
 *
 * Carrega Config (mesmo schema da API, via @sehloro/infra) + o módulo do
 * shard receiver EventSub. O receiver instala o conduit + WS client em
 * onApplicationBootstrap, sem necessidade de comando explícito.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: zodValidate,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env.local', '.env'],
    }),
    WorkerLoggerModule,
    TwitchConduitWorkerModule,
    KickIngestionModule,
    ChatIngestModule,
  ],
})
export class WorkerModule {}

/**
 * Wiring do ChatIngestService no worker.
 *
 * ClickHouseClient é provido de forma TOLERANTE: sem CLICKHOUSE_URL o
 * provider resolve para null e o serviço fica inerte (o worker não deve
 * exigir ClickHouse para servir o conduit — diferente da API, onde o
 * AnalyticsModule.forRootAsync falha o boot de propósito).
 *
 * ConfigsLoaderService vem do SocialListeningPersistenceModule (mesma
 * instância de lógica usada pelo orchestrator da API — tier-1 idêntico
 * nos dois processos).
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClickHouseClient,
  PersistenceModule,
  SocialListeningPersistenceModule,
} from '@sehloro/infra';
import { ChatIngestService } from './chat-ingest.service';

@Module({
  imports: [PersistenceModule, SocialListeningPersistenceModule],
  providers: [
    {
      provide: ClickHouseClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ClickHouseClient | null => {
        const url = config.get<string>('CLICKHOUSE_URL');
        if (!url) return null;
        return new ClickHouseClient({
          url,
          username: config.get<string>('CLICKHOUSE_USER') ?? 'default',
          password: config.get<string>('CLICKHOUSE_PASSWORD') ?? '',
          database: config.get<string>('CLICKHOUSE_DB') ?? 'sehloro',
        });
      },
    },
    ChatIngestService,
  ],
  exports: [ChatIngestService],
})
export class ChatIngestModule {}

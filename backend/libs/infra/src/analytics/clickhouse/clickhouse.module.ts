/**
 * AnalyticsModule — provê ClickHouseClient para o restante da aplicação.
 *
 * Uso típico em AppModule:
 *   AnalyticsModule.forRootAsync()
 *
 * O `forRootAsync` lê config via ConfigService — config schema valida que
 * as 4 envs ClickHouse estão presentes em runtime. Se você quiser injetar
 * config diretamente (ex.: testes), use AnalyticsModule.forRoot(cfg).
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CLICKHOUSE_CONFIG, ClickHouseClient, type ClickHouseConfig } from './clickhouse.client';

@Global()
@Module({})
export class AnalyticsModule {
  static forRoot(cfg: ClickHouseConfig): DynamicModule {
    return {
      module: AnalyticsModule,
      providers: [{ provide: CLICKHOUSE_CONFIG, useValue: cfg }, ClickHouseClient],
      exports: [ClickHouseClient],
    };
  }

  static forRootAsync(): DynamicModule {
    return {
      module: AnalyticsModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: CLICKHOUSE_CONFIG,
          inject: [ConfigService],
          useFactory: (config: ConfigService): ClickHouseConfig => {
            const url = config.get<string>('CLICKHOUSE_URL');
            const username = config.get<string>('CLICKHOUSE_USER');
            const password = config.get<string>('CLICKHOUSE_PASSWORD');
            const database = config.get<string>('CLICKHOUSE_DB');
            if (!url || !username || !password || !database) {
              throw new Error(
                'AnalyticsModule.forRootAsync: ' + 'CLICKHOUSE_URL/USER/PASSWORD/DB obrigatórios',
              );
            }
            return { url, username, password, database };
          },
        },
        ClickHouseClient,
      ],
      exports: [ClickHouseClient],
    };
  }
}

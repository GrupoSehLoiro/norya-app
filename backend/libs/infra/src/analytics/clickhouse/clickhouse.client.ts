/**
 * ClickHouseClient — wrapper Nest-injetável sobre `@clickhouse/client`.
 *
 * Por que existir vs. usar `createClient` direto?
 *   - DI: orchestrator/writers recebem `ClickHouseClient` via injector
 *     em vez de chamar a factory; facilita mock em testes.
 *   - Lifecycle: `onModuleDestroy` fecha o pool em shutdown.
 *   - Defaults seguros: compression habilitada, request timeout 30s.
 *
 * Usado por: ChatIngestService (Fase 2/CH-03), BatchAnalysisWriter (Fase 6),
 * insights REST controller (Fase 7), migrate script (compose service).
 */
import { Injectable, Logger, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import {
  createClient,
  type ClickHouseClient as RawClient,
  type ClickHouseClientConfigOptions,
} from '@clickhouse/client';

export const CLICKHOUSE_CONFIG = Symbol('CLICKHOUSE_CONFIG');

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  /** request timeout em ms; default 30s */
  requestTimeoutMs?: number;
}

@Injectable()
export class ClickHouseClient implements OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseClient.name);
  private readonly raw: RawClient;

  constructor(@Inject(CLICKHOUSE_CONFIG) @Optional() cfg?: ClickHouseConfig) {
    if (!cfg) {
      throw new Error(
        'ClickHouseClient: CLICKHOUSE_CONFIG não foi provido. ' +
          'Importe AnalyticsModule.forRoot({...}) ou registre o provider.',
      );
    }
    const opts: ClickHouseClientConfigOptions = {
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      database: cfg.database,
      compression: { request: false, response: true },
      request_timeout: cfg.requestTimeoutMs ?? 30_000,
      clickhouse_settings: {
        // Garante async_insert true por default — bom para batch ingest
        // (PIPE-01/CH-03). Pode ser sobrescrito por chamada.
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    };
    this.raw = createClient(opts);
    this.logger.log(`ClickHouseClient inicializado url=${cfg.url} db=${cfg.database}`);
  }

  /** Acesso ao client raw para casos específicos (streaming, etc). */
  get client(): RawClient {
    return this.raw;
  }

  async ping(): Promise<boolean> {
    const res = await this.raw.ping();
    return res.success;
  }

  /**
   * Executa DDL ou comandos sem retorno (CREATE, ALTER, TRUNCATE...).
   */
  async exec(query: string): Promise<void> {
    await this.raw.exec({ query });
  }

  /**
   * INSERT batch em uma tabela. `values` é array de objetos
   * (formato JSONEachRow).
   */
  async insert<T extends Record<string, unknown>>(table: string, values: T[]): Promise<void> {
    if (values.length === 0) return;
    await this.raw.insert({
      table,
      values,
      format: 'JSONEachRow',
    });
  }

  /**
   * SELECT que retorna array tipado. Use parametrização do client
   * (`query_params`) para evitar injeção quando montar WHEREs.
   */
  async query<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]> {
    const rs = await this.raw.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });
    return rs.json<T>();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.raw.close();
    } catch (err) {
      this.logger.warn(`Falha ao fechar ClickHouseClient: ${(err as Error).message}`);
    }
  }
}

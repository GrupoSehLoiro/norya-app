import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

/**
 * Boot do worker como standalone application (sem servidor HTTP).
 *
 * Consumers ativos: conduit EventSub (Twitch), ingestão Kick e chat ingest
 * para o ClickHouse. Logs estruturados via pino (WorkerLoggerModule) — mesmo
 * padrão da API.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  // Troca o Logger default do Nest pelo pino estruturado.
  app.useLogger(app.get(PinoLogger));

  const logger = new Logger('worker');
  logger.log('[worker] ready');

  // Graceful shutdown nos signals usuais (SIGINT/SIGTERM)
  app.enableShutdownHooks();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] falha fatal ao subir:', err);
  process.exit(1);
});

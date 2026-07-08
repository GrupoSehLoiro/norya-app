import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import type { AppConfig } from './config/config.schema';

/**
 * Bootstrap da API HTTP.
 *
 * - `bufferLogs: true` atrasa logs até trocarmos o logger padrão pelo pino.
 * - Prefixo global `/api` alinha com o legado (`SLMOD-api/vercel.json` roteia
 *   tudo para `app.js`, e as rotas lá já vivem sob `/api/...`).
 * - CORS: se `CORS_ORIGIN` não vier no env, cai no origin do frontend
 *   hospedado na Vercel. Valor no env aceita CSV (ex.: "https://a,https://b").
 */
async function bootstrap(): Promise<void> {
  // `rawBody: true` é exigido pelo TwitchHmacGuard (CON-04) — o guard
  // recalcula o HMAC sobre o body bruto, e sem isso o express já consumiu
  // o stream antes do guard ver.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Troca o Logger padrão do Nest pelo pino (via nestjs-pino)
  app.useLogger(app.get(PinoLogger));

  app.setGlobalPrefix('api');

  const config = app.get(ConfigService<AppConfig, true>);
  const cls = app.get(ClsService);

  // CORS
  const corsEnv = config.get('CORS_ORIGIN', { infer: true });
  const origins = corsEnv
    ? corsEnv
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : ['https://slmoderacao.vercel.app'];
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Filter global — precisa do ClsService para anexar traceId em cada resposta.
  app.useGlobalFilters(new AllExceptionsFilter(cls));

  // Graceful shutdown — útil para o worker e para signals no Docker
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  const logger = app.get(PinoLogger);
  logger.log(`sehloro-api listening on :${port} (prefix /api)`);
}

bootstrap().catch((err) => {
  // Se o Zod validator derrubar o boot, queremos o stderr legível antes do exit.
  // eslint-disable-next-line no-console
  console.error('[bootstrap] falha fatal ao subir a API:', err);
  process.exit(1);
});

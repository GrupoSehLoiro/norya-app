import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { ClsModule, ClsService } from 'nestjs-cls';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config/config.schema';

/**
 * Contrato dos campos que colocamos no CLS de cada request.
 * Usado pelo logger (customProps) e por guards/interceptors futuros.
 */
export interface RequestContext {
  traceId: string;
  userId?: string;
  channelId?: string;
  sessionId?: string;
}

/**
 * Módulo de logging estruturado baseado em pino + nestjs-cls.
 *
 * Em `NODE_ENV=development`, usa `pino-pretty` para logs humanos.
 * Em produção, emite JSON em linha única (compatível com Loki/Vector).
 *
 * Cada request ganha um traceId via CLS — exposto como `req.id` e propagado
 * pelos logs. Guards de autenticação vão anexar userId/channelId ao mesmo CLS.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage) => {
          // Respeita header de trace upstream (ex.: API Gateway) se vier
          const upstream =
            (req.headers['x-request-id'] as string | undefined) ??
            (req.headers['x-trace-id'] as string | undefined);
          return upstream ?? randomUUID();
        },
        setup: (cls, req: IncomingMessage) => {
          const traceId = cls.getId();
          cls.set<string>('traceId', traceId);
          // Echo no header de response é setado pelo pino-http via genReqId abaixo.
          (req as IncomingMessage & { id?: string }).id = traceId;
        },
      },
    }),
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule, ClsModule],
      inject: [ConfigService, ClsService],
      useFactory: (config: ConfigService<AppConfig, true>, cls: ClsService) => {
        const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
        const level = config.get('LOG_LEVEL', { infer: true });

        return {
          pinoHttp: {
            level,
            // Padrão internacional de log estruturado: timestamp ISO 8601
            // (campo `time`) e severidade como label (`"level":"info"`), em
            // vez dos defaults do pino (epoch ms / nível numérico). Alinha
            // com o que Loki/Datadog/CloudWatch parseiam sem config extra.
            timestamp: stdTimeFunctions.isoTime,
            formatters: {
              level: (label: string) => ({ level: label }),
            },
            // `base` vale para TODO log (inclusive fora de request);
            // customProps abaixo repete em request-scope com o contexto CLS.
            base: { service: 'sehloro-api' },
            genReqId: (req: IncomingMessage) => {
              const existing = cls.getId();
              if (existing) return existing;
              const upstream =
                (req.headers['x-request-id'] as string | undefined) ??
                (req.headers['x-trace-id'] as string | undefined);
              return upstream ?? randomUUID();
            },
            customProps: () => ({
              service: 'sehloro-api',
              traceId: cls.getId(),
              userId: cls.get<string | undefined>('userId'),
              channelId: cls.get<string | undefined>('channelId'),
              sessionId: cls.get<string | undefined>('sessionId'),
            }),
            // Logs de sucesso em debug para não poluir INFO; erros seguem em error.
            customLogLevel: (_req, res, err) => {
              if (err || res.statusCode >= 500) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },
            ...(isDev
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: {
                      colorize: true,
                      translateTime: 'SYS:HH:MM:ss.l',
                      singleLine: true,
                      ignore: 'pid,hostname',
                    },
                  },
                }
              : {}),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.token',
                '*.refreshToken',
                '*.accessToken',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule, ClsModule],
})
export class LoggerModule {}

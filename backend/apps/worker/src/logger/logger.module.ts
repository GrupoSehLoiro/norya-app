/**
 * Logging estruturado do worker — mesmo padrão internacional da API
 * (pino JSON, timestamp ISO 8601, level como label, redaction), com
 * `service: 'sehloro-worker'` para separar as fontes na página de logs.
 *
 * O worker não serve HTTP, então o middleware pino-http nunca roda — o
 * módulo existe para o Logger injetável e para `app.useLogger` no main.
 * Em development usa pino-pretty (paridade com a API).
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') === 'development';
        const level = config.get<string>('LOG_LEVEL') ?? 'info';

        return {
          pinoHttp: {
            level,
            timestamp: stdTimeFunctions.isoTime,
            formatters: {
              level: (label: string) => ({ level: label }),
            },
            base: { service: 'sehloro-worker' },
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
              paths: ['*.password', '*.token', '*.refreshToken', '*.accessToken'],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class WorkerLoggerModule {}

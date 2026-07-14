/**
 * LogsModule — access logging da API.
 *
 *  - AccessLogMiddleware aplicado a TODAS as rotas (inclui 4xx de guard).
 *  - GET /api/v2/logs para consulta, atrás de Basic Auth (.env).
 */
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AccessLogModule } from '@sehloro/infra';
import { AccessLogMiddleware } from './access-log.middleware';
import { LogsBasicAuthGuard } from './logs-basic-auth.guard';
import { LogsController } from './logs.controller';

@Module({
  imports: [AccessLogModule],
  controllers: [LogsController],
  providers: [LogsBasicAuthGuard, AccessLogMiddleware],
})
export class LogsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AccessLogMiddleware).forRoutes('*');
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PersistenceModule } from '@sehloro/infra';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { TwitchStreamLifecycleHandler } from './event-handlers/twitch-stream-lifecycle.handler';
import { MonitoringController } from './monitoring.controller';
import { MonitoringStreamController } from './monitoring-stream.controller';
import { MonitoringService } from './monitoring.service';
import { SessionStaleCloserCron } from './session-stale-closer.cron';

/**
 * MonitoringModule (MON-01..03).
 *
 * Persistence + FeatureFlags são pré-requisitos:
 *  - PersistenceModule fornece LIVE_SESSION_REPOSITORY e CHANNEL_REPOSITORY.
 *  - FeatureFlagsModule fornece o gate de `monitoring.autoStart` para o handler.
 *
 * O EventBus chega via CacheModule global (registrado em AppModule).
 *
 * JwtModule é necessário para o MonitoringStreamController validar o token
 * (header OU ?token=) do SSE de status em tempo real.
 */
@Module({
  imports: [
    PersistenceModule,
    FeatureFlagsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MonitoringController, MonitoringStreamController],
  providers: [MonitoringService, TwitchStreamLifecycleHandler, SessionStaleCloserCron],
  exports: [MonitoringService],
})
export class MonitoringModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PersistenceModule, TwitchHelixService } from '@sehloro/infra';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { TwitchStreamLifecycleHandler } from './event-handlers/twitch-stream-lifecycle.handler';
import { MonitoringController } from './monitoring.controller';
import { MonitoringStreamController } from './monitoring-stream.controller';
import { MonitoringService } from './monitoring.service';
import { SessionHelixReconcilerCron } from './session-helix-reconciler.cron';
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
  providers: [
    MonitoringService,
    TwitchStreamLifecycleHandler,
    SessionStaleCloserCron,
    SessionHelixReconcilerCron,
    // Mesmo factory do TwitchWebhookModule — o service é stateless (app token
    // próprio) e barato de instanciar por módulo.
    {
      provide: TwitchHelixService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID') ?? '';
        const clientSecret = config.get<string>('TWITCH_CLIENT_SECRET') ?? '';
        return new TwitchHelixService(clientId, clientSecret);
      },
    },
  ],
  exports: [MonitoringService],
})
export class MonitoringModule {}

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule, PersistenceModule } from '@sehloro/infra';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { HelloController } from './hello.controller';
import { IdentityModule } from './identity/identity.module';
import { ModerationModule } from './moderation/moderation.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SocialListeningModule } from './social-listening/social-listening.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { AiTrainingModule } from './ai-training/ai-training.module';
import { TwitchWebhookModule } from './ingestion/twitch-webhook/twitch-webhook.module';
import { TwitchConduitApiModule } from './ingestion/twitch-conduit/twitch-conduit-api.module';
import { TwitchOAuthModule } from './identity/twitch-oauth/twitch-oauth.module';
import { KickOAuthModule } from './identity/kick-oauth/kick-oauth.module';
import { CreatorModule } from './creator/creator.module';
import { LegacyModule } from './legacy/legacy.module';
import { LogsModule } from './logs/logs.module';

/**
 * Raiz da aplicação HTTP.
 *
 * Ordem de importação importa:
 * 1. ConfigModule (global) — antes de qualquer coisa que leia env.
 * 2. LoggerModule (global CLS + pino) — antes dos módulos de negócio.
 * 3. ScheduleModule — habilita @Interval/@Cron para todos os módulos filhos.
 * 4. PersistenceModule — conexão Mongoose única compartilhada.
 * 5. CacheModule (global) — provê EVENT_BUS_TOKEN para todos os bounded contexts.
 * 6. Bounded contexts.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    ScheduleModule.forRoot(),
    PersistenceModule,
    CacheModule,
    IdentityModule,
    ModerationModule,
    IngestionModule,
    MonitoringModule,
    SocialListeningModule,
    FeatureFlagsModule,
    AiTrainingModule,
    TwitchWebhookModule,
    TwitchConduitApiModule,
    TwitchOAuthModule,
    KickOAuthModule,
    CreatorModule,
    LegacyModule,
    LogsModule,
  ],
  controllers: [HelloController],
})
export class AppModule {}

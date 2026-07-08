import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PersistenceModule,
  SubscriptionRenewerService,
  TwitchConduitService,
  TwitchConduitStatePersistence,
  TwitchConduitStateSchema,
  TwitchConduitStateSchemaName,
  TwitchConduitSubscriptionsService,
  TwitchEventSubSubscriptionPersistence,
  TwitchEventSubSubscriptionSchema,
  TwitchEventSubSubscriptionSchemaName,
  TwitchHelixService,
} from '@sehloro/infra';
import { CHANNEL_REPOSITORY, ChannelRepository } from '@sehloro/domain';
import { FeatureFlagsModule } from '../../feature-flags/feature-flags.module';
import { SubscriptionRenewerCron } from './subscription-renewer.cron';
import { TwitchAdminController } from './twitch-admin.controller';

/**
 * Wiring na API de tudo que toca conduits Twitch além do webhook:
 *  - TwitchHelixService (factory baseado em config)
 *  - TwitchConduitService + TwitchConduitSubscriptionsService
 *  - SubscriptionRenewerService + cron diário
 *  - TwitchAdminController com endpoints administrativos
 *
 * O webhook tem o seu próprio TwitchWebhookModule porque o lifecycle de
 * providers ali é menor — manter dois módulos pequenos é mais barato que
 * um Gigamódulo.
 */
@Module({
  imports: [
    ConfigModule,
    PersistenceModule,
    FeatureFlagsModule,
    MongooseModule.forFeature([
      { name: TwitchConduitStateSchemaName, schema: TwitchConduitStateSchema },
      { name: TwitchEventSubSubscriptionSchemaName, schema: TwitchEventSubSubscriptionSchema },
    ]),
  ],
  controllers: [TwitchAdminController],
  providers: [
    {
      provide: TwitchHelixService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID') ?? '';
        const clientSecret = config.get<string>('TWITCH_CLIENT_SECRET') ?? '';
        return new TwitchHelixService(clientId, clientSecret);
      },
    },
    {
      provide: TwitchConduitService,
      inject: [TwitchHelixService, ConfigService, getModelToken(TwitchConduitStateSchemaName)],
      useFactory: (
        helix: TwitchHelixService,
        config: ConfigService,
        model: Model<TwitchConduitStatePersistence>,
      ) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID') ?? '';
        const shardCount = Number(config.get<string>('TWITCH_CONDUIT_SHARD_COUNT') ?? '1');
        return new TwitchConduitService(helix, clientId, model, shardCount);
      },
    },
    {
      provide: TwitchConduitSubscriptionsService,
      inject: [
        TwitchHelixService,
        ConfigService,
        getModelToken(TwitchEventSubSubscriptionSchemaName),
      ],
      useFactory: (
        helix: TwitchHelixService,
        config: ConfigService,
        model: Model<TwitchEventSubSubscriptionPersistence>,
      ) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID') ?? '';
        return new TwitchConduitSubscriptionsService(helix, clientId, model);
      },
    },
    {
      provide: SubscriptionRenewerService,
      inject: [
        CHANNEL_REPOSITORY,
        TwitchConduitService,
        TwitchConduitSubscriptionsService,
        ConfigService,
      ],
      useFactory: (
        channels: ChannelRepository,
        conduit: TwitchConduitService,
        subs: TwitchConduitSubscriptionsService,
        config: ConfigService,
      ) => {
        const botUserId = config.get<string>('TWITCH_BOT_USER_ID') ?? '';
        return new SubscriptionRenewerService(channels, conduit, subs, botUserId);
      },
    },
    SubscriptionRenewerCron,
  ],
  exports: [
    SubscriptionRenewerCron,
    SubscriptionRenewerService,
    // Exposto pra TwitchOAuthModule poder assinar `channel.chat.message`
    // imediatamente depois do OAuth do streamer.
    TwitchConduitService,
    TwitchConduitSubscriptionsService,
  ],
})
export class TwitchConduitApiModule {}

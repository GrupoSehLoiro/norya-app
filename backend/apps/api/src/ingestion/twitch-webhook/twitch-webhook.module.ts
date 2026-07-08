import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PersistenceModule,
  TwitchConduitSubscriptionsService,
  TwitchEventSubSubscriptionPersistence,
  TwitchEventSubSubscriptionSchema,
  TwitchEventSubSubscriptionSchemaName,
  TwitchHelixService,
} from '@sehloro/infra';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InMemoryNonceStore, NONCE_STORE_TOKEN, NonceStoreFactory } from './nonce-store';
import { TwitchHmacGuard } from './twitch-hmac.guard';
import { TwitchWebhookController } from './twitch-webhook.controller';

/**
 * Webhook receiver para Twitch EventSub (CON-04).
 *
 * Coexiste com o WS shard receiver do worker — o backend não roda os dois
 * ao mesmo tempo para o mesmo conduit, mas o módulo fica disponível caso a
 * Twitch deprecate transports WS no futuro ou queiramos a opção HTTPS.
 *
 * NonceStore é resolvido em runtime: usa Redis se REDIS_TOKEN estiver
 * disponível, senão fallback in-memory. A factory NonceStoreFactory faz isso.
 */
@Module({
  imports: [
    PersistenceModule,
    MongooseModule.forFeature([
      { name: TwitchEventSubSubscriptionSchemaName, schema: TwitchEventSubSubscriptionSchema },
    ]),
  ],
  controllers: [TwitchWebhookController],
  providers: [
    InMemoryNonceStore,
    NonceStoreFactory,
    {
      provide: NONCE_STORE_TOKEN,
      inject: [NonceStoreFactory],
      useFactory: (factory: NonceStoreFactory) => factory.build(),
    },
    TwitchHmacGuard,
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
  ],
})
export class TwitchWebhookModule {}

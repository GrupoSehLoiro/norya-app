/**
 * Wiring do shard receiver EventSub no worker.
 *
 * Provedores:
 *  - TwitchHelixService — factory recebe TWITCH_CLIENT_ID/SECRET do ConfigService.
 *  - TwitchConduitService — recebe Helix + Model<TwitchConduitState>.
 *  - TwitchConduitSubscriptionsService — recebe Helix + Model<EventSubSubscription>.
 *  - ChannelLookup — implementação que usa o CHANNEL_REPOSITORY do PersistenceModule.
 *  - TwitchEventSubBridge — recebe EventBus + ChatBuffer + Subscriptions + lookup.
 *  - TwitchEventSubBootstrap — orquestra ensureConduit + WS client.
 *
 * Os schemas TwitchConduitState e TwitchEventSubSubscription são registrados
 * aqui via MongooseModule.forFeature porque o PersistenceModule não inclui
 * (apenas o worker precisa deles).
 */
import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AccessLogModule,
  AccessLogService,
  CacheModule as InfraCacheModule,
  ChatBufferService,
  PersistenceModule,
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
import { CHANNEL_REPOSITORY, ChannelRepository, EVENT_BUS_TOKEN, EventBus } from '@sehloro/domain';
import { TwitchEventSubBootstrap } from './twitch-eventsub-bootstrap';
import { TwitchEventSubBridge } from './twitch-eventsub-bridge';

/**
 * Adapter que satisfaz a interface ChannelLookup do bridge usando o
 * ChannelRepository do PersistenceModule. Encapsulado aqui (não exportado)
 * porque é detalhe de wiring.
 */
@Injectable()
class ChannelRepositoryLookup {
  constructor(@Inject(CHANNEL_REPOSITORY) private readonly repo: ChannelRepository) {}

  async resolveExternalId(externalId: string): Promise<string | null> {
    const page = await this.repo.findMany({ platform: 'twitch', pageSize: 100 });
    const match = page.channels.find((c) => c.getExternalId() === externalId);
    return match ? match.getId() : null;
  }
}

@Module({
  imports: [
    PersistenceModule,
    InfraCacheModule,
    AccessLogModule,
    MongooseModule.forFeature([
      { name: TwitchConduitStateSchemaName, schema: TwitchConduitStateSchema },
      { name: TwitchEventSubSubscriptionSchemaName, schema: TwitchEventSubSubscriptionSchema },
    ]),
  ],
  providers: [
    {
      provide: TwitchHelixService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const clientId = config.get<string>('TWITCH_CLIENT_ID');
        const clientSecret = config.get<string>('TWITCH_CLIENT_SECRET');
        if (!clientId || !clientSecret) {
          throw new Error(
            'TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET são obrigatórios no worker conduit',
          );
        }
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
        const clientId = config.get<string>('TWITCH_CLIENT_ID')!;
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
        const clientId = config.get<string>('TWITCH_CLIENT_ID')!;
        return new TwitchConduitSubscriptionsService(helix, clientId, model);
      },
    },
    ChannelRepositoryLookup,
    {
      provide: TwitchEventSubBridge,
      inject: [
        EVENT_BUS_TOKEN,
        ChatBufferService,
        TwitchConduitSubscriptionsService,
        ChannelRepositoryLookup,
        AccessLogService,
      ],
      useFactory: (
        bus: EventBus,
        chatBuffer: ChatBufferService,
        subs: TwitchConduitSubscriptionsService,
        lookup: ChannelRepositoryLookup,
        accessLog: AccessLogService,
      ) => new TwitchEventSubBridge(bus, chatBuffer, subs, lookup, accessLog),
    },
    TwitchEventSubBootstrap,
  ],
  exports: [TwitchConduitService, TwitchConduitSubscriptionsService, TwitchEventSubBridge],
})
export class TwitchConduitWorkerModule {}

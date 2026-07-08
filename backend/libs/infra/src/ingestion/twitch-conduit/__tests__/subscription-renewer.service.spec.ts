import { Channel, ChannelRepository } from '@sehloro/domain';
import { SubscriptionRenewerService } from '../subscription-renewer.service';
import { TwitchConduitService } from '../twitch-conduit.service';
import { TwitchConduitSubscriptionsService } from '../twitch-conduit-subscriptions.service';
import type { TwitchEventSubSubscriptionPersistence } from '../../../persistence/mongoose/schemas/twitch-eventsub-subscription.schema';
import { Types } from 'mongoose';

function makeChannel(id: string, externalId: string | undefined): Channel {
  return Channel.reconstitute({
    id,
    name: 'chan-' + id,
    platform: 'twitch',
    active: true,
    createdAt: new Date(),
    externalId,
    displayName: 'chan-' + id,
    ownerId: 'owner',
    flags: {},
  });
}

function localSub(
  channelId: string,
  type: 'channel.chat.message' | 'stream.online' | 'stream.offline',
  status: 'enabled' | 'revoked' = 'enabled',
): TwitchEventSubSubscriptionPersistence {
  return {
    _id: new Types.ObjectId(),
    channelId: new Types.ObjectId(),
    channelExternalId: '999',
    type,
    subscriptionId: `sub-${channelId}-${type}`,
    conduitId: 'cond-1',
    status,
  } as TwitchEventSubSubscriptionPersistence;
}

describe('SubscriptionRenewerService', () => {
  let channels: jest.Mocked<ChannelRepository>;
  let conduit: jest.Mocked<TwitchConduitService>;
  let subs: jest.Mocked<TwitchConduitSubscriptionsService>;
  let service: SubscriptionRenewerService;

  beforeEach(() => {
    channels = {
      findMany: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn(),
      findAllActive: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ChannelRepository>;

    conduit = {
      ensureConduit: jest.fn().mockResolvedValue({ conduitId: 'cond-current', shardCount: 1 }),
    } as unknown as jest.Mocked<TwitchConduitService>;

    subs = {
      listActiveByChannel: jest.fn(),
      subscribeChannel: jest.fn(),
    } as unknown as jest.Mocked<TwitchConduitSubscriptionsService>;

    service = new SubscriptionRenewerService(channels, conduit, subs, 'bot-77');
  });

  it('re-subscreve canal com subscriptions faltando (status != enabled)', async () => {
    const channel = makeChannel('c1', '12345');
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });
    subs.listActiveByChannel.mockResolvedValue([
      // só uma de três está enabled → faltam 2
      localSub('c1', 'channel.chat.message'),
    ]);
    subs.subscribeChannel.mockResolvedValue([]);

    const stats = await service.renewAll();

    expect(stats.channelsScanned).toBe(1);
    expect(stats.channelsRenewed).toBe(1);
    expect(stats.channelsFailed).toBe(0);
    expect(subs.subscribeChannel).toHaveBeenCalledWith({
      channelId: 'c1',
      channelExternalId: '12345',
      conduitId: 'cond-current',
      botUserId: 'bot-77',
    });
  });

  it('pula canal quando os 3 tipos já estão enabled', async () => {
    const channel = makeChannel('c1', '12345');
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });
    subs.listActiveByChannel.mockResolvedValue([
      localSub('c1', 'channel.chat.message'),
      localSub('c1', 'stream.online'),
      localSub('c1', 'stream.offline'),
    ]);

    const stats = await service.renewAll();

    expect(stats.channelsScanned).toBe(1);
    expect(stats.channelsRenewed).toBe(0);
    expect(subs.subscribeChannel).not.toHaveBeenCalled();
  });

  it('pula canal sem externalId mas conta como scanned', async () => {
    const channel = makeChannel('c1', undefined);
    channels.findMany.mockResolvedValue({ channels: [channel], total: 1 });

    const stats = await service.renewAll();

    expect(stats.channelsScanned).toBe(1);
    expect(stats.channelsRenewed).toBe(0);
    expect(subs.subscribeChannel).not.toHaveBeenCalled();
  });

  it('isola falhas — um canal que quebra não impede os outros', async () => {
    const c1 = makeChannel('c1', '111');
    const c2 = makeChannel('c2', '222');
    channels.findMany.mockResolvedValue({ channels: [c1, c2], total: 2 });
    subs.listActiveByChannel.mockResolvedValue([]); // ambos precisam renovar
    subs.subscribeChannel.mockRejectedValueOnce(new Error('helix down')).mockResolvedValueOnce([]);

    const stats = await service.renewAll();

    expect(stats.channelsScanned).toBe(2);
    expect(stats.channelsRenewed).toBe(1);
    expect(stats.channelsFailed).toBe(1);
    expect(stats.errors).toEqual([
      expect.objectContaining({ channelId: 'c1', error: 'helix down' }),
    ]);
  });

  it('aborta se ensureConduit falhar', async () => {
    channels.findMany.mockResolvedValue({ channels: [makeChannel('c1', '1')], total: 1 });
    conduit.ensureConduit.mockRejectedValueOnce(new Error('no conduit'));

    await expect(service.renewAll()).rejects.toThrow('no conduit');
    expect(subs.subscribeChannel).not.toHaveBeenCalled();
  });

  it('sem canais ativos é no-op (sem chamar ensureConduit)', async () => {
    channels.findMany.mockResolvedValue({ channels: [], total: 0 });
    const stats = await service.renewAll();
    expect(stats.channelsScanned).toBe(0);
    expect(conduit.ensureConduit).not.toHaveBeenCalled();
  });
});

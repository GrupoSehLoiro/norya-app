/**
 * Unit do KickIngestionService — prova que o chat de um canal Kick logado
 * vira RawMessage no buffer + evento no bus (entrada do pipeline de IA),
 * sem tocar em Pusher/Redis reais (MockChatProvider + deps mockadas).
 */
import { MockChatProvider } from '@sehloro/infra';
import { CHAT_MESSAGE_BUS_CHANNEL, Channel, type RawMessage } from '@sehloro/domain';
import { KickIngestionService } from '../kick-ingestion.service';

function kickChannel(name = 'kicker'): Channel {
  return Channel.create({ name, platform: 'kick', externalId: '999', ownerId: 'u1' });
}

function kickMsg(text = 'vamos time'): RawMessage {
  return {
    id: 'k1',
    platform: 'kick',
    channelExternalId: '555',
    channelName: 'kicker',
    user: {
      externalId: '42',
      username: 'fan',
      displayName: 'Fan',
      isSubscriber: false,
      isMod: false,
      isBroadcaster: false,
      badges: [],
    },
    text,
    emotes: [],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date(),
  };
}

function build() {
  const bus = { publish: jest.fn().mockResolvedValue(undefined) };
  const chatBuffer = { push: jest.fn().mockResolvedValue(undefined) };
  const channels = { findMany: jest.fn() };
  const rest = { getChannel: jest.fn() };
  let lastProvider: MockChatProvider | undefined;
  const createProvider = jest.fn((channel: Channel) => {
    lastProvider = new MockChatProvider({
      platform: 'kick',
      channelExternalId: channel.getExternalId() ?? '',
      channelName: channel.getName(),
      credentials: {},
    });
    return lastProvider;
  });
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new KickIngestionService(
    bus as never,
    chatBuffer as never,
    channels as never,
    rest as never,
    createProvider as never,
    config as never,
  );
  return {
    service,
    bus,
    chatBuffer,
    channels,
    rest,
    createProvider,
    getProvider: () => lastProvider!,
  };
}

describe('KickIngestionService', () => {
  it('conecta provider para canal Kick ativo e resolve chatroomId via REST', async () => {
    const t = build();
    const ch = kickChannel();
    t.channels.findMany.mockResolvedValue({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue({
      id: 1,
      slug: 'kicker',
      chatroomId: 555,
      isLive: true,
      viewerCount: 0,
    });

    await t.service.reconcile();

    expect(t.rest.getChannel).toHaveBeenCalledWith('kicker');
    expect(t.createProvider).toHaveBeenCalledWith(ch, '555');
    expect(t.service.activeChannelIds()).toEqual([ch.getId()]);
  });

  it('empurra cada mensagem para o buffer e publica no bus chat.message', async () => {
    const t = build();
    const ch = kickChannel();
    t.channels.findMany.mockResolvedValue({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue({
      id: 1,
      slug: 'kicker',
      chatroomId: 555,
      isLive: true,
      viewerCount: 0,
    });
    await t.service.reconcile();

    const msg = kickMsg();
    t.getProvider().emit(msg);

    expect(t.chatBuffer.push).toHaveBeenCalledWith(ch.getId(), msg);
    expect(t.bus.publish).toHaveBeenCalledWith(CHAT_MESSAGE_BUS_CHANNEL, {
      channelId: ch.getId(),
      message: msg,
    });
  });

  it('não starta canal Kick sem chatroomId resolvido', async () => {
    const t = build();
    const ch = kickChannel('semchatroom');
    t.channels.findMany.mockResolvedValue({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue(null);

    await t.service.reconcile();

    expect(t.createProvider).not.toHaveBeenCalled();
    expect(t.service.activeChannelIds()).toEqual([]);
  });

  it('para o provider quando o canal deixa de estar ativo', async () => {
    const t = build();
    const ch = kickChannel();
    t.channels.findMany.mockResolvedValueOnce({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue({
      id: 1,
      slug: 'kicker',
      chatroomId: 555,
      isLive: true,
      viewerCount: 0,
    });
    await t.service.reconcile();
    const provider = t.getProvider();
    const disconnectSpy = jest.spyOn(provider, 'disconnect');

    t.channels.findMany.mockResolvedValueOnce({ channels: [], total: 0 });
    await t.service.reconcile();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(t.service.activeChannelIds()).toEqual([]);
  });

  it('é idempotente: não recria provider para canal já conectado', async () => {
    const t = build();
    const ch = kickChannel();
    t.channels.findMany.mockResolvedValue({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue({
      id: 1,
      slug: 'kicker',
      chatroomId: 555,
      isLive: true,
      viewerCount: 0,
    });

    await t.service.reconcile();
    await t.service.reconcile();

    expect(t.createProvider).toHaveBeenCalledTimes(1);
  });

  it('desconecta tudo no shutdown', async () => {
    const t = build();
    const ch = kickChannel();
    t.channels.findMany.mockResolvedValue({ channels: [ch], total: 1 });
    t.rest.getChannel.mockResolvedValue({
      id: 1,
      slug: 'kicker',
      chatroomId: 555,
      isLive: true,
      viewerCount: 0,
    });
    await t.service.reconcile();

    await t.service.onApplicationShutdown();

    expect(t.service.activeChannelIds()).toEqual([]);
  });
});

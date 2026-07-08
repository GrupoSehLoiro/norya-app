import { TwitchEventSubBridge } from '../twitch-eventsub-bridge';
import { InMemoryEventBus } from '@sehloro/infra';
import {
  CHAT_MESSAGE_BUS_CHANNEL,
  RawMessage,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
} from '@sehloro/domain';

function chatNotification(event: Record<string, unknown>) {
  return {
    subscription: {
      id: 'sub-1',
      type: 'channel.chat.message',
      version: '1',
      status: 'enabled',
      condition: {},
    },
    event,
  };
}

function streamNotification(
  type: 'stream.online' | 'stream.offline',
  event: Record<string, unknown>,
) {
  return {
    subscription: { id: 'sub-' + type, type, version: '1', status: 'enabled', condition: {} },
    event,
  };
}

describe('TwitchEventSubBridge', () => {
  let bus: InMemoryEventBus;
  let bridge: TwitchEventSubBridge;
  let chatBuffer: { push: jest.Mock };
  let subscriptions: { markRevoked: jest.Mock };
  let lookup: { resolveExternalId: jest.Mock };

  beforeEach(() => {
    bus = new InMemoryEventBus();
    chatBuffer = { push: jest.fn().mockResolvedValue(undefined) };
    subscriptions = { markRevoked: jest.fn().mockResolvedValue(undefined) };
    lookup = { resolveExternalId: jest.fn().mockResolvedValue('chan-local-1') };
    bridge = new TwitchEventSubBridge(bus, chatBuffer as never, subscriptions as never, lookup);
  });

  afterEach(async () => {
    await bus.dispose();
  });

  it('channel.chat.message vai para o ChatBufferService + event bus', async () => {
    const onMessage = jest.fn();
    await bus.subscribe<{ channelId: string; message: RawMessage }>(
      CHAT_MESSAGE_BUS_CHANNEL,
      onMessage,
    );

    await bridge.handleNotification(
      chatNotification({
        broadcaster_user_id: '12345',
        broadcaster_user_login: 'rogerbatt',
        chatter_user_id: '99',
        chatter_user_login: 'fan',
        chatter_user_name: 'Fan',
        message_id: 'msg-abc',
        message: {
          text: 'hello Kappa',
          fragments: [
            { type: 'text', text: 'hello ' },
            { type: 'emote', text: 'Kappa', emote: { id: '25' } },
          ],
        },
        badges: [{ set_id: 'subscriber', id: '1', info: '' }],
      }),
    );

    expect(chatBuffer.push).toHaveBeenCalledWith(
      'chan-local-1',
      expect.objectContaining({
        id: 'msg-abc',
        platform: 'twitch',
        text: 'hello Kappa',
        user: expect.objectContaining({ isSubscriber: true, username: 'fan' }),
      }),
    );
    expect(onMessage).toHaveBeenCalled();
    const [{ channelId, message }] = onMessage.mock.calls[0]!;
    expect(channelId).toBe('chan-local-1');
    expect(message.emotes).toEqual([
      expect.objectContaining({ code: 'Kappa', provider: 'twitch' }),
    ]);
  });

  it('chat message sem channel local é ignorada', async () => {
    lookup.resolveExternalId.mockResolvedValueOnce(null);
    await bridge.handleNotification(
      chatNotification({
        broadcaster_user_id: 'unknown',
        message_id: 'm1',
        message: { text: 'hi', fragments: [] },
      }),
    );
    expect(chatBuffer.push).not.toHaveBeenCalled();
  });

  it('stream.online publica no STREAM_ONLINE_CHANNEL', async () => {
    const handler = jest.fn();
    await bus.subscribe(STREAM_ONLINE_CHANNEL, handler);

    await bridge.handleNotification(
      streamNotification('stream.online', {
        broadcaster_user_id: '12345',
        broadcaster_user_login: 'rogerbatt',
        started_at: '2026-05-11T12:00:00Z',
        type: 'live',
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channelExternalId: '12345',
        broadcasterUserLogin: 'rogerbatt',
        startedAt: '2026-05-11T12:00:00Z',
        streamType: 'live',
      }),
    );
  });

  it('stream.offline publica no STREAM_OFFLINE_CHANNEL', async () => {
    const handler = jest.fn();
    await bus.subscribe(STREAM_OFFLINE_CHANNEL, handler);

    await bridge.handleNotification(
      streamNotification('stream.offline', {
        broadcaster_user_id: '12345',
        broadcaster_user_login: 'rogerbatt',
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        channelExternalId: '12345',
        broadcasterUserLogin: 'rogerbatt',
      }),
    );
  });

  it('revocation marca a subscription como revogada', async () => {
    await bridge.handleRevocation({
      subscription: { id: 'sub-x', type: 'channel.chat.message', status: 'authorization_revoked' },
    });
    expect(subscriptions.markRevoked).toHaveBeenCalledWith('sub-x', 'authorization_revoked');
  });

  it('tipo desconhecido é logado e ignorado sem throw', async () => {
    await expect(
      bridge.handleNotification({
        subscription: {
          id: 's',
          type: 'channel.update',
          version: '1',
          status: 'enabled',
          condition: {},
        },
        event: {},
      }),
    ).resolves.toBeUndefined();
  });
});

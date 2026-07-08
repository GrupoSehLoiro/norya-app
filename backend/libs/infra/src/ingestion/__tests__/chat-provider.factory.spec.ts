/**
 * Testes do ChatProviderFactory (CHAT-03).
 *
 * Cobertura:
 * 1. Em NODE_ENV=test → sempre retorna MockChatProvider.
 * 2. Chamar createForChannel 2x com o mesmo canal retorna a MESMA instância.
 * 3. Após dispose(channelId) → cria nova instância.
 * 4. Plataforma 'twitch' sem creator registrado → lança erro claro.
 * 5. Plataforma 'kick' sem creator registrado → lança erro claro.
 * 6. Creator customizado injetado via TWITCH_IRC_PROVIDER_CREATOR é chamado.
 * 7. Creator customizado injetado via KICK_PUSHER_PROVIDER_CREATOR é chamado.
 */
import { Channel, ChatProvider } from '@sehloro/domain';
import { ChatProviderFactory } from '../chat-provider.factory';
import { MockChatProvider } from '../mock/mock-chat-provider';
import {
  ChatProviderCreator,
  KICK_PUSHER_PROVIDER_CREATOR,
  TWITCH_IRC_PROVIDER_CREATOR,
} from '../tokens';

const originalNodeEnv = process.env['NODE_ENV'];

function makeChannel(platform: 'twitch' | 'kick' = 'twitch', name = 'testchannel'): Channel {
  return Channel.create({ name, platform, externalId: `ext-${name}` });
}

function makeFactory(
  opts: {
    twitchCreator?: ChatProviderCreator;
    kickCreator?: ChatProviderCreator;
    mockCreator?: ChatProviderCreator;
  } = {},
): ChatProviderFactory {
  return new ChatProviderFactory(opts.twitchCreator, opts.kickCreator, opts.mockCreator);
}

afterEach(() => {
  process.env['NODE_ENV'] = originalNodeEnv;
});

describe('ChatProviderFactory', () => {
  describe('NODE_ENV=test (modo mock)', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'test';
    });

    it('retorna MockChatProvider para canal twitch', async () => {
      const factory = makeFactory();
      const provider = await factory.createForChannel(makeChannel('twitch'));
      expect(provider).toBeInstanceOf(MockChatProvider);
    });

    it('retorna MockChatProvider para canal kick', async () => {
      const factory = makeFactory();
      const provider = await factory.createForChannel(makeChannel('kick'));
      expect(provider).toBeInstanceOf(MockChatProvider);
    });

    it('usa creator customizado quando MOCK_CHAT_PROVIDER_CREATOR injetado', async () => {
      const custom = new MockChatProvider({
        platform: 'twitch',
        channelExternalId: 'ext-x',
        channelName: 'x',
        credentials: {},
      });
      const factory = makeFactory({ mockCreator: () => custom });
      const provider = await factory.createForChannel(makeChannel('twitch'));
      expect(provider).toBe(custom);
    });
  });

  describe('cache por channelId', () => {
    it('retorna a MESMA instância em chamadas subsequentes', async () => {
      process.env['NODE_ENV'] = 'test';
      const factory = makeFactory();
      const channel = makeChannel();

      const p1 = await factory.createForChannel(channel);
      const p2 = await factory.createForChannel(channel);

      expect(p1).toBe(p2);
    });

    it('cria nova instância após dispose', async () => {
      process.env['NODE_ENV'] = 'test';
      const factory = makeFactory();
      const channel = makeChannel();

      const p1 = await factory.createForChannel(channel);
      factory.dispose(channel.getId());
      const p2 = await factory.createForChannel(channel);

      expect(p1).not.toBe(p2);
    });

    it('dispose de channelId inexistente não lança', () => {
      const factory = makeFactory();
      expect(() => factory.dispose('nao-existe')).not.toThrow();
    });
  });

  describe('creators concretos (NODE_ENV != test)', () => {
    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    it('usa TwitchIrcProviderCreator quando platform=twitch', async () => {
      const mockProvider = {} as ChatProvider;
      const creator = jest.fn().mockReturnValue(mockProvider);
      const factory = makeFactory({ twitchCreator: creator });

      const channel = makeChannel('twitch');
      const result = await factory.createForChannel(channel);

      expect(creator).toHaveBeenCalledTimes(1);
      expect(creator).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'twitch', channelName: channel.getName() }),
      );
      expect(result).toBe(mockProvider);
    });

    it('usa KickPusherProviderCreator quando platform=kick', async () => {
      const mockProvider = {} as ChatProvider;
      const creator = jest.fn().mockReturnValue(mockProvider);
      const factory = makeFactory({ kickCreator: creator });

      const channel = makeChannel('kick');
      const result = await factory.createForChannel(channel);

      expect(creator).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockProvider);
    });

    it('lança erro claro quando platform=twitch sem creator', async () => {
      const factory = makeFactory();
      const channel = makeChannel('twitch');

      await expect(factory.createForChannel(channel)).rejects.toThrow(
        'TwitchIrcProviderCreator não registrado',
      );
    });

    it('lança erro claro quando platform=kick sem creator', async () => {
      const factory = makeFactory();
      const channel = makeChannel('kick');

      await expect(factory.createForChannel(channel)).rejects.toThrow(
        'KickPusherProviderCreator não registrado',
      );
    });

    it('retorna a MESMA instância em chamadas subsequentes (creators concretos)', async () => {
      let callCount = 0;
      const creator: ChatProviderCreator = () => {
        callCount++;
        return {} as ChatProvider;
      };
      const factory = makeFactory({ twitchCreator: creator });
      const channel = makeChannel('twitch');

      await factory.createForChannel(channel);
      await factory.createForChannel(channel);

      expect(callCount).toBe(1);
    });
  });

  describe('tokens de injeção exportados', () => {
    it('TWITCH_IRC_PROVIDER_CREATOR é um Symbol', () => {
      expect(typeof TWITCH_IRC_PROVIDER_CREATOR).toBe('symbol');
    });

    it('KICK_PUSHER_PROVIDER_CREATOR é um Symbol', () => {
      expect(typeof KICK_PUSHER_PROVIDER_CREATOR).toBe('symbol');
    });
  });
});

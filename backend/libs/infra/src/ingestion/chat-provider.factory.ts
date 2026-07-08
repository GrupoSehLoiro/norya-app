/**
 * CHAT-03 · ChatProviderFactory.
 *
 * Cria e cacheia ChatProvider por canal. As implementações concretas
 * (TwitchIrcProvider, KickPusherProvider) são injetadas como funções
 * criadoras via tokens, permitindo que cheguem nos milestones TWI-01/KCK-02
 * sem alterar esta classe.
 *
 * Regras de seleção de provider:
 * - NODE_ENV === 'test' → MockChatProvider (sempre)
 * - platform === 'twitch' → TwitchConduitProvider se flag conduit ativo
 *   (stub: false neste milestone — implementado em CON-01/M3), senão TwitchIrcProvider
 * - platform === 'kick' → KickPusherProvider
 *
 * Cache: `Map<channelId, ChatProvider>`. Chamar `createForChannel` duas vezes
 * com o mesmo canal retorna a MESMA instância até `dispose(channelId)`.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Channel, ChatProvider, ChatProviderConfig } from '@sehloro/domain';
import { MockChatProvider } from './mock/mock-chat-provider';
import {
  ChatProviderCreator,
  KICK_PUSHER_PROVIDER_CREATOR,
  MOCK_CHAT_PROVIDER_CREATOR,
  TWITCH_IRC_PROVIDER_CREATOR,
} from './tokens';

@Injectable()
export class ChatProviderFactory {
  private readonly cache = new Map<string, ChatProvider>();

  constructor(
    @Optional()
    @Inject(TWITCH_IRC_PROVIDER_CREATOR)
    private readonly createTwitchIrc: ChatProviderCreator | undefined,

    @Optional()
    @Inject(KICK_PUSHER_PROVIDER_CREATOR)
    private readonly createKickPusher: ChatProviderCreator | undefined,

    @Optional()
    @Inject(MOCK_CHAT_PROVIDER_CREATOR)
    private readonly createMock: ChatProviderCreator | undefined,
  ) {}

  async createForChannel(channel: Channel): Promise<ChatProvider> {
    const cached = this.cache.get(channel.getId());
    if (cached) return cached;

    const provider = this._instantiate(channel);
    this.cache.set(channel.getId(), provider);
    return provider;
  }

  /**
   * Remove a instância cacheada para o canal. Não desconecta — o caller
   * deve chamar provider.disconnect() antes se necessário.
   */
  dispose(channelId: string): void {
    this.cache.delete(channelId);
  }

  private _instantiate(channel: Channel): ChatProvider {
    const config: ChatProviderConfig = {
      platform: channel.getPlatform(),
      channelExternalId: channel.getExternalId() ?? channel.getName(),
      channelName: channel.getName(),
      credentials: {},
    };

    if (process.env['NODE_ENV'] === 'test') {
      return this._createMockProvider(config);
    }

    if (channel.getPlatform() === 'twitch') {
      // Conduit flag: stub retorna false neste milestone (CON-01/M3 implementa)
      const useConduit = false;
      if (useConduit) {
        throw new Error('TwitchConduitProvider não implementado neste milestone (CON-01/M3)');
      }
      if (!this.createTwitchIrc) {
        throw new Error(
          'TwitchIrcProviderCreator não registrado — implemente TWI-01 e registre o token.',
        );
      }
      return this.createTwitchIrc(config);
    }

    if (channel.getPlatform() === 'kick') {
      if (!this.createKickPusher) {
        throw new Error(
          'KickPusherProviderCreator não registrado — implemente KCK-02 e registre o token.',
        );
      }
      return this.createKickPusher(config);
    }

    throw new Error(`Platform não suportada: ${channel.getPlatform() as string}`);
  }

  private _createMockProvider(config: ChatProviderConfig): ChatProvider {
    if (this.createMock) return this.createMock(config);
    return new MockChatProvider(config);
  }
}

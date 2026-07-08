/**
 * Tokens de injeção de dependência para provedores de chat.
 *
 * Cada token corresponde a uma função criadora (ChatProviderCreator) que,
 * dado um ChatProviderConfig, instancia um novo provider por canal.
 * Usar funções criadoras (e não instâncias) porque cada canal precisa
 * de sua própria conexão isolada.
 */
import { ChatProvider, ChatProviderConfig } from '@sehloro/domain';

export type ChatProviderCreator = (config: ChatProviderConfig) => ChatProvider;

export const TWITCH_IRC_PROVIDER_CREATOR = Symbol('TwitchIrcProviderCreator');
export const KICK_PUSHER_PROVIDER_CREATOR = Symbol('KickPusherProviderCreator');
export const MOCK_CHAT_PROVIDER_CREATOR = Symbol('MockChatProviderCreator');

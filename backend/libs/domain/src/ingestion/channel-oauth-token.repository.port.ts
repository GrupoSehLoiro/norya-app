/**
 * Contract (port) do repositório de ChannelOAuthToken.
 *
 * Semântica:
 *  - Em um dado canal, existe no MÁXIMO 1 token OAuth por plataforma. O
 *    upsert por `(channelId, platform)` é idempotente — refresh de token
 *    substitui o par anterior.
 *  - A implementação concreta (Mongoose) garante unicidade via compound
 *    index unique em `{channelId, platform}`.
 */
import { ChannelOAuthToken } from './channel-oauth-token.entity';
import { ChannelPlatform } from './channel.entity';

export interface ChannelOAuthTokenRepository {
  findByChannelId(channelId: string, platform: ChannelPlatform): Promise<ChannelOAuthToken | null>;
  save(token: ChannelOAuthToken): Promise<ChannelOAuthToken>;
  delete(id: string): Promise<void>;
}

export const CHANNEL_OAUTH_TOKEN_REPOSITORY = Symbol('ChannelOAuthTokenRepository');

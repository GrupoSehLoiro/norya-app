/**
 * Mapper ChannelOAuthToken ↔ ChannelOAuthTokenDocument.
 *
 * O plugin de encryption garante que `doc.accessToken` e `doc.refreshToken`
 * já estão em PLAINTEXT quando chegam aqui (post('init') hook decriptou).
 * Portanto o mapper só precisa traduzir shapes.
 */
import { ChannelOAuthToken, ChannelPlatform } from '@sehloro/domain';
import { ChannelOAuthTokenDocument } from '../schemas/channel-oauth-token.schema';

export function toDomain(doc: ChannelOAuthTokenDocument): ChannelOAuthToken {
  return ChannelOAuthToken.reconstitute({
    id: String(doc._id),
    channelId: doc.channelId,
    platform: doc.platform as ChannelPlatform,
    accessToken: doc.accessToken,
    refreshToken: doc.refreshToken,
    scope: doc.scope ?? '',
    expiresAt: doc.expiresAt,
    updatedAt: doc.updatedAt ?? new Date(),
  });
}

export function toPersistence(
  token: ChannelOAuthToken,
): ReturnType<ChannelOAuthToken['toPersistence']> {
  return token.toPersistence();
}

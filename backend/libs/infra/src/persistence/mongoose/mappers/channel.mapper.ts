/**
 * Mapper Channel ↔ ChannelDocument (ORC-01).
 *
 * Heurística de rehidratação de `platform`:
 * - Docs legados não têm o campo → default 'twitch'.
 * - Docs novos leem direto do schema.
 */
import { Channel, ChannelPlatform } from '@sehloro/domain';
import { ChannelDocument } from '../schemas/channel.schema';

export function toDomain(doc: ChannelDocument): Channel {
  const rawFlags = doc.flags as Map<string, boolean> | Record<string, boolean> | undefined;
  let flags: Record<string, boolean> | undefined;
  if (rawFlags instanceof Map) {
    flags = Object.fromEntries(rawFlags.entries());
  } else if (rawFlags && typeof rawFlags === 'object') {
    flags = rawFlags as Record<string, boolean>;
  }

  return Channel.reconstitute({
    id: String(doc._id),
    name: doc.channel,
    platform: (doc.platform as ChannelPlatform) ?? 'twitch',
    active: doc.active ?? true,
    createdAt: doc.created_at ?? new Date(),
    externalId: doc.externalId,
    displayName: doc.displayName,
    ownerId: doc.ownerId,
    flags,
    creatorId: doc.creatorId,
    workspaceId: doc.workspaceId,
    avatarUrl: doc.profileImageUrl,
  });
}

export function toPersistence(channel: Channel): ReturnType<Channel['toPersistence']> {
  return channel.toPersistence();
}

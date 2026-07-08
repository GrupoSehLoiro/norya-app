/**
 * KCK-02/KCK-03 · KickMessageMapper.
 *
 * Normaliza o payload do evento ChatMessageEvent do Kick para RawMessage canônico.
 * Formato de emotes Kick no texto: [emote:ID:NAME]  ex.: [emote:12345:KEKW]
 */
import type { RawMessage, RawMessageEmote, EmoteDictionary } from '@sehloro/domain';

export interface KickChatMessageEvent {
  id: string;
  chatroom_id: number;
  content: string;
  type: string;
  created_at: string;
  sender: {
    id: number;
    username: string;
    slug: string;
    identity?: {
      color?: string;
      badges?: Array<{ type: string; text?: string; count?: number }>;
    };
  };
}

const EMOTE_RE = /\[emote:(\d+):([^\]]+)\]/g;

export class KickMessageMapper {
  static toRaw(
    event: KickChatMessageEvent,
    channelName: string,
    chatroomId: string | number,
    dictionary?: EmoteDictionary,
  ): RawMessage {
    const emotes = KickMessageMapper._parseEmotes(event.content, dictionary);
    const mentions = KickMessageMapper._parseMentions(event.content);

    const badges = (event.sender.identity?.badges ?? []).map((b) =>
      b.text ? `${b.type}/${b.text}` : b.type,
    );
    const isSubscriber = badges.some((b) => b.startsWith('subscriber'));
    const isMod = badges.some((b) => b.startsWith('moderator'));
    const isBroadcaster = badges.some((b) => b.startsWith('broadcaster'));

    return {
      id: event.id,
      platform: 'kick',
      channelExternalId: String(chatroomId),
      channelName,
      user: {
        externalId: String(event.sender.id),
        username: event.sender.username,
        displayName: event.sender.username,
        isSubscriber,
        isMod,
        isBroadcaster,
        badges,
      },
      text: event.content,
      emotes,
      mentions,
      rawPayload: event,
      receivedAt: new Date(),
    };
  }

  private static _parseEmotes(content: string, dictionary?: EmoteDictionary): RawMessageEmote[] {
    const emotes: RawMessageEmote[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(EMOTE_RE.source, 'g');

    while ((match = re.exec(content)) !== null) {
      const fullMatch = match[0];
      const emoteName = match[2];
      const start = match.index;
      const end = start + fullMatch.length - 1;

      const entry = dictionary?.get(emoteName);
      emotes.push({
        code: emoteName,
        start,
        end,
        provider: 'kick',
        ...(entry
          ? {
              semantic: entry.semantic,
              polarity: entry.polarity,
              intensity: entry.intensity,
            }
          : {}),
      });
    }

    return emotes.sort((a, b) => a.start - b.start);
  }

  private static _parseMentions(content: string): Array<{ username: string }> {
    const mentions: Array<{ username: string }> = [];
    const re = /@([\w]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      mentions.push({ username: m[1].toLowerCase() });
    }
    return mentions;
  }
}

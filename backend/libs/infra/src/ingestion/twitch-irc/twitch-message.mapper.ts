/**
 * TWI-02 · TwitchMessageMapper.
 *
 * Converte userstate + message do tmi.js para RawMessage, enriquecendo
 * emotes[] com semântica via EmoteDictionary quando disponível.
 *
 * Separado do provider para facilitar testes unitários sem conexão IRC.
 */
import * as tmi from 'tmi.js';
import { EmoteDictionary, RawMessage, RawMessageEmote } from '@sehloro/domain';

export class TwitchMessageMapper {
  static toRaw(
    userstate: tmi.ChatUserstate,
    channelRaw: string,
    message: string,
    dictionary?: EmoteDictionary,
  ): RawMessage {
    const channelName = channelRaw.replace(/^#/, '').toLowerCase();

    return {
      id: userstate['id'] ?? `tmi-${Date.now()}`,
      platform: 'twitch',
      channelExternalId: channelName,
      channelName,
      user: {
        externalId: userstate['user-id'] ?? '',
        username: userstate['username'] ?? '',
        displayName: userstate['display-name'] ?? userstate['username'] ?? '',
        isSubscriber: userstate['subscriber'] === true || userstate['badges']?.subscriber != null,
        isMod: userstate['mod'] === true,
        isBroadcaster: userstate['badges']?.broadcaster != null,
        badges: buildBadges(userstate['badges']),
      },
      text: message,
      emotes: enrichEmotes(parseEmotes(userstate['emotes'], message), dictionary),
      mentions: parseMentions(message),
      rawPayload: userstate,
      receivedAt: new Date(),
    };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildBadges(badges: tmi.Badges | undefined): string[] {
  if (!badges) return [];
  return Object.entries(badges)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}/${v as string}`);
}

function parseEmotes(emotes: tmi.ChatUserstate['emotes'], text: string): RawMessageEmote[] {
  if (!emotes) return [];
  const result: RawMessageEmote[] = [];
  for (const [, ranges] of Object.entries(emotes)) {
    if (!ranges) continue;
    for (const range of ranges) {
      const [startStr, endStr] = range.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) continue;
      result.push({ code: text.slice(start, end + 1), start, end, provider: 'twitch' });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function enrichEmotes(emotes: RawMessageEmote[], dictionary?: EmoteDictionary): RawMessageEmote[] {
  if (!dictionary) return emotes;
  return emotes.map((e) => {
    const entry = dictionary.get(e.code);
    if (!entry) return e;
    return { ...e, semantic: entry.semantic, polarity: entry.polarity, intensity: entry.intensity };
  });
}

function parseMentions(text: string): Array<{ username: string }> {
  const pattern = /@(\w+)/g;
  const out: Array<{ username: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    out.push({ username: m[1].toLowerCase() });
  }
  return out;
}

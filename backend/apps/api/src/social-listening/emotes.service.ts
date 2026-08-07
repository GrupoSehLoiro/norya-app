/**
 * EmotesService — dicionário de emotes do canal pro frontend renderizar
 * mensagens do chat com as imagens.
 *
 * Fontes (todas tolerantes a falha — cada provider que cair só some da lista):
 *   Canal Twitch:
 *     - Twitch Helix: /chat/emotes/global + /chat/emotes?broadcaster_id (app token)
 *     - BTTV: api.betterttv.net/3/cached/emotes/global + /cached/users/twitch/:id
 *     - FFZ:  api.frankerfacez.com/v1/set/global + /v1/room/id/:twitchId
 *     - 7TV:  7tv.io/v3/emote-sets/global + /v3/users/twitch/:id
 *   Canal Kick:
 *     - 7TV:  7tv.io/v3/emote-sets/global + /v3/users/kick/:id (extensão 7TV
 *       funciona no Kick; o texto traz o código como palavra solta)
 *     - Emotes NATIVOS do Kick não precisam de dicionário: chegam no texto
 *       como `[emote:ID:NOME]` e o front deriva a URL direto do ID
 *       (files.kick.com). O endpoint kick.com/emotes/:slug é bloqueado por
 *       Cloudflare server-side, então nem tentamos.
 *
 * BTTV/FFZ/7TV indexam canais pelo ID da plataforma (`externalId` do
 * Channel). Cache em memória por canal (TTL 1h) — emotes mudam raramente.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CHANNEL_REPOSITORY, type ChannelRepository } from '@sehloro/domain';
import { TwitchHelixService } from '@sehloro/infra';

export type EmoteProvider = 'twitch' | 'bttv' | 'ffz' | '7tv';

export interface ChannelEmote {
  code: string;
  url: string;
  url2x?: string;
  provider: EmoteProvider;
}

export interface ChannelEmotesResult {
  channelId: string;
  emotes: ChannelEmote[];
}

interface BttvEmoteRaw {
  id: string;
  code: string;
}

interface SevenTvEmoteRaw {
  id: string;
  name: string;
}

interface FfzEmoteRaw {
  name: string;
  urls?: Record<string, string>;
}

interface FfzSetsRaw {
  default_sets?: number[];
  room?: { set?: number };
  sets?: Record<string, { emoticons?: FfzEmoteRaw[] }>;
}

const CACHE_TTL_MS = 60 * 60_000;
const HTTP_TIMEOUT_MS = 8_000;

@Injectable()
export class EmotesService {
  private readonly logger = new Logger(EmotesService.name);
  private readonly cache = new Map<string, { at: number; data: ChannelEmotesResult }>();

  constructor(
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    private readonly helix: TwitchHelixService,
  ) {}

  async forChannel(channelId: string): Promise<ChannelEmotesResult> {
    const hit = this.cache.get(channelId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    const channel = await this.channels.findById(channelId);
    if (!channel) throw new NotFoundException(`canal ${channelId} não encontrado`);

    const platform = channel.getPlatform();
    const twitchId = platform === 'twitch' ? channel.getExternalId() : undefined;
    const kickId = platform === 'kick' ? channel.getExternalId() : undefined;

    const sources = await Promise.all([
      this.guard('7tv:global', () => this.sevenTvGlobal()),
      twitchId ? this.guard('bttv:global', () => this.bttvGlobal()) : [],
      twitchId ? this.guard('ffz:global', () => this.ffzGlobal()) : [],
      twitchId ? this.guard('twitch:global', () => this.twitchGlobal()) : [],
      twitchId ? this.guard('7tv:channel', () => this.sevenTvChannel('twitch', twitchId)) : [],
      kickId ? this.guard('7tv:kick-channel', () => this.sevenTvChannel('kick', kickId)) : [],
      twitchId ? this.guard('bttv:channel', () => this.bttvChannel(twitchId)) : [],
      twitchId ? this.guard('ffz:channel', () => this.ffzChannel(twitchId)) : [],
      twitchId ? this.guard('twitch:channel', () => this.twitchChannel(twitchId)) : [],
    ]);

    // Precedência no merge: canal ganha de global; entre providers,
    // Twitch nativo > BTTV > FFZ > 7TV. O array acima já está na ordem
    // inversa da precedência — os últimos sobrescrevem os primeiros.
    const merged = new Map<string, ChannelEmote>();
    for (const list of sources) {
      for (const e of list) merged.set(e.code, e);
    }

    const data: ChannelEmotesResult = { channelId, emotes: Array.from(merged.values()) };
    this.cache.set(channelId, { at: Date.now(), data });
    return data;
  }

  private async guard(label: string, fn: () => Promise<ChannelEmote[]>): Promise<ChannelEmote[]> {
    try {
      return await fn();
    } catch (err) {
      // 404 nos providers de canal = canal sem emotes cadastrados; ruído esperado.
      this.logger.warn(`emotes ${label} indisponível: ${(err as Error).message}`);
      return [];
    }
  }

  private async twitchGlobal(): Promise<ChannelEmote[]> {
    const list = await this.helix.getGlobalChatEmotes();
    return list.map((e) => ({
      code: e.code,
      url: e.url1x,
      url2x: e.url2x,
      provider: 'twitch' as const,
    }));
  }

  private async twitchChannel(broadcasterId: string): Promise<ChannelEmote[]> {
    const list = await this.helix.getChannelChatEmotes(broadcasterId);
    return list.map((e) => ({
      code: e.code,
      url: e.url1x,
      url2x: e.url2x,
      provider: 'twitch' as const,
    }));
  }

  private async bttvGlobal(): Promise<ChannelEmote[]> {
    const data = await getJson<BttvEmoteRaw[]>('https://api.betterttv.net/3/cached/emotes/global');
    return (data ?? []).map(mapBttv);
  }

  private async bttvChannel(twitchId: string): Promise<ChannelEmote[]> {
    const data = await getJson<{ channelEmotes?: BttvEmoteRaw[]; sharedEmotes?: BttvEmoteRaw[] }>(
      `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(twitchId)}`,
    );
    return [...(data?.channelEmotes ?? []), ...(data?.sharedEmotes ?? [])].map(mapBttv);
  }

  private async sevenTvGlobal(): Promise<ChannelEmote[]> {
    const data = await getJson<{ emotes?: SevenTvEmoteRaw[] }>(
      'https://7tv.io/v3/emote-sets/global',
    );
    return (data?.emotes ?? []).map(mapSevenTv);
  }

  private async sevenTvChannel(
    platform: 'twitch' | 'kick',
    externalId: string,
  ): Promise<ChannelEmote[]> {
    const data = await getJson<{ emote_set?: { emotes?: SevenTvEmoteRaw[] } }>(
      `https://7tv.io/v3/users/${platform}/${encodeURIComponent(externalId)}`,
    );
    return (data?.emote_set?.emotes ?? []).map(mapSevenTv);
  }

  private async ffzGlobal(): Promise<ChannelEmote[]> {
    const data = await getJson<FfzSetsRaw>('https://api.frankerfacez.com/v1/set/global');
    const setIds = (data.default_sets ?? []).map(String);
    return setIds
      .flatMap((id) => data.sets?.[id]?.emoticons ?? [])
      .map(mapFfz)
      .filter((e): e is ChannelEmote => e !== null);
  }

  private async ffzChannel(twitchId: string): Promise<ChannelEmote[]> {
    const data = await getJson<FfzSetsRaw>(
      `https://api.frankerfacez.com/v1/room/id/${encodeURIComponent(twitchId)}`,
    );
    return Object.values(data.sets ?? {})
      .flatMap((s) => s.emoticons ?? [])
      .map(mapFfz)
      .filter((e): e is ChannelEmote => e !== null);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return (await res.json()) as T;
}

function mapBttv(raw: BttvEmoteRaw): ChannelEmote {
  return {
    code: raw.code,
    url: `https://cdn.betterttv.net/emote/${raw.id}/1x`,
    url2x: `https://cdn.betterttv.net/emote/${raw.id}/2x`,
    provider: 'bttv',
  };
}

function mapSevenTv(raw: SevenTvEmoteRaw): ChannelEmote {
  return {
    code: raw.name,
    url: `https://cdn.7tv.app/emote/${raw.id}/1x.webp`,
    url2x: `https://cdn.7tv.app/emote/${raw.id}/2x.webp`,
    provider: '7tv',
  };
}

function mapFfz(raw: FfzEmoteRaw): ChannelEmote | null {
  const url = raw.urls?.['1'] ?? raw.urls?.['2'];
  if (!raw.name || !url) return null;
  return { code: raw.name, url, url2x: raw.urls?.['2'], provider: 'ffz' };
}

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface ChannelEmote {
  code: string;
  url: string;
  url2x?: string;
  provider: 'twitch' | 'bttv' | 'ffz' | '7tv';
}

interface ChannelEmotesResponse {
  channelId: string;
  emotes: ChannelEmote[];
}

/**
 * Dicionário code→emote do canal (Twitch nativo + BTTV + 7TV), servido pelo
 * backend com cache de 1h. Map vazio enquanto carrega ou sem canal — o texto
 * das mensagens renderiza normal e os emotes "ligam" quando o dicionário chega.
 */
export function useChannelEmotes(channelId: string | null): Map<string, ChannelEmote> {
  const query = useQuery({
    enabled: !!channelId,
    queryKey: ['channel-emotes', channelId],
    queryFn: () =>
      api.get<ChannelEmotesResponse>(
        `/api/v2/social-listening/emotes?channelId=${encodeURIComponent(channelId!)}`,
      ),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });

  return useMemo(() => {
    const map = new Map<string, ChannelEmote>();
    for (const e of query.data?.emotes ?? []) map.set(e.code, e);
    return map;
  }, [query.data]);
}

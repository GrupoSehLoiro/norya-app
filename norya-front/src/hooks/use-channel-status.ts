'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { ChannelStatusDto } from '@/lib/monitoring-types';

/**
 * Polling do status on/off do canal a cada 10s.
 *
 * Backend retorna `online: true` quando existe LiveSession ACTIVE
 * (handler `stream.online` do bridge cria isso quando Twitch emite o
 * evento). Quando o canal cai, o stream.offline / stale-closer fecha
 * a sessão e voltamos pra `online: false`.
 *
 * Quando `online === false`, o orchestrator NÃO vai gerar novos
 * insights — o ChatBuffer fica vazio porque o EventSub não está mandando
 * msgs (sem live, sem chat).
 */
export function useChannelStatus(channelId: string | null) {
  return useQuery<ChannelStatusDto>({
    enabled: !!channelId,
    queryKey: ['channel-status', channelId],
    queryFn: () => api.get<ChannelStatusDto>(
      `/api/v2/monitoring/channel-status/${encodeURIComponent(channelId!)}`,
    ),
    // SSE (use-monitoring-realtime) empurra os flips instantaneamente; este
    // poll é fallback caso a conexão SSE caia — 10s limita o pior caso.
    refetchInterval: 10_000,
  });
}

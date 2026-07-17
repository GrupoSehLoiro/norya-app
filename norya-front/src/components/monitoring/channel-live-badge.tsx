'use client';

import { Badge } from '@/components/ui/badge';
import { useChannelStatus } from '@/hooks/use-channel-status';

/**
 * Indicador somente-leitura do status ao vivo de um canal.
 *
 * Substituiu o antigo ChannelLiveToggle ("Simular live"/"Encerrar"): com o
 * EventSub + SessionHelixReconcilerCron, a sessão espelha a live REAL da
 * Twitch — botão manual só criava estado divergente (sessão encerrada com a
 * stream ainda no ar era reaberta pelo reconciler em ≤60s, e cada view via
 * uma coisa no intervalo). Quem precisar forçar sessão em teste usa a API
 * (`POST /api/v2/monitoring/sessions/start|:id/stop`) via curl.
 */
export function ChannelLiveBadge({ channelId }: { channelId: string }) {
  const status = useChannelStatus(channelId);

  if (status.isLoading) {
    return <span className="text-xs text-ink-400">…</span>;
  }

  const isOnline = status.data?.online ?? false;
  return (
    <Badge tone={isOnline ? 'positive' : 'neutral'}>{isOnline ? '🟢 live' : 'offline'}</Badge>
  );
}

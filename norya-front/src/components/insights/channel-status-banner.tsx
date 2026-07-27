'use client';

import { Badge } from '@/components/ui/badge';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { formatDate, formatRelative } from '@/lib/utils';

/**
 * Banner indicating the channel on/off state.
 */
export function ChannelStatusBanner({ channelId }: { channelId: string | null }) {
  const status = useChannelStatus(channelId);

  if (!channelId) return null;
  if (status.isLoading || status.error || !status.data) return null;

  if (status.data.online) {
    const since = status.data.currentSession?.startedAt;
    return (
      <div className="flex items-center justify-between rounded-2xl border border-ok/30 bg-ok/[0.08] px-4 py-2.5 text-sm text-ok">
        <div className="flex items-center gap-2">
          <span className="relative inline-block h-2 w-2 rounded-full bg-ok">
            <span className="absolute inset-[-3px] rounded-full bg-ok opacity-20 animate-led-halo" />
          </span>
          <span className="font-semibold uppercase tracking-[0.12em] text-[11px]">AO VIVO</span>
          {since && (
            <span className="text-ok/80 text-xs">· há {formatRelative(since)}</span>
          )}
        </div>
        <Badge tone="positive">lendo o chat</Badge>
      </div>
    );
  }

  const last = status.data.lastSession;
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-warn/30 bg-warn/[0.08] px-4 py-3 text-sm text-warn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-warn" />
          <span className="font-semibold uppercase tracking-[0.12em] text-[11px]">Canal offline</span>
        </div>
        <Badge tone="warn">pausado</Badge>
      </div>
      <p className="text-xs text-warn/80">
        Sem novas análises enquanto a live não voltar. Os cards abaixo, se houver,
        são da última leitura do chat.
      </p>
      {last?.endedAt && (
        <p className="text-xs text-warn/60">
          última live terminou em {formatDate(last.endedAt)} ({formatRelative(last.endedAt)})
        </p>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { api, ApiError } from '@/lib/api-client';

/**
 * Toggle manual de LiveSession para um canal — equivale a simular
 * `stream.online`/`stream.offline` sem precisar do EventSub real.
 *
 * Bate em `POST /api/v2/monitoring/sessions/start` (cria sessão ACTIVE)
 * e `POST /api/v2/monitoring/sessions/:id/stop` (encerra). O backend
 * exige que o caller seja owner do canal OU role=admin.
 *
 * Útil pra:
 *  - Demo do banner on/off no /insights sem stream Twitch real
 *  - Testar manualmente que o orchestrator só roda quando ON
 *  - Forçar o início de extração pro caso de EventSub atrasar
 */
export function ChannelLiveToggle({ channelId }: { channelId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const status = useChannelStatus(channelId);

  const startMut = useMutation({
    mutationFn: () => api.post('/api/v2/monitoring/sessions/start', {
      channelId, title: 'Sessão manual via console',
    }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['channel-status', channelId] });
      void qc.invalidateQueries({ queryKey: ['monitoring-sessions'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'falha'),
  });

  const stopMut = useMutation({
    mutationFn: (sessionId: string) =>
      api.post(`/api/v2/monitoring/sessions/${sessionId}/stop`),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['channel-status', channelId] });
      void qc.invalidateQueries({ queryKey: ['monitoring-sessions'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'falha'),
  });

  if (status.isLoading) {
    return <span className="text-xs text-ink-400">…</span>;
  }

  const isOnline = status.data?.online ?? false;
  const currentSessionId = status.data?.currentSession?.id;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Badge tone={isOnline ? 'positive' : 'neutral'}>
          {isOnline ? '🟢 live' : 'offline'}
        </Badge>
        {isOnline && currentSessionId ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => stopMut.mutate(currentSessionId)}
            disabled={stopMut.isPending}
          >
            Encerrar
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending}
          >
            Simular live
          </Button>
        )}
      </div>
      {error && <p className="text-[10px] text-err">{error}</p>}
    </div>
  );
}

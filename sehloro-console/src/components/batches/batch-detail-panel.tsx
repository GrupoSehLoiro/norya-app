'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import type { BatchDetail, BatchMessage } from '@/lib/batches-types';

interface Props {
  batchId: string;
}

function sentimentTone(hint?: string): {
  tone: 'positive' | 'negative' | 'neutral' | 'accent' | 'warn';
  label: string;
  accent: string;
} {
  switch (hint) {
    case 'positive':
      return { tone: 'positive', label: '+', accent: 'border-l-ok' };
    case 'negative':
      return { tone: 'negative', label: '−', accent: 'border-l-err' };
    case 'neutral':
      return { tone: 'neutral', label: '○', accent: 'border-l-white/20' };
    default:
      return { tone: 'neutral', label: '·', accent: 'border-l-white/10' };
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function BatchDetailPanel({ batchId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['batch-detail', batchId],
    queryFn: () => api.get<BatchDetail>(`/api/v2/social-listening/batches/${encodeURIComponent(batchId)}`),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <p className="text-sm text-ink-400">Carregando mensagens…</p>;
  if (error)    return <p className="text-sm text-err">{(error as Error).message}</p>;
  if (!data || data.messages.length === 0) {
    return <p className="text-sm text-ink-400">Sem mensagens neste batch.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>
          Janela:{' '}
          <span className="font-mono text-ink-700">{new Date(data.windowStart).toLocaleString('pt-BR')}</span>
          {' → '}
          <span className="font-mono text-ink-700">{new Date(data.windowEnd).toLocaleString('pt-BR')}</span>
        </span>
        <span>{data.messages.length} msgs · {data.uniqueUsers} users</span>
      </div>

      <ul className="space-y-1.5">
        {data.messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ message }: { message: BatchMessage }) {
  const sent = sentimentTone(message.sentimentHint);
  return (
    <li
      className={`flex items-start gap-3 rounded-lg border-l-2 ${sent.accent} bg-white/[0.025] px-3 py-2`}
    >
      <span className="mt-0.5 font-mono text-[11px] text-ink-400">
        {formatTime(message.receivedAt)}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-ink-800">
            {message.displayName || message.username}
          </span>
          {message.isMod && <Badge tone="accent">MOD</Badge>}
          {message.isSubscriber && <Badge tone="positive">SUB</Badge>}
          {message.sentimentHint && message.sentimentHint !== 'neutral' && (
            <Badge tone={sent.tone}>{message.sentimentHint}</Badge>
          )}
        </div>
        <p className="mt-0.5 break-words text-sm text-ink-700">{message.text}</p>
        {message.emotes && message.emotes.length > 0 && (
          <p className="mt-1 font-mono text-[10px] text-ink-400">
            emotes: {message.emotes.join(', ')}
          </p>
        )}
      </div>
    </li>
  );
}

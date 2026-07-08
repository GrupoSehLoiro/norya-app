'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { BatchListResponse, BatchSummary } from '@/lib/batches-types';
import { BatchDetailPanel } from './batch-detail-panel';

interface Props {
  channelId: string;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export function BatchList({ channelId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['batches', channelId],
    queryFn: () =>
      api.get<BatchListResponse>(
        `/api/v2/social-listening/batches?channelId=${encodeURIComponent(channelId)}&limit=200`,
      ),
    refetchInterval: 20_000,
  });

  if (isLoading) return <Card>Carregando batches…</Card>;
  if (error) {
    return (
      <Card className="border border-err/30 bg-err/[0.08] text-err">
        {(error as Error).message}
      </Card>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Sem batches ainda"
        description="Quando o canal estiver ao vivo e o orchestrator processar mensagens, os batches aparecem aqui."
      />
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="divide-y divide-white/[0.05]">
        {items.map((b) => {
          const isOpen = expanded === b.batchId;
          return (
            <li key={b.batchId} className="transition-colors hover:bg-white/[0.03]">
              <BatchRow
                batch={b}
                isOpen={isOpen}
                onToggle={() => setExpanded(isOpen ? null : b.batchId)}
                stamp={formatStamp(b.windowStart)}
                ago={timeAgo(b.windowStart)}
              />
              {isOpen && (
                <div className="border-t border-white/[0.05] bg-white/[0.02] px-5 py-4">
                  <BatchDetailPanel batchId={b.batchId} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BatchRow({
  batch, isOpen, onToggle, stamp, ago,
}: {
  batch: BatchSummary;
  isOpen: boolean;
  onToggle: () => void;
  stamp: string;
  ago: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-4 px-5 py-3 text-left"
    >
      <span
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-300 transition-transform ${
          isOpen ? 'rotate-90' : ''
        }`}
        aria-hidden
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-mono text-sm font-medium text-ink-800">
          {stamp}
          <span className="font-sans text-xs font-normal text-ink-400">· {ago}</span>
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">{batch.batchId}</p>
      </div>

      <div className="flex items-center gap-2">
        <Badge tone="accent">{batch.messageCount} msgs</Badge>
        <Badge tone="neutral">{batch.uniqueUsers} users</Badge>
      </div>
    </button>
  );
}

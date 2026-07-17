'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchChatTopics, fetchChatTopicsHistory } from '@/lib/analytics';

function fmtHour(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

type Preset = 'today' | 'yesterday' | '7d';

function range(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const startOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  // Fim do dia como limite superior — não o `now` do mount. O `range` é
  // memoizado por `preset`, então usar `now` congelava o `to` no instante em
  // que o painel montou: batches que chegavam DEPOIS (live em andamento)
  // ficavam fora da janela e "Assuntos do chat" seguia vazio mesmo com dados.
  const endOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  if (preset === 'today') {
    return { from: startOf(now).toISOString(), to: endOf(now).toISOString() };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOf(y).toISOString(), to: endOf(y).toISOString() };
  }
  const week = new Date(now);
  week.setDate(week.getDate() - 7);
  return { from: startOf(week).toISOString(), to: endOf(now).toISOString() };
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
];

/**
 * "Assuntos do chat" — labels dos assuntos mais comentados + descrição via IA
 * (Haiku) para o período escolhido. Fica ao lado do Feed ao vivo.
 */
export function ChatTopicsPanel({ channelId }: { channelId: string | null }) {
  const [preset, setPreset] = useState<Preset>('today');
  const r = useMemo(() => range(preset), [preset]);

  const topics = useQuery({
    enabled: !!channelId,
    queryKey: ['chat-topics', channelId, preset],
    queryFn: () => fetchChatTopics(channelId!, r.from, r.to),
    staleTime: 30_000,
    refetchInterval: 30_000, // dinâmico
  });
  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['chat-topics-history', channelId, preset],
    queryFn: () => fetchChatTopicsHistory(channelId!, r.from, r.to),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader
        eyebrow="IA"
        title="Assuntos do chat"
        description="O que mais foi pautado no chat, descrito pela IA."
        actions={
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                  (preset === p.key
                    ? 'bg-accent-400 text-bg-0'
                    : 'bg-white/[0.05] text-ink-400 hover:text-ink-700')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {!channelId ? (
        <p className="text-sm text-ink-400">Selecione um canal.</p>
      ) : topics.isLoading ? (
        <p className="text-sm text-ink-400">analisando…</p>
      ) : topics.isError ? (
        <p className="text-sm text-err">Falha ao carregar (precisa do ClickHouse no ar).</p>
      ) : (topics.data?.messageCount ?? 0) === 0 ? (
        <p className="text-sm text-ink-400">Sem mensagens nesse período ainda.</p>
      ) : (
        <div className="space-y-4">
          {topics.data!.labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {topics.data!.labels.map((l) => (
                <span
                  key={l}
                  className="rounded-full border border-accent-400/30 bg-accent-400/[0.08] px-3 py-1 text-sm text-ink-800"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm leading-relaxed text-ink-700">{topics.data!.summary}</p>
          <div className="flex items-center justify-between text-[11px] text-ink-400">
            <span>{topics.data!.messageCount} mensagens no período</span>
            <Badge tone={topics.data!.aiEnabled ? 'positive' : 'neutral'}>
              {topics.data!.aiEnabled ? 'via Haiku' : 'heurístico'}
            </Badge>
          </div>
        </div>
      )}

      {/* Histórico de assuntos por timestamp */}
      {channelId && (history.data?.length ?? 0) > 0 && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
            Histórico (por hora)
          </p>
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {history.data!.map((b) => (
              <li key={b.bucket} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-700">{fmtHour(b.bucket)}</span>
                  <span className="text-[10px] text-ink-400">{b.messageCount} msgs</span>
                </div>
                {b.labels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {b.labels.map((l) => (
                      <span key={l} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ink-600">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
